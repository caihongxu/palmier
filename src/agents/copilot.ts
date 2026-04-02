import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import type { ParsedTask, RequiredPermission } from "../types.js";
import { execSync } from "child_process";
import type { AgentTool, CommandLine } from "./agent.js";
import { AGENT_INSTRUCTIONS } from "./shared-prompt.js";
import { SHELL } from "../platform/index.js";

export class CopilotAgent implements AgentTool {
  getPlanGenerationCommandLine(prompt: string): CommandLine {
    return {
      command: "copilot",
      args: ["-p", prompt],
    };
  }

  getTaskRunCommandLine(task: ParsedTask, retryPrompt?: string, extraPermissions?: RequiredPermission[]): CommandLine {
    const prompt = AGENT_INSTRUCTIONS + "\n\n" + (retryPrompt ?? (task.body || task.frontmatter.user_prompt));
    const args = ["-p", prompt];

    const allPerms = [...(task.frontmatter.permissions ?? []), ...(extraPermissions ?? [])];
    if (allPerms.length > 0) {
      args.push(`--allow-tool='${allPerms.map((p) => p.name).join(",")}'`);;
    }

    if (retryPrompt) { args.push("--continue"); }
    return { command: "copilot", args};
  }

  async init(): Promise<boolean> {
    try {
      execSync("copilot -v", { stdio: "ignore", shell: SHELL });
    } catch {
      return false;
    }
    // Register Palmier MCP server in ~/.copilot/mcp-config.json
    try {
      const configDir = path.join(homedir(), ".copilot");
      const configFile = path.join(configDir, "mcp-config.json");
      let config: Record<string, unknown> = {};
      if (fs.existsSync(configFile)) {
        config = JSON.parse(fs.readFileSync(configFile, "utf-8")) as Record<string, unknown>;
      }
      const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
      servers.palmier = { command: "palmier", args: ["mcpserver"] };
      config.mcpServers = servers;
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2), "utf-8");
    } catch {
      // MCP registration is best-effort
    }
    return true;
  }
}
