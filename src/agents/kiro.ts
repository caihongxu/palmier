import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const kiroAgent: AgentTool = {
  label: "Kiro CLI",
  command: "kiro-cli",
  promptArgs: ["--no-interactive"],
  probeArg: "--version",
  supportsYolo: true,

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = [];

    if (yolo) {
      args.push("--trust-all-tools");
    }
    if (followupPrompt) {args.push("--resume");}
    args.push("--no-interactive", prompt);

    return { args };
  },
};
