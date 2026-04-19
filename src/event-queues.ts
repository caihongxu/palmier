/**
 * Per-task in-memory event queues for on_new_notification / on_new_sms schedules.
 * The daemon owns the NATS subscription and populates these queues; the
 * `palmier run` process drains via /task-event/pop.
 *
 * Invariants:
 *   - popEvent clears activeRuns atomically when the queue empties, so a
 *     fresh startTask cannot race the tearing-down run.
 *   - enqueueEvent returns shouldStart=true only on the idle→active edge.
 */

const MAX_QUEUE_SIZE = 100;

const queues = new Map<string, string[]>();
const activeRuns = new Set<string>();

export function enqueueEvent(taskId: string, payload: string): { shouldStart: boolean } {
  const queue = queues.get(taskId) ?? [];
  if (queue.length >= MAX_QUEUE_SIZE) queue.shift();
  queue.push(payload);
  queues.set(taskId, queue);

  if (activeRuns.has(taskId)) return { shouldStart: false };
  activeRuns.add(taskId);
  return { shouldStart: true };
}

export function popEvent(taskId: string): { event: string } | { empty: true } {
  const queue = queues.get(taskId);
  if (queue && queue.length > 0) {
    return { event: queue.shift()! };
  }
  activeRuns.delete(taskId);
  return { empty: true };
}

/** Remove any state for a task (called from task.delete). */
export function clearTaskQueue(taskId: string): void {
  queues.delete(taskId);
  activeRuns.delete(taskId);
}
