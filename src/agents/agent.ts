import type { ParsedTask, RequiredPermission } from "../types.js";
import { ClaudeAgent } from "./claude.js";
import { GeminiAgent } from "./gemini.js";
import { CodexAgent } from "./codex.js";
import { OpenClawAgent } from "./openclaw.js";
import { CopilotAgent } from "./copilot.js";

export interface CommandLine {
  command: string;
  args: string[];
  /** If provided, the string is written to the process's stdin and then the pipe is closed. */
  stdin?: string;
}

/**
 * Interface that each agent tool must implement.
 * Abstracts how plans are generated and tasks are executed across different AI agents.
 */
export interface AgentTool {
  /** Return the command and args used to generate a plan from a prompt. */
  getPlanGenerationCommandLine(prompt: string): CommandLine;

  /** Return the command and args used to run a task. If followupPrompt is provided, use it instead of the task's prompt,
   *  and treat it as a continuation of the original run (reuse the same session, etc). extraPermissions are transient
   *  permissions granted for this run only (not persisted in frontmatter). */
  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[]): CommandLine;

  /** Detect whether the agent CLI is available and perform any agent-specific
   *  initialization. Returns true if the agent was detected and initialized successfully. */
  init(): Promise<boolean>;
}

const agentRegistry: Record<string, AgentTool> = {
  claude: new ClaudeAgent(),
  gemini: new GeminiAgent(),
  codex: new CodexAgent(),
  openclaw: new OpenClawAgent(),
  copilot: new CopilotAgent(),
};

const agentLabels: Record<string, string> = {
  claude: "Claude Code",
  gemini: "Gemini CLI",
  codex: "Codex CLI",
  openclaw: "OpenClaw",
  copilot: "Copilot CLI",
};

export interface DetectedAgent {
  key: string;
  label: string;
}

export async function detectAgents(): Promise<DetectedAgent[]> {
  const detected: DetectedAgent[] = [];
  for (const [key, agent] of Object.entries(agentRegistry)) {
    const label = agentLabels[key] ?? key;
    const ok = await agent.init();
    if (ok) detected.push({ key, label });
  }
  return detected;
}

export function getAgent(name: string): AgentTool {
  const agent = agentRegistry[name];
  if (!agent) {
    throw new Error(`Unknown agent: "${name}". Available agents: ${Object.keys(agentRegistry).join(", ")}`);
  }
  return agent;
}
