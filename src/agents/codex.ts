import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { AGENT_INSTRUCTIONS } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class CodexAgent implements AgentTool {
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "codex",
      args: ["exec", "--skip-git-repo-check", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[]): CommandLine {
    const prompt = AGENT_INSTRUCTIONS + "\n\n" + (followupPrompt ?? (task.body || task.frontmatter.user_prompt));
    // Using danger-full-access until workspace-write is fixed: https://github.com/openai/codex/issues/12572
    const args = ["exec", "--full-auto", "--skip-git-repo-check", "--sandbox", "danger-full-access"];

    const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
    for (const p of allPerms) {
      args.push("--config");
      args.push(`apps.${p.name}.default_tools_approval_mode="approve"`);
    }
    args.push("-"); // read prompt from stdin

    if (followupPrompt) {args.push("resume", "--last");} // continue mode for followups
    return { command: "codex", args, stdin: prompt };
  }

  async init(): Promise<boolean> {
    try {
      execSync("codex --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
