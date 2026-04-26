import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class Aider implements AgentTool {
  supportsPermissions = false;
  supportsYolo = true;
  getPromptCommandLine(prompt: string): CommandLine {
    return { command: "aider", args: ["--message", prompt] };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = [];

    if (yolo) {
      args.push("--yes-always");
    }
    args.push("--message", prompt);

    return { command: "aider", args};
  }

  async init(): Promise<boolean> {
    try {
      execSync("aider --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
