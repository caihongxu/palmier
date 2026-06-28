import { spawnCommand } from "./spawn-command.js";

interface PlaywrightCli {
  command: string;
  prefixArgs: string[];
}

let resolved: PlaywrightCli | undefined;

/**
 * Prefer the global `playwright-cli`; fall back to the local `npx` shim when it
 * isn't on PATH. Probed once and cached for the daemon's lifetime.
 */
async function resolvePlaywrightCli(): Promise<PlaywrightCli> {
  if (resolved) return resolved;
  try {
    await spawnCommand("playwright-cli", ["--version"], { cwd: process.cwd() });
    resolved = { command: "playwright-cli", prefixArgs: [] };
  } catch {
    resolved = { command: "npx", prefixArgs: ["--no-install", "playwright-cli"] };
  }
  return resolved;
}

/**
 * Fill `password` into the `ref` element of the agent's live playwright-cli
 * browser session. playwright-cli keeps a persistent server-side browser keyed
 * by session name, so this lands on the same page the agent is driving.
 *
 * The password is passed as an argv element (no shell, so no history/injection),
 * which leaves it briefly visible to other processes of the same user;
 * playwright-cli's `fill` exposes no stdin/env input for the value.
 */
export async function fillPasswordInBrowser(ref: string, password: string, session?: string): Promise<void> {
  const { command, prefixArgs } = await resolvePlaywrightCli();
  const args = [
    ...prefixArgs,
    ...(session ? [`-s=${session}`] : []),
    "fill",
    ref,
    password,
  ];
  const { exitCode, output } = await spawnCommand(command, args, { cwd: process.cwd(), resolveOnFailure: true });
  if (exitCode !== 0) {
    throw new Error(output.trim() || `playwright-cli fill exited with code ${exitCode}`);
  }
}
