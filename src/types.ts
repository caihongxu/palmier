export interface HostConfig {
  hostId: string;
  projectRoot: string;

  natsUrl?: string;
  natsWsUrl?: string;
  natsToken?: string;

  // Detected agent CLIs
  agents?: Array<{ key: string; label: string }>;

  // HTTP server port (default 9966)
  httpPort?: number;
  // Whether to accept non-localhost HTTP connections
  lanEnabled?: boolean;
}

export interface TaskFrontmatter {
  id: string;
  name: string;
  user_prompt: string;
  agent: string;
  triggers: Trigger[];
  triggers_enabled: boolean;
  requires_confirmation: boolean;
  yolo_mode?: boolean;
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
 * - `started`: task is actively running
 * - `finished`: agent completed successfully
 * - `aborted`: user declined confirmation, permission, or input
 * - `failed`: agent exited with an error
 */
export type TaskRunningState = "started" | "finished" | "aborted" | "failed";

/**
 * Persisted to `status.json` in the task directory. Used for crash detection
 * (checkStaleTasks) and abort signalling. Interactive request flows (confirmation,
 * permission, input) are handled via held HTTP connections on the serve daemon.
 */
export interface TaskStatus {
  running_state: TaskRunningState;
  time_stamp: number;
  /** PID of the palmier run process (used on Windows to kill the process tree). */
  pid?: number;
}

export interface HistoryEntry {
  task_id: string;
  run_id: string;
}

export interface RequiredPermission {
  name: string;
  description: string;
}

export interface ConversationMessage {
  role: "assistant" | "user" | "status";
  time: number;
  content: string;
  type?: "input" | "permission" | "confirmation" | "monitoring" | "started" | "finished" | "failed" | "aborted" | "stopped";
  attachments?: string[];
}

export interface RpcMessage {
  method: string;
  params: Record<string, unknown>;
  sessionToken?: string;
  /** Trusted localhost request — skip session validation. */
  localhost?: boolean;
}
