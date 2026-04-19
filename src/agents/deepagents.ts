import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class DeepAgents implements AgentTool {
  supportsPermissions = false;
  supportsYolo = true;
  getPromptCommandLine(prompt: string): CommandLine {
    return { command: "deepagents", args: ["--non-interactive", prompt] };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task, yolo || !this.supportsPermissions);
    const args = [];

    if (yolo) {
      args.push("--auto-approve");
    }
    if (followupPrompt) {args.push("--resume");}
    args.push("--non-interactive", prompt);

    return { command: "deepagents", args};
  }

  async init(): Promise<boolean> {
    try {
      execSync("deepagents --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
