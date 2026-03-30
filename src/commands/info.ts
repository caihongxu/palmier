import { loadConfig } from "../config.js";
import { loadSessions } from "../session-store.js";

/**
 * Print host connection info for setting up clients.
 */
export async function infoCommand(): Promise<void> {
  const config = loadConfig();
  const sessions = loadSessions();

  console.log(`Host ID:      ${config.hostId}`);
  console.log(`Project root: ${config.projectRoot}`);

  // Detected agents
  if (config.agents && config.agents.length > 0) {
    console.log(`Agents:       ${config.agents.map((a) => a.label).join(", ")}`);
  } else {
    console.log(`Agents:       (none detected — run \`palmier agents\`)`);
  }

  // Sessions
  console.log(`Sessions:     ${sessions.length} active`);

  if (sessions.length === 0) {
    console.log("");
    console.log("No paired clients. Run `palmier pair` to connect a device.");
  }
}
