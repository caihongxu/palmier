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
 * Key is sessionId for confirmation/input, taskId for permission. Only one
 * pending request per key at a time. `meta` is surfaced via host.info so a
 * freshly-connected PWA can render the modal without replaying events.
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

export function resolvePending(key: string, value: string[]): boolean {
  const entry = pending.get(key);
  if (!entry) return false;
  pending.delete(key);
  entry.resolve(value);
  return true;
}

export function getPending(key: string): PendingRequest | undefined {
  return pending.get(key);
}

export function removePending(key: string): void {
  pending.delete(key);
}

/** Pending requests stripped of the unserializable `resolve` callback. */
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
