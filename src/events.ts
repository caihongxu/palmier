import { StringCodec, type NatsConnection } from "nats";
import { loadConfig } from "./config.js";

const sc = StringCodec();

/**
 * Broadcast an event to connected clients via NATS and HTTP SSE.
 *
 * - NATS: publishes to `host-event.{hostId}.{taskId}`
 * - HTTP: POSTs to the serve daemon's `/event` endpoint
 */
export async function publishHostEvent(
  nc: NatsConnection | undefined,
  hostId: string,
  taskId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const subject = `host-event.${hostId}.${taskId}`;

  if (nc) {
    nc.publish(subject, sc.encode(JSON.stringify(payload)));
    console.log(`[nats] ${subject} →`, payload);
  }

  const config = loadConfig();
  const port = config.httpPort ?? 7400;
  try {
    await fetch(`http://localhost:${port}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, ...payload }),
    });
    console.log(`[http] host-event: ${taskId} →`, payload);
  } catch {
    // Serve HTTP may not be ready yet — ignore
  }
}
