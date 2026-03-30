import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ParsedTask, TaskFrontmatter, TaskStatus, HistoryEntry } from "./types.js";

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
function parseTaskContent(content: string): ParsedTask {
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
 * Get the creation time (birthtime) of a TASK.md file in ms since epoch.
 */
export function getTaskCreatedAt(taskDir: string): number {
  const filePath = path.join(taskDir, "TASK.md");
  try {
    return fs.statSync(filePath).birthtimeMs;
  } catch {
    return 0;
  }
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
 * Append a history entry to the project-level history.jsonl file.
 */
export function appendHistory(projectRoot: string, entry: HistoryEntry): void {
  const historyPath = path.join(projectRoot, "history.jsonl");
  fs.appendFileSync(historyPath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Delete a history entry and its associated result/task-snapshot files.
 * Returns true if the entry was found and removed.
 */
export function deleteHistoryEntry(
  projectRoot: string,
  taskId: string,
  resultFile: string,
): boolean {
  const historyPath = path.join(projectRoot, "history.jsonl");
  if (!fs.existsSync(historyPath)) return false;

  const lines = fs.readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
  let found = false;
  const remaining: string[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as HistoryEntry;
      if (entry.task_id === taskId && entry.result_file === resultFile) {
        found = true;
        continue; // skip this entry
      }
    } catch { /* keep malformed lines */ }
    remaining.push(line);
  }

  if (!found) return false;

  // Rewrite history.jsonl without the deleted entry
  fs.writeFileSync(historyPath, remaining.length > 0 ? remaining.join("\n") + "\n" : "", "utf-8");

  // Delete the result file
  const resultPath = path.join(projectRoot, "tasks", taskId, resultFile);
  if (fs.existsSync(resultPath)) {
    fs.unlinkSync(resultPath);
  }

  // Delete the corresponding task snapshot (TASK-<timestamp>.md)
  const tsMatch = resultFile.match(/^RESULT-(\d+)\.md$/);
  if (tsMatch) {
    const snapshotFile = `TASK-${tsMatch[1]}.md`;
    const snapshotPath = path.join(projectRoot, "tasks", taskId, snapshotFile);
    if (fs.existsSync(snapshotPath)) {
      fs.unlinkSync(snapshotPath);
    }
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
