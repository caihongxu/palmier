import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const gooseAgent: AgentTool = {
  command: "goose",
  promptArgs: ["run", "--text"],
  probeArg: "--version",
  supportsYolo: true,

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["run"];

    if (followupPrompt) {args.push("--resume");}
    args.push("--text", prompt);

    return { args, ...(yolo ? { env: { GOOSE_MODE: "auto" } } : {}) };
  },
};
