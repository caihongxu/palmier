import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { AGENT_INSTRUCTIONS } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class ClaudeAgent implements AgentTool {
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "claude",
      args: ["-p", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, retryPrompt?: string, extraPermissions?: RequiredPermission[]): CommandLine {
    const prompt = AGENT_INSTRUCTIONS + "\n\n" + (retryPrompt ?? (task.body || task.frontmatter.user_prompt));
    const args = ["--permission-mode", "acceptEdits", "-p"];

    const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
    for (const p of allPerms) {
      args.push("--allowedTools", p.name);
    }

    if (retryPrompt) {args.push("-c");} // continue mode for retries
    return { command: "claude", args, stdin: prompt };
  }

  async init(): Promise<boolean> {
    try {
      execSync("claude --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
