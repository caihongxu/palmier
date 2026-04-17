import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { execSync, exec } from "child_process";
import { promisify } from "util";
import type { PlatformService } from "./platform.js";
import type { HostConfig, ParsedTask } from "../types.js";
import { loadConfig } from "../config.js";
import { getTaskDir, readTaskStatus } from "../task.js";

const execAsync = promisify(exec);

const UNIT_DIR = path.join(homedir(), ".config", "systemd", "user");
const PATH_FILE = path.join(homedir(), ".config", "palmier", "user-path");

function getTimerName(taskId: string): string {
  return `palmier-task-${taskId}.timer`;
}

function getServiceName(taskId: string): string {
  return `palmier-task-${taskId}.service`;
}

/**
 * Convert a cron expression to a systemd OnCalendar string.
 *
 * Only the 4 cron patterns the PWA UI can produce are supported:
 *   hourly:  "0 * * * *"
 *   daily:   "MM HH * * *"
 *   weekly:  "MM HH * * D"
 *   monthly: "MM HH D * *"
 * Arbitrary cron expressions (ranges, lists, steps beyond hourly) are NOT
 * handled because the UI never generates them.
 */
export function cronToOnCalendar(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): ${cron}`);
  }

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  // Map cron day-of-week numbers to systemd abbreviated names
  const dowMap: Record<string, string> = {
    "0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed",
    "4": "Thu", "5": "Fri", "6": "Sat", "7": "Sun",
  };

  const monthPart = "*";
  const dayPart = dayOfMonth === "*" ? "*" : dayOfMonth.padStart(2, "0");
  const hourPart = hour === "*" ? "*" : hour.padStart(2, "0");
  const minutePart = minute === "*" ? "*" : minute.padStart(2, "0");

  if (dayOfWeek !== "*") {
    const dow = dowMap[dayOfWeek] ?? dayOfWeek;
    return `${dow} *-${monthPart}-${dayPart} ${hourPart}:${minutePart}:00`;
  }

  return `*-${monthPart}-${dayPart} ${hourPart}:${minutePart}:00`;
}

function daemonReload(): void {
  try {
    execSync("systemctl --user daemon-reload", { encoding: "utf-8" });
  } catch (err: unknown) {
    const e = err as { stderr?: string };
    console.error(`daemon-reload failed: ${e.stderr || err}`);
  }
}

export class LinuxPlatform implements PlatformService {
  installDaemon(config: HostConfig): void {
    fs.mkdirSync(UNIT_DIR, { recursive: true });

    const palmierBin = process.argv[1] || "palmier";
    // Save the user's shell PATH so restartDaemon can use it later
    // (the daemon itself runs under systemd with a limited PATH).
    const userPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
    fs.mkdirSync(path.dirname(PATH_FILE), { recursive: true });
    fs.writeFileSync(PATH_FILE, userPath, "utf-8");

    const serviceContent = `[Unit]
Description=Palmier Host
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${palmierBin} serve
WorkingDirectory=${config.projectRoot}
Restart=on-failure
RestartSec=5
Environment=PATH=${userPath}

[Install]
WantedBy=default.target
`;

    const servicePath = path.join(UNIT_DIR, "palmier.service");
    fs.writeFileSync(servicePath, serviceContent, "utf-8");
    console.log("Systemd service installed at:", servicePath);

    try {
      execSync("systemctl --user daemon-reload", { stdio: "inherit" });
      execSync("systemctl --user enable palmier.service", { stdio: "inherit" });
      execSync("systemctl --user restart palmier.service", { stdio: "inherit" });
      console.log("Palmier host service enabled and started.");
    } catch (err) {
      console.error(`Warning: failed to enable systemd service: ${err}`);
      console.error("You may need to start it manually: systemctl --user enable --now palmier.service");
    }

    // Enable lingering so service runs without active login session
    try {
      execSync(`loginctl enable-linger ${process.env.USER || ""}`, { stdio: "inherit" });
      console.log("Login lingering enabled.");
    } catch (err) {
      console.error(`Warning: failed to enable linger: ${err}`);
    }

    console.log("\nHost initialization complete!");
  }

  uninstallDaemon(): void {
    try {
      execSync("systemctl --user stop palmier.service 2>/dev/null", { stdio: "pipe" });
      execSync("systemctl --user disable palmier.service 2>/dev/null", { stdio: "pipe" });
    } catch { /* service may not exist */ }

    // Remove daemon service file
    const servicePath = path.join(UNIT_DIR, "palmier.service");
    try { fs.unlinkSync(servicePath); } catch { /* ignore */ }

    // Remove all task timers and services
    try {
      const files = fs.readdirSync(UNIT_DIR).filter((f) => f.startsWith("palmier-task-"));
      for (const f of files) {
        const unit = f.replace(/\.(timer|service)$/, "");
        try { execSync(`systemctl --user stop ${f} 2>/dev/null`, { stdio: "pipe" }); } catch { /* ignore */ }
        try { execSync(`systemctl --user disable ${f} 2>/dev/null`, { stdio: "pipe" }); } catch { /* ignore */ }
        try { fs.unlinkSync(path.join(UNIT_DIR, f)); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    try { execSync("systemctl --user daemon-reload", { stdio: "pipe" }); } catch { /* ignore */ }

    console.log("Palmier daemon and tasks uninstalled.");
  }

  async restartDaemon(): Promise<void> {
    // If called from a user's terminal, save the current PATH for future use.
    // If called from the daemon (auto-update), read the saved PATH instead.
    if (process.stdin.isTTY) {
      fs.mkdirSync(path.dirname(PATH_FILE), { recursive: true });
      fs.writeFileSync(PATH_FILE, process.env.PATH || "", "utf-8");
    }

    const servicePath = path.join(UNIT_DIR, "palmier.service");
    if (fs.existsSync(servicePath) && fs.existsSync(PATH_FILE)) {
      const userPath = fs.readFileSync(PATH_FILE, "utf-8").trim();
      if (userPath) {
        const content = fs.readFileSync(servicePath, "utf-8");
        const updated = content.replace(
          /^Environment=PATH=.*/m,
          `Environment=PATH=${userPath}`,
        );
        if (updated !== content) {
          fs.writeFileSync(servicePath, updated, "utf-8");
          execSync("systemctl --user daemon-reload", { encoding: "utf-8" });
        }
      }
    }
    execSync("systemctl --user restart palmier.service", { stdio: "inherit" });
    console.log("Palmier daemon restarted.");
  }

  installTaskTimer(config: HostConfig, task: ParsedTask): void {
    fs.mkdirSync(UNIT_DIR, { recursive: true });

    const taskId = task.frontmatter.id;
    const serviceName = getServiceName(taskId);
    const timerName = getTimerName(taskId);
    const palmierBin = process.argv[1] || "palmier";

    const serviceContent = `[Unit]
Description=Palmier Task: ${taskId}

[Service]
Type=oneshot
TimeoutStartSec=infinity
ExecStart=${palmierBin} run ${taskId}
WorkingDirectory=${config.projectRoot}
Environment=PATH=${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}
`;

    fs.writeFileSync(path.join(UNIT_DIR, serviceName), serviceContent, "utf-8");
    daemonReload();

    // Only create and enable a timer if the schedule exists and is enabled
    if (!task.frontmatter.schedule_enabled) return;
    const scheduleType = task.frontmatter.schedule_type;
    const scheduleValues = task.frontmatter.schedule_values;
    if (!scheduleType || !scheduleValues?.length) return;
    const onCalendarLines: string[] = [];
    for (const value of scheduleValues) {
      if (scheduleType === "crons") {
        onCalendarLines.push(`OnCalendar=${cronToOnCalendar(value)}`);
      } else if (scheduleType === "specific_times") {
        onCalendarLines.push(`OnActiveSec=${value}`);
      }
    }

    if (onCalendarLines.length > 0) {
      const timerContent = `[Unit]
Description=Timer for Palmier Task: ${taskId}

[Timer]
${onCalendarLines.join("\n")}
Persistent=true

[Install]
WantedBy=timers.target
`;
      fs.writeFileSync(path.join(UNIT_DIR, timerName), timerContent, "utf-8");
      daemonReload();

      try {
        execSync(`systemctl --user enable --now ${timerName}`, { encoding: "utf-8" });
      } catch (err: unknown) {
        const e = err as { stderr?: string };
        console.error(`Failed to enable timer ${timerName}: ${e.stderr || err}`);
      }
    }
  }

  removeTaskTimer(taskId: string): void {
    const timerName = getTimerName(taskId);
    const serviceName = getServiceName(taskId);
    const timerPath = path.join(UNIT_DIR, timerName);
    const servicePath = path.join(UNIT_DIR, serviceName);

    if (fs.existsSync(timerPath)) {
      try { execSync(`systemctl --user stop ${timerName}`, { encoding: "utf-8" }); } catch { /* timer might not be running */ }
      try { execSync(`systemctl --user disable ${timerName}`, { encoding: "utf-8" }); } catch { /* timer might not be enabled */ }
      fs.unlinkSync(timerPath);
    }

    if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath);
    daemonReload();
  }

  async startTask(taskId: string): Promise<void> {
    const serviceName = getServiceName(taskId);
    await execAsync(`systemctl --user start --no-block ${serviceName}`);
  }

  async stopTask(taskId: string): Promise<void> {
    const serviceName = getServiceName(taskId);
    await execAsync(`systemctl --user stop ${serviceName}`);
  }

  isTaskRunning(taskId: string): boolean {
    // Check systemd first (for scheduled/on-demand runs)
    const serviceName = getServiceName(taskId);
    try {
      const out = execSync(
        `systemctl --user show -p ActiveState --value ${serviceName}`,
        { encoding: "utf-8" },
      );
      const state = out.trim();
      if (state === "active" || state === "activating") return true;
    } catch { /* service may not exist */ }

    // Fall back to PID check (for follow-up runs spawned directly)
    try {
      const taskDir = getTaskDir(loadConfig().projectRoot, taskId);
      const status = readTaskStatus(taskDir);
      if (status?.pid) {
        process.kill(status.pid, 0); // signal 0 = check if process exists
        return true;
      }
    } catch { /* process not running or config unavailable */ }

    return false;
  }

  getGuiEnv(): Record<string, string> {
    const uid = process.getuid?.();
    const runtimeDir =
      process.env.XDG_RUNTIME_DIR ||
      (uid !== undefined ? `/run/user/${uid}` : "");

    return {
      DISPLAY: ":0",
      ...(runtimeDir ? { XDG_RUNTIME_DIR: runtimeDir } : {}),
    };
  }
}
