import * as readline from "readline";
import { spawnSync } from "child_process";
import { loadConfig, saveConfig } from "../config.js";
import { detectAgents, listInstallableAgents, type DetectedAgent, type InstallableAgent } from "../agents/agent.js";
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
  let agents = await detectAgents();
  if (agents.length > 0) {
    console.log(`  Found: ${green(agents.map((a) => a.label).join(", "))}`);
  }

  agents = await offerAgentInstall(agents);

  if (agents.length === 0) {
    console.log(`\n${red("No agent CLIs detected.")} Palmier requires at least one supported agent CLI.\n`);
    console.log(`See supported agents: https://www.palmier.me/agents\n`);
    console.log(`Install at least one agent CLI, then run ${cyan("palmier init")} again.`);
    process.exit(1);
  }

  console.log(`\n  Agents: ${green(agents.map((a) => a.label).join(", "))}\n`);

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
    console.log(`  ${dim("Remote (app):")}   ${cyan("https://github.com/caihongxu/palmier-android/releases/latest")}`);
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
    console.log(`  ${dim("Agents:")}         ${agents.map((a) => a.label).join(", ")}\n`);

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

    let existingHostId: string | undefined;
    try { existingHostId = loadConfig().hostId; } catch { /* first init */ }

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

    getPlatform().installDaemon(config);

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


async function offerAgentInstall(currentAgents: DetectedAgent[]): Promise<DetectedAgent[]> {
  let agents = currentAgents;

  while (true) {
    const detectedKeys = new Set(agents.map((a) => a.key));
    const missing = listInstallableAgents().filter((a) => !detectedKeys.has(a.key));
    if (missing.length === 0) return agents;

    const canFinish = agents.length > 0;
    const message = canFinish
      ? `\n${bold("Install another agent?")} The following supported agents are not yet installed:`
      : `\n${red("No agent CLIs detected.")} Palmier can install one for you via npm:`;

    const installChoices = missing.map((a) => ({
      label: a.label,
      hint: `npm install -g ${a.npmPackage}`,
    }));
    const choices = canFinish
      ? [{ label: "Done — continue setup", hint: "skip installation" }, ...installChoices]
      : installChoices;

    const idx = await selectFromList(message, choices);
    if (idx === null) return agents;
    if (canFinish && idx === 0) return agents;

    const choice = missing[canFinish ? idx - 1 : idx];
    if (!installAgentPackage(choice)) return agents;

    console.log(`\nRedetecting agents...`);
    agents = await detectAgents();
    const installedAgent = agents.find((a) => a.key === choice.key);
    if (!installedAgent) {
      console.log(`${red(`${choice.label} still not detected after install.`)} It may not be on PATH yet — open a new terminal and run ${cyan("palmier init")} again.`);
      return agents;
    }

    console.log(green(`  ${choice.label} installed.`));
    console.log(`\n${bold("Next: authenticate the CLI.")}`);
    console.log(`  Run ${cyan(choice.command)} in another terminal and follow the sign-in prompts.`);
    console.log(`  Palmier will use the CLI on your behalf once it's signed in.`);
  }
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
