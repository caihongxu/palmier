import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const qoderAgent: AgentTool = {
  label: "Qoder CLI",
  command: "qodercli",
  promptArgs: ["-p"],
  probeArg: "--version",
  supportsYolo: true,
  npmPackage: "@qoder-ai/qodercli",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = [];

    if (yolo) {
      args.push("--yolo");
    }
    if (followupPrompt) {args.push("-c");}
    args.push("-p", prompt);

    return { args };
  },
};
