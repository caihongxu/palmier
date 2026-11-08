import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../config.js";
import { connectNats } from "../nats-client.js";
import { createRpcHandler } from "../rpc-handler.js";
import { startNatsTransport } from "../transports/nats-transport.js";
import { startHttpTransport } from "../transports/http-transport.js";
import { getTaskDir, readTaskStatus, writeTaskStatus, parseTaskFile, taskDisplayName, appendRunMessage, listTasks, readFollowupStatus, deleteFollowupStatus } from "../task.js";
import { publishHostEvent } from "../events.js";
import { getPlatform } from "../platform/index.js";
import { detectAgents } from "../agents/agent.js";
import { getPlaywrightCliVersion } from "../playwright-cli.js";
import { saveConfig } from "../config.js";
import type { HostConfig } from "../types.js";
import { CONFIG_DIR } from "../config.js";
import { type NatsConnection } from "@nats-io/transport-node";
import { addNotification } from "../notification-store.js";
import { addSmsMessage } from "../sms-store.js";
import { dispatchTrigger } from "../trigger-dispatch.js";
import { startEnabledCommandRunners } from "../command-runners.js";
import { currentVersion } from "../update-checker.js";

const POLL_INTERVAL_MS = 30_000;
const DAEMON_PID_FILE = path.join(CONFIG_DIR, "daemon.pid");

/**
 * Reconcile tasks stuck in "started" whose process is no longer alive, and
 * clean up OS scheduler units for one-off tasks that have already terminated.
 * The system scheduler (Task Scheduler / systemd) is the authoritative source.
 */
async function checkStaleTasks(
  config: HostConfig,
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

    // Follow-up turns also end in needs_input, but no process is held open for them.
    const isWaitingRun = status.running_state === "needs_input" && status.pid !== undefined;

    if ((status.running_state === "started" || isWaitingRun) && !platform.isTaskRunning(taskId)) {
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

      await publishHostEvent(taskId, {
        event_type: "running-state",
        running_state: "failed",
        name: taskDisplayName(task.frontmatter) || taskId,
      });
    }

    if (task.frontmatter.one_off && status.running_state !== "started" && !isWaitingRun) {
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
        await publishHostEvent(taskId, { event_type: "result-updated", run_id: runId });
      }
    }
  }
}

export async function serveCommand(): Promise<void> {
  const config = loadConfig();

  // PID file lets `palmier restart` find us regardless of how we were started
  fs.writeFileSync(DAEMON_PID_FILE, String(process.pid), "utf-8");

  console.log(`Starting Palmier daemon v${currentVersion}...`);

  const agents = await detectAgents(config.agents);
  config.agents = agents;
  // Keep the managed Playwright CLI version in sync with manual upgrades, and
  // drop the marker if the package was removed out-of-band. Only touched when
  // Palmier already manages it.
  if (config.playwrightCliVersion) {
    config.playwrightCliVersion = getPlaywrightCliVersion() ?? undefined;
  }
  saveConfig(config);
  console.log(`Detected agents: ${agents.map((a) => a.key).join(", ") || "none"}`);

  let nc: NatsConnection | undefined;
  const handleRpc = createRpcHandler(config);

  function attachNats(conn: NatsConnection): void {
    nc = conn;
    console.log("[nats] Connected");
    (async () => {
      for await (const s of conn.status()) {
        if (s.type === "ping") continue;
        const detail = "server" in s ? s.server : "error" in s ? s.error.message : undefined;
        console.log(`[nats] Status: ${s.type}${detail ? ` (${detail})` : ""}`);
      }
    })();

    startNatsTransport(config, handleRpc, conn);


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
        dispatchTrigger(task.frontmatter.id, payload);
      }
    }

    const notifSub = conn.subscribe(`host.${config.hostId}.device.notifications`);
    (async () => {
      for await (const msg of notifSub) {
        const raw = msg.string();
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

    const smsSub = conn.subscribe(`host.${config.hostId}.device.sms`);
    (async () => {
      for await (const msg of smsSub) {
        const raw = msg.string();
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

  // The client's own reconnect only covers a connection that was once up, so a
  // daemon started while offline (e.g. at logon before Wi-Fi) must keep dialing.
  async function connectWithRetry(): Promise<void> {
    for (let delayMs = 5_000; ; delayMs = Math.min(delayMs * 2, 60_000)) {
      try {
        attachNats(await connectNats(config));
        return;
      } catch (err) {
        console.warn(`[nats] Connection failed, retrying in ${delayMs / 1000}s: ${err}`);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // Don't block startup on the relay: local mode must work offline.
  connectWithRetry();

  await checkStaleTasks(config);

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

  // Spawn the long-running command process for every enabled command task —
  // the daemon owns these the same way it owns the device-event subscriptions.
  startEnabledCommandRunners(config);

  setInterval(() => {
    checkStaleTasks(config).catch((err) => {
      console.error("[monitor] Error checking stale tasks:", err);
    });
  }, POLL_INTERVAL_MS);

  const httpPort = config.httpPort ?? 7256;

  await startHttpTransport(config, handleRpc, httpPort, () => nc);
}
