import { StringCodec, type NatsConnection } from "nats";
import { loadConfig } from "./config.js";

const sc = StringCodec();

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
  const port = config.httpPort ?? 7256;
  try {
    await fetch(`http://localhost:${port}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, ...payload }),
    });
    console.log(`[http] host-event: ${taskId} →`, payload);
  } catch { /* serve HTTP may not be ready yet */ }
}
