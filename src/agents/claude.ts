import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const claudeAgent: AgentTool = {
  label: "Claude Code",
  command: "claude",
  promptArgs: ["-p"],
  probeArg: "--version",
  authArgs: ["auth", "login"],
  supportsPermissions: true,
  npmPackage: "@anthropic-ai/claude-code",
  freeUsage: "Free with Claude Pro",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["--permission-mode", "bypassPermissions", "-p"];

    if (followupPrompt) {args.push("-c");}
    return {
      args,
      stdin: prompt,
      // Don't let the Bash tool kill the curl that blocks on user input — the
      // user may take arbitrarily long to answer. Max non-overflowing setTimeout.
      env: {
        BASH_DEFAULT_TIMEOUT_MS: "2147483647",
        BASH_MAX_TIMEOUT_MS: "2147483647",
      },
    };
  },
};
