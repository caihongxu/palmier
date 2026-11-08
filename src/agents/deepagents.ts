import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const deepAgentsAgent: AgentTool = {
  label: "Deep Agents CLI",
  command: "deepagents",
  promptArgs: ["--non-interactive"],
  probeArg: "--version",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["--auto-approve"];

    if (followupPrompt) {args.push("--resume");}
    args.push("--non-interactive", prompt);

    return { args };
  },
};
