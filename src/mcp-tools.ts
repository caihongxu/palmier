import { StringCodec, type NatsConnection } from "nats";
import { registerPending } from "./pending-requests.js";
import { getCapabilityDevice } from "./device-capabilities.js";
import { getNotifications } from "./notification-store.js";
import { getSmsMessages } from "./sms-store.js";
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
    "When you need information from the user (credentials, answers to questions, preferences, clarifications, etc.), do not guess, fail, or prompt via stdout, even in a non-interactive environment — use this instead.",
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

    const pendingPromise = registerPending(ctx.sessionId, "input", questions, {
      session_id: ctx.sessionId,
      session_name: ctx.agentName,
      description,
      input_questions: questions,
    });

    await ctx.publishEvent("_input", {
      event_type: "input-request",
      host_id: ctx.config.hostId,
      session_id: ctx.sessionId,
      session_name: ctx.agentName,
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

    const pendingPromise = registerPending(ctx.sessionId, "confirmation", undefined, {
      session_id: ctx.sessionId,
      session_name: ctx.agentName,
      description,
    });

    await ctx.publishEvent("_confirm", {
      event_type: "confirm-request",
      host_id: ctx.config.hostId,
      session_id: ctx.sessionId,
      session_name: ctx.agentName,
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
    "When you need the user's real-time location, use this.",
    "Blocks until the device responds (up to 30 seconds).",
    'Response: `{"latitude": ..., "longitude": ..., "accuracy": ..., "timestamp": ...}` on success, or `{"error": "..."}` on failure.',
  ],
  inputSchema: {
    type: "object",
    properties: {},
  },
  async handler(_args, ctx) {
    if (!ctx.nc) throw new ToolError("Not connected to server (NATS unavailable)", 503);

    const device = getCapabilityDevice("location");
    if (!device) throw new ToolError("No device has location access enabled", 400);

    const sc = StringCodec();

    const ackReply = await ctx.nc.request(
      `host.${ctx.config.hostId}.fcm.geolocation`,
      sc.encode(JSON.stringify({ hostId: ctx.config.hostId, requestId: ctx.sessionId, fcmToken: device.fcmToken })),
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

const readContactsTool: ToolDefinition = {
  name: "read-contacts",
  description: [
    "Read the contact list from the user's mobile device.",
    "Blocks until the device responds (up to 30 seconds).",
    'Response: `{"contacts": [{"id": ..., "name": ..., "phone": ...}]}` on success, or `{"error": "..."}` on failure.',
  ],
  inputSchema: {
    type: "object",
    properties: {},
  },
  async handler(_args, ctx) {
    if (!ctx.nc) throw new ToolError("Not connected to server (NATS unavailable)", 503);

    const device = getCapabilityDevice("contacts");
    if (!device) throw new ToolError("No device has contacts access enabled", 400);

    const sc = StringCodec();

    const ackReply = await ctx.nc.request(
      `host.${ctx.config.hostId}.fcm.contacts`,
      sc.encode(JSON.stringify({ hostId: ctx.config.hostId, requestId: ctx.sessionId, fcmToken: device.fcmToken, action: "read" })),
      { timeout: 5_000 },
    );
    const ack = JSON.parse(sc.decode(ackReply.data)) as { ok?: boolean; error?: string };
    if (ack.error) throw new ToolError(ack.error, 502);

    const responsePromise = new Promise<string>((resolve, reject) => {
      const sub = ctx.nc!.subscribe(`host.${ctx.config.hostId}.contacts.${ctx.sessionId}`, { max: 1 });
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

    const result = JSON.parse(await responsePromise);
    if (result.error) return { error: result.error };
    return result;
  },
};

const createContactTool: ToolDefinition = {
  name: "create-contact",
  description: [
    "Create a new contact on the user's mobile device.",
    "Blocks until the device responds (up to 30 seconds).",
    'Response: `{"ok": true}` on success, or `{"error": "..."}` on failure.',
  ],
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Contact display name" },
      phone: { type: "string", description: "Phone number" },
      email: { type: "string", description: "Email address" },
    },
    required: ["name"],
  },
  async handler(args, ctx) {
    if (!ctx.nc) throw new ToolError("Not connected to server (NATS unavailable)", 503);

    const device = getCapabilityDevice("contacts");
    if (!device) throw new ToolError("No device has contacts access enabled", 400);

    const { name, phone, email } = args as { name: string; phone?: string; email?: string };
    if (!name) throw new ToolError("name is required", 400);

    const sc = StringCodec();

    const ackReply = await ctx.nc.request(
      `host.${ctx.config.hostId}.fcm.contacts`,
      sc.encode(JSON.stringify({
        hostId: ctx.config.hostId, requestId: ctx.sessionId, fcmToken: device.fcmToken,
        action: "create", name, phone, email,
      })),
      { timeout: 5_000 },
    );
    const ack = JSON.parse(sc.decode(ackReply.data)) as { ok?: boolean; error?: string };
    if (ack.error) throw new ToolError(ack.error, 502);

    const responsePromise = new Promise<string>((resolve, reject) => {
      const sub = ctx.nc!.subscribe(`host.${ctx.config.hostId}.contacts.${ctx.sessionId}`, { max: 1 });
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

    const result = JSON.parse(await responsePromise);
    if (result.error) return { error: result.error };
    return result;
  },
};

const readCalendarTool: ToolDefinition = {
  name: "read-calendar",
  description: [
    "Read calendar events from the user's mobile device.",
    "Blocks until the device responds (up to 30 seconds).",
    "Pass startDate and endDate as Unix timestamps in milliseconds. Defaults to next 7 days.",
    'Response: `{"events": [{"id": ..., "title": ..., "startTime": ..., "endTime": ..., "location": ..., "description": ..., "allDay": ..., "calendar": ...}]}` on success.',
  ],
  inputSchema: {
    type: "object",
    properties: {
      startDate: { type: "number", description: "Start of range (Unix ms). Defaults to now." },
      endDate: { type: "number", description: "End of range (Unix ms). Defaults to 7 days from start." },
    },
  },
  async handler(args, ctx) {
    if (!ctx.nc) throw new ToolError("Not connected to server (NATS unavailable)", 503);

    const device = getCapabilityDevice("calendar");
    if (!device) throw new ToolError("No device has calendar access enabled", 400);

    const { startDate, endDate } = args as { startDate?: number; endDate?: number };
    const sc = StringCodec();

    const ackReply = await ctx.nc.request(
      `host.${ctx.config.hostId}.fcm.calendar`,
      sc.encode(JSON.stringify({
        hostId: ctx.config.hostId, requestId: ctx.sessionId, fcmToken: device.fcmToken,
        action: "read",
        ...(startDate ? { startDate: String(startDate) } : {}),
        ...(endDate ? { endDate: String(endDate) } : {}),
      })),
      { timeout: 5_000 },
    );
    const ack = JSON.parse(sc.decode(ackReply.data)) as { ok?: boolean; error?: string };
    if (ack.error) throw new ToolError(ack.error, 502);

    const responsePromise = new Promise<string>((resolve, reject) => {
      const sub = ctx.nc!.subscribe(`host.${ctx.config.hostId}.calendar.${ctx.sessionId}`, { max: 1 });
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

    const result = JSON.parse(await responsePromise);
    if (result.error) return { error: result.error };
    return result;
  },
};

const createCalendarEventTool: ToolDefinition = {
  name: "create-calendar-event",
  description: [
    "Create a calendar event on the user's mobile device.",
    "Blocks until the device responds (up to 30 seconds).",
    'Response: `{"ok": true}` on success, or `{"error": "..."}` on failure.',
  ],
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Event title" },
      startTime: { type: "number", description: "Start time (Unix ms)" },
      endTime: { type: "number", description: "End time (Unix ms)" },
      location: { type: "string", description: "Event location" },
      description: { type: "string", description: "Event description" },
    },
    required: ["title", "startTime", "endTime"],
  },
  async handler(args, ctx) {
    if (!ctx.nc) throw new ToolError("Not connected to server (NATS unavailable)", 503);

    const device = getCapabilityDevice("calendar");
    if (!device) throw new ToolError("No device has calendar access enabled", 400);

    const { title, startTime, endTime, location, description } = args as {
      title: string; startTime: number; endTime: number; location?: string; description?: string;
    };
    if (!title || !startTime || !endTime) throw new ToolError("title, startTime, and endTime are required", 400);

    const sc = StringCodec();

    const ackReply = await ctx.nc.request(
      `host.${ctx.config.hostId}.fcm.calendar`,
      sc.encode(JSON.stringify({
        hostId: ctx.config.hostId, requestId: ctx.sessionId, fcmToken: device.fcmToken,
        action: "create",
        title, startTime: String(startTime), endTime: String(endTime),
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
      })),
      { timeout: 5_000 },
    );
    const ack = JSON.parse(sc.decode(ackReply.data)) as { ok?: boolean; error?: string };
    if (ack.error) throw new ToolError(ack.error, 502);

    const responsePromise = new Promise<string>((resolve, reject) => {
      const sub = ctx.nc!.subscribe(`host.${ctx.config.hostId}.calendar.${ctx.sessionId}`, { max: 1 });
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

    const result = JSON.parse(await responsePromise);
    if (result.error) return { error: result.error };
    return result;
  },
};

const sendSmsTool: ToolDefinition = {
  name: "send-sms-message",
  description: [
    "Send an SMS message from the user's mobile device.",
    "Blocks until the device responds (up to 30 seconds).",
    'Response: `{"ok": true}` on success, or `{"error": "..."}` on failure.',
  ],
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient phone number" },
      body: { type: "string", description: "Message text" },
    },
    required: ["to", "body"],
  },
  async handler(args, ctx) {
    if (!ctx.nc) throw new ToolError("Not connected to server (NATS unavailable)", 503);

    const device = getCapabilityDevice("sms");
    if (!device) throw new ToolError("No device has SMS access enabled", 400);

    const { to, body } = args as { to: string; body: string };
    if (!to || !body) throw new ToolError("to and body are required", 400);

    const sc = StringCodec();

    const ackReply = await ctx.nc.request(
      `host.${ctx.config.hostId}.fcm.sms`,
      sc.encode(JSON.stringify({
        hostId: ctx.config.hostId, requestId: ctx.sessionId, fcmToken: device.fcmToken,
        action: "send", to, body,
      })),
      { timeout: 5_000 },
    );
    const ack = JSON.parse(sc.decode(ackReply.data)) as { ok?: boolean; error?: string };
    if (ack.error) throw new ToolError(ack.error, 502);

    const responsePromise = new Promise<string>((resolve, reject) => {
      const sub = ctx.nc!.subscribe(`host.${ctx.config.hostId}.sms.${ctx.sessionId}`, { max: 1 });
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

    const result = JSON.parse(await responsePromise);
    if (result.error) return { error: result.error };
    return result;
  },
};

const sendAlertTool: ToolDefinition = {
  name: "send-alert",
  description: [
    "Send an alert to the user's mobile device with an alarm sound and full-screen popup.",
    "Use this to urgently get the user's attention. The device will play an alarm sound and show a full-screen dialog even on the lock screen.",
    "Blocks until the device responds (up to 30 seconds).",
    'Response: `{"ok": true}` on success, or `{"error": "..."}` on failure.',
  ],
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Alert title" },
      description: { type: "string", description: "Alert description/details" },
    },
    required: ["title"],
  },
  async handler(args, ctx) {
    if (!ctx.nc) throw new ToolError("Not connected to server (NATS unavailable)", 503);

    const device = getCapabilityDevice("alert");
    if (!device) throw new ToolError("No device has alert access enabled", 400);

    const { title, description } = args as { title: string; description?: string };
    if (!title) throw new ToolError("title is required", 400);

    const sc = StringCodec();

    const payload: Record<string, string> = {
      hostId: ctx.config.hostId, requestId: ctx.sessionId, fcmToken: device.fcmToken,
      title,
    };
    if (description) payload.description = description;

    const ackReply = await ctx.nc.request(
      `host.${ctx.config.hostId}.fcm.alert`,
      sc.encode(JSON.stringify(payload)),
      { timeout: 5_000 },
    );
    const ack = JSON.parse(sc.decode(ackReply.data)) as { ok?: boolean; error?: string };
    if (ack.error) throw new ToolError(ack.error, 502);

    const responsePromise = new Promise<string>((resolve, reject) => {
      const sub = ctx.nc!.subscribe(`host.${ctx.config.hostId}.alert.${ctx.sessionId}`, { max: 1 });
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

    const result = JSON.parse(await responsePromise);
    if (result.error) return { error: result.error };
    return result;
  },
};

const readBatteryTool: ToolDefinition = {
  name: "read-battery",
  description: [
    "Get the battery level and charging status of the user's mobile device.",
    "Blocks until the device responds (up to 30 seconds).",
    'Response: `{"level": 85, "charging": true}` on success, or `{"error": "..."}` on failure.',
  ],
  inputSchema: {
    type: "object",
    properties: {},
  },
  async handler(_args, ctx) {
    if (!ctx.nc) throw new ToolError("Not connected to server (NATS unavailable)", 503);

    const device = getCapabilityDevice("battery");
    if (!device) throw new ToolError("No device has battery access enabled", 400);

    const sc = StringCodec();

    const ackReply = await ctx.nc.request(
      `host.${ctx.config.hostId}.fcm.battery`,
      sc.encode(JSON.stringify({ hostId: ctx.config.hostId, requestId: ctx.sessionId, fcmToken: device.fcmToken })),
      { timeout: 5_000 },
    );
    const ack = JSON.parse(sc.decode(ackReply.data)) as { ok?: boolean; error?: string };
    if (ack.error) throw new ToolError(ack.error, 502);

    const responsePromise = new Promise<string>((resolve, reject) => {
      const sub = ctx.nc!.subscribe(`host.${ctx.config.hostId}.battery.${ctx.sessionId}`, { max: 1 });
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

    const result = JSON.parse(await responsePromise);
    if (result.error) return { error: result.error };
    return result;
  },
};

const setRingerModeTool: ToolDefinition = {
  name: "set-ringer-mode",
  description: [
    "Set the phone's ringer mode. Requires Do Not Disturb access on the device.",
    "Blocks until the device responds (up to 30 seconds).",
    'Response: `{"ok": true, "mode": "silent"}` on success, or `{"error": "..."}` on failure.',
  ],
  inputSchema: {
    type: "object",
    properties: {
      mode: { type: "string", description: "Ringer mode: 'normal', 'vibrate', or 'silent'" },
    },
    required: ["mode"],
  },
  async handler(args, ctx) {
    if (!ctx.nc) throw new ToolError("Not connected to server (NATS unavailable)", 503);

    const device = getCapabilityDevice("dnd");
    if (!device) throw new ToolError("No device has Do Not Disturb control enabled", 400);

    const { mode } = args as { mode: string };
    if (!["normal", "vibrate", "silent"].includes(mode)) throw new ToolError("mode must be 'normal', 'vibrate', or 'silent'", 400);

    const sc = StringCodec();

    const ackReply = await ctx.nc.request(
      `host.${ctx.config.hostId}.fcm.ringer`,
      sc.encode(JSON.stringify({ hostId: ctx.config.hostId, requestId: ctx.sessionId, fcmToken: device.fcmToken, mode })),
      { timeout: 5_000 },
    );
    const ack = JSON.parse(sc.decode(ackReply.data)) as { ok?: boolean; error?: string };
    if (ack.error) throw new ToolError(ack.error, 502);

    const responsePromise = new Promise<string>((resolve, reject) => {
      const sub = ctx.nc!.subscribe(`host.${ctx.config.hostId}.ringer.${ctx.sessionId}`, { max: 1 });
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

    const result = JSON.parse(await responsePromise);
    if (result.error) return { error: result.error };
    return result;
  },
};

const sendEmailTool: ToolDefinition = {
  name: "send-email",
  description: [
    "Send an email from the user's mobile device.",
    "When you need to send an email, use this. The email app opens on the device with the draft pre-filled for the user to review and send.",
    'Response: `{"ok": true}` on success, or `{"error": "..."}` on failure.',
  ],
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address" },
      subject: { type: "string", description: "Email subject" },
      body: { type: "string", description: "Email body text" },
      cc: { type: "string", description: "CC recipient(s)" },
      bcc: { type: "string", description: "BCC recipient(s)" },
    },
    required: ["to"],
  },
  async handler(args, ctx) {
    if (!ctx.nc) throw new ToolError("Not connected to server (NATS unavailable)", 503);

    const device = getCapabilityDevice("email");
    if (!device) throw new ToolError("No device has email access enabled", 400);

    const { to, subject, body, cc, bcc } = args as { to: string; subject?: string; body?: string; cc?: string; bcc?: string };
    if (!to) throw new ToolError("to is required", 400);

    const sc = StringCodec();

    const payload: Record<string, string> = {
      hostId: ctx.config.hostId, requestId: ctx.sessionId, fcmToken: device.fcmToken,
      to,
    };
    if (subject) payload.subject = subject;
    if (body) payload.body = body;
    if (cc) payload.cc = cc;
    if (bcc) payload.bcc = bcc;

    const ackReply = await ctx.nc.request(
      `host.${ctx.config.hostId}.fcm.email`,
      sc.encode(JSON.stringify(payload)),
      { timeout: 5_000 },
    );
    const ack = JSON.parse(sc.decode(ackReply.data)) as { ok?: boolean; error?: string };
    if (ack.error) throw new ToolError(ack.error, 502);

    const responsePromise = new Promise<string>((resolve, reject) => {
      const sub = ctx.nc!.subscribe(`host.${ctx.config.hostId}.email.${ctx.sessionId}`, { max: 1 });
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

    const result = JSON.parse(await responsePromise);
    if (result.error) return { error: result.error };
    return result;
  },
};

export const agentTools: ToolDefinition[] = [notifyTool, requestInputTool, requestConfirmationTool, deviceGeolocationTool, readContactsTool, createContactTool, readCalendarTool, createCalendarEventTool, sendSmsTool, sendEmailTool, sendAlertTool, readBatteryTool, setRingerModeTool];
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

const deviceSmsResource: ResourceDefinition = {
  uri: "sms-messages://device",
  name: "Device SMS",
  description: [
    "Get recent SMS messages from the user's Android device.",
    "Response: JSON array of message objects with `id`, `sender`, `body`, `timestamp`.",
  ],
  mimeType: "application/json",
  restPath: "/sms-messages",
  read: getSmsMessages,
};

export const agentResources: ResourceDefinition[] = [deviceNotificationsResource, deviceSmsResource];
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
    lines.push(`**\`GET ${baseUrl}${resource.restPath}?taskId=${taskId}\`** — ${header}`);
    for (const detail of details) {
      lines.push(`- ${detail}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
