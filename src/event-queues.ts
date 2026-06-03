/**
 * Per-task in-memory event queues for on_new_notification / on_new_sms schedules.
 * The daemon owns the NATS subscription and populates these queues; the
 * `palmier run` process drains via /task-event/pop.
 *
 * Invariants:
 *   - popEvent clears activeRuns when the queue empties. This races the run's
 *     own teardown (the process/unit is still alive briefly after the empty
 *     pop), so a trigger arriving in that window can set activeRuns yet fail to
 *     launch a run (a oneshot `systemctl start` no-ops on an active unit). The
 *     dispatch watchdog in trigger-dispatch.ts reconciles that stranded state.
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

export function hasPendingEvents(taskId: string): boolean {
  const queue = queues.get(taskId);
  return !!queue && queue.length > 0;
}

export function pendingCount(taskId: string): number {
  return queues.get(taskId)?.length ?? 0;
}

/** Drop a stranded active flag so a fresh run can be launched (watchdog only). */
export function resetActiveRun(taskId: string): void {
  activeRuns.delete(taskId);
}

/** Re-acquire the active flag without enqueuing (watchdog relaunch only). */
export function markActiveRun(taskId: string): void {
  activeRuns.add(taskId);
}

/** Remove any state for a task (called from task.delete). */
export function clearTaskQueue(taskId: string): void {
  queues.delete(taskId);
  activeRuns.delete(taskId);
}
