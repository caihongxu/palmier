import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const clineAgent: AgentTool = {
  label: "Cline CLI",
  command: "cline",
  promptArgs: ["--yolo", "-p"],
  probeArg: "--version",
  npmPackage: "cline",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["--yolo"];

    args.push(prompt);

    return { args };
  },
};
