import * as fs from "fs";
import * as path from "path";
import { CONFIG_DIR } from "./config.js";

export const LAN_LOCKFILE = path.join(CONFIG_DIR, "lan.json");

/**
 * Read the LAN lockfile to determine if `palmier lan` is running.
 * Returns the port number, or null if not running.
 */
export function getLanPort(): number | null {
  try {
    const raw = fs.readFileSync(LAN_LOCKFILE, "utf-8");
    return (JSON.parse(raw) as { port: number }).port;
  } catch { return null; }
}
