import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { AGENT_INSTRUCTIONS } from "./shared-prompt.js";

// On Windows we need a shell so .cmd shims resolve correctly.
const SHELL = process.platform === "win32" ? "cmd.exe" : undefined;

export class CodexAgent implements AgentTool {
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    // TODO: fill in
    return {
      command: "codex",
      args: ["exec", "--skip-git-repo-check", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, retryPrompt?: string, extraPermissions?: RequiredPermission[]): CommandLine {
    const prompt = AGENT_INSTRUCTIONS + "\n\n" + (retryPrompt ?? (task.body || task.frontmatter.user_prompt));
    // TODO: Update sandbox to workspace-write once https://github.com/openai/codex/issues/12572
    // is fixed.
    const args = ["exec", "--full-auto", "--skip-git-repo-check", "--sandbox", "danger-full-access"];

    const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
    for (const p of allPerms) {
      args.push("--config");
      args.push(`apps.${p.name}.default_tools_approval_mode="approve"`);
    }
    args.push("-"); // read prompt from stdin

    if (retryPrompt) {args.push("resume", "--last");} // continue mode for retries
    return { command: "codex", args, stdin: prompt };
  }

  async init(): Promise<boolean> {
    try {
      execSync("codex --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    try {
      execSync("codex mcp add palmier palmier mcpserver", { stdio: "ignore", shell: SHELL });
    } catch {
      // MCP registration is best-effort; agent still works without it
    }
    return true;
  }
}
