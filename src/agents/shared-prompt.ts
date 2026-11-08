import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "../config.js";
import { generateEndpointDocs } from "../agent-tools.js";
import type { ParsedTask } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AGENT_INSTRUCTIONS_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "agent-instructions.md"),
  "utf-8",
);

export function getAgentInstructions(task: ParsedTask): string {
  const port = loadConfig().httpPort ?? 7256;
  const taskDescription = task.frontmatter.user_prompt;
  return AGENT_INSTRUCTIONS_TEMPLATE
    .replace(/\{\{ENDPOINT_DOCS\}\}/g, generateEndpointDocs(port, task.frontmatter.id))
    .replace(/\{\{TASK_DESCRIPTION\}\}/g, taskDescription);
}

export const TASK_SUCCESS_MARKER = "[PALMIER_TASK_SUCCESS]";
export const TASK_FAILURE_MARKER = "[PALMIER_TASK_FAILURE]";
export const TASK_NEED_INPUT_MARKER = "[PALMIER_TASK_NEED_INPUT]";
export const AGENT_MODEL_PREFIX = "[PALMIER_AGENT_MODEL]";

/** A resumed session may have lost the original instructions to compaction, and a missing marker silently ends the run. */
export function getResumePrompt(userMessage: string): string {
  return `${userMessage}\n\n---\nEnd your response with exactly one of these as the very last line on stdout: ${TASK_SUCCESS_MARKER}, ${TASK_FAILURE_MARKER}, or ${TASK_NEED_INPUT_MARKER} if you need more from the user.`;
}
