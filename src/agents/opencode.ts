import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const openCodeAgent: AgentTool = {
  command: "opencode",
  promptCommandLineArgs: ["run"],
  versionCommandLineArg: "--version",
  supportsYolo: true,
  npmPackage: "opencode-ai",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["run"];

    if (yolo) {
      args.push("--dangerously-skip-permissions");
    }
    if (followupPrompt) {args.push("--continue");}
    args.push(prompt);

    return { args };
  },
};
