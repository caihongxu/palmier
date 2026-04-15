import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { spawnCommand, spawnStreamingCommand } from "../spawn-command.js";
import { loadConfig } from "../config.js";
import { connectNats } from "../nats-client.js";
import { parseTaskFile, getTaskDir, writeTaskFile, writeTaskStatus, readTaskStatus, appendHistory, createRunDir, appendRunMessage, readRunMessages, getRunDir, beginStreamingMessage } from "../task.js";
import { getAgent } from "../agents/agent.js";
import { getPlatform } from "../platform/index.js";
import { TASK_SUCCESS_MARKER, TASK_FAILURE_MARKER, TASK_REPORT_PREFIX, TASK_PERMISSION_PREFIX } from "../agents/shared-prompt.js";
import type { AgentTool } from "../agents/agent.js";
import { publishHostEvent } from "../events.js";
import type { HostConfig, ParsedTask, TaskRunningState, RequiredPermission } from "../types.js";
import type { NatsConnection } from "nats";

/**
 * Shared context for agent invocation retry loops.
 * Passed around to avoid threading many individual parameters.
 */
interface InvocationContext {
  agent: AgentTool;
  task: ParsedTask;
  taskDir: string;
  runId: string;
  guiEnv: Record<string, string>;
  nc: NatsConnection | undefined;
  config: HostConfig;
  taskId: string;
  /** Mutable — accumulates across invocations within a run. */
  transientPermissions: RequiredPermission[];
}

interface InvocationResult {
  outcome: TaskRunningState;
}

/**
 * Invoke the agent CLI with a continuation loop for permissions and user input.
 *
 * Both standard and command-triggered execution use this.
 * The `invokeTask` is the ParsedTask whose prompt is passed to the agent
 * (for command-triggered mode this is the per-line augmented task).
 */
async function invokeAgentWithRetries(
  ctx: InvocationContext,
  invokeTask: ParsedTask,
): Promise<InvocationResult> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Stream agent output to TASKRUN.md in real-time, throttled to 500ms
    const writer = beginStreamingMessage(ctx.taskDir, ctx.runId, Date.now());
    let lineBuf = "";
    let notifyPending = false;
    let notifyTimer: ReturnType<typeof setTimeout> | undefined;

    function throttledNotify() {
      if (notifyPending) return;
      notifyPending = true;
      notifyTimer = setTimeout(() => {
        notifyPending = false;
        publishHostEvent(ctx.nc, ctx.config.hostId, ctx.taskId, { event_type: "result-updated", run_id: ctx.runId });
      }, 500);
    }

    const { command, args, stdin, env: agentEnv } = ctx.agent.getTaskRunCommandLine(
      invokeTask, undefined, ctx.task.frontmatter.yolo_mode ? "yolo" : ctx.transientPermissions,
    );
    const truncate = (s: string, max = 100) => s.length > max ? s.slice(0, max) + "…" : s;
    const displayArgs = args.map((a) => truncate(a));
    console.log(`[invoke] ${command} ${displayArgs.join(" ")}${stdin ? ` (stdin: ${truncate(stdin, 100)})` : ""}`);
    const result = await spawnCommand(command, args, {
      cwd: getRunDir(ctx.taskDir, ctx.runId),
      env: { ...ctx.guiEnv, ...agentEnv, PALMIER_RUN_DIR: getRunDir(ctx.taskDir, ctx.runId), PALMIER_HTTP_PORT: String(ctx.config.httpPort ?? 9966) },
      echoStdout: true,
      resolveOnFailure: true,
      stdin,
      onData: (chunk) => {
        lineBuf += chunk;
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";
        const filtered = lines.filter((l) => !l.startsWith("[PALMIER"));
        if (filtered.length > 0) {
          writer.write(filtered.join("\n") + "\n");
          throttledNotify();
        }
      },
    });

    if (notifyTimer) clearTimeout(notifyTimer);

    const outcome: TaskRunningState = result.exitCode !== 0 ? "failed" : parseTaskOutcome(result.output);
    const reportFiles = parseReportFiles(result.output);
    const requiredPermissions = parsePermissions(result.output);

    // Flush remaining buffered content
    if (lineBuf && !lineBuf.startsWith("[PALMIER")) {
      writer.write(lineBuf);
    }

    // Include permission requests in the assistant message
    if (requiredPermissions.length > 0) {
      const permLines = requiredPermissions.map((p) => `- **${p.name}** ${p.description}`).join("\n");
      writer.write(`\n\n**Permissions requested:**\n${permLines}\n`);
    }

    writer.end(reportFiles.length > 0 ? reportFiles : undefined);
    await publishHostEvent(ctx.nc, ctx.config.hostId, ctx.taskId, { event_type: "result-updated", run_id: ctx.runId });

    if (reportFiles.length > 0) {
      await publishHostEvent(ctx.nc, ctx.config.hostId, ctx.taskId, {
        event_type: "report-generated",
        run_id: ctx.runId,
        name: ctx.task.frontmatter.name,
        report_files: reportFiles,
      });
    }

    // Permission handling — agent requested permissions
    if (requiredPermissions.length > 0) {
      const response = await requestPermission(ctx.config, ctx.task, ctx.taskDir, requiredPermissions);

      if (response === "aborted") {
        await appendAndNotify(ctx, {
          role: "user",
          time: Date.now(),
          content: "Deny & Abort Task",
          type: "permission",
        });
        return { outcome: "failed" };
      }

      const newPerms = requiredPermissions.filter(
        (rp) => !ctx.task.frontmatter.permissions?.some((ep) => ep.name === rp.name)
          && !ctx.transientPermissions.some((ep) => ep.name === rp.name),
      );

      await appendAndNotify(ctx, {
        role: "user",
        time: Date.now(),
        content: response === "granted_all" ? "Allow Always" : "Allow Once",
        type: "permission",
      });

      if (response === "granted_all") {
        ctx.task.frontmatter.permissions = [...(ctx.task.frontmatter.permissions ?? []), ...newPerms];
        invokeTask.frontmatter.permissions = ctx.task.frontmatter.permissions;
        writeTaskFile(ctx.taskDir, ctx.task);
      } else {
        ctx.transientPermissions = [...ctx.transientPermissions, ...newPerms];
      }

      // If the agent actually failed, retry with the new permissions
      if (outcome === "failed") {
        continue;
      }
    }

    // Normal completion (success or terminal failure)
    return { outcome };
  }
}

/**
 * Strip [PALMIER_*] marker lines from agent output.
 */
export function stripPalmierMarkers(output: string): string {
  return output.split("\n").filter((l) => !l.startsWith("[PALMIER")).join("\n").trim();
}

/**
 * Append a conversation message to the RESULT file and notify connected clients.
 */
async function appendAndNotify(
  ctx: InvocationContext,
  msg: Parameters<typeof appendRunMessage>[2],
): Promise<void> {
  appendRunMessage(ctx.taskDir, ctx.runId, msg);
  await publishHostEvent(ctx.nc, ctx.config.hostId, ctx.taskId, { event_type: "result-updated", run_id: ctx.runId });
}

/**
 * Find the latest run dir that has no status messages yet (just created by the RPC handler).
 */
function findLatestPendingRunId(taskDir: string): string | null {
  const dirs = fs.readdirSync(taskDir)
    .filter((f) => /^\d+$/.test(f) && fs.existsSync(path.join(taskDir, f, "TASKRUN.md")))
    .sort();
  if (dirs.length === 0) return null;
  const latest = dirs[dirs.length - 1];
  const messages = readRunMessages(taskDir, latest);
  const hasStatus = messages.some((m) => m.role === "status");
  return hasStatus ? null : latest;
}

/**
 * If the RPC handler already wrote "aborted" to status.json (e.g. via task.abort),
 * respect that instead of overwriting with the process's own outcome.
 */
function resolveOutcome(taskDir: string, outcome: TaskRunningState): TaskRunningState {
  const current = readTaskStatus(taskDir);
  if (current?.running_state === "aborted") return "aborted";
  return outcome;
}

/**
 * Execute a task by ID.
 */
export async function runCommand(taskId: string): Promise<void> {
  const config = loadConfig();
  const taskDir = getTaskDir(config.projectRoot, taskId);
  const task = parseTaskFile(taskDir);
  console.log(`Running task: ${taskId}`);

  let nc: NatsConnection | undefined;
  const taskName = task.frontmatter.name;

  // Use existing run dir if just created by RPC, otherwise create a new one
  const existingRunId = findLatestPendingRunId(taskDir);
  const runId = existingRunId ?? createRunDir(taskDir, taskName, Date.now(), task.frontmatter.agent);
  if (!existingRunId) {
    appendHistory(config.projectRoot, { task_id: taskId, run_id: runId });
  }

  const cleanup = async () => {
    if (nc && !nc.isClosed()) {
      await nc.drain();
    }
  };

  try {
    nc = await connectNats(config);

    await publishTaskEvent(nc, config, taskDir, taskId, "started", taskName, runId);
    appendRunMessage(taskDir, runId, { role: "status", time: Date.now(), content: "", type: "started" });
    await publishHostEvent(nc, config.hostId, taskId, { event_type: "result-updated", run_id: runId });

    // If requires_confirmation, notify clients and wait
    if (task.frontmatter.requires_confirmation) {
      const confirmed = await requestConfirmation(config, task, taskDir);
      const confirmPrompt = `**Task Confirmation**\n\nRun task "${taskName || task.frontmatter.user_prompt}"?`;
      appendRunMessage(taskDir, runId, { role: "assistant", time: Date.now(), content: confirmPrompt, type: "confirmation" });
      await publishHostEvent(nc, config.hostId, taskId, { event_type: "result-updated", run_id: runId });

      if (!confirmed) {
        console.log("Task aborted by user.");
        appendRunMessage(taskDir, runId, { role: "user", time: Date.now(), content: "Aborted", type: "confirmation" });
        appendRunMessage(taskDir, runId, { role: "status", time: Date.now(), content: "", type: "aborted" });
        await publishTaskEvent(nc, config, taskDir, taskId, "aborted", taskName, runId);
        await cleanup();
        return;
      }
      console.log("Task confirmed by user.");
      appendRunMessage(taskDir, runId, { role: "user", time: Date.now(), content: "Confirmed", type: "confirmation" });
      appendRunMessage(taskDir, runId, { role: "status", time: Date.now(), content: "", type: "confirmation" });
      await publishHostEvent(nc, config.hostId, taskId, { event_type: "result-updated", run_id: runId });
    }

    // Shared invocation context
    const guiEnv = getPlatform().getGuiEnv();
    const agent = getAgent(task.frontmatter.agent);
    const ctx: InvocationContext = {
      agent, task, taskDir, runId, guiEnv, nc, config, taskId,
      transientPermissions: [],
    };

    if (task.frontmatter.command) {
      // Command-triggered mode
      const result = await runCommandTriggeredMode(ctx);
      const outcome = resolveOutcome(taskDir, result.outcome);
      appendRunMessage(taskDir, runId, { role: "status", time: Date.now(), content: "", type: outcome });
      await publishTaskEvent(nc, config, taskDir, taskId, outcome, taskName, runId);
      console.log(`Task ${taskId} completed (command-triggered).`);
    } else {
      // Standard execution — add user prompt as first message
      await appendAndNotify(ctx, {
        role: "user",
        time: Date.now(),
        content: task.body || task.frontmatter.user_prompt,
      });

      const result = await invokeAgentWithRetries(ctx, task);
      const outcome = resolveOutcome(taskDir, result.outcome);
      appendRunMessage(taskDir, runId, { role: "status", time: Date.now(), content: "", type: outcome });
      await publishTaskEvent(nc, config, taskDir, taskId, outcome, taskName, runId);
      console.log(`Task ${taskId} completed.`);
    }
  } catch (err) {
    console.error(`Task ${taskId} failed:`, err);
    const outcome = resolveOutcome(taskDir, "failed");
    const errorMsg = err instanceof Error ? err.message : String(err);
    appendRunMessage(taskDir, runId, {
      role: "assistant",
      time: Date.now(),
      content: errorMsg,
    });
    appendRunMessage(taskDir, runId, { role: "status", time: Date.now(), content: "", type: outcome });
    await publishTaskEvent(nc, config, taskDir, taskId, outcome, taskName, runId);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

const MAX_QUEUE_SIZE = 100;
const MAX_LOG_ENTRIES = 1000;
/** Max input line length (chars). Long emails can take up to 200k chars. */
const MAX_LINE_LENGTH = 200_000;

/**
 * Command-triggered execution mode.
 *
 * Spawns a long-running shell command and, for each line of stdout,
 * invokes the agent CLI with the user's prompt augmented by that line.
 * Processes lines sequentially with a bounded queue.
 */
async function runCommandTriggeredMode(
  ctx: InvocationContext,
): Promise<{ outcome: TaskRunningState; endTime: number }> {
  const commandStr = ctx.task.frontmatter.command!;
  console.log(`[command-triggered] Spawning: ${commandStr}`);

  appendRunMessage(ctx.taskDir, ctx.runId, { role: "status", time: Date.now(), content: "", type: "monitoring" });
  await publishHostEvent(ctx.nc, ctx.config.hostId, ctx.taskId, { event_type: "result-updated", run_id: ctx.runId });

  const child = spawnStreamingCommand(commandStr, {
    cwd: getRunDir(ctx.taskDir, ctx.runId),
    env: { ...ctx.guiEnv, PALMIER_RUN_DIR: getRunDir(ctx.taskDir, ctx.runId), PALMIER_HTTP_PORT: String(ctx.config.httpPort ?? 9966) },
  });

  let linesProcessed = 0;
  let invocationsSucceeded = 0;
  let invocationsFailed = 0;

  const lineQueue: string[] = [];
  let processing = false;
  let commandExited = false;
  let resolveWhenDone: (() => void) | undefined;

  const logPath = path.join(getRunDir(ctx.taskDir, ctx.runId), "command-output.log");
  function appendLog(line: string, agentOutput: string, outcome: string) {
    const entry = `[${new Date().toISOString()}] (${outcome}) input: ${line}\n${agentOutput}\n---\n`;
    fs.appendFileSync(logPath, entry, "utf-8");

    // Trim log if too large (keep last MAX_LOG_ENTRIES entries)
    try {
      const content = fs.readFileSync(logPath, "utf-8");
      const entries = content.split("\n---\n").filter(Boolean);
      if (entries.length > MAX_LOG_ENTRIES) {
        const trimmed = entries.slice(-MAX_LOG_ENTRIES).join("\n---\n") + "\n---\n";
        fs.writeFileSync(logPath, trimmed, "utf-8");
      }
    } catch { /* ignore trim errors */ }
  }

  async function processLine(line: string): Promise<void> {
    linesProcessed++;
    if (line.length > MAX_LINE_LENGTH) {
      console.warn(`[command-triggered] Skipping line #${linesProcessed}: ${line.length} chars exceeds limit`);
      invocationsFailed++;
      appendLog(line.slice(0, 200) + "...(truncated)", "", "skipped");
      return;
    }
    console.log(`[command-triggered] Processing line #${linesProcessed}: ${line}`);

    const perLinePrompt = `${ctx.task.frontmatter.user_prompt}\n\nProcess this input:\n${line}`;
    const perLineTask: ParsedTask = {
      frontmatter: { ...ctx.task.frontmatter, user_prompt: perLinePrompt },
      body: "",
    };

    const result = await invokeAgentWithRetries(ctx, perLineTask);
    if (result.outcome === "finished") {
      invocationsSucceeded++;
    } else {
      invocationsFailed++;
    }
    appendLog(line, "", result.outcome);

    // Append monitoring status so the UI shows the task is waiting for more input
    appendRunMessage(ctx.taskDir, ctx.runId, { role: "status", time: Date.now(), content: "", type: "monitoring" });
    await publishHostEvent(ctx.nc, ctx.config.hostId, ctx.taskId, { event_type: "result-updated", run_id: ctx.runId });
  }

  async function drainQueue(): Promise<void> {
    if (processing) return;
    processing = true;
    try {
      while (lineQueue.length > 0) {
        const line = lineQueue.shift()!;
        await processLine(line);
      }
    } finally {
      processing = false;
      if (commandExited && lineQueue.length === 0 && resolveWhenDone) {
        resolveWhenDone();
      }
    }
  }

  const rl = readline.createInterface({ input: child.stdout! });
  rl.on("line", (line: string) => {
    if (!line.trim()) return;
    if (lineQueue.length >= MAX_QUEUE_SIZE) {
      console.warn(`[command-triggered] Queue full, dropping oldest line.`);
      lineQueue.shift();
    }
    lineQueue.push(line);
    drainQueue().catch((err) => {
      console.error(`[command-triggered] Error processing line:`, err);
      invocationsFailed++;
    });
  });

  let stderrBuf = "";
  child.stderr?.on("data", (d: Buffer) => {
    const chunk = d.toString();
    stderrBuf += chunk;
    process.stderr.write(d);
  });

  // Wait for command to exit
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", (code: number | null) => {
      commandExited = true;
      rl.close();
      resolve(code);
    });
    child.on("error", (err: Error) => {
      console.error(`[command-triggered] Command error:`, err);
      stderrBuf += err.message;
      commandExited = true;
      rl.close();
      resolve(1);
    });
  });

  // Wait for any remaining queued lines to finish processing
  if (lineQueue.length > 0 || processing) {
    await new Promise<void>((resolve) => {
      resolveWhenDone = resolve;
      drainQueue();
    });
  }

  const endTime = Date.now();

  if (exitCode !== 0) {
    const errorDetail = stderrBuf.trim() || `Command exited with code ${exitCode}`;
    appendRunMessage(ctx.taskDir, ctx.runId, {
      role: "status",
      time: endTime,
      content: errorDetail,
      type: "error",
    });
    await publishHostEvent(ctx.nc, ctx.config.hostId, ctx.taskId, { event_type: "result-updated", run_id: ctx.runId });
    return { outcome: "failed", endTime };
  }

  return { outcome: "finished", endTime };
}

async function publishTaskEvent(
  nc: NatsConnection | undefined,
  config: HostConfig,
  taskDir: string,
  taskId: string,
  eventType: TaskRunningState,
  taskName?: string,
  runId?: string,
): Promise<void> {
  writeTaskStatus(taskDir, {
    running_state: eventType,
    time_stamp: Date.now(),
    ...(eventType === "started" ? { pid: process.pid } : {}),
  });

  const payload: Record<string, unknown> = { event_type: "running-state", running_state: eventType };
  if (taskName) payload.name = taskName;
  if (runId) payload.run_id = runId;
  await publishHostEvent(nc, config.hostId, taskId, payload);
}


async function requestPermission(
  config: HostConfig,
  task: ParsedTask,
  taskDir: string,
  requiredPermissions: RequiredPermission[],
): Promise<"granted" | "granted_all" | "aborted"> {
  const port = config.httpPort ?? 9966;
  const res = await fetch(`http://localhost:${port}/request-permission`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId: task.frontmatter.id,
      taskName: task.frontmatter.name,
      permissions: requiredPermissions,
    }),
  });
  const body = await res.json() as { response?: string; error?: string };
  const response = body.response as "granted" | "granted_all" | "aborted" | undefined;
  if (!response || !["granted", "granted_all", "aborted"].includes(response)) {
    throw new Error(`Permission request failed: ${body.error ?? `unexpected response: ${JSON.stringify(body)}`}`);
  }
  writeTaskStatus(taskDir, {
    running_state: response === "aborted" ? "aborted" : "started",
    time_stamp: Date.now(),
  });
  return response;
}


async function requestConfirmation(
  config: HostConfig,
  task: ParsedTask,
  taskDir: string,
): Promise<boolean> {
  const port = config.httpPort ?? 9966;
  const res = await fetch(`http://localhost:${port}/request-confirmation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: `Run task "${task.frontmatter.name || task.frontmatter.id}"?` }),
  });
  const body = await res.json() as { confirmed?: boolean; error?: string };
  if (typeof body.confirmed !== "boolean") {
    throw new Error(`Confirmation request failed: ${body.error ?? `unexpected response: ${JSON.stringify(body)}`}`);
  }
  const { confirmed } = body;
  writeTaskStatus(taskDir, {
    running_state: confirmed ? "started" : "aborted",
    time_stamp: Date.now(),
  });
  return confirmed;
}

/**
 * Extract report file names from agent output.
 * Looks for lines matching: [PALMIER_REPORT] <filename>
 */
const ALLOWED_REPORT_EXT = [".md", ".txt", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];

export function parseReportFiles(output: string): string[] {
  const regex = new RegExp(`^\\${TASK_REPORT_PREFIX}\\s+(.+)$`, "gm");
  const files: string[] = [];
  let match;
  while ((match = regex.exec(output)) !== null) {
    const name = match[1].trim();
    // Skip placeholder examples echoed from the prompt (e.g. "<filename>")
    if (!name || name.startsWith("<")) continue;
    const ext = name.lastIndexOf(".") >= 0 ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
    if (!ALLOWED_REPORT_EXT.includes(ext)) continue;
    files.push(name);
  }
  return files;
}

/**
 * Extract required permissions from agent output.
 * Looks for lines matching: [PALMIER_PERMISSION] <tool> | <description>
 */
export function parsePermissions(output: string): RequiredPermission[] {
  const regex = new RegExp(`^\\${TASK_PERMISSION_PREFIX}\\s+(.+)$`, "gm");
  const perms: RequiredPermission[] = [];
  let match;
  while ((match = regex.exec(output)) !== null) {
    const raw = match[1].trim();
    // Skip placeholder examples echoed from the prompt (e.g. "<tool_name> | <description>")
    if (raw.startsWith("<")) continue;
    const sep = raw.indexOf("|");
    if (sep !== -1) {
      perms.push({ name: raw.slice(0, sep).trim(), description: raw.slice(sep + 1).trim() });
    } else {
      perms.push({ name: raw, description: "" });
    }
  }
  return perms;
}

/**
 * Parse the agent's output for success/failure markers.
 * Falls back to "finished" if no marker is found.
 */
export function parseTaskOutcome(output: string): TaskRunningState {
  const lastChunk = output.slice(-500);
  const regex = new RegExp(`^\\${TASK_FAILURE_MARKER}$|^\\${TASK_SUCCESS_MARKER}$`, "gm");
  let last: string | null = null;
  let match;
  while ((match = regex.exec(lastChunk)) !== null) {
    last = match[0];
  }
  if (last === TASK_FAILURE_MARKER) return "failed";
  if (last === TASK_SUCCESS_MARKER) return "finished";
  return "finished";
}

