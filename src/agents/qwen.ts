import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const qwenAgent: AgentTool = {
  label: "Qwen Code",
  command: "qwen",
  promptArgs: ["-p"],
  probeArg: "--version",
  authArgs: ["auth", "qwen-oauth"],
  npmPackage: "@qwen-code/qwen-code",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["--approval-mode", "yolo"];

    if (followupPrompt) { args.push("-c"); }
    args.push("-p", prompt);
    return { args };
  },
};
