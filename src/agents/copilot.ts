import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { AGENT_INSTRUCTIONS } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class CopilotAgent implements AgentTool {
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "copilot",
      args: ["-p", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[]): CommandLine {
    const prompt = AGENT_INSTRUCTIONS + "\n\n" + (followupPrompt ?? (task.body || task.frontmatter.user_prompt));
    const args = ["-p", prompt];

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
