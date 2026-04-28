import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class OpenCodeAgent implements AgentTool {
  supportsPermissions = false;
  supportsYolo = true;
  suppressStdErr = false;
  npmPackage = "opencode-ai";
  getPromptCommandLine(prompt: string): CommandLine {
    return { command: "opencode", args: ["run", prompt] };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["run"];

    if (yolo) {
      args.push("--dangerously-skip-permissions");
    }
    if (followupPrompt) {args.push("--continue");}
    args.push(prompt);

    return { command: "opencode", args};
  }

  async init(): Promise<boolean> {
    try {
      execSync("opencode --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
