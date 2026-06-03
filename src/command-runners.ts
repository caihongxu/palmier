/**
 * Daemon-owned supervisors for command-triggered tasks. A command task's shell
 * command is a long-running trigger source — the daemon spawns it while the task
 * is enabled, reads its stdout, and feeds each line into the shared per-task
 * event queue (the same one the NATS notification/SMS subscriptions populate).
 * The idle→active edge launches a short-lived `palmier run` that drains the
 * queue, so command tasks share the exact lifecycle as on_new_* event tasks:
 * one run per burst, "running" only while the agent is actually invoked.
 *
 * Lifecycle parity:
 *   - Enabled command task → command process running (= being monitored).
 *   - Disable / delete → command process killed; no further triggers.
 *   - Abort → kills only the in-flight run; the command process is untouched.
 */

import * as readline from "readline";
import { execFileSync, type ChildProcess } from "child_process";
import { spawnStreamingCommand } from "./spawn-command.js";
import { getTaskDir, listTasks, parseTaskFile } from "./task.js";
import { dispatchTrigger } from "./trigger-dispatch.js";
import { getPlatform } from "./platform/index.js";
import type { HostConfig, ParsedTask } from "./types.js";

interface Runner {
  child: ChildProcess;
  command: string;
}

const runners = new Map<string, Runner>();
const stopping = new Set<string>();

function shouldRun(task: ParsedTask): boolean {
  return !!task.frontmatter.command
    && !!task.frontmatter.schedule_enabled
    && !task.frontmatter.one_off;
}

function killChild(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid) {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/f", "/t"], { windowsHide: true, stdio: "pipe" });
      return;
    } catch { /* may have already exited */ }
  }
  child.kill();
}

function spawnRunner(config: HostConfig, taskId: string, command: string): void {
  stopping.delete(taskId);
  const taskDir = getTaskDir(config.projectRoot, taskId);
  const platform = getPlatform();
  const child = spawnStreamingCommand(command, {
    cwd: taskDir,
    env: { ...platform.getGuiEnv(), PALMIER_HTTP_PORT: String(config.httpPort ?? 7256) },
  });
  runners.set(taskId, { child, command });
  console.log(`[command-runner] ${taskId} spawned: ${command}`);

  const rl = readline.createInterface({ input: child.stdout! });
  rl.on("line", (line: string) => {
    if (!line.trim()) return;
    dispatchTrigger(taskId, line);
  });
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(d));

  const handleExit = () => {
    rl.close();
    if (runners.get(taskId)?.child === child) runners.delete(taskId);
    if (stopping.has(taskId)) {
      stopping.delete(taskId);
      return;
    }
    // Exited on its own while still enabled — relaunch so monitoring stays live.
    console.log(`[command-runner] ${taskId} command exited; relaunching in 1s`);
    setTimeout(() => {
      if (stopping.has(taskId) || runners.has(taskId)) return;
      let task: ParsedTask;
      try { task = parseTaskFile(taskDir); } catch { return; }
      if (shouldRun(task)) spawnRunner(config, taskId, task.frontmatter.command!);
    }, 1000);
  };
  child.on("close", handleExit);
  child.on("error", (err: Error) => {
    console.error(`[command-runner] ${taskId} error:`, err);
    handleExit();
  });
}

/** Start, stop, or restart a task's command process to match its current state. */
export function reconcileCommandRunner(config: HostConfig, task: ParsedTask): void {
  const taskId = task.frontmatter.id;
  if (!shouldRun(task)) {
    stopCommandRunner(taskId);
    return;
  }
  const existing = runners.get(taskId);
  if (existing) {
    if (existing.command === task.frontmatter.command) return;
    stopCommandRunner(taskId);
  }
  spawnRunner(config, taskId, task.frontmatter.command!);
}

export function stopCommandRunner(taskId: string): void {
  const existing = runners.get(taskId);
  if (!existing) return;
  stopping.add(taskId);
  runners.delete(taskId);
  killChild(existing.child);
}

/** Recover command runners for all enabled command tasks (daemon startup). */
export function startEnabledCommandRunners(config: HostConfig): void {
  for (const task of listTasks(config.projectRoot)) {
    if (shouldRun(task)) reconcileCommandRunner(config, task);
  }
}
