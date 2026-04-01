import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { spawn as nodeSpawn } from "child_process";
import type { PlatformService } from "./platform.js";
import type { HostConfig, ParsedTask } from "../types.js";
import { CONFIG_DIR } from "../config.js";


const TASK_PREFIX = "\\Palmier\\PalmierTask-";
const DAEMON_TASK_NAME = "PalmierDaemon";
const DAEMON_PID_FILE = path.join(CONFIG_DIR, "daemon.pid");
const DAEMON_VBS_FILE = path.join(CONFIG_DIR, "daemon.vbs");

/**
 * Build the /tr value for schtasks: a single string with quoted paths
 * so Task Scheduler can invoke node with the palmier script + subcommand.
 */
function schtasksTr(...subcommand: string[]): string {
  const script = process.argv[1] || "palmier";
  return `"${process.execPath}" "${script}" ${subcommand.join(" ")}`;
}

/**
 * Convert one of the 4 supported cron patterns to schtasks flags.
 *
 * Only these patterns (produced by the PWA UI) are handled:
 *   hourly:  "0 * * * *"        → /sc HOURLY
 *   daily:   "MM HH * * *"      → /sc DAILY /st HH:MM
 *   weekly:  "MM HH * * D"      → /sc WEEKLY /d <day> /st HH:MM
 *   monthly: "MM HH D * *"      → /sc MONTHLY /d D /st HH:MM
 *
 * Arbitrary cron expressions (ranges, lists, step values) are NOT handled
 * because the UI never generates them.
 */
function cronToSchtasksArgs(cron: string): string[] {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): ${cron}`);
  }

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  // Map cron day-of-week numbers to schtasks day abbreviations
  const dowMap: Record<string, string> = {
    "0": "SUN", "1": "MON", "2": "TUE", "3": "WED",
    "4": "THU", "5": "FRI", "6": "SAT", "7": "SUN",
  };

  const st = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

  // Hourly: "0 * * * *"
  if (hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") {
    return ["/sc", "HOURLY"];
  }

  // Weekly: "MM HH * * D"
  if (dayOfMonth === "*" && dayOfWeek !== "*") {
    const day = dowMap[dayOfWeek];
    if (!day) throw new Error(`Unsupported day-of-week: ${dayOfWeek}`);
    return ["/sc", "WEEKLY", "/d", day, "/st", st];
  }

  // Monthly: "MM HH D * *"
  if (dayOfMonth !== "*" && dayOfWeek === "*") {
    return ["/sc", "MONTHLY", "/d", dayOfMonth, "/st", st];
  }

  // Daily: "MM HH * * *"  (most common fallback)
  return ["/sc", "DAILY", "/st", st];
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
    // Kill the old daemon if we have its PID
    if (fs.existsSync(DAEMON_PID_FILE)) {
      const oldPid = fs.readFileSync(DAEMON_PID_FILE, "utf-8").trim();
      try {
        execFileSync("taskkill", ["/pid", oldPid, "/t", "/f"], { windowsHide: true });
      } catch {
        // Process may have already exited
      }
    }

    const script = process.argv[1] || "palmier";
    this.spawnDaemon(script);
  }

  private spawnDaemon(script: string): void {
    const child = nodeSpawn(process.execPath, [script, "serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    if (child.pid) {
      fs.writeFileSync(DAEMON_PID_FILE, String(child.pid), "utf-8");
    }
    child.unref();
    console.log("Palmier daemon started.");
  }

  installTaskTimer(config: HostConfig, task: ParsedTask): void {
    const taskId = task.frontmatter.id;
    const tn = schtasksTaskName(taskId);
    const tr = schtasksTr("run", taskId);

    // Always create the scheduled task with a dummy trigger first.
    // This ensures startTask (/run) works even when no triggers are configured.
    try {
      execFileSync("schtasks", [
        "/create", "/tn", tn,
        "/tr", tr,
        "/sc", "ONCE", "/sd", "01/01/2000", "/st", "00:00",
        "/f",
      ], { encoding: "utf-8", windowsHide: true });
    } catch (err: unknown) {
      const e = err as { stderr?: string };
      console.error(`Failed to create scheduled task ${tn}: ${e.stderr || err}`);
    }

    // Overlay with real schedule triggers if enabled
    if (!task.frontmatter.triggers_enabled) return;
    const triggers = task.frontmatter.triggers || [];
    for (const trigger of triggers) {
      if (trigger.type === "cron") {
        const schedArgs = cronToSchtasksArgs(trigger.value);
        try {
          execFileSync("schtasks", [
            "/create", "/tn", tn,
            "/tr", tr,
            ...schedArgs,
            "/f",
          ], { encoding: "utf-8", windowsHide: true });
        } catch (err: unknown) {
          const e = err as { stderr?: string };
          console.error(`Failed to create scheduled task ${tn}: ${e.stderr || err}`);
        }
      } else if (trigger.type === "once") {
        // "once" triggers use ISO datetime: "2026-03-28T09:00"
        const [datePart, timePart] = trigger.value.split("T");
        if (!datePart || !timePart) {
          console.error(`Invalid once trigger value: ${trigger.value}`);
          continue;
        }
        // schtasks expects MM/DD/YYYY date format
        const [year, month, day] = datePart.split("-");
        const sd = `${month}/${day}/${year}`;
        const st = timePart.slice(0, 5);
        try {
          execFileSync("schtasks", [
            "/create", "/tn", tn,
            "/tr", tr,
            "/sc", "ONCE", "/sd", sd, "/st", st,
            "/f",
          ], { encoding: "utf-8", windowsHide: true });
        } catch (err: unknown) {
          const e = err as { stderr?: string };
          console.error(`Failed to create once task ${tn}: ${e.stderr || err}`);
        }
      }
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
      return out.includes('"Running"');
    } catch {
      return false;
    }
  }

  getGuiEnv(): Record<string, string> {
    // Windows GUI is always available — no special env vars needed
    return {};
  }
}
