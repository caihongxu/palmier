import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const openCodeAgent: AgentTool = {
  label: "OpenCode",
  command: "opencode",
  promptArgs: ["run"],
  probeArg: "--version",
  npmPackage: "opencode-ai",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["run", "--dangerously-skip-permissions"];

    if (followupPrompt) {args.push("--continue");}
    args.push(prompt);

    return { args };
  },
};
