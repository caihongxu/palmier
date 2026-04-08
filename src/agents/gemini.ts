import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class GeminiAgent implements AgentTool {
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "gemini",
      args: ["--prompt", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[]): CommandLine {
    const prompt = followupPrompt ?? (getAgentInstructions(task.frontmatter.id) + "\n\n" + (task.body || task.frontmatter.user_prompt));
    const args = ["--approval-mode", "auto_edit", "--allowed-tools", "web_fetch"];

    const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
    if (allPerms.length > 0) {
      for (const p of allPerms) {
        args.push(p.name);
      }
    }

    if (followupPrompt) {args.push("--resume");} // continue mode for followups
    args.push("--prompt", prompt);
    
    return { command: "gemini", args };
  }

  async init(): Promise<boolean> {
    try {
      execSync("gemini --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
