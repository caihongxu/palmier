import { loadConfig, saveConfig } from "../config.js";
import { detectAgents } from "../agents/agent.js";
import {
  colors,
  pickAndInstallAgent,
  pickAndUninstallAgent,
  printInstalledAgents,
} from "../agents/wizard.js";
import { selectFromList } from "../prompts.js";
import { getPlatform } from "../platform/index.js";
import type { HostConfig } from "../types.js";

const { bold, dim, cyan } = colors;

export async function agentsCommand(): Promise<void> {
  let config: HostConfig | null = null;
  try { config = loadConfig(); } catch { /* host not yet initialized */ }

  let agents = await detectAgents(config?.agents);
  let dirty = false;

  while (true) {
    console.log(`\n${bold("=== Installed agents ===")}\n`);
    printInstalledAgents(agents);

    const idx = await selectFromList(
      `\n${bold("What would you like to do?")}`,
      [
        { label: "Install an agent", hint: "add a supported CLI" },
        { label: "Uninstall an agent", hint: "remove a supported CLI" },
        { label: "Done", hint: "exit" },
      ],
    );
    if (idx === null || idx === 2) break;

    if (idx === 0) {
      const installed = await pickAndInstallAgent(agents, { allowCancel: true });
      if (installed) {
        agents = [...agents.filter((a) => a.key !== installed.key), installed];
        dirty = true;
      }
    } else if (idx === 1) {
      const removedKey = await pickAndUninstallAgent(agents);
      if (removedKey) {
        agents = agents.filter((a) => a.key !== removedKey);
        dirty = true;
      }
    }

    agents = await detectAgents(agents);
  }

  if (!dirty) return;

  if (config) {
    config.agents = agents;
    saveConfig(config);
    console.log(`\nConfig saved to ${dim("~/.config/palmier/host.json")}`);
    try {
      await getPlatform().restartDaemon();
      console.log(dim("Daemon restarted."));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(dim(`(Daemon restart skipped: ${message})`));
    }
  } else {
    console.log(`\n${dim(`Run ${cyan("palmier init")} to register this host with the new agent set.`)}`);
  }
}
