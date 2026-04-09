import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class ClaudeAgent implements AgentTool {
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "claude",
      args: ["-p", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? (getAgentInstructions(task.frontmatter.id, yolo) + "\n\n" + (task.body || task.frontmatter.user_prompt));
    const args = ["--permission-mode", yolo ? "bypassPermissions" : "acceptEdits", "-p"];

    if (!yolo) {
      args.push("--allowedTools", "WebFetch");
      const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
      for (const p of allPerms) {
        args.push("--allowedTools", p.name);
      }
    }

    if (followupPrompt) {args.push("-c");} // continue mode for followups
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
