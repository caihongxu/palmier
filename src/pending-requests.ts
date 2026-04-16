import type { RequiredPermission } from "./types.js";

export interface PendingRequestMeta {
  /** Doubles as task_id for permission-type entries (the key the task uses). */
  session_id?: string;
  /** Human-readable label for whoever opened the prompt — agent name for
   *  confirm/input, task name for permission. */
  session_name?: string;
  description?: string;
  input_questions?: string[];
}

export interface PendingRequest {
  type: "confirmation" | "permission" | "input";
  resolve: (value: string[]) => void;
  /** Permission list (for 'permission') or input descriptions (for 'input'). */
  params?: RequiredPermission[] | string[];
  /** Display context for PWAs that connect while this request is already open. */
  meta?: PendingRequestMeta;
}

const pending = new Map<string, PendingRequest>();

/**
 * Register a pending request keyed by either a sessionId (confirmation / input)
 * or a taskId (permission). The `meta` is surfaced to PWAs that connect after
 * the request was opened, so their modals can render without replaying events.
 * Only one pending request per key at a time.
 */
export function registerPending(
  key: string,
  type: PendingRequest["type"],
  params?: PendingRequest["params"],
  meta?: PendingRequestMeta,
): Promise<string[]> {
  if (pending.has(key)) {
    return Promise.reject(new Error(`Key ${key} already has a pending request`));
  }

  return new Promise<string[]>((resolve) => {
    pending.set(key, { type, resolve, params, meta });
  });
}

/**
 * Resolve a pending request with the user's response.
 * Returns true if a pending request was found and resolved.
 */
export function resolvePending(key: string, value: string[]): boolean {
  const entry = pending.get(key);
  if (!entry) return false;
  pending.delete(key);
  entry.resolve(value);
  return true;
}

/**
 * Get the current pending request for a key (if any).
 */
export function getPending(key: string): PendingRequest | undefined {
  return pending.get(key);
}

/**
 * Remove a pending request without resolving it.
 */
export function removePending(key: string): void {
  pending.delete(key);
}

/**
 * List all currently-pending requests, stripped of the unserializable `resolve`
 * callback. Used by `host.info` so the PWA can seed its modal state on connect.
 */
export function listPending(): Array<{
  key: string;
  type: PendingRequest["type"];
  params?: PendingRequest["params"];
  meta?: PendingRequestMeta;
}> {
  return [...pending.entries()].map(([key, entry]) => ({
    key,
    type: entry.type,
    params: entry.params,
    meta: entry.meta,
  }));
}
