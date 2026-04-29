import type { ParsedTask, RequiredPermission } from "../types.js";
import type { AgentTool, CommandLine } from "./agent.js";
import { getAgentInstructions } from "./shared-prompt.js";

export const copilotAgent: AgentTool = {
  label: "Copilot CLI",
  command: "copilot",
  promptArgs: ["-p"],
  probeArg: "-v",
  authArgs: ["login"],
  supportsYolo: true,
  suppressStdErr: true,
  npmPackage: "@github/copilot",
  freeUsage: "Free Tier",

  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine {
    const yolo = extraPermissions === "yolo";
    const prompt = followupPrompt ?? getAgentInstructions(task);
    const args = ["-p", prompt];

    if (yolo) {
      args.push("--yolo");
    } else {
      const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
      args.push(`--allow-tool=${["web_fetch", ...allPerms.map((p) => p.name)].join(",")}`);
    }
    if (followupPrompt) { args.push("--continue"); }
    return { args };
  },
};
