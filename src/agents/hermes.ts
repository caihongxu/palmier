import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class Hermes implements AgentTool {
  supportsPermissions = false;
  supportsYolo = true;
  suppressStdErr = false;
  getPromptCommandLine(prompt: string): CommandLine {
    return { command: "hermes", args: ["chat", "-q", prompt] };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["chat"];

    if (yolo) {
      args.push("--trust-all-tools");
    }
    if (followupPrompt) {args.push("--continue");}
    args.push("-q", prompt);

    return { command: "hermes", args};
  }

  async init(): Promise<boolean> {
    try {
      execSync("hermes --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
