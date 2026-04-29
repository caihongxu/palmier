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
  args: string[];
  /** If provided, the string is written to the process's stdin and then the pipe is closed. */
  stdin?: string;
  /** Additional environment variables to set for the spawned process. */
  env?: Record<string, string>;
  /** Files to write into the spawned process's cwd before invocation. Path is relative to cwd. */
  files?: Array<{ path: string; content: string }>;
}

export interface AgentTool {
  /** Human-readable name shown in the PWA and CLI (e.g. "Claude Code"). */
  label: string;

  /** The agent's CLI binary name (e.g. "claude", "kiro-cli"). */
  command: string;

  /** Static args for a short, non-interactive prompt. The prompt is appended to the end of this list. */
  promptArgs: string[];

  /** Single arg passed to `command` to probe whether the CLI is installed. Usually `"--version"`. */
  probeArg: string;

  /** Optional args to launch the agent's auth flow after a successful install. When set,
   *  `palmier init` runs `<command> <args...>` interactively (stdio: "inherit") so the user
   *  can sign in before configuration continues. Leave undefined for agents that auth on
   *  first run with no separate command. */
  authArgs?: string[];

  /** Whether this agent supports permission overrides (e.g. --allowedTools).
   *  When falsy, the permissions section is omitted from agent instructions. */
  supportsPermissions?: boolean;

  /** Whether this agent supports yolo mode (auto-approve all tools). */
  supportsYolo?: boolean;

  /** When true, the run loop will not listen to or persist the agent's stderr output. */
  suppressStdErr?: boolean;

  npmPackage?: string;

  /** Optional human-readable note about free-usage availability (e.g. "Free Tier").
   *  Surfaced next to the agent in the installer. */
  freeUsage?: string;

  /** Return the command and args used to run a task. If followupPrompt is provided, use it instead of the task's prompt,
   *  and treat it as a continuation of the original run (reuse the same session, etc).
   *  extraPermissions: pass an array of RequiredPermission for transient permissions granted for this run only,
   *  or pass `"yolo"` to enable yolo mode (auto-approve all tools, skip permission instructions). */
  getTaskRunCommandLine(task: ParsedTask, followupPrompt?: string, extraPermissions?: RequiredPermission[] | "yolo"): CommandLine;
}

export function getPromptCommandLine(agent: AgentTool, prompt: string): CommandLine {
  return { args: [...agent.promptArgs, prompt] };
}

export async function probeAgent(agent: AgentTool): Promise<boolean> {
  const probe = `${agent.command} ${agent.probeArg}`;
  try {
    execSync(probe, { stdio: "ignore", shell: SHELL });
  } catch {
    return false;
  }
  return true;
}

/** Look up the installed version of an npm-managed agent via `npm ls -g --json`.
 *  Returns the version string, or null if the package isn't reported as installed
 *  globally. Does not gate on exit code — `npm ls` exits non-zero on extraneous
 *  deps in the global tree but still prints valid JSON to stdout. */
export function getNpmInstalledVersion(npmPackage: string): string | null {
  const cmd = `npm ls -g ${npmPackage} --depth=0 --json`;
  let stdout: string;
  try {
    stdout = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], shell: SHELL, encoding: "utf-8" });
  } catch (err) {
    const e = err as { stdout?: string | Buffer };
    if (!e.stdout) return null;
    stdout = e.stdout.toString();
  }
  try {
    const parsed = JSON.parse(stdout) as { dependencies?: Record<string, { version?: string }> };
    return parsed.dependencies?.[npmPackage]?.version ?? null;
  } catch {
    return null;
  }
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

export interface DetectedAgent {
  key: string;
  label: string;
  supportsPermissions?: boolean;
  supportsYolo?: boolean;
  npmPackage?: string;
  /** Runtime marker for "managed by Palmier" — present iff Palmier installed/manages this agent. */
  version?: string;
}

export interface InstallableAgent {
  key: string;
  label: string;
  npmPackage: string;
  command: string;
  freeUsage?: string;
}

export function listInstallableAgents(): InstallableAgent[] {
  const out: InstallableAgent[] = [];
  for (const [key, agent] of Object.entries(agentRegistry)) {
    if (!agent.npmPackage) continue;
    out.push({
      key,
      label: agent.label,
      npmPackage: agent.npmPackage,
      command: agent.command,
      ...(agent.freeUsage ? { freeUsage: agent.freeUsage } : {}),
    });
  }
  return out;
}

/** Detect agents present on PATH and resolve their version when they are
 *  Palmier-managed. An agent is treated as managed if either:
 *  - it had a `version` in the `previous` list (preserved across daemon restarts), or
 *  - its key is in `newlyInstalled` (e.g. just installed by the wizard this session).
 *
 *  Every managed agent has its version probed live via `npm ls -g`, so manual
 *  upgrades outside Palmier are picked up on the next detection. */
export async function detectAgents(
  previous?: DetectedAgent[],
  newlyInstalled?: Set<string>,
): Promise<DetectedAgent[]> {
  const previousByKey = new Map((previous ?? []).map((a) => [a.key, a]));
  const detected: DetectedAgent[] = [];
  for (const [key, agent] of Object.entries(agentRegistry)) {
    const ok = await probeAgent(agent);
    if (!ok) continue;
    const wasManaged = !!previousByKey.get(key)?.version || (newlyInstalled?.has(key) ?? false);
    const version = wasManaged && agent.npmPackage
      ? getNpmInstalledVersion(agent.npmPackage) ?? undefined
      : undefined;
    detected.push({
      key,
      label: agent.label,
      supportsPermissions: agent.supportsPermissions,
      supportsYolo: agent.supportsYolo,
      ...(agent.npmPackage ? { npmPackage: agent.npmPackage } : {}),
      ...(version ? { version } : {}),
    });
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
