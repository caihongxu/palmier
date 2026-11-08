import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const grokAgent: AgentTool = {
  label: "Grok Build",
  command: "grok",
  promptArgs: ["-p"],
  probeArg: "--version",
  authArgs: ["login"],
  npmPackage: "@xai-official/grok",
  freeUsage: "Free Tier",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["--always-approve"];

    if (followupPrompt) { args.push("-c"); }
    args.push("-p", prompt);
    return { args };
  },
};
