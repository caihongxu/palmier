export interface HostConfig {
  hostId: string;
  projectRoot: string;

  natsUrl?: string;
  natsWsUrl?: string;
  natsJwt?: string;
  natsNkeySeed?: string;

  // Detected agent CLIs
  agents?: Array<{ key: string; label: string; supportsPermissions: boolean; supportsYolo: boolean }>;

  // HTTP server port (default 7256)
  httpPort?: number;
  // Whether to accept non-localhost HTTP connections
  lanEnabled?: boolean;
}

export interface TaskFrontmatter {
  id: string;
  name: string;
  user_prompt: string;
  agent: string;
  /**
   * Task schedule. `schedule_values` is homogeneous per `schedule_type`:
   * - `crons`: array of cron expressions (e.g. "0 9 * * *")
   * - `specific_times`: array of local datetime strings (e.g. "2026-04-20T09:00")
   * Both fields are present together or absent together.
   */
  schedule_type?: "crons" | "specific_times";
  schedule_values?: string[];
  schedule_enabled: boolean;
  requires_confirmation: boolean;
  yolo_mode?: boolean;
  foreground_mode?: boolean;
  permissions?: RequiredPermission[];
  command?: string;
}

export interface ParsedTask {
  frontmatter: TaskFrontmatter;
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
  type?: "input" | "permission" | "confirmation" | "monitoring" | "started" | "finished" | "failed" | "aborted" | "stopped" | "error";
  attachments?: string[];
}

export interface RpcMessage {
  method: string;
  params: Record<string, unknown>;
  clientToken?: string;
  /** Trusted localhost request — skip client validation. */
  localhost?: boolean;
}
