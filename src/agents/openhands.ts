import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class OpenHands implements AgentTool {
  supportsPermissions = false;
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "openhands",
      args: ["--headless", "-t", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? (getAgentInstructions(task.frontmatter.id, yolo || !this.supportsPermissions) + "\n\n" + (task.body || task.frontmatter.user_prompt));
    const args = ["--headless"];

    if (yolo) {
      args.push("--always-approve");
    }
    if (followupPrompt) {args.push("--resume", "--last");} // continue mode for followups
    args.push("-t", prompt);

    return { command: "openhands", args};
  }

  async init(): Promise<boolean> {
    try {
      execSync("openhands --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
