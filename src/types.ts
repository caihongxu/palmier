export interface HostConfig {
  hostId: string;
  projectRoot: string;

  natsUrl?: string;
  natsWsUrl?: string;
  natsJwt?: string;
  natsNkeySeed?: string;

  agents?: Array<{
    key: string;
    label: string;
    npmPackage?: string;
    /** Runtime marker for "managed by Palmier" — present iff Palmier installed/manages this agent. */
    version?: string;
  }>;

  /** Installed version of the Palmier-managed Playwright CLI (`@playwright/cli`).
   * Present iff Palmier manages it; mirrors the agents' `version` marker. */
  playwrightCliVersion?: string;

  httpPort?: number;

  /** OS network interface name of the IPv4 default route, captured on the
   * most recent `palmier pair`. Used to resolve the host's LAN URL live for
   * `host.info` so the client can track IP changes (laptop roaming, DHCP). */
  defaultInterface?: string;

  /** Added to the instructions of every task run on this host, ahead of the task description. */
  userPrompt?: string;
}

export interface TaskFrontmatter {
  id: string;
  /** Machine-generated from the prompt; regenerated on prompt or agent change. */
  name: string;
  /** User-set title; takes precedence over `name` and is never auto-changed. */
  custom_name?: string;
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
  foreground_mode?: boolean;
  command?: string;
  /** Set when the task was created via task.run_oneoff. Used so the run process
   * can tear down its OS scheduler unit when it finishes — one-off tasks aren't
   * in tasks.jsonl so the daemon's recovery/sweep logic doesn't cover them. */
  one_off?: boolean;
}

export interface ParsedTask {
  frontmatter: TaskFrontmatter;
}

/**
 * - `started`: task is actively running
 * - `finished`: agent completed successfully
 * - `aborted`: user declined confirmation or input
 * - `failed`: agent exited with an error
 * - `needs_input`: agent stopped to ask the user something and will resume on their reply
 */
export type TaskRunningState = "started" | "finished" | "aborted" | "failed" | "needs_input";

export interface TaskStatus {
  running_state: TaskRunningState;
  time_stamp: number;
  /** PID of the palmier run process (used on Windows to kill the process tree). */
  pid?: number;
  /** The run a live `palmier run` process is holding open for the user's reply. */
  run_id?: string;
}

export interface HistoryEntry {
  task_id: string;
  run_id: string;
}

export interface ConversationMessage {
  role: "assistant" | "user" | "status";
  time: number;
  content: string;
  type?: "input" | "confirmation" | "started" | "finished" | "failed" | "aborted" | "stopped" | "error" | "needs_input";
  /** Only present on runs recorded by older hosts; never written anymore. */
  attachments?: string[];
  /** For assistant messages, identifies which stream the agent CLI emitted this segment on.
   *  Absent on non-assistant messages and on legacy entries written before the split. */
  stream?: "stdout" | "stderr";
  /** Model the agent self-reported for the invocation that produced this assistant message. */
  model?: string;
}

export interface RpcMessage {
  method: string;
  params: Record<string, unknown>;
  clientToken?: string;
  /** Trusted localhost request — skip client validation. */
  localhost?: boolean;
}
