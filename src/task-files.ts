import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Base64 of a 512 KiB chunk plus JSON framing stays under NATS's default 1 MB max payload.
export const FILE_CHUNK_SIZE = 512 * 1024;
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".html": "text/html",
  ".htm": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
};

export function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

// A one-letter "scheme" is a Windows drive (C:\...), not a URL.
const URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/** Maps a markdown link target to a host file path, or null for external URLs and in-page anchors. */
export function hrefToFilePath(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return null;
  if (/^file:/i.test(trimmed)) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return null;
    }
  }
  if (URL_SCHEME.test(trimmed)) return null;
  const withoutSuffix = trimmed.replace(/[?#].*$/, "");
  try {
    return decodeURI(withoutSuffix) || null;
  } catch {
    return withoutSuffix || null;
  }
}

const MARKDOWN_LINK = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

export function extractFileLinks(markdown: string): string[] {
  const files = new Set<string>();
  for (const match of markdown.matchAll(MARKDOWN_LINK)) {
    const target = match[1].startsWith("<") ? match[1].slice(1, -1) : match[1];
    const filePath = hrefToFilePath(target);
    if (filePath) files.add(filePath);
  }
  return [...files];
}

/** Resolves a path against the run directory; throws unless its real path lies within the task directory. */
export function resolveTaskFile(taskDir: string, runId: string, filePath: string): string {
  let target: string;
  try {
    target = fs.realpathSync(path.resolve(taskDir, runId, filePath));
  } catch {
    throw new Error("File not found");
  }
  const relative = path.relative(fs.realpathSync(taskDir), target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("File is outside the task directory");
  }
  return target;
}

export interface TaskFileChunk {
  mime: string;
  size: number;
  offset: number;
  /** Base64-encoded bytes. */
  data: string;
  eof: boolean;
}

export function readTaskFileChunk(filePath: string, offset = 0): TaskFileChunk {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("Not a file");
  if (stat.size > MAX_FILE_SIZE) throw new Error(`File is too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`);
  if (!Number.isInteger(offset) || offset < 0 || offset > stat.size) throw new Error("Invalid offset");

  const length = Math.min(FILE_CHUNK_SIZE, stat.size - offset);
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, buffer, 0, length, offset);
  } finally {
    fs.closeSync(fd);
  }
  return {
    mime: mimeTypeFor(filePath),
    size: stat.size,
    offset,
    data: buffer.toString("base64"),
    eof: offset + length >= stat.size,
  };
}
