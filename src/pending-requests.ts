import type { RequiredPermission } from "./types.js";

export interface PendingRequest {
  type: "confirmation" | "permission" | "input";
  resolve: (value: string[]) => void;
  /** Permission list (for 'permission') or input descriptions (for 'input'). */
  params?: RequiredPermission[] | string[];
}

const pending = new Map<string, PendingRequest>();

/**
 * Register a pending request for a task. Returns a Promise that resolves
 * when `resolvePending` is called with the user's response.
 * Only one pending request per task at a time.
 */
export function registerPending(
  taskId: string,
  type: PendingRequest["type"],
  params?: PendingRequest["params"],
): Promise<string[]> {
  if (pending.has(taskId)) {
    return Promise.reject(new Error(`Task ${taskId} already has a pending request`));
  }

  return new Promise<string[]>((resolve) => {
    pending.set(taskId, { type, resolve, params });
  });
}

/**
 * Resolve a pending request with the user's response.
 * Returns true if a pending request was found and resolved.
 */
export function resolvePending(taskId: string, value: string[]): boolean {
  const entry = pending.get(taskId);
  if (!entry) return false;
  pending.delete(taskId);
  entry.resolve(value);
  return true;
}

/**
 * Get the current pending request for a task (if any).
 */
export function getPending(taskId: string): PendingRequest | undefined {
  return pending.get(taskId);
}

/**
 * Remove a pending request without resolving it.
 */
export function removePending(taskId: string): void {
  pending.delete(taskId);
}
