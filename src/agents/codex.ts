import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class CodexAgent implements AgentTool {
  supportsPermissions = true;
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "codex",
      args: ["exec", "--skip-git-repo-check", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? (getAgentInstructions(yolo || !this.supportsPermissions) + "\n\n" + (task.body || task.frontmatter.user_prompt));
    const args = ["exec", "--skip-git-repo-check", "--sandbox", yolo ? "danger-full-access" : "workspace-write"];

    if (!yolo) {
      const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
      for (const p of allPerms) {
        args.push("--config");
        args.push(`apps.${p.name}.default_tools_approval_mode="approve"`);
      }
    }
    if (followupPrompt) {args.push("resume", "--last");} // continue mode for followups
    args.push("-"); // read prompt from stdin

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
