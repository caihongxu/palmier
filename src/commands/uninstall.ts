import { getPlatform } from "../platform/index.js";
import { loadConfig } from "../config.js";
import { uninstallManagedAgents } from "../agents/wizard.js";
import type { HostConfig } from "../types.js";

export async function uninstallCommand(): Promise<void> {
  console.log("Stopping daemon and removing scheduled tasks...");
  const platform = getPlatform();
  platform.uninstallDaemon();
  console.log("Daemon stopped and scheduled tasks removed.");

  let config: HostConfig | null = null;
  try { config = loadConfig(); } catch { /* host not initialized */ }
  if (config?.agents) {
    uninstallManagedAgents(config.agents);
  }

  console.log("\nUninstall finished.");
  console.log("To remove the palmier package itself: npm uninstall -g palmier");
  console.log("To also remove configuration and task data, see https://github.com/caihongxu/palmier#uninstalling");
}
