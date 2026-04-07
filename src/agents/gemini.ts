import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class GeminiAgent implements AgentTool {
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "gemini",
      args: ["--approval-mode", "auto_edit", "--prompt", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[]): CommandLine {
    const fullPrompt = followupPrompt ?? (getAgentInstructions(task.frontmatter.id) + "\n\n" + (task.body || task.frontmatter.user_prompt));
    const args = ["--allowed-tools", "web_fetch"];

    const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
    if (allPerms.length > 0) {
      args.push("--allowed-tools");
      for (const p of allPerms) {
        args.push(p.name);
      }
    }

    if (followupPrompt) {args.push("--resume");} // continue mode for followups
    args.push("--prompt", "-"); // read prompt from stdin
    
    return { command: "gemini", args, stdin: fullPrompt };
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
