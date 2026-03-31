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

  getTaskRunCommandLine(task: ParsedTask, retryPrompt?: string, extraPermissions?: RequiredPermission[]): CommandLine {
    const prompt = retryPrompt ?? (task.body || task.frontmatter.user_prompt);
    const fullPrompt = AGENT_INSTRUCTIONS + "\n\n" + prompt;
    const args = ["--prompt", "-"];

    const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
    if (allPerms.length > 0) {
      args.push("--allowed-tools");
      for (const p of allPerms) {
        args.push(p.name);
      }
    }

    if (retryPrompt) {args.push("--resume");} // continue mode for retries
    return { command: "gemini", args, stdin: fullPrompt };
  }

  async init(): Promise<boolean> {
    try {
      execSync("gemini --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    try {
      execSync("gemini mcp add --scope user palmier palmier mcpserver", { stdio: "ignore", shell: SHELL });
    } catch {
      // MCP registration is best-effort; agent still works without it
    }
    return true;
  }
}
