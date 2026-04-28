import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const aiderAgent: AgentTool = {
  command: "aider",
  promptCommandLineArgs: ["--message"],
  versionCommandLineArg: "--version",
  supportsPermissions: false,
  supportsYolo: true,
  suppressStdErr: false,

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = [];

    if (yolo) {
      args.push("--yes-always");
    }
    args.push("--message", prompt);

    return { args };
  },
};
