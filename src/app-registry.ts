import * as fs from "fs";
import * as path from "path";
import { CONFIG_DIR } from "./config.js";

const REGISTRY_FILE = path.join(CONFIG_DIR, "app-registry.json");

/**
 * Persistent cache of packageName → appName pairs seen via incoming device
 * notifications. Used by the task editor UI to resolve display names for the
 * app filter without round-tripping to the notification-listening device
 * (important when the user is editing from a different browser, e.g. desktop).
 */
export interface AppInfo {
  packageName: string;
  appName: string;
}

let cache: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (cache) return cache;
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      cache = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf-8")) as Record<string, string>;
      return cache;
    }
  } catch {
    // Corrupt file — start fresh rather than fail notifications.
  }
  cache = {};
  return cache;
}

function persist(map: Record<string, string>): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(map, null, 2), "utf-8");
}

/**
 * Record an observation of a packageName ↔ appName pair. Writes only when the
 * name is new or changed so we track the latest label if an app renames itself.
 */
export function recordApp(packageName: string, appName: string): void {
  if (!packageName || !appName) return;
  const map = load();
  if (map[packageName] === appName) return;
  map[packageName] = appName;
  persist(map);
}

export function listApps(): AppInfo[] {
  const map = load();
  return Object.entries(map)
    .map(([packageName, appName]) => ({ packageName, appName }))
    .sort((a, b) => a.appName.localeCompare(b.appName));
}

export function getAppName(packageName: string): string | undefined {
  return load()[packageName];
}
