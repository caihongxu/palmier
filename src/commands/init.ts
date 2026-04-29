import * as readline from "readline";
import { spawnSync } from "child_process";
import { loadConfig, saveConfig } from "../config.js";
import { detectAgents, getAgent, getNpmInstalledVersion, listInstallableAgents, type DetectedAgent, type InstallableAgent } from "../agents/agent.js";
import { getPlatform } from "../platform/index.js";
import { pairCommand } from "./pair.js";
import { detectDefaultInterface, getInterfaceIpv4 } from "../network.js";
import { listTasks } from "../task.js";
import { selectFromList } from "../prompts.js";
import type { HostConfig } from "../types.js";

type AskFn = (q: string) => Promise<string>;

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

export async function initCommand(): Promise<void> {
  console.log(`\n${bold("=== Palmier Host Setup ===")}\n`);
  console.log(`By continuing, you agree to the ${cyan("Terms of Service")} (https://www.palmier.me/terms)`);
  console.log(`and ${cyan("Privacy Policy")} (https://www.palmier.me/privacy).\n`);

  console.log("Detecting installed agents...");
  let previousConfig: HostConfig | null = null;
  try { previousConfig = loadConfig(); } catch { /* first init */ }
  let agents = await detectAgents(previousConfig?.agents);
  logDetectedAgents(agents);

  await offerAgentInstall(agents, () => {
    if (previousConfig) {
      previousConfig.agents = agents;
      saveConfig(previousConfig);
    }
  });

  if (agents.length === 0) {
    console.log(`\n${red("No agent CLIs detected.")} Palmier requires at least one supported agent CLI.\n`);
    console.log(`See supported agents: https://www.palmier.me/agents\n`);
    console.log(`Install at least one agent CLI, then run ${cyan("palmier init")} again.`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask: AskFn = (q) => new Promise<string>((resolve) => rl.question(q, resolve));

  try {

    let httpPort = 7256;
    const portAnswer = await ask(`HTTP port (default ${httpPort}): `);
    const parsed = parseInt(portAnswer.trim(), 10);
    if (parsed > 0 && parsed < 65536) httpPort = parsed;

    const defaultInterface = (await detectDefaultInterface()) ?? undefined;
    const lanIp = defaultInterface ? getInterfaceIpv4(defaultInterface) : null;

    console.log(`\n${bold("Setup summary:")}\n`);
    console.log(`  ${dim("Task storage:")}   ${bold(process.cwd())}`);
    console.log(`                  All tasks and execution data will be stored here.\n`);
    console.log(`  ${dim("Local:")}          ${cyan(`http://localhost:${httpPort}`)}`);
    console.log(`                  Open in a browser on this machine — no internet required.\n`);
    console.log(`  ${dim("Remote (app):")}   ${cyan("https://github.com/caihongxu/palmier-android/releases/latest/download/palmier.apk")}`);
    if (lanIp) {
      console.log(`                  Download the Android APK. The app uses LAN for direct RPC`);
      console.log(`                  on the same network (detected ${cyan(`http://${lanIp}:${httpPort}`)}),`);
      console.log(`                  otherwise the relay.\n`);
    } else {
      console.log(`                  Download the Android APK. Traffic will go through the relay —`);
      console.log(`                  ${red("could not detect a LAN interface")} for direct RPC.\n`);
    }
    console.log(`  ${dim("Remote (web):")}   ${cyan("https://app.palmier.me")}`);
    console.log(`                  Pair a browser on any device. Traffic always goes through the relay.\n`);
    console.log(`  ${dim("Agents:")}         ${agents.map((a) => a.version ? `${a.label} v${a.version}` : a.label).join(", ")}\n`);

    const existingTasks = listTasks(process.cwd());
    if (existingTasks.length > 0) {
      console.log(`  ${dim("Recover tasks:")}  ${existingTasks.length} existing task(s) found:`);
      for (const t of existingTasks) {
        console.log(`                  - ${t.frontmatter.name || t.frontmatter.user_prompt.slice(0, 50)}`);
      }
      console.log();
    }

    const confirm = await ask("Proceed? (Y/n): ");
    if (confirm.trim().toLowerCase() === "n") {
      console.log("\nSetup cancelled.");
      rl.close();
      return;
    }

    const existingHostId = previousConfig?.hostId;

    const serverUrl = "https://app.palmier.me";
    let registerResponse: { hostId: string; natsUrl: string; natsWsUrl: string; natsJwt: string; natsNkeySeed: string };

    while (true) {
      console.log(`\nRegistering host...`);
      try {
        registerResponse = await registerHost(serverUrl, existingHostId);
        console.log(green("Host registered successfully."));
        break;
      } catch (err) {
        console.error(`\n  ${red(err instanceof Error ? err.message : String(err))}`);
        const retry = await ask("\nRetry? (Y/n): ");
        if (retry.trim().toLowerCase() === "n") {
          console.log("\nSetup cancelled.");
          rl.close();
          return;
        }
      }
    }

    const config: HostConfig = {
      hostId: registerResponse.hostId,
      projectRoot: process.cwd(),
      natsUrl: registerResponse.natsUrl,
      natsWsUrl: registerResponse.natsWsUrl,
      natsJwt: registerResponse.natsJwt,
      natsNkeySeed: registerResponse.natsNkeySeed,
      agents,
      httpPort,
      defaultInterface,
    };

    saveConfig(config);
    console.log(`Config saved to ${dim("~/.config/palmier/host.json")}`);

    const platform = getPlatform();
    platform.installDaemon(config);
    if (previousConfig) {
      // Re-init: a daemon is already running with stale in-memory config.
      // Restart so it picks up the new agents/versions for host.info.
      await platform.restartDaemon();
    }

    // Task recovery runs in the daemon (palmier serve) because that process
    // is elevated and can create S4U scheduled tasks.

    console.log("\nStarting pairing...");
    rl.close();
    await pairCommand();
  } catch (err) {
    rl.close();
    throw err;
  }
}


async function offerAgentInstall(
  agents: DetectedAgent[],
  onAgentInstalled?: () => void,
): Promise<void> {
  while (true) {
    const detectedKeys = new Set(agents.map((a) => a.key));
    const missing = listInstallableAgents()
      .filter((a) => !detectedKeys.has(a.key))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (missing.length === 0) return;

    const hasAgents = agents.length > 0;
    const message = hasAgents
      ? `\n${bold("Install additional agents?")} The following supported agents can be installed:`
      : `\n${red("No agent CLIs detected.")} Palmier can install one for you via npm:`;

    const installChoices = missing.map((a) => ({
      label: a.freeUsage ? `${a.label} ${green(`[${a.freeUsage}]`)}` : a.label,
      hint: `${a.npmPackage}`,
    }));
    const choices = hasAgents
      ? [{ label: "No — continue to the next step ", hint: "skip installation" }, ...installChoices]
      : installChoices;

    const idx = await selectFromList(message, choices);
    if (idx === null) return;
    if (hasAgents && idx === 0) return;

    const choice = missing[hasAgents ? idx - 1 : idx];
    if (!installAgentPackage(choice)) return;

    console.log(green(`  ${choice.label} installed.`));

    // Stamp the agent record with version *before* auth so that an interrupted
    // wizard (Ctrl+C during sign-in, etc.) still leaves the agent recorded as
    // Palmier-managed in the persisted config on next run.
    const tool = getAgent(choice.key);
    const version = getNpmInstalledVersion(choice.npmPackage) ?? undefined;
    agents.push({
      key: choice.key,
      label: choice.label,
      ...(tool.supportsPermissions ? { supportsPermissions: true } : {}),
      ...(tool.supportsYolo ? { supportsYolo: true } : {}),
      npmPackage: choice.npmPackage,
      ...(version ? { version } : {}),
    });
    onAgentInstalled?.();

    if (tool.authArgs && tool.authArgs.length > 0) {
      runAgentAuthFlow(choice.label, tool.command, tool.authArgs);
    } else {
      console.log(`\n${bold("Next: authenticate the CLI.")}`);
      console.log(`  Run ${cyan(choice.command)} in another terminal and follow the sign-in prompts.`);
      console.log(`  Palmier will use the CLI on your behalf once it's signed in.`);
    }
    await waitForEnter("Press Enter once authentication is complete...");
  }
}

async function waitForEnter(message: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<string>((resolve) => rl.question(`\n${dim(message)} `, resolve));
  rl.close();
}

function logDetectedAgents(agents: DetectedAgent[]): void {
  if (agents.length === 0) return;
  console.log(`  Found: ${green(agents.map((a) => a.version ? `${a.label} v${a.version}` : a.label).join(", "))}`);
}

function runAgentAuthFlow(label: string, command: string, args: string[]): void {
  const cmd = `${command} ${args.join(" ")}`;
  console.log(`\n${bold(`Authenticating ${label}...`)} ${dim(`(${cmd})`)}\n`);
  const result = spawnSync(cmd, { shell: true, stdio: "inherit" });
  console.log("");

  if (result.error) {
    console.log(red(`Auth failed: could not run ${cmd} — ${result.error.message}`));
    console.log(`Re-run ${cyan(cmd)} manually after init finishes.\n`);
    return;
  }
  if (result.status !== 0) {
    const exitInfo = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    console.log(red(`Auth failed (${exitInfo}).`));
    console.log(`Re-run ${cyan(cmd)} manually after init finishes.\n`);
    return;
  }
  console.log(green(`Successfully authenticated ${label}.\n`));
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
      console.log(`If this is a permissions error, try opening a terminal as Administrator and re-running ${cyan("palmier init")}.`);
    } else {
      console.log(`If this is a permissions error, try running with ${cyan("sudo")} or fix your global npm prefix.`);
    }
    return false;
  }
  return true;
}

async function registerHost(
  serverUrl: string,
  existingHostId?: string,
): Promise<{ hostId: string; natsUrl: string; natsWsUrl: string; natsJwt: string; natsNkeySeed: string }> {
  try {
    const res = await fetch(`${serverUrl}/api/hosts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(existingHostId ? { hostId: existingHostId } : {}),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status} ${res.statusText}\n${body}`);
    }

    return (await res.json()) as {
      hostId: string;
      natsUrl: string;
      natsWsUrl: string;
      natsJwt: string;
      natsNkeySeed: string;
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("fetch failed") || message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("NetworkError")) {
      throw new Error(`Could not reach ${serverUrl} — check the URL and your network connection.`);
    }
    throw new Error(`Failed to register host: ${message}`);
  }
}
