import * as fs from "fs";
import * as path from "path";
import { StringCodec, type NatsConnection } from "nats";
import { CONFIG_DIR } from "./config.js";

const sc = StringCodec();
const LAN_LOCKFILE = path.join(CONFIG_DIR, "lan.json");

/**
 * Read the LAN lockfile to determine if `palmier lan` is running.
 */
function getLanPort(): number | null {
  try {
    const raw = fs.readFileSync(LAN_LOCKFILE, "utf-8");
    return (JSON.parse(raw) as { port: number }).port;
  } catch { return null; }
}

/**
 * Broadcast an event to connected clients via NATS and HTTP SSE (if LAN server is running).
 *
 * - NATS: publishes to `host-event.{hostId}.{taskId}`
 * - HTTP: POSTs to the LAN server's `/internal/event` endpoint (auto-detected via lockfile)
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

  const lanPort = getLanPort();
  if (lanPort) {
    try {
      await fetch(`http://localhost:${lanPort}/internal/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId, ...payload }),
      });
      console.log(`[http] host-event: ${taskId} →`, payload);
    } catch {
      // LAN server may have shut down — ignore
    }
  }
}
