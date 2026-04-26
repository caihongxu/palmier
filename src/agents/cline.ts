import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class Cline implements AgentTool {
  supportsPermissions = false;
  supportsYolo = true;
  getPromptCommandLine(prompt: string): CommandLine {
    return { command: "cline ", args: ["--yolo", "-p", prompt] };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = [];

    if (yolo) {
      args.push("--yolo");
    }
    args.push(prompt);

    return { command: "cline ", args};
  }

  async init(): Promise<boolean> {
    try {
      execSync("cline --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
