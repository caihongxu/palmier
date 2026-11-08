import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const gooseAgent: AgentTool = {
  label: "Goose CLI",
  command: "goose",
  promptArgs: ["run", "--text"],
  probeArg: "--version",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["run"];

    if (followupPrompt) {args.push("--resume");}
    args.push("--text", prompt);

    return { args, env: { GOOSE_MODE: "auto" } };
  },
};
