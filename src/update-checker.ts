import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { spawnCommand } from "./spawn-command.js";
import { getPlatform } from "./platform/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8")) as { version: string };

/** True when running from a source checkout (has .git) rather than a global npm install. */
export const isDevBuild = fs.existsSync(path.join(packageRoot, ".git"));
export const currentVersion = isDevBuild ? `${pkg.version}-dev` : pkg.version;

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
