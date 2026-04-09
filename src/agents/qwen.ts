import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class QwenAgent implements AgentTool {
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "qwen",
      args: ["-p", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[]): CommandLine {
    const prompt = followupPrompt ?? (getAgentInstructions(task.frontmatter.id) + "\n\n" + (task.body || task.frontmatter.user_prompt));
    const tools = ["web_fetch"];
    const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
    for (const p of allPerms) {
      tools.push(p.name);
    }
    const args = ["--approval-mode", "auto-edit", "--allowed-tools", ...tools];

    if (followupPrompt) { args.push("-c"); }
    args.push("-p", prompt);
    return { command: "qwen", args };
  }

  async init(): Promise<boolean> {
    try {
      execSync("qwen --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
