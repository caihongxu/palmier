import * as fs from "fs";
import * as path from "path";
import { CONFIG_DIR } from "./config.js";

const LOCATION_FILE = path.join(CONFIG_DIR, "location-device.json");

export interface LocationDevice {
  clientToken: string;
  fcmToken: string;
}

export function getLocationDevice(): LocationDevice | null {
  try {
    if (!fs.existsSync(LOCATION_FILE)) return null;
    const raw = fs.readFileSync(LOCATION_FILE, "utf-8");
    const data = JSON.parse(raw) as LocationDevice;
    if (!data.clientToken || !data.fcmToken) return null;
    return data;
  } catch {
    return null;
  }
}

export function setLocationDevice(clientToken: string, fcmToken: string): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(LOCATION_FILE, JSON.stringify({ clientToken, fcmToken }, null, 2), "utf-8");
}

export function clearLocationDevice(): void {
  try {
    if (fs.existsSync(LOCATION_FILE)) fs.unlinkSync(LOCATION_FILE);
  } catch {
    // ignore
  }
}
