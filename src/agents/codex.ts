import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const codexAgent: AgentTool = {
  command: "codex",
  promptArgs: ["exec", "--skip-git-repo-check"],
  probeArg: "--version",
  authArgs: ["login"],
  supportsYolo: true,
  suppressStdErr: true,
  npmPackage: "@openai/codex",
  freeUsage: "Free Tier",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["exec", "--skip-git-repo-check", "--sandbox", yolo ? "danger-full-access" : "workspace-write"];

    if (followupPrompt) {args.push("resume", "--last");}
    args.push("-");

    return { args, stdin: prompt, env: { RUST_LOG: "warn" } };
  },
};
