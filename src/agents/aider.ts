import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const aiderAgent: AgentTool = {
  label: "Aider",
  command: "aider",
  promptArgs: ["--message"],
  probeArg: "--version",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["--yes-always"];

    args.push("--message", prompt);

    return { args };
  },
};
