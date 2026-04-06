import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { AGENT_INSTRUCTIONS } from "./shared-prompt.js";

export class OpenClawAgent implements AgentTool {
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "openclaw",
      args: ["agent", "--local", "--agent", "main", "--message", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[]): CommandLine {
    const prompt = AGENT_INSTRUCTIONS + "\n\n" + (followupPrompt ?? (task.body || task.frontmatter.user_prompt));
    // OpenClaw does not support stdin as prompt.
    const args = ["agent", "--local", "--session-id", task.frontmatter.id, "--message", prompt];

    return { command: "openclaw", args };
  }

  async init(): Promise<boolean> {
    try {
      execSync("openclaw --version", { stdio: "ignore" });
    } catch {
      return false;
    }
    return true;
  }
}
