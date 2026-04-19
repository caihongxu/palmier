import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { execSync, exec } from "child_process";
import { promisify } from "util";
import type { PlatformService } from "./platform.js";
import type { HostConfig, ParsedTask } from "../types.js";
import { CONFIG_DIR, loadConfig } from "../config.js";
import { getTaskDir, readTaskStatus } from "../task.js";

const execAsync = promisify(exec);

const AGENT_DIR = path.join(homedir(), "Library", "LaunchAgents");
const PATH_FILE = path.join(CONFIG_DIR, "user-path");
const DAEMON_LABEL = "me.palmier.host";
const TASK_LABEL_PREFIX = "me.palmier.task.";

function daemonPlistPath(): string {
  return path.join(AGENT_DIR, `${DAEMON_LABEL}.plist`);
}

function taskLabel(taskId: string): string {
  return `${TASK_LABEL_PREFIX}${taskId}`;
}

function taskPlistPath(taskId: string): string {
  return path.join(AGENT_DIR, `${taskLabel(taskId)}.plist`);
}

function taskLogPath(taskId: string): string {
  return path.join(CONFIG_DIR, `task-${taskId}.log`);
}

function guiDomain(): string {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("getuid() unavailable — macOS platform requires POSIX uid");
  return `gui/${uid}`;
}

/**
 * Convert one of the four PWA-produced cron patterns to a launchd
 * `StartCalendarInterval` dict.
 *   hourly  "0 * * * *"        → { Minute: 0 }
 *   daily   "MM HH * * *"      → { Minute, Hour }
 *   weekly  "MM HH * * D"      → { Minute, Hour, Weekday }
 *   monthly "MM HH D * *"      → { Minute, Hour, Day }
 * launchd Weekday: Sunday is 0 (cron 7 → 0).
 */
export function cronToCalendarInterval(cron: string): Record<string, number> {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): ${cron}`);
  }
  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;
  const result: Record<string, number> = {};

  if (minute !== "*") result.Minute = Number(minute);
  if (hour !== "*") result.Hour = Number(hour);
  if (dayOfMonth !== "*") result.Day = Number(dayOfMonth);
  if (dayOfWeek !== "*") {
    const dow = Number(dayOfWeek);
    result.Weekday = dow === 7 ? 0 : dow;
  }

  for (const [k, v] of Object.entries(result)) {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`Invalid cron field ${k}=${v} in ${cron}`);
    }
  }
  return result;
}

/**
 * Convert a PWA `specific_times` value (ISO local datetime like "2026-04-20T09:00")
 * to a `StartCalendarInterval` dict. launchd has no "one-shot at date X" trigger,
 * so we omit Year — the task fires yearly on the same date and time. Sufficient
 * because the PWA regenerates/removes one-off tasks after they run.
 */
export function specificTimeToCalendarInterval(iso: string): Record<string, number> {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error(`Invalid specific_times value: ${iso}`);
  return {
    Month: Number(m[2]),
    Day: Number(m[3]),
    Hour: Number(m[4]),
    Minute: Number(m[5]),
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Serialize a JS value to a plist XML fragment. Supports string/number/boolean/array/plain object. */
function plistValue(value: unknown, indent: string): string {
  if (typeof value === "string") return `${indent}<string>${escapeXml(value)}</string>`;
  if (typeof value === "boolean") return `${indent}<${value ? "true" : "false"}/>`;
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? `${indent}<integer>${value}</integer>`
      : `${indent}<real>${value}</real>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}<array/>`;
    const inner = value.map((v) => plistValue(v, indent + "  ")).join("\n");
    return `${indent}<array>\n${inner}\n${indent}</array>`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${indent}<dict/>`;
    const inner = entries
      .map(([k, v]) => `${indent}  <key>${escapeXml(k)}</key>\n${plistValue(v, indent + "  ")}`)
      .join("\n");
    return `${indent}<dict>\n${inner}\n${indent}</dict>`;
  }
  throw new Error(`Unsupported plist value type: ${typeof value}`);
}

export function buildPlist(dict: Record<string, unknown>): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    plistValue(dict, ""),
    `</plist>`,
    ``,
  ].join("\n");
}

function runLaunchctl(args: string[], opts: { ignoreFailure?: boolean } = {}): void {
  try {
    execSync(`launchctl ${args.join(" ")}`, { stdio: "pipe", encoding: "utf-8" });
  } catch (err: unknown) {
    if (opts.ignoreFailure) return;
    const e = err as { stderr?: string };
    console.error(`launchctl ${args[0]} failed: ${e.stderr || err}`);
  }
}

/**
 * Reload a LaunchAgent plist. The `enable` call is essential: after `bootout`
 * macOS can leave the service in a *disabled* state (tracked in
 * /var/db/com.apple.xpc.launchd/disabled.<uid>.plist). A subsequent bootstrap
 * then fails with "Bootstrap failed: 5: Input/output error".
 */
function reloadAgent(domain: string, label: string, plistPath: string): void {
  runLaunchctl(["bootout", `${domain}/${label}`], { ignoreFailure: true });
  runLaunchctl(["enable", `${domain}/${label}`], { ignoreFailure: true });
  runLaunchctl(["bootstrap", domain, `"${plistPath}"`]);
}

export class MacOsPlatform implements PlatformService {
  installDaemon(config: HostConfig): void {
    fs.mkdirSync(AGENT_DIR, { recursive: true });
    fs.mkdirSync(CONFIG_DIR, { recursive: true });

    const palmierBin = process.argv[1] || "palmier";
    const userPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
    fs.writeFileSync(PATH_FILE, userPath, "utf-8");

    const logPath = path.join(CONFIG_DIR, "daemon.log");
    const plist = buildPlist({
      Label: DAEMON_LABEL,
      ProgramArguments: [process.execPath, palmierBin, "serve"],
      WorkingDirectory: config.projectRoot,
      RunAtLoad: true,
      KeepAlive: { SuccessfulExit: false },
      EnvironmentVariables: { PATH: userPath },
      StandardOutPath: logPath,
      StandardErrorPath: logPath,
    });

    const plistPath = daemonPlistPath();
    fs.writeFileSync(plistPath, plist, "utf-8");
    console.log("LaunchAgent installed at:", plistPath);

    const domain = guiDomain();
    reloadAgent(domain, DAEMON_LABEL, plistPath);
    runLaunchctl(["kickstart", "-k", `${domain}/${DAEMON_LABEL}`]);

    console.log("Palmier host LaunchAgent loaded and started.");
    console.log(
      "Note: LaunchAgents only run while you are logged into the GUI session. " +
      "After reboot, tasks remain dormant until you log in at least once.",
    );

    console.log("\nHost initialization complete!");
  }

  uninstallDaemon(): void {
    const domain = guiDomain();
    runLaunchctl(["bootout", `${domain}/${DAEMON_LABEL}`], { ignoreFailure: true });
    try { fs.unlinkSync(daemonPlistPath()); } catch { /* may not exist */ }

    try {
      const entries = fs.readdirSync(AGENT_DIR).filter((f) => f.startsWith(TASK_LABEL_PREFIX) && f.endsWith(".plist"));
      for (const f of entries) {
        const label = f.slice(0, -".plist".length);
        runLaunchctl(["bootout", `${domain}/${label}`], { ignoreFailure: true });
        try { fs.unlinkSync(path.join(AGENT_DIR, f)); } catch { /* ignore */ }
      }
    } catch { /* AGENT_DIR may not exist */ }

    console.log("Palmier daemon and tasks uninstalled.");
  }

  async restartDaemon(): Promise<void> {
    const plistPath = daemonPlistPath();
    const domain = guiDomain();

    if (process.stdin.isTTY && fs.existsSync(plistPath)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const userPath = process.env.PATH || "";
      fs.writeFileSync(PATH_FILE, userPath, "utf-8");

      const content = fs.readFileSync(plistPath, "utf-8");
      const updated = content.replace(
        /(<key>PATH<\/key>\s*\n\s*<string>)[^<]*(<\/string>)/,
        `$1${escapeXml(userPath)}$2`,
      );
      if (updated !== content) {
        fs.writeFileSync(plistPath, updated, "utf-8");
        reloadAgent(domain, DAEMON_LABEL, plistPath);
      }
    }

    runLaunchctl(["kickstart", "-k", `${domain}/${DAEMON_LABEL}`]);
    console.log("Palmier daemon restarted.");
  }

  installTaskTimer(config: HostConfig, task: ParsedTask): void {
    fs.mkdirSync(AGENT_DIR, { recursive: true });

    const taskId = task.frontmatter.id;
    const label = taskLabel(taskId);
    const plistPath = taskPlistPath(taskId);
    const palmierBin = process.argv[1] || "palmier";

    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const logPath = taskLogPath(taskId);
    const dict: Record<string, unknown> = {
      Label: label,
      ProgramArguments: [process.execPath, palmierBin, "run", taskId],
      WorkingDirectory: config.projectRoot,
      RunAtLoad: false,
      EnvironmentVariables: { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
      StandardOutPath: logPath,
      StandardErrorPath: logPath,
    };

    const scheduleType = task.frontmatter.schedule_type;
    const scheduleValues = task.frontmatter.schedule_values;
    const isTimerSchedule = scheduleType === "crons" || scheduleType === "specific_times";
    if (task.frontmatter.schedule_enabled && isTimerSchedule && scheduleValues?.length) {
      const intervals: Record<string, number>[] = [];
      for (const value of scheduleValues) {
        try {
          intervals.push(
            scheduleType === "crons"
              ? cronToCalendarInterval(value)
              : specificTimeToCalendarInterval(value),
          );
        } catch (err) {
          console.error(`Invalid schedule value: ${err}`);
        }
      }
      if (intervals.length > 0) dict.StartCalendarInterval = intervals;
    }

    fs.writeFileSync(plistPath, buildPlist(dict), "utf-8");

    const domain = guiDomain();
    reloadAgent(domain, label, plistPath);
  }

  removeTaskTimer(taskId: string): void {
    const domain = guiDomain();
    runLaunchctl(["bootout", `${domain}/${taskLabel(taskId)}`], { ignoreFailure: true });
    try { fs.unlinkSync(taskPlistPath(taskId)); } catch { /* ignore */ }
    try { fs.unlinkSync(taskLogPath(taskId)); } catch { /* ignore */ }
  }

  async startTask(taskId: string): Promise<void> {
    await execAsync(`launchctl kickstart ${guiDomain()}/${taskLabel(taskId)}`);
  }

  async stopTask(taskId: string): Promise<void> {
    try {
      const taskDir = getTaskDir(loadConfig().projectRoot, taskId);
      const status = readTaskStatus(taskDir);
      if (status?.pid) {
        process.kill(status.pid, "SIGTERM");
        return;
      }
    } catch { /* fall through */ }

    await execAsync(`launchctl kill SIGTERM ${guiDomain()}/${taskLabel(taskId)}`);
  }

  isTaskRunning(taskId: string): boolean {
    try {
      const out = execSync(`launchctl print ${guiDomain()}/${taskLabel(taskId)}`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      // Running services show a numeric `pid = N`; idle ones show `state = not running`.
      if (/^\s*pid\s*=\s*\d+/m.test(out)) return true;
    } catch { /* service may not be loaded */ }

    try {
      const taskDir = getTaskDir(loadConfig().projectRoot, taskId);
      const status = readTaskStatus(taskDir);
      if (status?.pid) {
        process.kill(status.pid, 0);
        return true;
      }
    } catch { /* process not running or config unavailable */ }

    return false;
  }

  getGuiEnv(): Record<string, string> {
    return {};
  }
}
