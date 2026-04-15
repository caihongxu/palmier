import { StringCodec, type NatsConnection } from "nats";
import { registerPending } from "./pending-requests.js";
import { getLocationDevice } from "./location-device.js";
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
  description: string;
  inputSchema: object;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

const notifyTool: ToolDefinition = {
  name: "notify",
  description: "Send a push notification to the user's device.",
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
  description: "Request input from the user. The request blocks until the user responds.",
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
      await ctx.publishEvent("_input", { event_type: "input-resolved", host_id: ctx.config.hostId, session_id: ctx.sessionId, status: "aborted" });
      return { aborted: true };
    }

    await ctx.publishEvent("_input", { event_type: "input-resolved", host_id: ctx.config.hostId, session_id: ctx.sessionId, status: "provided" });
    return { values: response };
  },
};

const requestConfirmationTool: ToolDefinition = {
  name: "request-confirmation",
  description: "Request confirmation from the user. The request blocks until the user confirms or aborts.",
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
  description: "Get the GPS location of the user's mobile device. Blocks until the device responds (up to 30 seconds).",
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
