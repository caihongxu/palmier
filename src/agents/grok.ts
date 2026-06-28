import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const grokAgent: AgentTool = {
  label: "Grok Build",
  command: "grok",
  promptArgs: ["-p"],
  probeArg: "--version",
  supportsYolo: true,

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = [];

    if (yolo) {
      args.push("--always-approve");
    }
    if (followupPrompt) { args.push("-c"); }
    args.push("-p", prompt);
    return { args };
  },
};
