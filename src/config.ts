import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import type { HostConfig } from "./types.js";

const CONFIG_DIR = path.join(homedir(), ".config", "palmier");
const CONFIG_FILE = path.join(CONFIG_DIR, "host.json");

/**
 * Load host configuration from ~/.config/palmier/host.json.
 * Throws if the file is missing or invalid.
 */
export function loadConfig(): HostConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(
      "Host not provisioned. Run `palmier init` first.\n" +
        `Expected config at: ${CONFIG_FILE}`
    );
  }

  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  const config = JSON.parse(raw) as HostConfig;

  if (!config.hostId) {
    throw new Error("Invalid host config: missing hostId");
  }

  if (!config.natsUrl || !config.natsJwt || !config.natsNkeySeed) {
    throw new Error("Invalid host config: missing NATS JWT credentials. Re-run palmier init.");
  }

  return config;
}

/**
 * Persist host configuration to ~/.config/palmier/host.json.
 * Creates parent directories if needed.
 */
export function saveConfig(config: HostConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export { CONFIG_DIR, CONFIG_FILE };
