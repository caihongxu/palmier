import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { spawnCommand } from "./spawn-command.js";
import { getPlatform } from "./platform/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")) as { version: string };
const currentVersion = pkg.version;

let latestVersion: string | null = null;
let lastCheckTime = 0;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Compare two semver strings (major.minor.patch).
 * Returns true if b is newer than a.
 */
function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pb[i] ?? 0) > (pa[i] ?? 0)) return true;
    if ((pb[i] ?? 0) < (pa[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Check the npm registry for a newer version of palmier.
 */
export async function checkForUpdate(): Promise<void> {
  const now = Date.now();
  if (now - lastCheckTime < CHECK_INTERVAL_MS) return;
  lastCheckTime = now;

  try {
    const res = await fetch("https://registry.npmjs.org/palmier/latest", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    if (data.version && isNewer(currentVersion, data.version)) {
      latestVersion = data.version;
      console.log(`[update] New version available: ${data.version} (current: ${currentVersion})`);
    } else {
      latestVersion = null;
    }
  } catch {
    // Network errors are expected (offline, etc.)
  }
}

/**
 * Get the available update version, or null if up to date.
 */
export function getUpdateAvailable(): string | null {
  return latestVersion;
}

/**
 * Run the update and restart the daemon.
 * Returns an error message if the update fails.
 */
export async function performUpdate(): Promise<string | null> {
  try {
    const { output, exitCode } = await spawnCommand("npm", ["update", "-g", "palmier"], {
      cwd: process.cwd(),
      timeout: 120_000,
      resolveOnFailure: true,
    });
    if (exitCode !== 0) {
      console.error(`[update] npm update failed (exit ${exitCode}):`, output);
      return `Update failed. Please run manually:\nnpm update -g palmier`;
    }
    console.log("[update] Update installed, restarting daemon...");
    latestVersion = null;
    // Small delay to allow the RPC response to be sent
    setTimeout(() => {
      getPlatform().restartDaemon().catch((err) => {
        console.error("[update] Restart failed:", err);
      });
    }, 1000);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[update] Update failed:", msg);
    return `Update failed. Please run manually:\nnpm update -g palmier`;
  }
}
