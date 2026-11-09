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

export function renderAgentInstructions(values: {
  endpointDocs: string;
  userPrompt?: string;
  taskDescription: string;
}): string {
  const slots: Record<string, string> = {
    ENDPOINT_DOCS: values.endpointDocs,
    USER_PROMPT: values.userPrompt ? `## Standing Instructions From the User\n\n${values.userPrompt}\n\n` : "",
    TASK_DESCRIPTION: values.taskDescription,
  };
  // A single pass with a replacer, so user text is never rescanned for slots or read as `$&` patterns.
  return AGENT_INSTRUCTIONS_TEMPLATE.replace(
    /\{\{(ENDPOINT_DOCS|USER_PROMPT|TASK_DESCRIPTION)\}\}/g,
    (_, slot: string) => slots[slot],
  );
}

export function getAgentInstructions(task: ParsedTask): string {
  const config = loadConfig();
  return renderAgentInstructions({
    endpointDocs: generateEndpointDocs(config.httpPort ?? 7256, task.frontmatter.id),
    userPrompt: config.userPrompt,
    taskDescription: task.frontmatter.user_prompt,
  });
}

export const TASK_SUCCESS_MARKER = "[PALMIER_TASK_SUCCESS]";
export const TASK_FAILURE_MARKER = "[PALMIER_TASK_FAILURE]";
export const TASK_NEED_INPUT_MARKER = "[PALMIER_TASK_NEED_INPUT]";
export const AGENT_MODEL_PREFIX = "[PALMIER_AGENT_MODEL]";

/** A resumed session may have lost the original instructions to compaction, and a missing marker silently ends the run. */
export function getResumePrompt(userMessage: string): string {
  return `${userMessage}\n\n---\nEnd your response with exactly one of these as the very last line on stdout: ${TASK_SUCCESS_MARKER}, ${TASK_FAILURE_MARKER}, or ${TASK_NEED_INPUT_MARKER} if you need more from the user.`;
}
