import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { AGENT_INSTRUCTIONS } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class GeminiAgent implements AgentTool {
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "gemini",
      args: ["--approval-mode", "auto_edit", "--prompt", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[]): CommandLine {
    const prompt = followupPrompt ?? (task.body || task.frontmatter.user_prompt);
    const fullPrompt = AGENT_INSTRUCTIONS + "\n\n" + prompt;
    const args = ["--prompt", "-"];

    const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
    if (allPerms.length > 0) {
      args.push("--allowed-tools");
      for (const p of allPerms) {
        args.push(p.name);
      }
    }

    if (followupPrompt) {args.push("--resume");} // continue mode for followups
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
