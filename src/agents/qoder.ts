import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const qoderAgent: AgentTool = {
  label: "Qoder CLI",
  command: "qodercli",
  promptArgs: ["-p"],
  probeArg: "--version",
  authArgs: ["login"],
  npmPackage: "@qoder-ai/qodercli",
  freeUsage: "Free Tier",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["--yolo"];

    if (followupPrompt) {args.push("-c");}
    args.push("-p", prompt);

    return { args };
  },
};
