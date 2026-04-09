import { StringCodec, type NatsConnection, type Msg, type Subscription } from "nats";
import type { HostConfig, RpcMessage } from "../types.js";

/**
 * Start the NATS transport using an existing connection.
 * Subscribe to RPC subjects and dispatch to handler.
 */
export async function startNatsTransport(
  config: HostConfig,
  handleRpc: (req: RpcMessage) => Promise<unknown>,
  nc: NatsConnection,
): Promise<void> {
  const sc = StringCodec();

  const subject = `host.${config.hostId}.rpc.>`;
  console.log(`[nats] Subscribing to: ${subject}`);
  const sub = nc.subscribe(subject);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[nats] Shutting down...");
    sub.unsubscribe();
    await nc.drain();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  async function processMessage(msg: Msg) {
    // Derive RPC method from subject: ...rpc.<method parts>
    const subjectTokens = msg.subject.split(".");
    const rpcIdx = subjectTokens.indexOf("rpc");
    const method = rpcIdx >= 0 ? subjectTokens.slice(rpcIdx + 1).join(".") : "";

    // Parse params from message body
    let params: Record<string, unknown> = {};
    if (msg.data && msg.data.length > 0) {
      const raw = sc.decode(msg.data).trim();
      if (raw.length > 0) {
        try {
          params = JSON.parse(raw);
        } catch {
          console.error(`[nats] Failed to parse RPC params for ${method}`);
          if (msg.reply) {
            msg.respond(sc.encode(JSON.stringify({ error: "Invalid JSON" })));
          }
          return;
        }
      }
    }

    // Extract clientToken from params (PWA includes it in the payload)
    const clientToken = typeof params.clientToken === "string" ? params.clientToken : undefined;
    delete params.clientToken;

    console.log(`[nats] RPC: ${method}`);

    let response: unknown;
    try {
      response = await handleRpc({ method, params, clientToken });
    } catch (err) {
      console.error(`[nats] RPC error (${method}):`, err);
      response = { error: String(err) };
    }

    console.log(`[nats] RPC done: ${method}`, JSON.stringify(response).slice(0, 200));
    if (msg.reply) {
      msg.respond(sc.encode(JSON.stringify(response)));
    }
  }

  async function consumeSubscription(subscription: Subscription) {
    for await (const msg of subscription) {
      // Handle RPC without blocking the message loop so heartbeats keep flowing
      processMessage(msg);
    }
  }

  console.log("[nats] Waiting for RPC messages...");
  await consumeSubscription(sub);
}
