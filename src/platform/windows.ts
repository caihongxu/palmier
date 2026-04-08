import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { spawn as nodeSpawn } from "child_process";
import type { PlatformService } from "./platform.js";
import type { HostConfig, ParsedTask } from "../types.js";
import { CONFIG_DIR, loadConfig } from "../config.js";
import { getTaskDir, readTaskStatus } from "../task.js";


const TASK_PREFIX = "\\Palmier\\PalmierTask-";
const DAEMON_TASK_NAME = "PalmierDaemon";
const DAEMON_PID_FILE = path.join(CONFIG_DIR, "daemon.pid");
const DAEMON_VBS_FILE = path.join(CONFIG_DIR, "daemon.vbs");


const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Convert a cron expression or "once" trigger to Task Scheduler XML trigger elements.
 *
 * Only these cron patterns (produced by the PWA UI) are handled:
 *   hourly:  "0 * * * *"
 *   daily:   "MM HH * * *"
 *   weekly:  "MM HH * * D"
 *   monthly: "MM HH D * *"
 */
export function triggerToXml(trigger: { type: string; value: string }): string {
  if (trigger.type === "once") {
    // ISO datetime "2026-03-28T09:00"
    return `<TimeTrigger><StartBoundary>${trigger.value}:00</StartBoundary></TimeTrigger>`;
  }

  const parts = trigger.value.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${trigger.value}`);
  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;
  const st = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00`;
  // StartBoundary needs a full date; use a past date as the anchor
  const base = `2000-01-01T${st}`;

  // Hourly
  if (hour === "*") {
    return `<TimeTrigger><StartBoundary>${base}</StartBoundary><Repetition><Interval>PT1H</Interval></Repetition></TimeTrigger>`;
  }

  // Weekly
  if (dayOfMonth === "*" && dayOfWeek !== "*") {
    const day = DOW_NAMES[Number(dayOfWeek)] ?? "Monday";
    return `<CalendarTrigger><StartBoundary>${base}</StartBoundary><ScheduleByWeek><DaysOfWeek><${day} /></DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek></CalendarTrigger>`;
  }

  // Monthly
  if (dayOfMonth !== "*" && dayOfWeek === "*") {
    return `<CalendarTrigger><StartBoundary>${base}</StartBoundary><ScheduleByMonth><DaysOfMonth><Day>${dayOfMonth}</Day></DaysOfMonth><Months><January /><February /><March /><April /><May /><June /><July /><August /><September /><October /><November /><December /></Months></ScheduleByMonth></CalendarTrigger>`;
  }

  // Daily
  return `<CalendarTrigger><StartBoundary>${base}</StartBoundary><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`;
}

/**
 * Build a complete Task Scheduler XML definition.
 */
export function buildTaskXml(tr: string, triggers: string[]): string {
  const [command, ...argParts] = tr.match(/"[^"]*"|[^\s]+/g) ?? [];
  const commandStr = command?.replace(/"/g, "") ?? "";
  const argsStr = argParts.map((a) => a.replace(/"/g, "")).join(" ");

  return [
    `<?xml version="1.0" encoding="UTF-16"?>`,
    `<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">`,
    `  <Settings>`,
    `    <MultipleInstancesPolicy>StopExisting</MultipleInstancesPolicy>`,
    `    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>`,
    `    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>`,
    `    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>`,
    `  </Settings>`,
    `  <Triggers>${triggers.join("")}</Triggers>`,
    `  <Actions>`,
    `    <Exec>`,
    `      <Command>${commandStr}</Command>`,
    `      <Arguments>${argsStr}</Arguments>`,
    `    </Exec>`,
    `  </Actions>`,
    `</Task>`,
  ].join("\n");
}

function schtasksTaskName(taskId: string): string {
  return `${TASK_PREFIX}${taskId}`;
}

export class WindowsPlatform implements PlatformService {
  installDaemon(config: HostConfig): void {
    const script = process.argv[1] || "palmier";

    // Write a VBS launcher that starts the daemon with no visible console window.
    // VBS doesn't use backslash escaping — only quotes need doubling ("").
    const vbs = `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${script}"" serve", 0, False`;
    fs.writeFileSync(DAEMON_VBS_FILE, vbs, "utf-8");

    const regValue = `"${process.env.SYSTEMROOT || "C:\\Windows"}\\System32\\wscript.exe" "${DAEMON_VBS_FILE}"`;

    try {
      execFileSync("reg", [
        "add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        "/v", DAEMON_TASK_NAME, "/t", "REG_SZ", "/d", regValue, "/f",
      ], { encoding: "utf-8", stdio: "pipe" });
      console.log(`Registry Run key "${DAEMON_TASK_NAME}" installed (runs at logon).`);
    } catch (err) {
      console.error(`Warning: failed to install registry run entry: ${err}`);
      console.error("You may need to start palmier serve manually.");
    }

    // Start the daemon now
    this.spawnDaemon(script);

    console.log("\nHost initialization complete!");
  }

  async restartDaemon(): Promise<void> {
    const script = process.argv[1] || "palmier";
    const oldPid = fs.existsSync(DAEMON_PID_FILE)
      ? fs.readFileSync(DAEMON_PID_FILE, "utf-8").trim()
      : null;

    if (oldPid && oldPid === String(process.pid)) {
      // We ARE the old daemon (auto-update) — spawn replacement then exit.
      this.spawnDaemon(script);
      process.exit(0);
    }

    // Kill old daemon first, then spawn new one.
    if (oldPid) {
      try {
        execFileSync("taskkill", ["/pid", oldPid, "/f", "/t"], { windowsHide: true, stdio: "pipe" });
      } catch {
        // Process may have already exited
      }
    }

    this.spawnDaemon(script);
  }

  private spawnDaemon(script: string): void {
    // Write a VBS launcher that starts the daemon with no visible console window.
    const vbs = `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${script}"" serve", 0, False`;
    fs.writeFileSync(DAEMON_VBS_FILE, vbs, "utf-8");

    // Use `cmd /c start` to break out of the SSH session's job object.
    // Without this, the daemon is killed when the SSH session disconnects.
    const child = nodeSpawn("cmd", ["/c", "start", "/b", "wscript.exe", DAEMON_VBS_FILE], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    // PID file will be written by the serve command itself when it starts.
    console.log("Palmier daemon started.");
  }

  installTaskTimer(config: HostConfig, task: ParsedTask): void {
    const taskId = task.frontmatter.id;
    const tn = schtasksTaskName(taskId);
    const script = process.argv[1] || "palmier";

    // Write a VBS launcher so the task runs without a visible console window
    const vbsPath = path.join(CONFIG_DIR, `task-${taskId}.vbs`);
    const vbs = `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${script}"" run ${taskId}", 0, True`;
    fs.writeFileSync(vbsPath, vbs, "utf-8");

    const wscript = `${process.env.SYSTEMROOT || "C:\\Windows"}\\System32\\wscript.exe`;
    const tr = `"${wscript}" "${vbsPath}"`;

    // Build trigger XML elements
    const triggerElements: string[] = [];
    if (task.frontmatter.triggers_enabled) {
      for (const trigger of task.frontmatter.triggers ?? []) {
        try {
          triggerElements.push(triggerToXml(trigger));
        } catch (err) {
          console.error(`Invalid trigger: ${err}`);
        }
      }
    }
    // Always include a dummy trigger so startTask (/run) works
    if (triggerElements.length === 0) {
      triggerElements.push(`<TimeTrigger><StartBoundary>2000-01-01T00:00:00</StartBoundary></TimeTrigger>`);
    }

    // Write XML and register via schtasks — gives us full control over
    // settings like MultipleInstancesPolicy that schtasks flags don't expose.
    const xml = buildTaskXml(tr, triggerElements);
    const xmlPath = path.join(CONFIG_DIR, `task-${taskId}.xml`);
    try {
      // schtasks /xml requires UTF-16LE with BOM
      const bom = Buffer.from([0xFF, 0xFE]);
      fs.writeFileSync(xmlPath, Buffer.concat([bom, Buffer.from(xml, "utf16le")]));
      execFileSync("schtasks", [
        "/create", "/tn", tn, "/xml", xmlPath, "/f",
      ], { encoding: "utf-8", windowsHide: true });
    } catch (err: unknown) {
      const e = err as { stderr?: string };
      console.error(`Failed to create scheduled task ${tn}: ${e.stderr || err}`);
    } finally {
      try { fs.unlinkSync(xmlPath); } catch { /* ignore */ }
    }
  }

  removeTaskTimer(taskId: string): void {
    const tn = schtasksTaskName(taskId);
    try {
      execFileSync("schtasks", ["/delete", "/tn", tn, "/f"], { encoding: "utf-8", windowsHide: true });
    } catch {
      // Task might not exist — that's fine
    }
    try { fs.unlinkSync(path.join(CONFIG_DIR, `task-${taskId}.vbs`)); } catch { /* ignore */ }
  }

  async startTask(taskId: string): Promise<void> {
    const tn = schtasksTaskName(taskId);
    try {
      execFileSync("schtasks", ["/run", "/tn", tn], { encoding: "utf-8", windowsHide: true });
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`Failed to start task via schtasks: ${e.stderr || e.message}`);
    }
  }

  async stopTask(taskId: string): Promise<void> {
    // Try to kill the entire process tree via the PID recorded in status.json.
    // schtasks /end only kills the top-level process, leaving agent children orphaned.
    try {
      const taskDir = getTaskDir(loadConfig().projectRoot, taskId);
      const status = readTaskStatus(taskDir);
      if (status?.pid) {
        execFileSync("taskkill", ["/pid", String(status.pid), "/f", "/t"], { windowsHide: true, stdio: "pipe" });
        return;
      }
    } catch {
      // PID may be stale or config unavailable; fall through to schtasks /end
    }

    // Fallback: schtasks /end (kills top-level process only)
    const tn = schtasksTaskName(taskId);
    try {
      execFileSync("schtasks", ["/end", "/tn", tn], { encoding: "utf-8", windowsHide: true });
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`Failed to stop task via schtasks: ${e.stderr || e.message}`);
    }
  }

  isTaskRunning(taskId: string): boolean {
    // Check Task Scheduler first (for scheduled/on-demand runs)
    const tn = schtasksTaskName(taskId);
    try {
      const out = execFileSync("schtasks", ["/query", "/tn", tn, "/fo", "CSV", "/nh"], {
        encoding: "utf-8",
        windowsHide: true,
      });
      if (out.includes('"Running"')) return true;
    } catch { /* task may not exist in scheduler */ }

    // Fall back to PID check (for follow-up runs spawned directly, not via schtasks)
    try {
      const taskDir = getTaskDir(loadConfig().projectRoot, taskId);
      const status = readTaskStatus(taskDir);
      if (status?.pid) {
        // tasklist exits 0 if the PID is found
        execFileSync("tasklist", ["/fi", `PID eq ${status.pid}`, "/nh"], {
          encoding: "utf-8",
          windowsHide: true,
          stdio: "pipe",
        });
        // tasklist always exits 0; check if output contains the PID
        const out = execFileSync("tasklist", ["/fi", `PID eq ${status.pid}`, "/fo", "CSV", "/nh"], {
          encoding: "utf-8",
          windowsHide: true,
          stdio: "pipe",
        });
        if (out.includes(`"${status.pid}"`)) return true;
      }
    } catch { /* ignore */ }

    return false;
  }

  getGuiEnv(): Record<string, string> {
    // Windows GUI is always available — no special env vars needed
    return {};
  }
}
