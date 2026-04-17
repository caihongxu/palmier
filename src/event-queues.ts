/**
 * Per-task in-memory event queues for event-triggered schedules
 * (schedule_type: "on_new_notification" | "on_new_sms").
 *
 * The daemon owns the NATS subscription and populates these queues; the
 * `palmier run` process drains them via the localhost /task-event/pop HTTP
 * endpoint. `activeRuns` tracks whether a run process is currently draining,
 * so we don't race a fresh startTask with a teardown-phase run.
 *
 * Lifecycle invariants:
 *   - activeRuns is cleared atomically inside popEvent when the queue is
 *     drained. At that point the calling run has already finished its last
 *     agent invocation and is only tearing down.
 *   - enqueueEvent returns shouldStart=true only if the task transitioned
 *     from idle (no active run) to active — callers must then startTask.
 */

const MAX_QUEUE_SIZE = 100;

const queues = new Map<string, string[]>();
const activeRuns = new Set<string>();

/**
 * Queue a raw (JSON-string) event payload for a task. Returns whether the
 * caller should now start the run process.
 */
export function enqueueEvent(taskId: string, payload: string): { shouldStart: boolean } {
  const queue = queues.get(taskId) ?? [];
  if (queue.length >= MAX_QUEUE_SIZE) queue.shift();
  queue.push(payload);
  queues.set(taskId, queue);

  if (activeRuns.has(taskId)) return { shouldStart: false };
  activeRuns.add(taskId);
  return { shouldStart: true };
}

/**
 * Pop the oldest queued event for a task. Returns `{ event }` when one is
 * available (keeps the task marked active), or `{ empty: true }` after
 * clearing the active flag atomically.
 */
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
