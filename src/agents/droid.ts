import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class DroidAgent implements AgentTool {
  supportsPermissions = false;
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "droid",
      args: ["exec", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? (getAgentInstructions(yolo || !this.supportsPermissions) + "\n\n" + (task.body || task.frontmatter.user_prompt));
    const args = ["exec", "--session-id", task.frontmatter.id];

    if (yolo) {
      args.push("--skip-permissions-unsafe");
    }
    args.push(prompt);

    return { command: "droid", args};
  }

  async init(): Promise<boolean> {
    try {
      execSync("droid --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
