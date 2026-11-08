import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const codexAgent: AgentTool = {
  label: "Codex CLI",
  command: "codex",
  promptArgs: ["exec", "--skip-git-repo-check"],
  probeArg: "--version",
  authArgs: ["login"],
  suppressStdErr: true,
  stderrModelPattern: /^model: (.+)$/m,
  npmPackage: "@openai/codex",
  freeUsage: "Free Tier",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["exec", "--skip-git-repo-check", "--sandbox", "danger-full-access"];

    if (followupPrompt) {args.push("resume", "--last");}
    args.push("-");

    return { args, stdin: prompt, env: { RUST_LOG: "warn" } };
  },
};
