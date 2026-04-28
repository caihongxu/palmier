import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const deepAgentsAgent: AgentTool = {
  command: "deepagents",
  promptCommandLineArgs: ["--non-interactive"],
  versionCommandLineArgs: ["--version"],
  supportsPermissions: false,
  supportsYolo: true,
  suppressStdErr: false,

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = [];

    if (yolo) {
      args.push("--auto-approve");
    }
    if (followupPrompt) {args.push("--resume");}
    args.push("--non-interactive", prompt);

    return { command: this.command, args };
  },
};
