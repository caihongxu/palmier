import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const hermesAgent: AgentTool = {
  label: "Hermes Agent",
  command: "hermes",
  promptArgs: ["chat", "-q"],
  probeArg: "--version",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["chat", "--trust-all-tools"];

    if (followupPrompt) {args.push("--continue");}
    args.push("-q", prompt);

    return { args };
  },
};
