import * as fs from "fs";
import * as path from "path";
import { CONFIG_DIR } from "./config.js";

const CAPABILITIES_FILE = path.join(CONFIG_DIR, "device-capabilities.json");

export interface RegisteredDevice {
  clientToken: string;
  fcmToken: string;
}

export type DeviceCapability =
  | "location"
  | "notifications"
  | "sms"
  | "contacts"
  | "calendar"
  | "alarm"
  | "battery"
  | "send-email"
  | "dnd";

type CapabilityMap = Partial<Record<DeviceCapability, RegisteredDevice>>;

function readAll(): CapabilityMap {
  try {
    if (!fs.existsSync(CAPABILITIES_FILE)) return {};
    return JSON.parse(fs.readFileSync(CAPABILITIES_FILE, "utf-8")) as CapabilityMap;
  } catch {
    return {};
  }
}

function writeAll(map: CapabilityMap): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CAPABILITIES_FILE, JSON.stringify(map, null, 2), "utf-8");
}

export function getCapabilityDevice(capability: DeviceCapability): RegisteredDevice | null {
  const map = readAll();
  const device = map[capability];
  if (!device?.clientToken || !device?.fcmToken) return null;
  return device;
}

export function setCapabilityDevice(capability: DeviceCapability, clientToken: string, fcmToken: string): void {
  const map = readAll();
  map[capability] = { clientToken, fcmToken };
  writeAll(map);
}

export function clearCapabilityDevice(capability: DeviceCapability): void {
  const map = readAll();
  delete map[capability];
  writeAll(map);
}
