import { randomUUID } from "crypto";
import { agentTools, agentToolMap, agentResources, agentResourceMap, ToolError, type ToolContext } from "./mcp-tools.js";

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpResponse {
  body: object;
  sessionId?: string;
  /** If true, the HTTP transport should keep the response open as an SSE stream for server-initiated notifications. */
  stream?: boolean;
}

// Resource subscriptions: sessionId → Set of resource URIs
const resourceSubscriptions = new Map<string, Set<string>>();

export function getResourceSubscriptions(): Map<string, Set<string>> {
  return resourceSubscriptions;
}

// Session-to-agent name map with 24h TTL
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessionAgents = new Map<string, { agentName: string; expiresAt: number }>();

export function getAgentName(sessionId: string): string | undefined {
  const entry = sessionAgents.get(sessionId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    sessionAgents.delete(sessionId);
    return undefined;
  }
  return entry.agentName;
}

function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [id, entry] of sessionAgents) {
    if (now > entry.expiresAt) {
      sessionAgents.delete(id);
      resourceSubscriptions.delete(id);
    }
  }
}

function rpcError(id: string | number | null, code: number, message: string): object {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function rpcResult(id: string | number | null, result: unknown): object {
  return { jsonrpc: "2.0", id, result };
}

export async function handleMcpRequest(body: string, sessionId: string | undefined, ctx: ToolContext): Promise<McpResponse> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(body);
  } catch {
    return { body: rpcError(null, -32700, "Parse error") };
  }

  const id = req.id ?? null;

  if (req.jsonrpc !== "2.0") {
    return { body: rpcError(id, -32600, "Invalid Request: missing jsonrpc 2.0") };
  }

  const agent = sessionId ? getAgentName(sessionId) : undefined;
  const sid = sessionId?.slice(0, 8) ?? "none";
  const logPrefix = agent ? `[mcp] [${sid}] [${agent}]` : `[mcp] [${sid}]`;
  console.log(`${logPrefix} ${req.method}${req.method === "tools/call" ? ` → ${req.params?.name}` : ""}`);

  switch (req.method) {
    case "initialize": {
      const newSessionId = randomUUID();
      const clientInfo = req.params?.clientInfo as { name?: string; version?: string } | undefined;
      const agentName = clientInfo
        ? `${clientInfo.name || "unknown"}${clientInfo.version ? ` ${clientInfo.version}` : ""}`
        : undefined;

      if (agentName) {
        sessionAgents.set(newSessionId, { agentName, expiresAt: Date.now() + SESSION_TTL_MS });
        pruneExpiredSessions();
      }

      console.log(`[mcp] [${newSessionId.slice(0, 8)}] Session initialized${agentName ? ` (${agentName})` : ""}`);
      return {
        body: rpcResult(id, {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {}, resources: { subscribe: true } },
          serverInfo: { name: "palmier", version: "1.0.0" },
        }),
        sessionId: newSessionId,
      };
    }

    case "tools/list": {
      return {
        body: rpcResult(id, {
          tools: agentTools.map((t) => ({
            name: t.name,
            description: t.description.join(" "),
            inputSchema: t.inputSchema,
          })),
        }),
      };
    }

    case "tools/call": {
      const name = req.params?.name as string | undefined;
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;

      if (!name) return { body: rpcError(id, -32602, "Missing params.name") };

      const tool = agentToolMap.get(name);
      if (!tool) return { body: rpcError(id, -32602, `Unknown tool: ${name}`) };

      try {
        const result = await tool.handler(args, ctx);
        console.log(`${logPrefix} tools/call ${name} done:`, JSON.stringify(result).slice(0, 200));
        return {
          body: rpcResult(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
          }),
        };
      } catch (err: any) {
        const message = err instanceof ToolError ? err.message : String(err);
        console.error(`${logPrefix} tools/call ${name} error:`, message);
        return {
          body: rpcResult(id, {
            content: [{ type: "text", text: JSON.stringify({ error: message }) }],
            isError: true,
          }),
        };
      }
    }

    case "resources/list": {
      return {
        body: rpcResult(id, {
          resources: agentResources.map((r) => ({
            uri: r.uri,
            name: r.name,
            description: r.description[0],
            mimeType: r.mimeType,
          })),
        }),
      };
    }

    case "resources/read": {
      const uri = req.params?.uri as string;
      const resource = agentResourceMap.get(uri);
      if (!resource) {
        return { body: rpcError(id, -32602, `Unknown resource: ${uri}`) };
      }
      return {
        body: rpcResult(id, {
          contents: [{
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: JSON.stringify(resource.read()),
          }],
        }),
      };
    }

    case "resources/subscribe": {
      const uri = req.params?.uri as string;
      if (!agentResourceMap.has(uri)) {
        return { body: rpcError(id, -32602, `Unknown resource: ${uri}`) };
      }
      if (!sessionId) {
        return { body: rpcError(id, -32600, "Session required for subscriptions") };
      }
      if (!resourceSubscriptions.has(sessionId)) {
        resourceSubscriptions.set(sessionId, new Set());
      }
      resourceSubscriptions.get(sessionId)!.add(uri);
      return { body: rpcResult(id, {}), stream: true };
    }

    case "resources/unsubscribe": {
      const uri = req.params?.uri as string;
      if (sessionId) {
        resourceSubscriptions.get(sessionId)?.delete(uri);
      }
      return { body: rpcResult(id, {}) };
    }

    default:
      console.warn(`${logPrefix} Unknown method: ${req.method}`);
      return { body: rpcError(id, -32601, `Method not found: ${req.method}`) };
  }
}
