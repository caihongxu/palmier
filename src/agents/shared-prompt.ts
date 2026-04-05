import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Instructions prepended or injected as system prompt for every task invocation.
 * Instructs the agent to output structured markers so palmier can determine
 * the task outcome, report files, and permission/input requests.
 */
export const AGENT_INSTRUCTIONS = fs.readFileSync(
  path.join(__dirname, "agent-instructions.md"),
  "utf-8",
);

export const TASK_SUCCESS_MARKER = "[PALMIER_TASK_SUCCESS]";
export const TASK_FAILURE_MARKER = "[PALMIER_TASK_FAILURE]";
export const TASK_REPORT_PREFIX = "[PALMIER_REPORT]";
export const TASK_PERMISSION_PREFIX = "[PALMIER_PERMISSION]";
