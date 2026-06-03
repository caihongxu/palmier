/**
 * Shared entry point for trigger-driven tasks (on_new_* device events and
 * command-output lines): enqueue the payload, launch a run on the idle→active
 * edge, and run a self-healing watchdog.
 *
 * Why the watchdog: the per-task active flag is cleared on the empty pop while
 * the previous run is still tearing down (its OS unit still "active"). A
 * trigger landing in that window re-sets the flag but its `startTask` no-ops on
 * the still-active unit, stranding the queued payload forever. The watchdog
 * detects "work queued but no live run" shortly after triggers quiesce and
 * relaunches. High-frequency sources (commands) would otherwise wedge fast.
 */

import { enqueueEvent, hasPendingEvents, pendingCount, resetActiveRun, markActiveRun } from "./event-queues.js";
import { getPlatform } from "./platform/index.js";

const WATCHDOG_MS = 3000;
const watchdogs = new Map<string, ReturnType<typeof setTimeout>>();

function startRun(taskId: string): void {
  console.log(`[trigger] ${taskId} requesting run start`);
  getPlatform().startTask(taskId)
    .then(() => console.log(`[trigger] ${taskId} run start request returned`))
    .catch((err) => console.error(`[trigger] failed to start run for ${taskId}:`, err));
}

function armWatchdog(taskId: string): void {
  const existing = watchdogs.get(taskId);
  if (existing) clearTimeout(existing);
  watchdogs.set(taskId, setTimeout(() => watchdogTick(taskId), WATCHDOG_MS));
}

function watchdogTick(taskId: string): void {
  watchdogs.delete(taskId);
  if (!hasPendingEvents(taskId)) return;
  // A run is mid-flight and will drain the queue — check again later.
  if (getPlatform().isTaskRunning(taskId)) {
    armWatchdog(taskId);
    return;
  }
  console.warn(`[trigger] ${taskId} has queued work but no running task; relaunching`);
  resetActiveRun(taskId);
  markActiveRun(taskId);
  startRun(taskId);
  // Keep watching: if this relaunch also fails to take (e.g. HTTP not yet up),
  // the next tick retries until the queue actually drains.
  armWatchdog(taskId);
}

/** Enqueue a trigger payload and ensure a run is (or will be) draining it. */
export function dispatchTrigger(taskId: string, payload: string): void {
  const { shouldStart } = enqueueEvent(taskId, payload);
  console.log(`[trigger] ${taskId} enqueued (shouldStart=${shouldStart}, pending=${pendingCount(taskId)})`);
  if (shouldStart) startRun(taskId);
  armWatchdog(taskId);
}
