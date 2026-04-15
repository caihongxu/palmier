import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class CopilotAgent implements AgentTool {
  supportsPermissions = false;
  getPromptCommandLine(prompt: string): CommandLine {
    return { command: "copilot", args: ["-p", prompt] };
  }

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task, yolo || !this.supportsPermissions);
    const args = ["-p", prompt];

    if (yolo) {
      args.push("--yolo");
    } else {
      const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
      args.push(`--allow-tool=${["web_fetch", ...allPerms.map((p) => p.name)].join(",")}`);
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
