import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const cursorAgent: AgentTool = {
  label: "Cursor CLI",
  command: "cursor",
  promptArgs: ["-p"],
  probeArg: "--version",
  supportsYolo: true,

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = [];

    if (yolo) {
      args.push("--force");
    }
    if (followupPrompt) {args.push("--continue");}
    args.push("-p", prompt);

    return { args };
  },
};
