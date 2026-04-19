import { loadConfig } from "../config.js";
import { loadClients } from "../client-store.js";

export async function infoCommand(): Promise<void> {
  const config = loadConfig();
  const clients = loadClients();

  console.log(`Host ID:      ${config.hostId}`);
  console.log(`Project root: ${config.projectRoot}`);

  if (config.agents && config.agents.length > 0) {
    console.log(`Agents:       ${config.agents.map((a) => a.label).join(", ")}`);
  } else {
    console.log(`Agents:       (none detected — run \`palmier agents\`)`);
  }

  console.log(`Clients:      ${clients.length} active`);

  if (clients.length === 0) {
    console.log("");
    console.log("No paired clients. Run `palmier pair` to connect a device.");
  }
}
