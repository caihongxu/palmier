import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class Qoder implements AgentTool {
  supportsPermissions = false;
  supportsYolo = true;
  getPromptCommandLine(prompt: string): CommandLine {
    return { command: "qodercli", args: ["-p", prompt] };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = [];

    if (yolo) {
      args.push("--yolo");
    }
    if (followupPrompt) {args.push("-c");}
    args.push("-p", prompt);

    return { command: "qodercli", args};
  }

  async init(): Promise<boolean> {
    try {
      execSync("qodercli --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
