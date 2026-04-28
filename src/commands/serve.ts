import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../config.js";
import { connectNats } from "../nats-client.js";
import { createRpcHandler } from "../rpc-handler.js";
import { startNatsTransport } from "../transports/nats-transport.js";
import { startHttpTransport } from "../transports/http-transport.js";
import { getTaskDir, readTaskStatus, writeTaskStatus, parseTaskFile, appendRunMessage, listTasks, readFollowupStatus, deleteFollowupStatus } from "../task.js";
import { publishHostEvent } from "../events.js";
import { getPlatform } from "../platform/index.js";
import { detectAgents } from "../agents/agent.js";
import { saveConfig } from "../config.js";
import type { HostConfig } from "../types.js";
import { CONFIG_DIR } from "../config.js";
import { StringCodec, type NatsConnection } from "nats";
import { addNotification } from "../notification-store.js";
import { addSmsMessage } from "../sms-store.js";
import { enqueueEvent } from "../event-queues.js";

const POLL_INTERVAL_MS = 30_000;
const DAEMON_PID_FILE = path.join(CONFIG_DIR, "daemon.pid");

/**
 * Reconcile tasks stuck in "started" whose process is no longer alive, and
 * clean up OS scheduler units for one-off tasks that have already terminated.
 * The system scheduler (Task Scheduler / systemd) is the authoritative source.
 */
async function checkStaleTasks(
  config: HostConfig,
  nc: NatsConnection | undefined,
): Promise<void> {
  const tasksRoot = path.join(config.projectRoot, "tasks");
  if (!fs.existsSync(tasksRoot)) return;

  const platform = getPlatform();
  const taskIds = fs.readdirSync(tasksRoot).filter((f) =>
    fs.statSync(path.join(tasksRoot, f)).isDirectory()
  );

  for (const taskId of taskIds) {
    const taskDir = getTaskDir(config.projectRoot, taskId);
    const status = readTaskStatus(taskDir);
    if (!status) continue;

    let task;
    try { task = parseTaskFile(taskDir); } catch { continue; }

    if (status.running_state === "started" && !platform.isTaskRunning(taskId)) {
      console.log(`[monitor] Task ${taskId} process exited unexpectedly, marking as failed.`);
      const endTime = Date.now();
      writeTaskStatus(taskDir, { running_state: "failed", time_stamp: endTime });

      const runId = fs.readdirSync(taskDir)
        .filter((f) => /^\d+$/.test(f) && fs.existsSync(path.join(taskDir, f, "TASKRUN.md")))
        .sort()
        .pop();

      if (runId) {
        appendRunMessage(taskDir, runId, {
          role: "status",
          time: endTime,
          content: "",
          type: "failed",
        });
      }

      await publishHostEvent(nc, config.hostId, taskId, {
        event_type: "running-state",
        running_state: "failed",
        name: task.frontmatter.name || taskId,
      });
    }

    if (task.frontmatter.one_off && status.running_state !== "started") {
      try { platform.removeTaskTimer(taskId); } catch { /* best-effort */ }
    }

    // Reconcile orphaned follow-ups: if a run has a persisted follow-up PID
    // but that process is no longer alive, clear the file and mark the run
    // as failed so the UI doesn't claim it's still running.
    const runIds = fs.readdirSync(taskDir).filter((f) =>
      /^\d+$/.test(f) && fs.existsSync(path.join(taskDir, f, "TASKRUN.md"))
    );
    for (const runId of runIds) {
      const runDir = path.join(taskDir, runId);
      const followup = readFollowupStatus(runDir);
      if (!followup) continue;
      try {
        process.kill(followup.pid, 0);
      } catch {
        deleteFollowupStatus(runDir);
        appendRunMessage(taskDir, runId, {
          role: "status",
          time: Date.now(),
          content: "",
          type: "failed",
        });
        await publishHostEvent(nc, config.hostId, taskId, { event_type: "result-updated", run_id: runId });
      }
    }
  }
}

export async function serveCommand(): Promise<void> {
  const config = loadConfig();

  // PID file lets `palmier restart` find us regardless of how we were started
  fs.writeFileSync(DAEMON_PID_FILE, String(process.pid), "utf-8");

  console.log("Starting...");

  const agents = await detectAgents(config.agents);
  config.agents = agents;
  saveConfig(config);
  console.log(`Detected agents: ${agents.map((a) => a.key).join(", ") || "none"}`);

  let nc: NatsConnection | undefined;
  try {
    nc = await connectNats(config);
    console.log("[nats] Connected");
  } catch (err) {
    console.warn(`[nats] Connection failed (server mode unavailable): ${err}`);
  }

  await checkStaleTasks(config, nc);

  // Reinstall scheduler entries for all tasks (recovery after init/reinstall)
  const platform = getPlatform();
  const allTasks = listTasks(config.projectRoot);
  for (const task of allTasks) {
    try {
      platform.installTaskTimer(config, task);
    } catch (err) {
      console.error(`Warning: failed to install timer for task ${task.frontmatter.id}: ${err}`);
    }
  }

  setInterval(() => {
    checkStaleTasks(config, nc).catch((err) => {
      console.error("[monitor] Error checking stale tasks:", err);
    });
  }, POLL_INTERVAL_MS);

  const handleRpc = createRpcHandler(config, nc);
  const httpPort = config.httpPort ?? 7256;

  if (nc) {
    startNatsTransport(config, handleRpc, nc);

    const sc = StringCodec();

    // Match phone numbers regardless of formatting; letters preserved for shortcodes.
    function normalizeSender(raw: string): string {
      return raw.replace(/[\s\-()+]/g, "").toLowerCase();
    }

    function dispatchDeviceEvent(scheduleType: "on_new_notification" | "on_new_sms", payload: string, parsed?: unknown): void {
      for (const task of listTasks(config.projectRoot)) {
        if (task.frontmatter.schedule_type !== scheduleType) continue;
        if (!task.frontmatter.schedule_enabled) continue;
        if (scheduleType === "on_new_notification" && task.frontmatter.schedule_values && task.frontmatter.schedule_values.length > 0) {
          const pkg = (parsed as { packageName?: string } | undefined)?.packageName;
          if (!pkg || !task.frontmatter.schedule_values.includes(pkg)) continue;
        }
        if (scheduleType === "on_new_sms" && task.frontmatter.schedule_values && task.frontmatter.schedule_values.length > 0) {
          const sender = (parsed as { sender?: string } | undefined)?.sender;
          const normalizedSender = sender ? normalizeSender(sender) : "";
          if (!normalizedSender || !task.frontmatter.schedule_values.some((s) => normalizeSender(s) === normalizedSender)) continue;
        }
        const { shouldStart } = enqueueEvent(task.frontmatter.id, payload);
        if (shouldStart) {
          platform.startTask(task.frontmatter.id).catch((err) => {
            console.error(`[event-trigger] Failed to start ${task.frontmatter.id}:`, err);
          });
        }
      }
    }

    const notifSub = nc.subscribe(`host.${config.hostId}.device.notifications`);
    (async () => {
      for await (const msg of notifSub) {
        const raw = sc.decode(msg.data);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
          addNotification({ ...(parsed as object), receivedAt: Date.now() } as Parameters<typeof addNotification>[0]);
        } catch (err) {
          console.error("[nats] Failed to parse device notification:", err);
        }
        dispatchDeviceEvent("on_new_notification", raw, parsed);
      }
    })();

    const smsSub = nc.subscribe(`host.${config.hostId}.device.sms`);
    (async () => {
      for await (const msg of smsSub) {
        const raw = sc.decode(msg.data);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
          addSmsMessage({ ...(parsed as object), receivedAt: Date.now() } as Parameters<typeof addSmsMessage>[0]);
        } catch (err) {
          console.error("[nats] Failed to parse device SMS:", err);
        }
        dispatchDeviceEvent("on_new_sms", raw, parsed);
      }
    })();
  }

  await startHttpTransport(config, handleRpc, httpPort, nc);
}
