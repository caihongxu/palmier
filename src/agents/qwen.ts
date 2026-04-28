import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const qwenAgent: AgentTool = {
  command: "qwen",
  promptCommandLineArgs: ["-p"],
  versionCommandLineArg: "--version",
  supportsYolo: true,
  npmPackage: "@qwen-code/qwen-code",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["--approval-mode", yolo ? "yolo" : "auto-edit"];

    if (followupPrompt) { args.push("-c"); }
    args.push("-p", prompt);
    return { args };
  },
};
