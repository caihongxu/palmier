import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const cursorAgent: AgentTool = {
  label: "Cursor CLI",
  command: "cursor",
  promptArgs: ["-p"],
  probeArg: "--version",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["--force"];

    if (followupPrompt) {args.push("--continue");}
    args.push("-p", prompt);

    return { args };
  },
};
