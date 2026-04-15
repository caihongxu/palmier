import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class Cursor implements AgentTool {
  supportsPermissions = false;
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "cursor",
      args: ["-p", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? (getAgentInstructions(yolo || !this.supportsPermissions) + "\n\n" + (task.body || task.frontmatter.user_prompt));
    const args = [];

    if (yolo) {
      args.push("--force");
    }
    if (followupPrompt) {args.push("--continue");} // continue mode for followups
    args.push("-p", prompt);

    return { command: "cursor", args};
  }

  async init(): Promise<boolean> {
    try {
      execSync("cursor --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
