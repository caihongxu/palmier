import { agentTools, agentToolMap, ToolError, type ToolContext } from "./mcp-tools.js";

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcError(id: string | number | null, code: number, message: string): object {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function rpcResult(id: string | number | null, result: unknown): object {
  return { jsonrpc: "2.0", id, result };
}

export async function handleMcpRequest(body: string, ctx: ToolContext): Promise<object> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(body);
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const id = req.id ?? null;

  if (req.jsonrpc !== "2.0") {
    return rpcError(id, -32600, "Invalid Request: missing jsonrpc 2.0");
  }

  switch (req.method) {
    case "initialize": {
      return rpcResult(id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "palmier", version: "1.0.0" },
      });
    }

    case "tools/list": {
      const tools = agentTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return rpcResult(id, { tools });
    }

    case "tools/call": {
      const name = req.params?.name as string | undefined;
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;

      if (!name) return rpcError(id, -32602, "Missing params.name");

      const tool = agentToolMap.get(name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);

      try {
        const result = await tool.handler(args, ctx);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
        });
      } catch (err: any) {
        const message = err instanceof ToolError ? err.message : String(err);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify({ error: message }) }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}
