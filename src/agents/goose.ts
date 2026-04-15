import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class GooseAgent implements AgentTool {
  supportsPermissions = false;
  getPromptCommandLine(prompt: string): CommandLine {
    return { command: "goose", args: ["run", "--text", prompt] };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task, yolo || !this.supportsPermissions);
    const args = ["run"];

    if (followupPrompt) {args.push("--resume");} // continue mode for followups
    args.push("--text", prompt);

    return { command: "goose", args, ...(yolo ? { env: { GOOSE_MODE: "auto" } } : {}) };
  }

  async init(): Promise<boolean> {
    try {
      execSync("goose --version", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    return true;
  }
}
