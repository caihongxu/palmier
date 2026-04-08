import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ParsedTask, TaskFrontmatter, TaskStatus, HistoryEntry, ConversationMessage } from "./types.js";

/**
 * Parse a TASK.md file from the given task directory.
 */
export function parseTaskFile(taskDir: string): ParsedTask {
  const filePath = path.join(taskDir, "TASK.md");

  if (!fs.existsSync(filePath)) {
    throw new Error(`TASK.md not found at: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return parseTaskContent(content);
}

/**
 * Parse TASK.md content string into frontmatter + body.
 */
export function parseTaskContent(content: string): ParsedTask {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = content.match(fmRegex);

  if (!match) {
    throw new Error("TASK.md is missing valid YAML frontmatter delimiters (---)");
  }

  const frontmatter = parseYaml(match[1]) as TaskFrontmatter;
  const body = (match[2] || "").trim();

  if (!frontmatter.id) {
    throw new Error("TASK.md frontmatter must include at least: id");
  }

  frontmatter.name ??= frontmatter.user_prompt?.slice(0, 60) ?? "";
  frontmatter.agent ??= "claude";
  frontmatter.triggers_enabled ??= true;

  return { frontmatter, body };
}

/**
 * Write a TASK.md file to the given task directory.
 * Creates the directory if it doesn't exist.
 */
export function writeTaskFile(taskDir: string, task: ParsedTask): void {
  fs.mkdirSync(taskDir, { recursive: true });

  const yamlStr = stringifyYaml(task.frontmatter).trim();
  const content = `---\n${yamlStr}\n---\n${task.body}\n`;

  const filePath = path.join(taskDir, "TASK.md");
  fs.writeFileSync(filePath, content, "utf-8");
}

/**
 * Append a task ID to the project-level tasks.jsonl file.
 */
export function appendTaskList(projectRoot: string, taskId: string): void {
  const listPath = path.join(projectRoot, "tasks.jsonl");
  fs.appendFileSync(listPath, JSON.stringify({ task_id: taskId }) + "\n", "utf-8");
}

/**
 * Remove a task ID from the project-level tasks.jsonl file.
 * Returns true if the entry was found and removed.
 */
export function removeFromTaskList(projectRoot: string, taskId: string): boolean {
  const listPath = path.join(projectRoot, "tasks.jsonl");
  if (!fs.existsSync(listPath)) return false;

  const lines = fs.readFileSync(listPath, "utf-8").split("\n").filter(Boolean);
  let found = false;
  const remaining: string[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as { task_id: string };
      if (entry.task_id === taskId) {
        found = true;
        continue;
      }
    } catch { /* keep malformed lines */ }
    remaining.push(line);
  }

  if (!found) return false;
  fs.writeFileSync(listPath, remaining.length > 0 ? remaining.join("\n") + "\n" : "", "utf-8");
  return true;
}

/**
 * List all tasks referenced in tasks.jsonl.
 */
export function listTasks(projectRoot: string): ParsedTask[] {
  const listPath = path.join(projectRoot, "tasks.jsonl");
  if (!fs.existsSync(listPath)) return [];

  const lines = fs.readFileSync(listPath, "utf-8").split("\n").filter(Boolean);
  const tasks: ParsedTask[] = [];

  for (const line of lines) {
    let taskId: string;
    try {
      taskId = (JSON.parse(line) as { task_id: string }).task_id;
    } catch { continue; }

    const taskDir = getTaskDir(projectRoot, taskId);
    try {
      tasks.push(parseTaskFile(taskDir));
    } catch (err) {
      console.error(`Warning: failed to parse task ${taskId}: ${err}`);
    }
  }

  return tasks.reverse();
}

/**
 * Get the directory path for a task by its ID.
 */
export function getTaskDir(projectRoot: string, taskId: string): string {
  return path.join(projectRoot, "tasks", taskId);
}

/**
 * Write task status to status.json in the task directory.
 */
export function writeTaskStatus(taskDir: string, status: TaskStatus): void {
  const filePath = path.join(taskDir, "status.json");
  fs.writeFileSync(filePath, JSON.stringify(status), "utf-8");
}

/**
 * Read task status from status.json in the task directory.
 * Returns undefined if the file doesn't exist.
 */
export function readTaskStatus(taskDir: string): TaskStatus | undefined {
  const filePath = path.join(taskDir, "status.json");
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as TaskStatus;
  } catch {
    return undefined;
  }
}

/**
 * Create a run directory with an initial TASKRUN.md file.
 * Returns the run ID (timestamp string used as directory name).
 */
export function createRunDir(
  taskDir: string,
  taskName: string,
  startTime: number,
  agent?: string,
): string {
  const runId = String(startTime);
  const runDir = path.join(taskDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const agentLine = agent ? `\nagent: ${agent}` : "";
  const content = `---\ntask_name: ${taskName}${agentLine}\n---\n\n`;
  fs.writeFileSync(path.join(runDir, "TASKRUN.md"), content, "utf-8");
  return runId;
}

/**
 * Get the path to a run directory.
 */
export function getRunDir(taskDir: string, runId: string): string {
  return path.join(taskDir, runId);
}

/**
 * Append a conversation message to a run's TASKRUN.md file.
 */
export function appendRunMessage(
  taskDir: string,
  runId: string,
  msg: ConversationMessage,
): void {
  const attrs = [`role="${msg.role}"`, `time="${msg.time}"`];
  if (msg.type) attrs.push(`type="${msg.type}"`);
  if (msg.attachments?.length) attrs.push(`attachments="${msg.attachments.join(",")}"`);

  const delimiter = `<!-- palmier:message ${attrs.join(" ")} -->`;
  const entry = `${delimiter}\n\n${msg.content}\n\n`;
  fs.appendFileSync(path.join(taskDir, runId, "TASKRUN.md"), entry, "utf-8");
}

/**
 * Begin a streaming assistant message — writes the delimiter only.
 * Returns a writer that appends content chunks and finalizes the message.
 */
export function beginStreamingMessage(
  taskDir: string,
  runId: string,
  time: number,
): StreamingMessageWriter {
  const filePath = path.join(taskDir, runId, "TASKRUN.md");
  const delimiter = `<!-- palmier:message role="assistant" time="${time}" -->`;
  fs.appendFileSync(filePath, `${delimiter}\n\n`, "utf-8");
  return new StreamingMessageWriter(filePath, delimiter);
}

export class StreamingMessageWriter {
  private delimiter: string;
  constructor(private filePath: string, delimiter: string) {
    this.delimiter = delimiter;
  }

  /** Append a chunk of content to the current message. */
  write(chunk: string): void {
    fs.appendFileSync(this.filePath, chunk, "utf-8");
  }

  /** Finalize the message. If attachments are provided, rewrites the delimiter to include them. */
  end(attachments?: string[]): void {
    fs.appendFileSync(this.filePath, "\n\n", "utf-8");
    if (attachments?.length) {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const updated = raw.replace(this.delimiter, `${this.delimiter.slice(0, -4)} attachments="${attachments.join(",")}" -->`);
      fs.writeFileSync(this.filePath, updated, "utf-8");
    }
  }
}

/**
 * Read conversation messages from a run's TASKRUN.md file.
 */
export function readRunMessages(taskDir: string, runId: string): ConversationMessage[] {
  const raw = fs.readFileSync(path.join(taskDir, runId, "TASKRUN.md"), "utf-8");
  const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  if (!fmMatch) return [];

  const body = fmMatch[1];
  const delimiterRegex = /<!-- palmier:message\s+(.*?)\s*-->/g;
  const matches = [...body.matchAll(delimiterRegex)];
  if (matches.length === 0) return [];

  const messages: ConversationMessage[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const attrs = match[1];
    const start = match.index! + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : body.length;
    const content = body.slice(start, end).trim();

    const roleAttr = attrs.match(/role="([^"]*)"/)?.[1] ?? "assistant";
    const timeAttr = attrs.match(/time="([^"]*)"/)?.[1] ?? "0";
    const typeAttr = attrs.match(/type="([^"]*)"/)?.[1];
    const attachmentsAttr = attrs.match(/attachments="([^"]*)"/)?.[1];

    messages.push({
      role: roleAttr as ConversationMessage["role"],
      time: Number(timeAttr),
      content,
      ...(typeAttr ? { type: typeAttr as ConversationMessage["type"] } : {}),
      ...(attachmentsAttr ? { attachments: attachmentsAttr.split(",").map((f) => f.trim()).filter(Boolean) } : {}),
    });
  }
  return messages;
}

/**
 * Append a history entry to the project-level history.jsonl file.
 */
export function appendHistory(projectRoot: string, entry: HistoryEntry): void {
  const historyPath = path.join(projectRoot, "history.jsonl");
  fs.appendFileSync(historyPath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Delete a history entry and its associated run directory.
 * Returns true if the entry was found and removed.
 */
export function deleteHistoryEntry(
  projectRoot: string,
  taskId: string,
  runId: string,
): boolean {
  const historyPath = path.join(projectRoot, "history.jsonl");
  if (!fs.existsSync(historyPath)) return false;

  const lines = fs.readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
  let found = false;
  const remaining: string[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as HistoryEntry;
      if (entry.task_id === taskId && entry.run_id === runId) {
        found = true;
        continue;
      }
    } catch { /* keep malformed lines */ }
    remaining.push(line);
  }

  if (!found) return false;

  fs.writeFileSync(historyPath, remaining.length > 0 ? remaining.join("\n") + "\n" : "", "utf-8");

  // Delete the run directory
  const runDir = path.join(projectRoot, "tasks", taskId, runId);
  if (fs.existsSync(runDir)) {
    fs.rmSync(runDir, { recursive: true, force: true });
  }

  return true;
}

/**
 * Read history entries from history.jsonl with pagination.
 * Returns entries sorted most-recent-first.
 */
export function readHistory(
  projectRoot: string,
  opts: { offset?: number; limit?: number; task_id?: string },
): { entries: HistoryEntry[]; total: number } {
  const historyPath = path.join(projectRoot, "history.jsonl");
  if (!fs.existsSync(historyPath)) return { entries: [], total: 0 };

  const lines = fs.readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
  let all: HistoryEntry[] = [];
  for (const line of lines) {
    try { all.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  all.reverse();
  if (opts.task_id) {
    all = all.filter((e) => e.task_id === opts.task_id);
  }
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 10;
  return { entries: all.slice(offset, offset + limit), total: all.length };
}
