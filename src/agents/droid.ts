import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const droidAgent: AgentTool = {
  label: "Droid CLI",
  command: "droid",
  promptArgs: ["exec"],
  probeArg: "--version",
  npmPackage: "@factory/cli",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["exec", "--session-id", task.frontmatter.id, "--skip-permissions-unsafe"];

    args.push(prompt);

    return { args };
  },
};
