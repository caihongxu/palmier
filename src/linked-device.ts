import * as fs from "fs";
import * as path from "path";
import { CONFIG_DIR } from "./config.js";

const LINKED_DEVICE_FILE = path.join(CONFIG_DIR, "linked-device.json");

export interface LinkedDevice {
  clientToken: string;
  fcmToken: string;
}

function read(): LinkedDevice | null {
  try {
    if (!fs.existsSync(LINKED_DEVICE_FILE)) return null;
    const raw = fs.readFileSync(LINKED_DEVICE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LinkedDevice>;
    if (!parsed?.clientToken || !parsed?.fcmToken) return null;
    return { clientToken: parsed.clientToken, fcmToken: parsed.fcmToken };
  } catch {
    return null;
  }
}

function write(device: LinkedDevice | null): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!device) {
    if (fs.existsSync(LINKED_DEVICE_FILE)) fs.unlinkSync(LINKED_DEVICE_FILE);
    return;
  }
  fs.writeFileSync(LINKED_DEVICE_FILE, JSON.stringify(device, null, 2), "utf-8");
}

export function getLinkedDevice(): LinkedDevice | null {
  return read();
}

export function setLinkedDevice(clientToken: string, fcmToken: string): void {
  write({ clientToken, fcmToken });
}

export function clearLinkedDevice(): void {
  write(null);
}

export function clearLinkedDeviceIfMatches(clientToken: string): boolean {
  const current = read();
  if (current?.clientToken === clientToken) {
    write(null);
    return true;
  }
  return false;
}
