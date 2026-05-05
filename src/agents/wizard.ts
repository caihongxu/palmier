import { spawnSync } from "child_process";
import * as readline from "readline";
import { selectFromList } from "../prompts.js";
import {
  getAgent,
  getNpmInstalledVersion,
  listInstallableAgents,
  type DetectedAgent,
  type InstallableAgent,
} from "./agent.js";

export const colors = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

const { bold, dim, green, cyan, red, yellow } = colors;

export function printInstalledAgents(agents: DetectedAgent[]): void {
  if (agents.length === 0) {
    console.log(`  ${dim("(none installed)")}`);
    return;
  }
  for (const a of agents) {
    const version = a.version ? ` ${dim(`v${a.version}`)}` : "";
    const note = a.version ? "" : ` ${dim("(not managed by Palmier)")}`;
    console.log(`  ${green("✓")} ${a.label}${version}${note}`);
  }
}

export interface InstallPickerOptions {
  /** Show a "Cancel" entry as the first choice. */
  allowCancel?: boolean;
  /** Override the picker prompt message. */
  message?: string;
}

/** Show the install picker and run the npm install + auth flow for the chosen
 *  agent. Returns the new DetectedAgent record on success, or null if the user
 *  cancelled, no installables remain, or the install failed. */
export async function pickAndInstallAgent(
  current: DetectedAgent[],
  options: InstallPickerOptions = {},
): Promise<DetectedAgent | null> {
  const detectedKeys = new Set(current.map((a) => a.key));
  const missing = listInstallableAgents()
    .filter((a) => !detectedKeys.has(a.key))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (missing.length === 0) {
    console.log(`\n${dim("All supported agents are already installed.")}`);
    return null;
  }

  const installChoices = missing.map((a) => ({
    label: a.freeUsage ? `${a.label} ${green(`[${a.freeUsage}]`)}` : a.label,
    hint: a.npmPackage,
  }));
  const othersChoice = { label: "Others", hint: "see all supported agents" };
  const choices = options.allowCancel
    ? [{ label: "Cancel", hint: "go back" }, ...installChoices, othersChoice]
    : [...installChoices, othersChoice];

  const message = options.message ?? `\n${bold("Select an agent to install:")}`;
  const idx = await selectFromList(message, choices);
  if (idx === null) return null;
  if (options.allowCancel && idx === 0) return null;

  if (idx === choices.length - 1) {
    console.log(`\n${bold("More agents:")} ${cyan("https://www.palmier.me/agents")}`);
    console.log(`Install one with ${cyan("npm install -g <package>")}, then re-run this command.`);
    return null;
  }

  const choice = missing[options.allowCancel ? idx - 1 : idx];
  if (!installAgentPackage(choice)) return null;

  console.log(green(`  ${choice.label} installed.`));

  const tool = getAgent(choice.key);
  const version = getNpmInstalledVersion(choice.npmPackage) ?? undefined;
  const record: DetectedAgent = {
    key: choice.key,
    label: choice.label,
    ...(tool.supportsPermissions ? { supportsPermissions: true } : {}),
    ...(tool.supportsYolo ? { supportsYolo: true } : {}),
    npmPackage: choice.npmPackage,
    ...(version ? { version } : {}),
  };

  if (tool.authArgs && tool.authArgs.length > 0) {
    runAgentAuthFlow(choice.label, tool.command, tool.authArgs);
  } else {
    console.log(`\n${bold("Next: authenticate the CLI.")}`);
    console.log(`  Run ${cyan(choice.command)} in another terminal and follow the sign-in prompts.`);
    console.log(`  Palmier will use the CLI on your behalf once it's signed in.`);
  }
  await waitForEnter("Press Enter once authentication is complete...");
  return record;
}

/** Show the uninstall picker. Runs `npm uninstall -g` for the chosen agent
 *  and returns the agent key on success, or null on cancel/failure/no candidates. */
export async function pickAndUninstallAgent(
  current: DetectedAgent[],
): Promise<string | null> {
  const uninstallable = current.filter((a) => a.npmPackage);
  if (uninstallable.length === 0) {
    console.log(`\n${dim("No agents available to uninstall.")}`);
    return null;
  }

  const choices = [
    { label: "Cancel", hint: "go back" },
    ...uninstallable.map((a) => ({
      label: a.label,
      hint: a.npmPackage as string,
    })),
  ];
  const idx = await selectFromList(`\n${bold("Select an agent to uninstall:")}`, choices);
  if (idx === null || idx === 0) return null;

  const target = uninstallable[idx - 1];
  if (!uninstallAgent(target)) return null;
  return target.key;
}

/** Uninstall a single agent's npm package. Logs success/failure to stdout.
 *  Shared between the `palmier agents` interactive picker and the bulk
 *  managed-agent removal in `palmier uninstall`. */
export function uninstallAgent(agent: DetectedAgent): boolean {
  if (!agent.npmPackage) return false;
  if (!uninstallAgentPackage(agent.npmPackage)) {
    console.log(red(`  Skipped ${agent.label}; uninstall it manually with npm uninstall -g ${agent.npmPackage}.`));
    return false;
  }
  console.log(green(`  ${agent.label} uninstalled.`));
  return true;
}

function installAgentPackage(agent: InstallableAgent): boolean {
  console.log(`\nInstalling ${cyan(agent.npmPackage)}...\n`);
  const cmd = `npm install -g ${agent.npmPackage}`;
  const result = spawnSync(cmd, { shell: true, stdio: "inherit" });
  if (result.error) {
    console.log(`\n${red(`Failed to run npm: ${result.error.message}`)}`);
    console.log(`Make sure ${cyan("npm")} is on your PATH, then retry.`);
    return false;
  }
  if (result.status !== 0) {
    const exitInfo = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    console.log(`\n${red(`${cmd} failed (${exitInfo}).`)}`);
    if (process.platform === "win32") {
      console.log(`If this is a permissions error, try opening a terminal as Administrator and re-running.`);
    } else {
      console.log(`If this is a permissions error, try running with ${cyan("sudo")} or fix your global npm prefix.`);
    }
    return false;
  }
  return true;
}

export function uninstallManagedAgents(agents: DetectedAgent[]): void {
  const managed = agents.filter((a) => a.version && a.npmPackage);
  if (managed.length === 0) {
    console.log(`\n${dim("No Palmier-managed agent CLIs to uninstall.")}`);
    return;
  }
  console.log(`\n${bold(`Uninstalling ${managed.length} Palmier-managed agent ${managed.length === 1 ? "CLI" : "CLIs"}...`)}`);
  let succeeded = 0;
  for (let i = 0; i < managed.length; i++) {
    const agent = managed[i];
    console.log(`\n${dim(`[${i + 1}/${managed.length}]`)} ${agent.label}`);
    if (uninstallAgent(agent)) succeeded++;
  }
  const failed = managed.length - succeeded;
  if (failed === 0) {
    console.log(`\n${green(`Uninstalled ${succeeded} agent ${succeeded === 1 ? "CLI" : "CLIs"}.`)}`);
  } else {
    console.log(`\n${yellow(`Uninstalled ${succeeded} of ${managed.length} agent CLIs (${failed} skipped).`)}`);
  }
}

function uninstallAgentPackage(npmPackage: string): boolean {
  console.log(`\nUninstalling ${cyan(npmPackage)}...\n`);
  const cmd = `npm uninstall -g ${npmPackage}`;
  const result = spawnSync(cmd, { shell: true, stdio: "inherit" });
  if (result.error) {
    console.log(`\n${red(`Failed to run npm: ${result.error.message}`)}`);
    return false;
  }
  if (result.status !== 0) {
    const exitInfo = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    console.log(`\n${red(`${cmd} failed (${exitInfo}).`)}`);
    return false;
  }
  return true;
}

function runAgentAuthFlow(label: string, command: string, args: string[]): void {
  const cmd = `${command} ${args.join(" ")}`;
  console.log(`\n${bold(`Authenticating ${label}...`)} ${dim(`(${cmd})`)}\n`);
  const result = spawnSync(cmd, { shell: true, stdio: "inherit" });
  console.log("");
  if (result.error) {
    console.log(red(`Auth failed: could not run ${cmd} — ${result.error.message}`));
    console.log(`Re-run ${cyan(cmd)} manually after this.\n`);
    return;
  }
  if (result.status !== 0) {
    const exitInfo = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    console.log(red(`Auth failed (${exitInfo}).`));
    console.log(`Re-run ${cyan(cmd)} manually after this.\n`);
    return;
  }
  console.log(green(`Successfully authenticated ${label}.\n`));
}

async function waitForEnter(message: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<string>((resolve) => rl.question(`\n${dim(message)} `, resolve));
  rl.close();
}
