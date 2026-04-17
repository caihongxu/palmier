import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import type { PlatformService } from "./platform.js";
import type { HostConfig, ParsedTask } from "../types.js";
import { CONFIG_DIR, loadConfig } from "../config.js";
import { getTaskDir, readTaskStatus } from "../task.js";


const TASK_PREFIX = "\\Palmier\\PalmierTask-";
const DAEMON_TASK_NAME = "PalmierDaemon";


const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Convert a single schedule value to a Task Scheduler XML trigger element.
 *
 * `specific_times` values are ISO datetime strings like "2026-03-28T09:00".
 *
 * `crons` values are cron expressions. Only these patterns (produced by the PWA UI) are handled:
 *   hourly:  "0 * * * *"
 *   daily:   "MM HH * * *"
 *   weekly:  "MM HH * * D"
 *   monthly: "MM HH D * *"
 */
export function scheduleValueToXml(scheduleType: "crons" | "specific_times", value: string): string {
  if (scheduleType === "specific_times") {
    return `<TimeTrigger><StartBoundary>${value}:00</StartBoundary></TimeTrigger>`;
  }

  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${value}`);
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
export function buildTaskXml(tr: string, triggers: string[], foreground?: boolean): string {
  const [command, ...argParts] = tr.match(/"[^"]*"|[^\s]+/g) ?? [];
  const commandStr = command?.replace(/"/g, "") ?? "";
  const argsStr = argParts.map((a) => a.replace(/"/g, "")).join(" ");

  return [
    `<?xml version="1.0" encoding="UTF-16"?>`,
    `<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">`,
    `  <Principals>`,
    `    <Principal>`,
    `      <LogonType>${foreground ? "InteractiveToken" : "S4U"}</LogonType>`,
    `      <RunLevel>LeastPrivilege</RunLevel>`,
    `    </Principal>`,
    `  </Principals>`,
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

    // Create the Task Scheduler entry for the daemon (BootTrigger starts it at system boot)
    this.ensureDaemonTask(script);

    // Start the daemon now
    this.startDaemonTask();

    console.log("\nHost initialization complete!");
  }

  uninstallDaemon(): void {
    const tn = `\\Palmier\\${DAEMON_TASK_NAME}`;

    // Stop the daemon via Task Scheduler
    try {
      execFileSync("schtasks", ["/end", "/tn", tn], { encoding: "utf-8", windowsHide: true, stdio: "pipe" });
    } catch { /* task may not be running */ }

    // Remove daemon scheduled task (elevated — S4U task requires elevation to delete)
    try {
      execFileSync("powershell", [
        "-Command", `Start-Process -Verb RunAs -Wait -FilePath schtasks -ArgumentList '/delete /tn "${tn}" /f'`,
      ], { encoding: "utf-8", windowsHide: true, stdio: "pipe" });
      console.log("Daemon task removed.");
    } catch { /* task may not exist */ }

    // Remove all Palmier task timers
    try {
      const out = execFileSync("schtasks", ["/query", "/fo", "CSV", "/nh"], { encoding: "utf-8", windowsHide: true, stdio: "pipe" });
      for (const line of out.split("\n")) {
        const match = line.match(/"(\\Palmier\\PalmierTask-[^"]+)"/);
        if (match) {
          try { execFileSync("schtasks", ["/end", "/tn", match[1]], { encoding: "utf-8", windowsHide: true, stdio: "pipe" }); } catch { /* ignore */ }
          try { execFileSync("schtasks", ["/delete", "/tn", match[1], "/f"], { encoding: "utf-8", windowsHide: true, stdio: "pipe" }); } catch { /* ignore */ }
        }
      }
      console.log("Task timers removed.");
    } catch { /* ignore */ }

    console.log("Palmier daemon and tasks uninstalled.");
  }

  async restartDaemon(): Promise<void> {
    const tn = `\\Palmier\\${DAEMON_TASK_NAME}`;

    // Stop the daemon via Task Scheduler
    try {
      execFileSync("schtasks", ["/end", "/tn", tn], { encoding: "utf-8", windowsHide: true, stdio: "pipe" });
    } catch { /* task may not be running */ }

    // Start it again
    this.startDaemonTask();
  }

  /** Create or update the Task Scheduler entry for the daemon (requires elevation for S4U). */
  private ensureDaemonTask(script: string): void {
    const tn = `\\Palmier\\${DAEMON_TASK_NAME}`;
    const tr = `"${process.execPath}" "${script}" serve`;
    const xml = buildTaskXml(tr, [`<BootTrigger><Enabled>true</Enabled></BootTrigger>`]);
    const xmlPath = path.join(CONFIG_DIR, "daemon-task.xml");
    try {
      const bom = Buffer.from([0xFF, 0xFE]);
      fs.writeFileSync(xmlPath, Buffer.concat([bom, Buffer.from(xml, "utf16le")]));
      // S4U LogonType requires elevation — spawn schtasks via RunAs
      const args = `/create /tn "${tn}" /xml "${xmlPath}" /f`;
      execFileSync("powershell", [
        "-Command", `Start-Process -Verb RunAs -Wait -FilePath schtasks -ArgumentList '${args}'`,
      ], { encoding: "utf-8", windowsHide: true, stdio: "pipe" });
    } catch (err: unknown) {
      const e = err as { stderr?: string };
      console.error(`Failed to create daemon task: ${e.stderr || err}`);
    } finally {
      try { fs.unlinkSync(xmlPath); } catch { /* ignore */ }
    }

  }

  /** Start the daemon via Task Scheduler (runs outside any session's job object). */
  private startDaemonTask(): void {
    const tn = `\\Palmier\\${DAEMON_TASK_NAME}`;
    try {
      execFileSync("schtasks", ["/run", "/tn", tn], { encoding: "utf-8", windowsHide: true, stdio: "pipe" });
    } catch (err: unknown) {
      const e = err as { stderr?: string };
      console.error(`Failed to start daemon via Task Scheduler: ${e.stderr || err}`);
    }
    console.log("Palmier daemon started.");
  }

  installTaskTimer(config: HostConfig, task: ParsedTask): void {
    const taskId = task.frontmatter.id;
    const tn = schtasksTaskName(taskId);
    const script = process.argv[1] || "palmier";
    const tr = `"${process.execPath}" "${script}" run ${taskId}`;

    // Build trigger XML elements
    const triggerElements: string[] = [];
    const scheduleType = task.frontmatter.schedule_type;
    const scheduleValues = task.frontmatter.schedule_values;
    if (task.frontmatter.schedule_enabled && scheduleType && scheduleValues?.length) {
      for (const value of scheduleValues) {
        try {
          triggerElements.push(scheduleValueToXml(scheduleType, value));
        } catch (err) {
          console.error(`Invalid schedule value: ${err}`);
        }
      }
    }
    // Always include a dummy trigger so startTask (/run) works
    if (triggerElements.length === 0) {
      triggerElements.push(`<TimeTrigger><StartBoundary>2000-01-01T00:00:00</StartBoundary></TimeTrigger>`);
    }

    // Write XML and register via schtasks — gives us full control over
    // settings like MultipleInstancesPolicy that schtasks flags don't expose.
    // S4U LogonType ensures no console window (unless foreground_mode is set).
    // Works without elevation because the daemon (which calls this) runs elevated.
    const xml = buildTaskXml(tr, triggerElements, task.frontmatter.foreground_mode);
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
