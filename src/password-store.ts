import * as fs from "fs";
import * as path from "path";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { CONFIG_DIR } from "./config.js";

const PASSWORDS_FILE = path.join(CONFIG_DIR, "passwords.enc");
const KEY_FILE = path.join(CONFIG_DIR, "password-key");

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

interface PasswordEntry {
  origin: string;
  username: string;
  password: string;
}

/** A stored credential without its secret — safe to display and log. */
export interface PasswordIdentity {
  origin: string;
  username: string;
}

function getOrCreateKey(): Buffer {
  try {
    const existing = fs.readFileSync(KEY_FILE);
    if (existing.length === KEY_LENGTH) return existing;
  } catch { /* fall through to create */ }
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const key = randomBytes(KEY_LENGTH);
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  return key;
}

function encrypt(plaintext: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getOrCreateKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function decrypt(blob: Buffer): string {
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getOrCreateKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

function readFile(): PasswordEntry[] {
  try {
    if (!fs.existsSync(PASSWORDS_FILE)) return [];
    const blob = fs.readFileSync(PASSWORDS_FILE);
    if (blob.length === 0) return [];
    return JSON.parse(decrypt(blob)) as PasswordEntry[];
  } catch {
    return [];
  }
}

function writeFile(entries: PasswordEntry[]): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(PASSWORDS_FILE, encrypt(JSON.stringify(entries)), { mode: 0o600 });
}

/** Collapse a login URL to its origin so all paths on a site share one entry. */
export function normalizeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    try {
      return new URL(`https://${url}`).origin;
    } catch {
      return url;
    }
  }
}

export function lookupPassword(origin: string, username: string): string | undefined {
  return readFile().find((e) => e.origin === origin && e.username === username)?.password;
}

export function savePassword(origin: string, username: string, password: string): void {
  const entries = readFile();
  const existing = entries.find((e) => e.origin === origin && e.username === username);
  if (existing) existing.password = password;
  else entries.push({ origin, username, password });
  writeFile(entries);
}

export function listPasswords(): PasswordIdentity[] {
  return readFile().map(({ origin, username }) => ({ origin, username }));
}

/** Delete one (origin, username) entry, or every entry for an origin when username is omitted. */
export function deletePassword(origin: string, username?: string): boolean {
  const entries = readFile();
  const remaining = entries.filter((e) =>
    username === undefined ? e.origin !== origin : !(e.origin === origin && e.username === username)
  );
  if (remaining.length === entries.length) return false;
  writeFile(remaining);
  return true;
}

export function clearPasswords(): number {
  const entries = readFile();
  writeFile([]);
  return entries.length;
}
