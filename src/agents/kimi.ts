import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class KimiAgent implements AgentTool {
  supportsPermissions = false;
  supportsYolo = true;
  getPromptCommandLine(prompt: string): CommandLine {
    return { command: "kimi", args: ["-p", prompt] };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = [];

    if (yolo) {
      args.push("--yolo");
    }
    if (followupPrompt) { args.push("--continue"); }
    args.push("-p", prompt);
    return { command: "kimi", args };
  }

  async init(): Promise<boolean> {
    try {
      execSync("kimi --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
