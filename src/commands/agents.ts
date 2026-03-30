import { loadConfig, saveConfig } from "../config.js";
import { detectAgents } from "../agents/agent.js";
import { getPlatform } from "../platform/index.js";

export async function agentsCommand(): Promise<void> {
  const config = loadConfig();
  const oldKeys = (config.agents ?? []).map((a) => a.key).sort().join(",");

  console.log("Detecting installed agents...");
  const agents = await detectAgents();
  config.agents = agents;
  saveConfig(config);

  if (agents.length === 0) {
    console.log("No agent CLIs detected.");
  } else {
    console.log("Detected agents:");
    for (const a of agents) {
      console.log(`  ${a.key} — ${a.label}`);
    }
  }

  // Restart daemon if agent list changed so the UI picks it up immediately
  const newKeys = agents.map((a) => a.key).sort().join(",");
  if (newKeys !== oldKeys) {
    try {
      console.log("Agent list changed, restarting daemon...");
      await getPlatform().restartDaemon();
    } catch { /* daemon may not be running yet */ }
  }
}
