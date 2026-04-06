import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AGENT_INSTRUCTIONS_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "agent-instructions.md"),
  "utf-8",
);

/**
 * Agent instructions with the serve daemon's HTTP port and task ID baked in.
 */
export function getAgentInstructions(taskId: string): string {
  const port = loadConfig().httpPort ?? 7400;
  return AGENT_INSTRUCTIONS_TEMPLATE
    .replace(/\{\{PORT\}\}/g, String(port))
    .replace(/\{\{TASK_ID\}\}/g, taskId);
}

export const TASK_SUCCESS_MARKER = "[PALMIER_TASK_SUCCESS]";
export const TASK_FAILURE_MARKER = "[PALMIER_TASK_FAILURE]";
export const TASK_REPORT_PREFIX = "[PALMIER_REPORT]";
export const TASK_PERMISSION_PREFIX = "[PALMIER_PERMISSION]";
