import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";
import { CONFIG_DIR } from "./config.js";

const SESSIONS_FILE = path.join(CONFIG_DIR, "sessions.json");

export interface SessionEntry {
  token: string;
  createdAt: string;
  label?: string;
}

function readFile(): SessionEntry[] {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return [];
    const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
    return JSON.parse(raw) as SessionEntry[];
  } catch {
    return [];
  }
}

function writeFile(sessions: SessionEntry[]): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), "utf-8");
}

export function loadSessions(): SessionEntry[] {
  return readFile();
}

export function addSession(label?: string): SessionEntry {
  const sessions = readFile();
  const entry: SessionEntry = {
    token: randomBytes(32).toString("hex"),
    createdAt: new Date().toISOString(),
    ...(label ? { label } : {}),
  };
  sessions.push(entry);
  writeFile(sessions);
  return entry;
}

export function revokeSession(token: string): boolean {
  const sessions = readFile();
  const idx = sessions.findIndex((s) => s.token === token);
  if (idx === -1) return false;
  sessions.splice(idx, 1);
  writeFile(sessions);
  return true;
}

export function revokeAllSessions(): number {
  const sessions = readFile();
  const count = sessions.length;
  writeFile([]);
  return count;
}

export function validateSession(token: string): boolean {
  const sessions = readFile();
  return sessions.some((s) => s.token === token);
}

export function hasSessions(): boolean {
  return readFile().length > 0;
}
