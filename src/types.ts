export interface HostConfig {
  hostId: string;
  projectRoot: string;

  natsUrl?: string;
  natsWsUrl?: string;
  natsJwt?: string;
  natsNkeySeed?: string;

  agents?: Array<{ key: string; label: string; supportsPermissions: boolean; supportsYolo: boolean }>;

  httpPort?: number;
  /** Whether to accept non-localhost HTTP connections. */
  lanEnabled?: boolean;
}

export interface TaskFrontmatter {
  id: string;
  name: string;
  user_prompt: string;
  agent: string;
  /**
   * Task schedule.
   * - `crons`: `schedule_values` holds cron expressions (e.g. "0 9 * * *")
   * - `specific_times`: `schedule_values` holds local datetime strings (e.g. "2026-04-20T09:00")
   * - `on_new_notification`: fires on each new Android notification from NATS. Optional `schedule_values` holds a single-entry packageName filter; empty/unset matches any app.
   * - `on_new_sms`: fires on each new SMS from NATS. Optional `schedule_values` holds a single-entry sender filter; compared after normalization (strip spaces/dashes/parens/plus, lowercase). Empty/unset matches any sender.
   */
  schedule_type?: "crons" | "specific_times" | "on_new_notification" | "on_new_sms";
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
