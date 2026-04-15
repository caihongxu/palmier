import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class Kiro implements AgentTool {
  supportsPermissions = false;
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "kiro-cli",
      args: ["--no-interactive", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? (getAgentInstructions(yolo || !this.supportsPermissions) + "\n\n" + (task.body || task.frontmatter.user_prompt));
    const args = [];

    if (yolo) {
      args.push("--trust-all-tools");
    }
    if (followupPrompt) {args.push("--resume");} // continue mode for followups
    args.push("--no-interactive", prompt);

    return { command: "kiro-cli", args};
  }

  async init(): Promise<boolean> {
    try {
      execSync("kiro-cli --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
