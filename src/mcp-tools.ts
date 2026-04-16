import { StringCodec, type NatsConnection } from "nats";
import { registerPending } from "./pending-requests.js";
import { getLocationDevice } from "./location-device.js";
import { getNotifications } from "./notification-store.js";
import type { HostConfig } from "./types.js";

export class ToolError extends Error {
  constructor(message: string, public statusCode: number = 500) {
    super(message);
  }
}

export interface ToolContext {
  config: HostConfig;
  nc: NatsConnection | undefined;
  publishEvent: (id: string, payload: Record<string, unknown>) => Promise<void>;
  sessionId: string;
  agentName?: string;
}

export interface ToolDefinition {
  name: string;
  /** First line is the summary (used as endpoint header). Remaining lines become bullet points in docs. */
  description: string[];
  inputSchema: object;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

const notifyTool: ToolDefinition = {
  name: "notify",
  description: [
    "Send a push notification to the user's device.",
    'Response: `{"ok": true}` on success.',
  ],
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Notification title" },
      body: { type: "string", description: "Notification body" },
    },
    required: ["title", "body"],
  },
  async handler(args, ctx) {
    const { title, body } = args as { title: string; body: string };
    if (!title || !body) throw new ToolError("title and body are required", 400);
    if (!ctx.nc) throw new ToolError("NATS not connected — push notifications require server mode", 503);

    const sc = StringCodec();
    const payload: Record<string, string> = { hostId: ctx.config.hostId, title, body };
    if (ctx.sessionId) payload.session_id = ctx.sessionId;
    if (ctx.agentName) payload.agent_name = ctx.agentName;
    const subject = `host.${ctx.config.hostId}.push.send`;
    const reply = await ctx.nc.request(subject, sc.encode(JSON.stringify(payload)), { timeout: 15_000 });
    const result = JSON.parse(sc.decode(reply.data)) as { ok?: boolean; error?: string };

    if (result.ok) return { ok: true };
    throw new ToolError(result.error ?? "Push notification failed", 502);
  },
};

const requestInputTool: ToolDefinition = {
  name: "request-input",
  description: [
    "Request input from the user.",
    "The request blocks until the user responds.",
    'Response: `{"values": ["answer1", "answer2"]}` on success, or `{"aborted": true}` if the user declines.',
    "When you need information from the user (credentials, answers to questions, preferences, clarifications, etc.), do not guess, fail, or prompt via stdout, even in a non-interactive environment — use this endpoint instead.",
  ],
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string", description: "Context or heading for the input request" },
      questions: {
        type: "array",
        items: { type: "string" },
        description: "Questions to present to the user",
        minItems: 1,
      },
    },
    required: ["questions"],
  },
  async handler(args, ctx) {
    const { description, questions } = args as { description?: string; questions: string[] };
    if (!questions?.length) throw new ToolError("questions is required", 400);

    const pendingPromise = registerPending(ctx.sessionId, "input", questions);

    await ctx.publishEvent("_input", {
      event_type: "input-request",
      host_id: ctx.config.hostId,
      session_id: ctx.sessionId,
      agent_name: ctx.agentName,
      description,
      input_questions: questions,
    });

    const response = await pendingPromise;

    if (response.length === 1 && response[0] === "aborted") {
      await ctx.publishEvent("_input", {
        event_type: "input-resolved", host_id: ctx.config.hostId,
        session_id: ctx.sessionId, status: "aborted",
      });
      return { aborted: true };
    }

    await ctx.publishEvent("_input", {
      event_type: "input-resolved", host_id: ctx.config.hostId,
      session_id: ctx.sessionId, status: "provided",
    });
    return { values: response };
  },
};

const requestConfirmationTool: ToolDefinition = {
  name: "request-confirmation",
  description: [
    "Request confirmation from the user.",
    "The request blocks until the user confirms or aborts.",
    'Response: `{"confirmed": true}` or `{"confirmed": false}`.',
  ],
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string", description: "What the user is confirming" },
    },
    required: ["description"],
  },
  async handler(args, ctx) {
    const { description } = args as { description: string };
    if (!description) throw new ToolError("description is required", 400);

    const pendingPromise = registerPending(ctx.sessionId, "confirmation");

    await ctx.publishEvent("_confirm", {
      event_type: "confirm-request",
      host_id: ctx.config.hostId,
      session_id: ctx.sessionId,
      agent_name: ctx.agentName,
      description,
    });

    const response = await pendingPromise;
    const confirmed = response[0] === "confirmed";

    await ctx.publishEvent("_confirm", {
      event_type: "confirm-resolved",
      host_id: ctx.config.hostId,
      session_id: ctx.sessionId,
      status: confirmed ? "confirmed" : "aborted",
    });

    return { confirmed };
  },
};

const deviceGeolocationTool: ToolDefinition = {
  name: "device-geolocation",
  description: [
    "Get the GPS location of the user's mobile device.",
    "When you need the user's real-time location, use this endpoint.",
    "Blocks until the device responds (up to 30 seconds).",
    'Response: `{"latitude": ..., "longitude": ..., "accuracy": ..., "timestamp": ...}` on success, or `{"error": "..."}` on failure.',
  ],
  inputSchema: {
    type: "object",
    properties: {},
  },
  async handler(_args, ctx) {
    if (!ctx.nc) throw new ToolError("Not connected to server (NATS unavailable)", 503);

    const locDevice = getLocationDevice();
    if (!locDevice) throw new ToolError("No device has location access enabled", 400);

    const sc = StringCodec();

    const ackReply = await ctx.nc.request(
      `host.${ctx.config.hostId}.fcm.geolocation`,
      sc.encode(JSON.stringify({ hostId: ctx.config.hostId, requestId: ctx.sessionId, fcmToken: locDevice.fcmToken })),
      { timeout: 5_000 },
    );
    const ack = JSON.parse(sc.decode(ackReply.data)) as { ok?: boolean; error?: string };
    if (ack.error) throw new ToolError(ack.error, 502);

    const locationPromise = new Promise<string>((resolve, reject) => {
      const sub = ctx.nc!.subscribe(`host.${ctx.config.hostId}.geolocation.${ctx.sessionId}`, { max: 1 });
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new ToolError("Device did not respond within 30 seconds", 504));
      }, 30_000);

      (async () => {
        for await (const msg of sub) {
          clearTimeout(timer);
          resolve(sc.decode(msg.data));
        }
      })();
    });

    const locationData = JSON.parse(await locationPromise);
    if (locationData.error) return { error: locationData.error };
    return locationData;
  },
};

export const agentTools: ToolDefinition[] = [notifyTool, requestInputTool, requestConfirmationTool, deviceGeolocationTool];
export const agentToolMap = new Map<string, ToolDefinition>(agentTools.map((t) => [t.name, t]));

// ── MCP Resources ─────────────────────────────────────────────────────

export interface ResourceDefinition {
  /** MCP resource URI (e.g. "notifications://device"). */
  uri: string;
  /** Display name. */
  name: string;
  /** First line is the summary (used as REST endpoint header). Remaining lines become bullet points in docs. */
  description: string[];
  mimeType: string;
  /** REST endpoint path (e.g. "/notifications"). Served as GET. */
  restPath: string;
  /** Return the current resource content. */
  read: () => unknown;
}

const deviceNotificationsResource: ResourceDefinition = {
  uri: "notifications://device",
  name: "Device Notifications",
  description: [
    "Get recent notifications from the user's Android device.",
    "Response: JSON array of notification objects with `id`, `packageName`, `appName`, `title`, `text`, `timestamp`.",
  ],
  mimeType: "application/json",
  restPath: "/notifications",
  read: getNotifications,
};

export const agentResources: ResourceDefinition[] = [deviceNotificationsResource];
export const agentResourceMap = new Map<string, ResourceDefinition>(agentResources.map((r) => [r.uri, r]));

/**
 * Generate the HTTP Endpoints markdown section for agent-instructions.md from the tool registry.
 */
export function generateEndpointDocs(
  port: number,
  taskId: string,
  tools: ToolDefinition[] = agentTools,
  resources: ResourceDefinition[] = agentResources,
): string {
  const baseUrl = `http://localhost:${port}`;
  const lines: string[] = [
    `The following HTTP endpoints are available during task execution. Use curl to call them.`,
    "",
  ];

  for (const tool of tools) {
    const schema = tool.inputSchema as { properties?: Record<string, { type?: string; description?: string; items?: { type?: string } }>; required?: string[] };
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);

    // Build example JSON (body only, no taskId)
    const example: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(props)) {
      if (prop.type === "array") example[key] = ["..."];
      else example[key] = "...";
    }

    const queryUrl = `${baseUrl}/${tool.name}?taskId=${taskId}`;
    const [header, ...details] = tool.description;

    lines.push(`**\`POST ${queryUrl}\`** — ${header}`);
    if (Object.keys(example).length > 0) {
      lines.push("```json");
      lines.push(JSON.stringify(example));
      lines.push("```");
    }
    for (const [key, prop] of Object.entries(props)) {
      const req = required.has(key) ? "required" : "optional";
      let typeStr = prop.type ?? "unknown";
      if (prop.type === "array" && prop.items?.type) typeStr = `${prop.items.type} array`;
      lines.push(`- \`${key}\` (${req}, ${typeStr}): ${prop.description ?? ""}`);
    }
    for (const detail of details) {
      lines.push(`- ${detail}`);
    }

    lines.push("");
  }

  for (const resource of resources) {
    const [header, ...details] = resource.description;
    lines.push(`**\`GET ${baseUrl}${resource.restPath}\`** — ${header}`);
    for (const detail of details) {
      lines.push(`- ${detail}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
