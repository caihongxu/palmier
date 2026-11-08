import type { ParsedTask } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const copilotAgent: AgentTool = {
  label: "Copilot CLI",
  command: "copilot",
  promptArgs: ["-p"],
  probeArg: "-v",
  authArgs: ["login"],
  suppressStdErr: true,
  npmPackage: "@github/copilot",
  freeUsage: "Free Tier",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string): CommandLine {
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["-p", prompt];

    args.push("--yolo");
    if (followupPrompt) { args.push("--continue"); }
    return { args };
  },
};
