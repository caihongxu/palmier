export interface HostConfig {
  hostId: string;
  projectRoot: string;

  natsUrl?: string;
  natsWsUrl?: string;
  natsToken?: string;

  // Detected agent CLIs
  agents?: Array<{ key: string; label: string }>;
}

export interface TaskFrontmatter {
  id: string;
  name: string;
  user_prompt: string;
  agent: string;
  triggers: Trigger[];
  triggers_enabled: boolean;
  requires_confirmation: boolean;
  permissions?: RequiredPermission[];
  command?: string;
}

export interface Trigger {
  type: "cron" | "once";
  value: string;
}

export interface ParsedTask {
  frontmatter: TaskFrontmatter;
  body: string;
}

/**
 * State machine: started → (pending_confirmation | pending_permission | pending_input) → finished | aborted | failed
 *
 * - `started`: task is actively running
 * - `finished`: agent completed successfully
 * - `aborted`: user declined confirmation, permission, or input
 * - `failed`: agent exited with an error
 */
export type TaskRunningState = "started" | "finished" | "aborted" | "failed";

/**
 * Persisted to `status.json` in the task directory. Updated by the run process
 * and read by the RPC handler + PWA to track live task state.
 *
 * Interactive request flow: the run process sets a `pending_*` field and waits
 * for `user_input` to be populated by an RPC call (task.user_input). Only one
 * `pending_*` field is set at a time.
 */
export interface TaskStatus {
  running_state: TaskRunningState;
  time_stamp: number;
  /** PID of the palmier run process (used on Windows to kill the process tree). */
  pid?: number;
  /** Set when the task has `requires_confirmation` and is awaiting user approval. */
  pending_confirmation?: boolean;
  /** Set when the agent requests permissions not yet granted. Contains the permissions needed. */
  pending_permission?: RequiredPermission[];
  /** Set when the agent requests user input. Contains descriptions of each requested value. */
  pending_input?: string[];
  /** Written by the RPC handler to deliver the user's response to the waiting run process. */
  user_input?: string[];
}

export interface HistoryEntry {
  task_id: string;
  result_file: string;
}

export interface RequiredPermission {
  name: string;
  description: string;
}

export interface ConversationMessage {
  role: "assistant" | "user" | "status";
  time: number;
  content: string;
  type?: "input" | "permission" | "confirmation" | "started" | "finished" | "failed" | "aborted";
  attachments?: string[];
}

export interface RpcMessage {
  method: string;
  params: Record<string, unknown>;
  sessionToken?: string;
}
