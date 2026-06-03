import * as fs from "fs";
import * as path from "path";
import { spawnCommand } from "../spawn-command.js";
import { loadConfig } from "../config.js";
import { connectNats } from "../nats-client.js";
import { parseTaskFile, getTaskDir, writeTaskFile, writeTaskStatus, readTaskStatus, appendHistory, createRunDir, appendRunMessage, readRunMessages, getRunDir, beginStreamingMessage, StreamingMessageWriter } from "../task.js";
import { getAgent } from "../agents/agent.js";
import { getPlatform } from "../platform/index.js";
import { TASK_SUCCESS_MARKER, TASK_FAILURE_MARKER, TASK_REPORT_PREFIX, TASK_PERMISSION_PREFIX } from "../agents/shared-prompt.js";
import type { AgentTool } from "../agents/agent.js";
import { publishHostEvent } from "../events.js";
import type { HostConfig, ParsedTask, TaskRunningState, RequiredPermission } from "../types.js";
import type { NatsConnection } from "nats";

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
 * Invoke the agent CLI in a continuation loop to handle permission requests.
 * `invokeTask` is the ParsedTask whose prompt is passed to the agent (for
 * triggered tasks this is the per-trigger augmented task).
 */
async function invokeAgentWithRetries(
  ctx: InvocationContext,
  invokeTask: ParsedTask,
): Promise<InvocationResult> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let writer: StreamingMessageWriter | undefined;
    let activeStream: "stdout" | "stderr" | undefined;
    const lineBufs: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };
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

    function ensureWriter(stream: "stdout" | "stderr"): StreamingMessageWriter {
      if (writer && activeStream === stream) return writer;
      if (writer) writer.end();
      writer = beginStreamingMessage(ctx.taskDir, ctx.runId, Date.now(), stream);
      activeStream = stream;
      return writer;
    }

    function emit(stream: "stdout" | "stderr", chunk: string): void {
      lineBufs[stream] += chunk;
      const lines = lineBufs[stream].split("\n");
      lineBufs[stream] = lines.pop() ?? "";
      const filtered = lines.filter((l) => !l.startsWith("[PALMIER"));
      if (filtered.length === 0) return;
      ensureWriter(stream).write(filtered.join("\n") + "\n");
      throttledNotify();
    }

    const { args, stdin, env: agentEnv, files } = ctx.agent.getTaskRunCommandLine(
      invokeTask, undefined, ctx.task.frontmatter.yolo_mode ? "yolo" : ctx.transientPermissions,
    );
    const command = ctx.agent.command;
    const runDir = getRunDir(ctx.taskDir, ctx.runId);
    if (files) {
      for (const f of files) fs.writeFileSync(path.join(runDir, f.path), f.content, "utf-8");
    }
    const result = await spawnCommand(command, args, {
      cwd: runDir,
      env: { ...ctx.guiEnv, ...agentEnv, PALMIER_RUN_DIR: runDir, PALMIER_HTTP_PORT: String(ctx.config.httpPort ?? 7256) },
      echoStdout: true,
      resolveOnFailure: true,
      stdin,
      onStdout: (chunk) => emit("stdout", chunk),
      onStderr: ctx.agent.suppressStdErr ? undefined : (chunk) => emit("stderr", chunk),
    });

    if (notifyTimer) clearTimeout(notifyTimer);

    const outcome: TaskRunningState = result.exitCode !== 0 ? "failed" : parseTaskOutcome(result.output);
    const reportFiles = parseReportFiles(result.output);
    const requiredPermissions = parsePermissions(result.output);

    for (const stream of ["stdout", "stderr"] as const) {
      const trailing = lineBufs[stream];
      if (trailing && !trailing.startsWith("[PALMIER")) {
        ensureWriter(stream).write(trailing);
      }
    }

    if (requiredPermissions.length > 0) {
      const permLines = requiredPermissions.map((p) => `- **${p.name}** ${p.description}`).join("\n");
      ensureWriter("stdout").write(`\n\n**Permissions requested:**\n${permLines}\n`);
    }

    if (reportFiles.length > 0) {
      ensureWriter("stdout").end(reportFiles);
    } else if (writer) {
      writer.end();
    }
    await publishHostEvent(ctx.nc, ctx.config.hostId, ctx.taskId, { event_type: "result-updated", run_id: ctx.runId });

    if (reportFiles.length > 0) {
      await publishHostEvent(ctx.nc, ctx.config.hostId, ctx.taskId, {
        event_type: "report-generated",
        run_id: ctx.runId,
        name: ctx.task.frontmatter.name,
        report_files: reportFiles,
      });
    }

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

      // Retry with the new permissions if the agent failed.
      if (outcome === "failed") {
        continue;
      }
    }

    return { outcome };
  }
}

export function stripPalmierMarkers(output: string): string {
  return output.split("\n").filter((l) => !l.startsWith("[PALMIER")).join("\n").trim();
}

async function appendAndNotify(
  ctx: InvocationContext,
  msg: Parameters<typeof appendRunMessage>[2],
): Promise<void> {
  appendRunMessage(ctx.taskDir, ctx.runId, msg);
  await publishHostEvent(ctx.nc, ctx.config.hostId, ctx.taskId, { event_type: "result-updated", run_id: ctx.runId });
}

/** The latest run dir with no status messages yet — freshly created by the RPC handler. */
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
 * If the RPC handler already wrote "aborted" (via task.abort), respect that
 * instead of overwriting with the process's own outcome.
 */
function resolveOutcome(taskDir: string, outcome: TaskRunningState): TaskRunningState {
  const current = readTaskStatus(taskDir);
  if (current?.running_state === "aborted") return "aborted";
  return outcome;
}

export async function runCommand(taskId: string): Promise<void> {
  const config = loadConfig();
  const taskDir = getTaskDir(config.projectRoot, taskId);
  const task = parseTaskFile(taskDir);
  console.log(`Running task: ${taskId}`);

  let nc: NatsConnection | undefined;
  const taskName = task.frontmatter.name;

  const existingRunId = findLatestPendingRunId(taskDir);
  const agentVersion = config.agents?.find((a) => a.key === task.frontmatter.agent)?.version;
  const runId = existingRunId ?? createRunDir(taskDir, taskName, Date.now(), task.frontmatter.agent, agentVersion);
  if (!existingRunId) {
    appendHistory(config.projectRoot, { task_id: taskId, run_id: runId });
  }

  const cleanup = async () => {
    if (nc && !nc.isClosed()) {
      await nc.drain();
    }
    if (task.frontmatter.one_off) {
      try { getPlatform().removeTaskTimer(taskId); } catch { /* best-effort */ }
    }
  };

  try {
    nc = await connectNats(config);

    await publishTaskEvent(nc, config, taskDir, taskId, "started", taskName, runId);
    appendRunMessage(taskDir, runId, { role: "status", time: Date.now(), content: "", type: "started" });
    await publishHostEvent(nc, config.hostId, taskId, { event_type: "result-updated", run_id: runId });

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

    const guiEnv = getPlatform().getGuiEnv();
    const agent = getAgent(task.frontmatter.agent);
    const ctx: InvocationContext = {
      agent, task, taskDir, runId, guiEnv, nc, config, taskId,
      transientPermissions: [],
    };

    // Command-triggered and on_new_* tasks share the same trigger machinery: the
    // daemon owns the trigger source (the shell command's stdout / a NATS
    // subscription) and feeds the shared per-task queue, while this run drains
    // that queue one invocation at a time.
    if (task.frontmatter.command
        || task.frontmatter.schedule_type === "on_new_notification"
        || task.frontmatter.schedule_type === "on_new_sms") {
      const result = await runEventTriggeredMode(ctx);
      const outcome = resolveOutcome(taskDir, result.outcome);
      appendRunMessage(taskDir, runId, { role: "status", time: Date.now(), content: "", type: outcome });
      await publishTaskEvent(nc, config, taskDir, taskId, outcome, taskName, runId);
      console.log(`Task ${taskId} completed (triggered).`);
    } else {
      await appendAndNotify(ctx, {
        role: "user",
        time: Date.now(),
        content: task.frontmatter.user_prompt,
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

/**
 * Drain the daemon-owned per-task event queue via /task-event/pop, invoking the
 * agent once per queued trigger. The run process holds no subscription of its
 * own — the daemon owns the trigger source (a NATS subscription for on_new_*
 * tasks, the command's stdout for command tasks) and atomically clears the
 * active flag on empty pop so it can fire a fresh run on the next trigger.
 */
async function runEventTriggeredMode(
  ctx: InvocationContext,
): Promise<{ outcome: TaskRunningState; endTime: number }> {
  const isCommand = !!ctx.task.frontmatter.command;
  const label = isCommand
    ? "input"
    : ctx.task.frontmatter.schedule_type === "on_new_notification" ? "notification" : "SMS";
  const port = ctx.config.httpPort ?? 7256;
  const popUrl = `http://localhost:${port}/task-event/pop?taskId=${encodeURIComponent(ctx.taskId)}`;

  console.log(`[triggered] Draining ${label} queue`);
  appendRunMessage(ctx.taskDir, ctx.runId, { role: "status", time: Date.now(), content: "", type: "monitoring" });
  await publishHostEvent(ctx.nc, ctx.config.hostId, ctx.taskId, { event_type: "result-updated", run_id: ctx.runId });

  let eventsProcessed = 0;
  let lastOutcome: TaskRunningState = "finished";
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await fetch(popUrl, { method: "POST" });
      if (!res.ok) throw new Error(`pop-event failed: ${res.status} ${res.statusText}`);
      const body = await res.json() as { event?: string; empty?: true };
      if (body.empty || !body.event) break;

      eventsProcessed++;
      console.log(`[triggered] Processing ${label} #${eventsProcessed}`);

      const perEventPrompt = isCommand
        ? `${ctx.task.frontmatter.user_prompt}\n\nProcess this input:\n${body.event}`
        : `${ctx.task.frontmatter.user_prompt}\n\nProcess this new ${label}:\n${body.event}`;
      const perEventTask: ParsedTask = {
        frontmatter: { ...ctx.task.frontmatter, user_prompt: perEventPrompt },
      };

      const result = await invokeAgentWithRetries(ctx, perEventTask);
      lastOutcome = result.outcome;

      appendRunMessage(ctx.taskDir, ctx.runId, { role: "status", time: Date.now(), content: "", type: "monitoring" });
      await publishHostEvent(ctx.nc, ctx.config.hostId, ctx.taskId, { event_type: "result-updated", run_id: ctx.runId });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    appendRunMessage(ctx.taskDir, ctx.runId, { role: "status", time: Date.now(), content: errorMsg, type: "error" });
    await publishHostEvent(ctx.nc, ctx.config.hostId, ctx.taskId, { event_type: "result-updated", run_id: ctx.runId });
    return { outcome: "failed", endTime: Date.now() };
  }

  return { outcome: lastOutcome, endTime: Date.now() };
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
  const port = config.httpPort ?? 7256;
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
  const port = config.httpPort ?? 7256;
  const res = await fetch(`http://localhost:${port}/request-confirmation?taskId=${encodeURIComponent(task.frontmatter.id)}`, {
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

const ALLOWED_REPORT_EXT = [".md", ".txt", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];

export function parseReportFiles(output: string): string[] {
  const regex = new RegExp(`^\\${TASK_REPORT_PREFIX}\\s+(.+)$`, "gm");
  const files: string[] = [];
  let match;
  while ((match = regex.exec(output)) !== null) {
    const name = match[1].trim();
    // Skip placeholder examples echoed from the prompt (e.g. "<filename>").
    if (!name || name.startsWith("<")) continue;
    const ext = name.lastIndexOf(".") >= 0 ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
    if (!ALLOWED_REPORT_EXT.includes(ext)) continue;
    files.push(name);
  }
  return files;
}

export function parsePermissions(output: string): RequiredPermission[] {
  const regex = new RegExp(`^\\${TASK_PERMISSION_PREFIX}\\s+(.+)$`, "gm");
  const perms: RequiredPermission[] = [];
  let match;
  while ((match = regex.exec(output)) !== null) {
    const raw = match[1].trim();
    // Skip placeholder examples echoed from the prompt (e.g. "<tool_name> | <description>").
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

/** Falls back to "finished" if no success/failure marker is found. */
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

