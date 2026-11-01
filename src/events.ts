import { loadConfig } from "./config.js";

/** Hands the event to the daemon, which forwards it to the relay and local SSE clients. */
export async function publishHostEvent(
  taskId: string,
  payload: Record<string, unknown>,
): Promise<void> {
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
