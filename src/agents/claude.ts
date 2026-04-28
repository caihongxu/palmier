import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const claudeAgent: AgentTool = {
  command: "claude",
  promptCommandLineArgs: ["-p"],
  versionCommandLineArg: "--version",
  supportsPermissions: true,
  supportsYolo: true,
  suppressStdErr: false,
  npmPackage: "@anthropic-ai/claude-code",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["--permission-mode", yolo ? "bypassPermissions" : "acceptEdits", "-p"];

    if (!yolo) {
      args.push("--allowedTools", "Bash(curl)", "WebFetch");
      const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
      for (const p of allPerms) {
        args.push(p.name);
      }
    }

    if (followupPrompt) {args.push("-c");}
    return { args, stdin: prompt };
  },
};
