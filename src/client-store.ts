import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";
import { CONFIG_DIR } from "./config.js";

const CLIENTS_FILE = path.join(CONFIG_DIR, "clients.json");

export interface ClientEntry {
  token: string;
  createdAt: string;
  label?: string;
}

function readFile(): ClientEntry[] {
  try {
    if (!fs.existsSync(CLIENTS_FILE)) return [];
    const raw = fs.readFileSync(CLIENTS_FILE, "utf-8");
    return JSON.parse(raw) as ClientEntry[];
  } catch {
    return [];
  }
}

function writeFile(clients: ClientEntry[]): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), "utf-8");
}

export function loadClients(): ClientEntry[] {
  return readFile();
}

export function addClient(label?: string): ClientEntry {
  const clients = readFile();
  const entry: ClientEntry = {
    token: randomBytes(32).toString("hex"),
    createdAt: new Date().toISOString(),
    ...(label ? { label } : {}),
  };
  clients.push(entry);
  writeFile(clients);
  return entry;
}

export function revokeClient(token: string): boolean {
  const clients = readFile();
  const idx = clients.findIndex((c) => c.token === token);
  if (idx === -1) return false;
  clients.splice(idx, 1);
  writeFile(clients);
  return true;
}

export function revokeAllClients(): number {
  const clients = readFile();
  const count = clients.length;
  writeFile([]);
  return count;
}

export function validateClient(token: string): boolean {
  const clients = readFile();
  return clients.some((c) => c.token === token);
}

export function hasClients(): boolean {
  return readFile().length > 0;
}
