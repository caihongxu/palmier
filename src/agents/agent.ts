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
import { Cursor } from "./cursor.js";
import { Kiro } from "./kiro.js";
import { Cline } from "./cline.js";
import { Qoder } from "./qoder.js";
import { Hermes } from "./hermes.js";

export interface CommandLine {
  command: string;
  args: string[];
  /** If provided, the string is written to the process's stdin and then the pipe is closed. */
  stdin?: string;
  /** Additional environment variables to set for the spawned process. */
  env?: Record<string, string>;
  /** Files to write into the spawned process's cwd before invocation. Path is relative to cwd. */
  files?: Array<{ path: string; content: string }>;
}

export interface AgentTool {
  /** Return the command and args for a short, non-interactive prompt (e.g. generating a task name). */
  getPromptCommandLine(prompt: string): CommandLine;

  /** Return the command and args used to run a task. If followupPrompt is provided, use it instead of the task's prompt,
   *  and treat it as a continuation of the original run (reuse the same session, etc).
   *  extraPermissions: pass an array of RequiredPermission for transient permissions granted for this run only,
   *  or pass `"yolo"` to enable yolo mode (auto-approve all tools, skip permission instructions). */
  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine;

  /** Whether this agent supports permission overrides (e.g. --allowedTools).
   *  If false, the permissions section is omitted from agent instructions. */
  supportsPermissions: boolean;

  /** Whether this agent supports yolo mode (auto-approve all tools). */
  supportsYolo: boolean;

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
  cursor: new Cursor(),
  kiro: new Kiro(),
  cline: new Cline(),
  qoder: new Qoder(),
  hermes: new Hermes(),
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
  deepagents: "Deep Agents CLI",
  aider: "Aider",
  cursor: "Cursor CLI",
  kiro: "Kiro CLI",
  cline: "Cline CLI",
  qoder: "Qoder CLI",
  hermes: "Hermes Agent",
};

export interface DetectedAgent {
  key: string;
  label: string;
  supportsPermissions: boolean;
  supportsYolo: boolean;
}

export async function detectAgents(): Promise<DetectedAgent[]> {
  const detected: DetectedAgent[] = [];
  for (const [key, agent] of Object.entries(agentRegistry)) {
    const label = agentLabels[key] ?? key;
    const ok = await agent.init();
    if (ok) detected.push({ key, label, supportsPermissions: agent.supportsPermissions, supportsYolo: agent.supportsYolo });
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
