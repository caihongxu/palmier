import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../config.js";
import { connectNats } from "../nats-client.js";
import { createRpcHandler } from "../rpc-handler.js";
import { startNatsTransport } from "../transports/nats-transport.js";
import { getTaskDir, readTaskStatus, writeTaskStatus, appendHistory, parseTaskFile, appendResultMessage } from "../task.js";
import { publishHostEvent } from "../events.js";
import { getPlatform } from "../platform/index.js";
import { detectAgents } from "../agents/agent.js";
import { saveConfig } from "../config.js";
import type { HostConfig } from "../types.js";
import { CONFIG_DIR } from "../config.js";
import type { NatsConnection } from "nats";

const POLL_INTERVAL_MS = 30_000;
const DAEMON_PID_FILE = path.join(CONFIG_DIR, "daemon.pid");

/**
 * Mark a stuck task as failed: update status.json, write RESULT, append history,
 * and broadcast the failure event.
 */
async function markTaskFailed(
  config: HostConfig,
  nc: NatsConnection | undefined,
  taskId: string,
  reason: string,
): Promise<void> {
  const taskDir = getTaskDir(config.projectRoot, taskId);
  const status = readTaskStatus(taskDir);
  if (!status || status.running_state !== "started") return;

  console.log(`[monitor] Task ${taskId} ${reason}, marking as failed.`);
  const endTime = Date.now();
  writeTaskStatus(taskDir, { running_state: "failed", time_stamp: endTime });

  let taskName = taskId;
  try {
    const task = parseTaskFile(taskDir);
    taskName = task.frontmatter.name || taskId;
  } catch { /* use taskId as fallback */ }

  const resultFileName = `RESULT-${endTime}.md`;
  const content = `---\ntask_name: ${taskName}\nrunning_state: failed\nstart_time: ${status.time_stamp}\nend_time: ${endTime}\ntask_file: \n---\n\n`;
  fs.writeFileSync(path.join(taskDir, resultFileName), content, "utf-8");
  appendResultMessage(taskDir, resultFileName, {
    role: "assistant",
    time: endTime,
    content: reason,
  });
  appendHistory(config.projectRoot, { task_id: taskId, result_file: resultFileName });

  const payload: Record<string, unknown> = { event_type: "running-state", running_state: "failed", name: taskName };
  await publishHostEvent(nc, config.hostId, taskId, payload);
}

/**
 * Scan all tasks for any stuck in "start" state whose process is no longer alive.
 * Uses the system scheduler (Task Scheduler / systemd) as the authoritative source.
 */
async function checkStaleTasks(
  config: HostConfig,
  nc: NatsConnection | undefined,
): Promise<void> {
  const tasksJsonl = path.join(config.projectRoot, "tasks.jsonl");
  if (!fs.existsSync(tasksJsonl)) return;

  const platform = getPlatform();
  const lines = fs.readFileSync(tasksJsonl, "utf-8").split("\n").filter(Boolean);
  for (const line of lines) {
    let taskId: string;
    try {
      taskId = (JSON.parse(line) as { task_id: string }).task_id;
    } catch { continue; }

    const taskDir = getTaskDir(config.projectRoot, taskId);
    const status = readTaskStatus(taskDir);
    if (!status || status.running_state !== "started") continue;

    // Ask the system scheduler if the task is still running
    if (platform.isTaskRunning(taskId)) continue;

    await markTaskFailed(config, nc, taskId, "Task process exited unexpectedly");
  }
}

/**
 * Start the persistent RPC handler (NATS only).
 */
export async function serveCommand(): Promise<void> {
  const config = loadConfig();

  // Write PID so `palmier restart` can find us regardless of how we were started
  fs.writeFileSync(DAEMON_PID_FILE, String(process.pid), "utf-8");

  console.log("Starting...");

  // Re-detect agents on every daemon start
  const agents = await detectAgents();
  config.agents = agents;
  saveConfig(config);
  console.log(`Detected agents: ${agents.map((a) => a.key).join(", ") || "none"}`);

  const nc = await connectNats(config);

  // Reconcile any tasks stuck from before daemon started
  await checkStaleTasks(config, nc);

  // Poll for crashed tasks every 30 seconds
  setInterval(() => {
    checkStaleTasks(config, nc).catch((err) => {
      console.error("[monitor] Error checking stale tasks:", err);
    });
  }, POLL_INTERVAL_MS);

  const handleRpc = createRpcHandler(config, nc);
  await startNatsTransport(config, handleRpc, nc);
}
