import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import type { PlatformService } from "./platform.js";
import type { HostConfig, ParsedTask } from "../types.js";
import { CONFIG_DIR, loadConfig } from "../config.js";
import { getTaskDir, readTaskStatus, parseTaskFile } from "../task.js";


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
  // StartBoundary needs a full date; anchor to a past one.
  const base = `2000-01-01T${st}`;

  if (hour === "*") {
    return `<TimeTrigger><StartBoundary>${base}</StartBoundary><Repetition><Interval>PT1H</Interval></Repetition></TimeTrigger>`;
  }

  if (dayOfMonth === "*" && dayOfWeek !== "*") {
    const day = DOW_NAMES[Number(dayOfWeek)] ?? "Monday";
    return `<CalendarTrigger><StartBoundary>${base}</StartBoundary><ScheduleByWeek><DaysOfWeek><${day} /></DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek></CalendarTrigger>`;
  }

  if (dayOfMonth !== "*" && dayOfWeek === "*") {
    return `<CalendarTrigger><StartBoundary>${base}</StartBoundary><ScheduleByMonth><DaysOfMonth><Day>${dayOfMonth}</Day></DaysOfMonth><Months><January /><February /><March /><April /><May /><June /><July /><August /><September /><October /><November /><December /></Months></ScheduleByMonth></CalendarTrigger>`;
  }

  return `<CalendarTrigger><StartBoundary>${base}</StartBoundary><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`;
}

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

interface SchtasksStatus {
  status: string;
  lastResult: string;
}

function querySchtasksStatus(tn: string): SchtasksStatus | undefined {
  try {
    const out = execFileSync("schtasks", ["/query", "/tn", tn, "/v", "/fo", "LIST"], {
      encoding: "utf-8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const status = out.match(/^\s*Status:\s*(.+?)\s*$/im)?.[1] ?? "";
    const lastResult = out.match(/^\s*Last Result:\s*(.+?)\s*$/im)?.[1] ?? "";
    return { status, lastResult };
  } catch {
    return undefined;
  }
}

/** Map common Last Result HRESULTs to a human-readable cause. */
function explainLastResult(lastResult: string, foreground: boolean): string | undefined {
  const code = lastResult.trim();
  // Decimal forms emitted by schtasks: 267011 = 0x41303 SCHED_S_TASK_HAS_NOT_RUN.
  if (code === "267011" || /0x0*41303/i.test(code)) {
    return foreground
      ? "Foreground mode requires an active Windows session, but no user is logged in. Sign in to Windows and try again, or disable foreground mode for this task."
      : "Task Scheduler reported the task did not run. Check that the daemon has permission to launch it.";
  }
  if (code === "0" || code === "0x0") return undefined;
  return `Task Scheduler reported Last Result=${code}.`;
}

/**
 * 2s after `schtasks /run`, confirm the action actually launched. Some failure
 * modes — most notably foreground tasks with no interactive session — make
 * /run return success while the action is silently skipped (Status stays
 * "Ready", Last Result stays at 0x41303). If the run process has already
 * written status.json by then, it clearly launched; skip the Scheduler query.
 */
async function verifyTaskLaunched(tn: string, taskDir: string, startTime: number, foreground: boolean): Promise<void> {
  await new Promise((r) => setTimeout(r, 2000));
  const status = readTaskStatus(taskDir);
  if (status && status.time_stamp >= startTime) return;

  const last = querySchtasksStatus(tn);
  if (last && /running/i.test(last.status)) return;
  const explained = explainLastResult(last?.lastResult ?? "", foreground);
  if (explained) throw new Error(explained);
  throw new Error(
    `Task Scheduler did not launch the task within 2s (status=${last?.status || "unknown"}, last_result=${last?.lastResult || "unknown"}).`,
  );
}

export class WindowsPlatform implements PlatformService {
  installDaemon(config: HostConfig): void {
    const script = process.argv[1] || "palmier";

    this.ensureDaemonTask(script);
    this.startDaemonTask();

    console.log("\nHost initialization complete!");
  }

  uninstallDaemon(): void {
    const tn = `\\Palmier\\${DAEMON_TASK_NAME}`;

    try {
      execFileSync("schtasks", ["/end", "/tn", tn], { encoding: "utf-8", windowsHide: true, stdio: "pipe" });
    } catch { /* task may not be running */ }

    // Deleting an S4U task requires elevation.
    try {
      execFileSync("powershell", [
        "-Command", `Start-Process -Verb RunAs -Wait -FilePath schtasks -ArgumentList '/delete /tn "${tn}" /f'`,
      ], { encoding: "utf-8", windowsHide: true, stdio: "pipe" });
      console.log("Daemon task removed.");
    } catch { /* task may not exist */ }

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

    try {
      execFileSync("schtasks", ["/end", "/tn", tn], { encoding: "utf-8", windowsHide: true, stdio: "pipe" });
    } catch { /* task may not be running */ }

    this.startDaemonTask();
  }

  /** S4U LogonType requires elevation to create. */
  private ensureDaemonTask(script: string): void {
    const tn = `\\Palmier\\${DAEMON_TASK_NAME}`;
    const tr = `"${process.execPath}" "${script}" serve`;
    const xml = buildTaskXml(tr, [`<BootTrigger><Enabled>true</Enabled></BootTrigger>`]);
    const xmlPath = path.join(CONFIG_DIR, "daemon-task.xml");
    try {
      const bom = Buffer.from([0xFF, 0xFE]);
      fs.writeFileSync(xmlPath, Buffer.concat([bom, Buffer.from(xml, "utf16le")]));
      // S4U requires elevation — spawn schtasks via RunAs.
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

  /** Starting via Task Scheduler runs the daemon outside any session's job object. */
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

    // Event-based schedule types (on_new_notification/on_new_sms) are driven by
    // the run process, not the OS scheduler — they fall through to the dummy trigger.
    const triggerElements: string[] = [];
    const scheduleType = task.frontmatter.schedule_type;
    const scheduleValues = task.frontmatter.schedule_values;
    const isTimerSchedule = scheduleType === "crons" || scheduleType === "specific_times";
    if (task.frontmatter.schedule_enabled && isTimerSchedule && scheduleValues?.length) {
      for (const value of scheduleValues) {
        try {
          triggerElements.push(scheduleValueToXml(scheduleType, value));
        } catch (err) {
          console.error(`Invalid schedule value: ${err}`);
        }
      }
    }
    // Dummy trigger so schtasks /run still works.
    if (triggerElements.length === 0) {
      triggerElements.push(`<TimeTrigger><StartBoundary>2000-01-01T00:00:00</StartBoundary></TimeTrigger>`);
    }

    // XML registration (vs schtasks flags) gives us access to settings like
    // MultipleInstancesPolicy. S4U keeps the console hidden unless
    // foreground_mode is set. Works unelevated because the caller (daemon)
    // runs elevated.
    const xml = buildTaskXml(tr, triggerElements, task.frontmatter.foreground_mode);
    const xmlPath = path.join(CONFIG_DIR, `task-${taskId}.xml`);
    try {
      // schtasks /xml requires UTF-16LE with BOM.
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
    } catch { /* task may not exist */ }
  }

  async startTask(taskId: string): Promise<void> {
    const tn = schtasksTaskName(taskId);
    const taskDir = getTaskDir(loadConfig().projectRoot, taskId);

    let foreground = false;
    try {
      foreground = !!parseTaskFile(taskDir).frontmatter.foreground_mode;
    } catch { /* fall through; verifyTaskLaunched still detects most failures */ }

    const startTime = Date.now();
    try {
      execFileSync("schtasks", ["/run", "/tn", tn], { encoding: "utf-8", windowsHide: true });
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`Failed to start task via schtasks: ${e.stderr || e.message}`);
    }

    await verifyTaskLaunched(tn, taskDir, startTime, foreground);
  }

  async stopTask(taskId: string): Promise<void> {
    // schtasks /end leaves agent children orphaned, so kill the process tree
    // via the PID recorded in status.json first.
    try {
      const taskDir = getTaskDir(loadConfig().projectRoot, taskId);
      const status = readTaskStatus(taskDir);
      if (status?.pid) {
        execFileSync("taskkill", ["/pid", String(status.pid), "/f", "/t"], { windowsHide: true, stdio: "pipe" });
        return;
      }
    } catch {
      // PID may be stale or config unavailable; fall through to schtasks /end.
    }

    const tn = schtasksTaskName(taskId);
    try {
      execFileSync("schtasks", ["/end", "/tn", tn], { encoding: "utf-8", windowsHide: true });
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`Failed to stop task via schtasks: ${e.stderr || e.message}`);
    }
  }

  isTaskRunning(taskId: string): boolean {
    const tn = schtasksTaskName(taskId);
    try {
      const out = execFileSync("schtasks", ["/query", "/tn", tn, "/fo", "CSV", "/nh"], {
        encoding: "utf-8",
        windowsHide: true,
      });
      if (out.includes('"Running"')) return true;
    } catch { /* task may not exist in scheduler */ }

    // Follow-up runs are spawned directly (not via schtasks), so check PID too.
    try {
      const taskDir = getTaskDir(loadConfig().projectRoot, taskId);
      const status = readTaskStatus(taskDir);
      if (status?.pid) {
        execFileSync("tasklist", ["/fi", `PID eq ${status.pid}`, "/nh"], {
          encoding: "utf-8",
          windowsHide: true,
          stdio: "pipe",
        });
        // tasklist always exits 0, so match the output for the PID.
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
    return {};
  }
}
