import { execSync } from "child_process";
import type { ParsedTask, RequiredPermission } from "../types.js";
import { SHELL } from "../platform/index.js";
import { claudeAgent } from "./claude.js";
import { geminiAgent } from "./gemini.js";
import { codexAgent } from "./codex.js";
import { droidAgent } from "./droid.js";
import { openClawAgent } from "./openclaw.js";
import { copilotAgent } from "./copilot.js";
import { qwenAgent } from "./qwen.js";
import { kimiAgent } from "./kimi.js";
import { gooseAgent } from "./goose.js";
import { openCodeAgent } from "./opencode.js";
import { deepAgentsAgent } from "./deepagents.js";
import { aiderAgent } from "./aider.js";
import { cursorAgent } from "./cursor.js";
import { kiroAgent } from "./kiro.js";
import { clineAgent } from "./cline.js";
import { qoderAgent } from "./qoder.js";
import { hermesAgent } from "./hermes.js";

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
  /** The agent's CLI binary name (e.g. "claude", "kiro-cli"). */
  command: string;

  /** Static args for a short, non-interactive prompt. The prompt is appended to the end of this list. */
  promptCommandLineArgs: string[];

  /** Args passed to `command` to probe whether the CLI is installed. Usually `["--version"]`. */
  versionCommandLineArgs: string[];

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

  /** When true, the run loop will not listen to or persist the agent's stderr output. */
  suppressStdErr: boolean;

  /** npm package that provides this agent's CLI, if installable via `npm install -g`.
   *  Used by `palmier init` to offer one-click installation when no agents are detected. */
  npmPackage?: string;
}

export function getPromptCommandLine(agent: AgentTool, prompt: string): CommandLine {
  return { command: agent.command, args: [...agent.promptCommandLineArgs, prompt] };
}

export async function probeAgent(agent: AgentTool): Promise<boolean> {
  const probe = `${agent.command} ${agent.versionCommandLineArgs.join(" ")}`;
  try {
    execSync(probe, { stdio: "ignore", shell: SHELL });
  } catch {
    return false;
  }
  return true;
}

const agentRegistry: Record<string, AgentTool> = {
  claude: claudeAgent,
  gemini: geminiAgent,
  codex: codexAgent,
  openclaw: openClawAgent,
  copilot: copilotAgent,
  qwen: qwenAgent,
  kimi: kimiAgent,
  droid: droidAgent,
  goose: gooseAgent,
  opencode: openCodeAgent,
  deepagents: deepAgentsAgent,
  aider: aiderAgent,
  cursor: cursorAgent,
  kiro: kiroAgent,
  cline: clineAgent,
  qoder: qoderAgent,
  hermes: hermesAgent,
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

export interface InstallableAgent {
  key: string;
  label: string;
  npmPackage: string;
  command: string;
}

export function listInstallableAgents(): InstallableAgent[] {
  const out: InstallableAgent[] = [];
  for (const [key, agent] of Object.entries(agentRegistry)) {
    if (!agent.npmPackage) continue;
    out.push({
      key,
      label: agentLabels[key] ?? key,
      npmPackage: agent.npmPackage,
      command: agent.command,
    });
  }
  return out;
}

export async function detectAgents(): Promise<DetectedAgent[]> {
  const detected: DetectedAgent[] = [];
  for (const [key, agent] of Object.entries(agentRegistry)) {
    const label = agentLabels[key] ?? key;
    const ok = await probeAgent(agent);
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
