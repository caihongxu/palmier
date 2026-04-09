import type { HostConfig, ParsedTask } from "../types.js";

/**
 * Abstracts OS-specific daemon, scheduling, and process management.
 * Linux uses systemd; Windows uses Task Scheduler; macOS will use launchd.
 */
export interface PlatformService {
  /** Install the main `palmier serve` daemon to start at boot. */
  installDaemon(config: HostConfig): void;

  /** Restart the `palmier serve` daemon. */
  restartDaemon(): Promise<void>;

  /** Stop the daemon and remove all scheduled tasks/timers. */
  uninstallDaemon(): void;

  /** Install a scheduled trigger (timer) for a task. */
  installTaskTimer(config: HostConfig, task: ParsedTask): void;

  /** Remove a task's scheduled trigger and service files. */
  removeTaskTimer(taskId: string): void;

  /** Start a task execution (non-blocking). */
  startTask(taskId: string): Promise<void>;

  /** Abort/stop a running task. */
  stopTask(taskId: string): Promise<void>;

  /** Check if a task is currently running via the system scheduler. */
  isTaskRunning(taskId: string): boolean;

  /** Return env vars needed for GUI access (Linux: DISPLAY, etc.). */
  getGuiEnv(): Record<string, string>;
}
