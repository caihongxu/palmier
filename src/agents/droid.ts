import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const droidAgent: AgentTool = {
  command: "droid",
  promptArgs: ["exec"],
  probeArg: "--version",
  supportsYolo: true,
  npmPackage: "@factory/cli",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["exec", "--session-id", task.frontmatter.id];

    if (yolo) {
      args.push("--skip-permissions-unsafe");
    }
    args.push(prompt);

    return { args };
  },
};
