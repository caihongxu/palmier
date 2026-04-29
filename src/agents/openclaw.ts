import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const openClawAgent: AgentTool = {
  command: "openclaw",
  promptArgs: ["agent", "--local", "--agent", "main", "--message"],
  probeArg: "--version",
  npmPackage: "openclaw",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    // OpenClaw does not support stdin as prompt.
    const args = ["agent", "--local", "--session-id", task.frontmatter.id, "--message", prompt];

    return { args };
  },
};
