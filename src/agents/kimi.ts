import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const kimiAgent: AgentTool = {
  label: "Kimi Code",
  command: "kimi",
  promptArgs: ["-p"],
  probeArg: "--version",
  suppressStdErr: true,
  npmPackage: "@moonshot-ai/kimi-code",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = [];

    if (followupPrompt) { args.push("--continue"); }
    // Print mode (-p) already implies yolo.
    args.push("-p", prompt);
    return { args };
  },
};
