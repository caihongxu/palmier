import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "../config.js";
import { generateEndpointDocs } from "../mcp-tools.js";
import type { ParsedTask } from "../types.js";
import { getAgent } from "./agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AGENT_INSTRUCTIONS_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "agent-instructions.md"),
  "utf-8",
);

export function getAgentInstructions(task: ParsedTask): string {
  const port = loadConfig().httpPort ?? 7256;
  const taskDescription = task.frontmatter.user_prompt;
  let instructions = AGENT_INSTRUCTIONS_TEMPLATE
    .replace(/\{\{ENDPOINT_DOCS\}\}/g, generateEndpointDocs(port, task.frontmatter.id))
    .replace(/\{\{TASK_DESCRIPTION\}\}/g, taskDescription);
  const agent = getAgent(task.frontmatter.agent);
  if (!agent.supportsPermissions || !!task.frontmatter.yolo_mode) {
    instructions = instructions.replace(/## Permissions\r?\n[\s\S]*?(?=## |\r?\n---)/m, "");
  }
  return instructions;
}

export const TASK_SUCCESS_MARKER = "[PALMIER_TASK_SUCCESS]";
export const TASK_FAILURE_MARKER = "[PALMIER_TASK_FAILURE]";
export const TASK_REPORT_PREFIX = "[PALMIER_REPORT]";
export const TASK_PERMISSION_PREFIX = "[PALMIER_PERMISSION]";
