import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class CopilotAgent implements AgentTool {
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "copilot",
      args: ["-p", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[]): CommandLine {
    const prompt = followupPrompt ?? (getAgentInstructions(task.frontmatter.id) + "\n\n" + (task.body || task.frontmatter.user_prompt));
    const args = ["-p", prompt, "--allowed-tools", "web_fetch"];

    const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
    if (allPerms.length > 0) {
      args.push(`--allow-tool='${allPerms.map((p) => p.name).join(",")}'`);;
    }

    if (followupPrompt) { args.push("--continue"); }
    return { command: "copilot", args};
  }

  async init(): Promise<boolean> {
    try {
      execSync("copilot -v", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
