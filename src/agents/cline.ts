import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const clineAgent: AgentTool = {
  command: "cline",
  promptCommandLineArgs: ["--yolo", "-p"],
  versionCommandLineArg: "--version",
  supportsPermissions: false,
  supportsYolo: true,
  suppressStdErr: false,
  npmPackage: "cline",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = [];

    if (yolo) {
      args.push("--yolo");
    }
    args.push(prompt);

    return { args };
  },
};
