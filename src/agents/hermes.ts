import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const hermesAgent: AgentTool = {
  label: "Hermes Agent",
  command: "hermes",
  promptArgs: ["chat", "-q"],
  probeArg: "--version",
  supportsYolo: true,

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["chat"];

    if (yolo) {
      args.push("--trust-all-tools");
    }
    if (followupPrompt) {args.push("--continue");}
    args.push("-q", prompt);

    return { args };
  },
};
