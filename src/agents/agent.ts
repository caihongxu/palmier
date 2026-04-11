import type { ParsedTask, RequiredPermission } from "../types.js";
import { ClaudeAgent } from "./claude.js";
import { GeminiAgent } from "./gemini.js";
import { CodexAgent } from "./codex.js";
import { DroidAgent } from "./droid.js";
import { OpenClawAgent } from "./openclaw.js";
import { CopilotAgent } from "./copilot.js";
import { QwenAgent } from "./qwen.js";
import { KimiAgent } from "./kimi.js";
import { GooseAgent } from "./goose.js";
import { OpenCodeAgent } from "./opencode.js";
import { DeepAgents } from "./deepagents.js";
import { Aider } from "./aider.js";
import { OpenHands } from "./openhands.js";

export interface CommandLine {
  command: string;
  args: string[];
  /** If provided, the string is written to the process's stdin and then the pipe is closed. */
  stdin?: string;
  /** Additional environment variables to set for the spawned process. */
  env?: Record<string, string>;
}

/**
 * Interface that each agent tool must implement.
 * Abstracts how plans are generated and tasks are executed across different AI agents.
 */
export interface AgentTool {
  /** Return the command and args used to generate a plan from a prompt. */
  getPlanGenerationCommandLine(prompt: string): CommandLine;

  /** Return the command and args used to run a task. If followupPrompt is provided, use it instead of the task's prompt,
   *  and treat it as a continuation of the original run (reuse the same session, etc).
   *  extraPermissions: pass an array of RequiredPermission for transient permissions granted for this run only,
   *  or pass `"yolo"` to enable yolo mode (auto-approve all tools, skip permission instructions). */
  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine;

  /** Whether this agent supports permission overrides (e.g. --allowedTools).
   *  If false, the permissions section is omitted from agent instructions. */
  supportsPermissions: boolean;

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
  qwen: new QwenAgent(),
  kimi: new KimiAgent(),
  droid: new DroidAgent(),
  goose: new GooseAgent(),
  opencode: new OpenCodeAgent(),
  deepagents: new DeepAgents(),
  aider: new Aider(),
  openhands: new OpenHands(),
};

const agentLabels: Record<string, string> = {
  claude: "Claude Code",
  gemini: "Gemini CLI",
  codex: "Codex CLI",
  droid: "Droid CLI",
  openclaw: "OpenClaw",
  copilot: "Copilot CLI",
  qwen: "Qwen Code",
  kimi: "Kimi Code",
  goose: "Goose CLI",
  opencode: "OpenCode",
  deepagents: "DeepAgents",
  aider: "Aider",
  openhands: "OpenHands",
};

export interface DetectedAgent {
  key: string;
  label: string;
  supportsPermissions: boolean;
}

export async function detectAgents(): Promise<DetectedAgent[]> {
  const detected: DetectedAgent[] = [];
  for (const [key, agent] of Object.entries(agentRegistry)) {
    const label = agentLabels[key] ?? key;
    const ok = await agent.init();
    if (ok) detected.push({ key, label, supportsPermissions: agent.supportsPermissions });
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
