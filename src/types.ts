export interface HostConfig {
  hostId: string;
  projectRoot: string;

  // NATS (always enabled)
  nats?: boolean;
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

export type TaskRunningState = "started" | "finished" | "aborted" | "failed";

export interface TaskStatus {
  running_state: TaskRunningState;
  time_stamp: number;
  pending_confirmation?: boolean;
  pending_permission?: RequiredPermission[];
  pending_input?: string[];
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

export interface RpcMessage {
  method: string;
  params: Record<string, unknown>;
  sessionToken?: string;
}
