import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class QwenAgent implements AgentTool {
  supportsPermissions = false;
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "qwen",
      args: ["-p", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task, yolo || !this.supportsPermissions);
    const args = ["--approval-mode", yolo ? "yolo" : "auto-edit"];

    if (followupPrompt) { args.push("-c"); }
    args.push("-p", prompt);
    return { command: "qwen", args };
  }

  async init(): Promise<boolean> {
    try {
      execSync("qwen --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
