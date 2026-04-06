import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { parse as parseYaml } from "yaml";
import { type NatsConnection } from "nats";
import { listTasks, parseTaskFile, writeTaskFile, getTaskDir, readTaskStatus, writeTaskStatus, readHistory, deleteHistoryEntry, appendTaskList, removeFromTaskList, appendHistory, createRunDir, appendRunMessage } from "./task.js";
import { getPlatform } from "./platform/index.js";
import { spawnCommand } from "./spawn-command.js";
import { getAgent } from "./agents/agent.js";
import { validateSession } from "./session-store.js";
import { publishHostEvent } from "./events.js";
import { currentVersion, performUpdate } from "./update-checker.js";
import type { HostConfig, ParsedTask, RpcMessage, ConversationMessage } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PLAN_GENERATION_PROMPT = fs.readFileSync(
  path.join(__dirname, "commands", "plan-generation.md"),
  "utf-8",
);

/**
 * Parse RESULT frontmatter and conversation messages.
 */
function parseResultFrontmatter(raw: string): Record<string, unknown> {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return { messages: [] };

  const meta: Record<string, string> = {};
  for (const line of fmMatch[1].split("\n")) {
    const sep = line.indexOf(": ");
    if (sep === -1) continue;
    meta[line.slice(0, sep).trim()] = line.slice(sep + 2).trim();
  }

  const messages = parseConversationMessages(fmMatch[2]);

  // Derive running_state, start_time, end_time from status messages
  const statusMessages = messages.filter((m: ConversationMessage) => m.role === "status");
  const startedMsg = statusMessages.find((m: ConversationMessage) => m.type === "started");
  const terminalStates = ["finished", "failed", "aborted"];
  const terminalMsg = [...statusMessages].reverse().find((m: ConversationMessage) => terminalStates.includes(m.type ?? ""));

  // Detect follow-up in progress: last non-status message is a user message with no assistant response
  const nonStatusMessages = messages.filter((m: ConversationMessage) => m.role !== "status");
  const lastNonStatus = nonStatusMessages[nonStatusMessages.length - 1];
  const followupRunning = lastNonStatus?.role === "user" && terminalMsg !== undefined;

  return {
    messages,
    task_name: meta.task_name,
    running_state: followupRunning ? "followup" : (terminalMsg?.type ?? (startedMsg ? "started" : undefined)),
    start_time: startedMsg?.time || undefined,
    end_time: terminalMsg?.time || undefined,
  };
}

/**
 * Parse conversation messages from the body of a RESULT file.
 */
function parseConversationMessages(body: string): ConversationMessage[] {
  const delimiterRegex = /<!-- palmier:message\s+(.*?)\s*-->/g;
  const messages: ConversationMessage[] = [];
  const matches = [...body.matchAll(delimiterRegex)];

  if (matches.length === 0) {
    // No delimiters — treat entire body as single assistant message if non-empty
    const content = body.trim();
    if (content) {
      messages.push({ role: "assistant", time: 0, content });
    }
    return messages;
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const attrs = match[1];
    const start = match.index! + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : body.length;
    const content = body.slice(start, end).trim();

    const role = (parseAttr(attrs, "role") ?? "assistant") as "assistant" | "user";
    const time = Number(parseAttr(attrs, "time") ?? "0");
    const type = parseAttr(attrs, "type") as ConversationMessage["type"];
    const attachmentsRaw = parseAttr(attrs, "attachments");
    const attachments = attachmentsRaw ? attachmentsRaw.split(",").map((f) => f.trim()).filter(Boolean) : undefined;

    messages.push({ role, time, content, ...(type ? { type } : {}), ...(attachments ? { attachments } : {}) });
  }

  return messages;
}

function parseAttr(attrs: string, name: string): string | undefined {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : undefined;
}

/**
 * Run plan generation for a task prompt using the given agent.
 * Returns the generated plan body and task name.
 */
async function generatePlan(
  projectRoot: string,
  userPrompt: string,
  agentName: string,
): Promise<{ name: string; body: string }> {
  const fullPrompt = PLAN_GENERATION_PROMPT + userPrompt;
  const planAgent = getAgent(agentName);
  const { command, args, stdin } = planAgent.getPlanGenerationCommandLine(fullPrompt);
  console.log(`[generatePlan] Running: ${command} ${args.join(" ")}`);

  const { output } = await spawnCommand(command, args, {
    cwd: projectRoot,
    timeout: 120_000,
    stdin,
  });

  let name = "";
  const trimmed = output.trim();
  let body = trimmed;
  const fmMatch = trimmed.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    try {
      const fm = parseYaml(fmMatch[1]) as { task_name?: string };
      name = fm.task_name ?? "";
    } catch {
      // If frontmatter parsing fails, treat entire output as body
    }
    body = fmMatch[2].trimStart();
  }
  return { name, body };
}

/**
 * Create a transport-agnostic RPC handler bound to the given config.
 */
export function createRpcHandler(config: HostConfig, nc?: NatsConnection) {
  function flattenTask(task: ParsedTask) {
    const taskDir = getTaskDir(config.projectRoot, task.frontmatter.id);
    return {
      ...task.frontmatter,
      body: task.body,
      status: readTaskStatus(taskDir),
    };
  }

  async function handleRpc(request: RpcMessage): Promise<unknown> {
    // Session token validation: always require a valid session token
    if (!request.sessionToken || !validateSession(request.sessionToken)) {
      return { error: "Unauthorized" };
    }

    switch (request.method) {
      case "task.list": {
        const tasks = listTasks(config.projectRoot);
        return {
          tasks: tasks.map((task) => flattenTask(task)),
          agents: config.agents ?? [],
          version: currentVersion,
        };
      }

      case "task.create": {
        const params = request.params as {
          user_prompt: string;
          agent: string;
          triggers?: Array<{ type: "cron" | "once"; value: string }>;
          triggers_enabled?: boolean;
          requires_confirmation?: boolean;
          command?: string;
        };

        // Only generate a plan for longer prompts that benefit from it
        let name = "";
        let body = "";
        if (params.user_prompt.length <= 50) {
          name = params.user_prompt;
        } else {
          try {
            const plan = await generatePlan(config.projectRoot, params.user_prompt, params.agent);
            name = plan.name;
            body = plan.body;
          } catch (err: unknown) {
            const error = err as { stdout?: string; stderr?: string };
            return { error: "plan generation failed", stdout: error.stdout, stderr: error.stderr };
          }
        }

        const id = randomUUID();
        const taskDir = getTaskDir(config.projectRoot, id);
        const task = {
          frontmatter: {
            id,
            name,
            user_prompt: params.user_prompt,
            agent: params.agent,
            triggers: params.triggers ?? [],
            triggers_enabled: params.triggers_enabled ?? true,
            requires_confirmation: params.requires_confirmation ?? true,
            ...(params.command ? { command: params.command } : {}),
          },
          body,
        };

        writeTaskFile(taskDir, task);
        appendTaskList(config.projectRoot, id);
        getPlatform().installTaskTimer(config, task);

        return flattenTask(task);
      }

      case "task.update": {
        const params = request.params as {
          id: string;
          user_prompt?: string;
          agent?: string;
          triggers?: Array<{ type: "cron" | "once"; value: string }>;
          triggers_enabled?: boolean;
          requires_confirmation?: boolean;
          command?: string;
        };

        const taskDir = getTaskDir(config.projectRoot, params.id);
        const existing = parseTaskFile(taskDir);

        // Detect whether plan needs regeneration
        const promptChanged = params.user_prompt !== undefined && params.user_prompt !== existing.frontmatter.user_prompt;
        const agentChanged = params.agent !== undefined && params.agent !== existing.frontmatter.agent;
        const needsRegeneration = promptChanged || agentChanged || !existing.body;

        // Merge updates
        if (params.user_prompt !== undefined) existing.frontmatter.user_prompt = params.user_prompt;
        if (params.agent !== undefined) existing.frontmatter.agent = params.agent;
        if (params.triggers !== undefined) existing.frontmatter.triggers = params.triggers;
        if (params.triggers_enabled !== undefined) existing.frontmatter.triggers_enabled = params.triggers_enabled;
        if (params.requires_confirmation !== undefined)
          existing.frontmatter.requires_confirmation = params.requires_confirmation;
        if (params.command !== undefined) {
          if (params.command) {
            existing.frontmatter.command = params.command;
          } else {
            delete existing.frontmatter.command;
          }
        }

        // Regenerate plan if needed (only for longer prompts)
        if (existing.frontmatter.user_prompt.length <= 50) {
          existing.frontmatter.name = existing.frontmatter.user_prompt;
          existing.body = "";
        } else if (needsRegeneration) {
          try {
            const plan = await generatePlan(config.projectRoot, existing.frontmatter.user_prompt, existing.frontmatter.agent);
            existing.frontmatter.name = plan.name;
            existing.body = plan.body;
          } catch (err: unknown) {
            const error = err as { stdout?: string; stderr?: string };
            return { error: "plan generation failed", stdout: error.stdout, stderr: error.stderr };
          }
        }

        writeTaskFile(taskDir, existing);

        // Update timers — installTaskTimer overwrites in-place (schtasks /f,
        // systemd unit rewrite) without killing a running task process.
        getPlatform().installTaskTimer(config, existing);

        return flattenTask(existing);
      }

      case "task.delete": {
        const params = request.params as { id: string };

        getPlatform().removeTaskTimer(params.id);
        removeFromTaskList(config.projectRoot, params.id);

        return { ok: true, task_id: params.id };
      }

      case "task.run_oneoff": {
        const params = request.params as {
          user_prompt: string;
          agent: string;
          requires_confirmation?: boolean;
          command?: string;
        };

        const id = randomUUID();
        const taskDir = getTaskDir(config.projectRoot, id);
        const name = params.user_prompt.slice(0, 60);
        const task: ParsedTask = {
          frontmatter: {
            id,
            name,
            user_prompt: params.user_prompt,
            agent: params.agent,
            triggers: [],
            triggers_enabled: false,
            requires_confirmation: params.requires_confirmation ?? false,
            ...(params.command ? { command: params.command } : {}),
          },
          body: "",
        };

        writeTaskFile(taskDir, task);
        // Do NOT append to tasks.jsonl — this is a one-off run

        // Create initial result file so it appears in runs list immediately
        const runId = createRunDir(taskDir, name, Date.now());
        appendHistory(config.projectRoot, { task_id: id, run_id: runId });

        // Spawn `palmier run <id>` directly as a detached process
        const script = process.argv[1] || "palmier";
        const child = spawn(process.execPath, [script, "run", id], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        child.unref();

        return { ok: true, task_id: id, run_id: runId };
      }

      case "task.run": {
        const params = request.params as { id: string };
        try {
          // Create initial result file so it appears in runs list immediately
          const runTaskDir = getTaskDir(config.projectRoot, params.id);
          const runTask = parseTaskFile(runTaskDir);
          const taskRunId = createRunDir(runTaskDir, runTask.frontmatter.name, Date.now());
          appendHistory(config.projectRoot, { task_id: params.id, run_id: taskRunId });

          await getPlatform().startTask(params.id);
          return { ok: true, task_id: params.id, run_id: taskRunId };
        } catch (err: unknown) {
          const e = err as { stderr?: string; message?: string };
          console.error(`task.run failed for ${params.id}: ${e.stderr || e.message}`);
          return { error: `Failed to start task: ${e.stderr || e.message}` };
        }
      }

      case "task.followup": {
        const params = request.params as { id: string; run_id: string; message: string };
        if (!params.run_id || !params.message?.trim()) {
          return { error: "run_id and message are required" };
        }
        const followupTaskDir = getTaskDir(config.projectRoot, params.id);

        // Append user message to RESULT file (no status entries — follow-ups don't affect task status)
        appendRunMessage(followupTaskDir, params.run_id, {
          role: "user",
          time: Date.now(),
          content: params.message,
        });

        // Broadcast so UI updates (shows typing indicator based on unanswered user message)
        await publishHostEvent(nc, config.hostId, params.id, { event_type: "result-updated", run_id: params.run_id });

        // Spawn `palmier run <id>` as detached process — it will detect
        // the existing RESULT file and use the last user message as continuation prompt
        const followupScript = process.argv[1] || "palmier";
        const followupChild = spawn(process.execPath, [followupScript, "run", params.id], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        followupChild.unref();

        return { ok: true, task_id: params.id, run_id: params.run_id };
      }

      case "task.abort": {
        const params = request.params as { id: string };
        const abortTaskDir = getTaskDir(config.projectRoot, params.id);
        // Read the PID before overwriting status — stopTask needs it to
        // kill the entire process tree on Windows.
        const abortPrevStatus = readTaskStatus(abortTaskDir);
        // Write abort status BEFORE killing so the dying process's signal
        // handler can detect this was RPC-initiated and skip publishing.
        writeTaskStatus(abortTaskDir, {
          running_state: "aborted",
          time_stamp: Date.now(),
          ...(abortPrevStatus?.pid ? { pid: abortPrevStatus.pid } : {}),
        });
        // Append aborted status to the latest run
        try {
          const runDirs = fs.readdirSync(abortTaskDir)
            .filter((f) => /^\d+$/.test(f) && fs.existsSync(path.join(abortTaskDir, f, "TASKRUN.md")))
            .sort();
          const latestRunId = runDirs[runDirs.length - 1];
          if (latestRunId) {
            appendRunMessage(abortTaskDir, latestRunId, {
              role: "status",
              time: Date.now(),
              content: "",
              type: "aborted",
            });
          }
        } catch { /* best-effort */ }

        try {
          await getPlatform().stopTask(params.id);
        } catch (err: unknown) {
          const e = err as { stderr?: string; message?: string };
          console.error(`task.abort failed for ${params.id}: ${e.stderr || e.message}`);
          return { error: `Failed to abort task: ${e.stderr || e.message}` };
        }
        // Notify connected clients (NATS + HTTP SSE if LAN server is running)
        const abortPayload: Record<string, unknown> = { event_type: "running-state", running_state: "aborted" };
        await publishHostEvent(nc, config.hostId, params.id, abortPayload);
        return { ok: true, task_id: params.id };
      }

      case "task.status": {
        const params = request.params as { id: string };
        const taskDir = getTaskDir(config.projectRoot, params.id);
        const status = readTaskStatus(taskDir);
        if (!status) {
          return { task_id: params.id, error: "No status found" };
        }
        return { task_id: params.id, ...status };
      }

      case "task.result": {
        const params = request.params as { id: string; run_id: string };
        if (!params.run_id) {
          return { error: "run_id is required" };
        }
        const taskrunPath = path.join(config.projectRoot, "tasks", params.id, params.run_id, "TASKRUN.md");

        try {
          const raw = fs.readFileSync(taskrunPath, "utf-8");
          const meta = parseResultFrontmatter(raw);
          return { task_id: params.id, ...meta };
        } catch {
          return { task_id: params.id, error: "Run not found" };
        }
      }

      case "task.reports": {
        const params = request.params as { id: string; run_id: string; report_files: string[] };
        if (!params.run_id || !Array.isArray(params.report_files) || params.report_files.length === 0) {
          return { error: "run_id and report_files are required" };
        }
        const reports: Array<{ file: string; content?: string; error?: string }> = [];
        const runDir = path.join(config.projectRoot, "tasks", params.id, params.run_id);
        for (const file of params.report_files) {
          if (!file.endsWith(".md")) {
            reports.push({ file, error: "must end with .md" });
            continue;
          }
          const basename = path.basename(file);
          if (basename !== file) {
            reports.push({ file, error: "must be a plain filename" });
            continue;
          }
          const reportPath = path.join(runDir, basename);
          try {
            const content = fs.readFileSync(reportPath, "utf-8");
            reports.push({ file, content });
          } catch {
            reports.push({ file, error: "Report file not found" });
          }
        }
        return { task_id: params.id, reports };
      }

      case "task.user_input": {
        const params = request.params as { id: string; value: string[] };
        const taskDir = getTaskDir(config.projectRoot, params.id);

        const currentStatus = readTaskStatus(taskDir);
        if (!currentStatus?.pending_confirmation && !currentStatus?.pending_permission?.length && !currentStatus?.pending_input?.length) {
          return { ok: false, error: "not pending" };
        }

        writeTaskStatus(taskDir, { ...currentStatus, user_input: params.value });

        console.log(`[task.user_input] ${params.id} → ${params.value}`);
        return { ok: true };
      }

      case "taskrun.list": {
        const params = request.params as { offset?: number; limit?: number; task_id?: string };
        const { entries, total } = readHistory(config.projectRoot, {
          offset: params.offset ?? 0,
          limit: params.limit ?? 10,
          task_id: params.task_id,
        });

        const enriched = entries.map((entry) => {
          const taskrunPath = path.join(config.projectRoot, "tasks", entry.task_id, entry.run_id, "TASKRUN.md");
          try {
            const raw = fs.readFileSync(taskrunPath, "utf-8");
            const meta = parseResultFrontmatter(raw);
            const { messages: _, ...rest } = meta;
            return { ...entry, ...rest };
          } catch {
            return { ...entry, error: "Run not found" };
          }
        });

        return { entries: enriched, total };
      }

      case "taskrun.delete": {
        const params = request.params as { task_id: string; run_id: string };
        if (!params.task_id || !params.run_id) {
          return { error: "task_id and run_id are required" };
        }
        const deleted = deleteHistoryEntry(config.projectRoot, params.task_id, params.run_id);
        if (!deleted) {
          return { error: "History entry not found" };
        }
        return { ok: true, task_id: params.task_id, run_id: params.run_id };
      }

      case "host.update": {
        const error = await performUpdate();
        if (error) return { error };
        return { ok: true };
      }

      default:
        return { error: `Unknown method: ${request.method}` };
    }
  }

  return handleRpc;
}
