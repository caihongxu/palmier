import * as readline from "readline";
import { loadConfig, saveConfig } from "../config.js";
import { detectAgents } from "../agents/agent.js";
import { getPlatform } from "../platform/index.js";
import { pairCommand } from "./pair.js";
import type { HostConfig } from "../types.js";

type AskFn = (q: string) => Promise<string>;

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

/**
 * Interactive wizard to provision this host.
 */
export async function initCommand(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask: AskFn = (q) => new Promise<string>((resolve) => rl.question(q, resolve));

  try {
    console.log(`\n${bold("=== Palmier Host Setup ===")}\n`);
    console.log(`By continuing, you agree to the ${cyan("Terms of Service")} (https://www.palmier.me/terms)`);
    console.log(`and ${cyan("Privacy Policy")} (https://www.palmier.me/privacy).\n`);

    // Detect agents first — abort if none found
    console.log("Detecting installed agents...");
    const agents = await detectAgents();

    if (agents.length === 0) {
      console.log(`\n${red("No agent CLIs detected.")} Palmier requires at least one supported agent CLI.\n`);
      console.log(`See supported agents: https://www.palmier.me/agents\n`);
      console.log(`Install at least one agent CLI, then run ${cyan("palmier init")} again.`);
      rl.close();
      process.exit(1);
    }

    console.log(`  Found: ${green(agents.map((a) => a.label).join(", "))}\n`);

    // Register with server
    let existingHostId: string | undefined;
    try { existingHostId = loadConfig().hostId; } catch { /* first init */ }

    const serverUrl = "https://app.palmier.me";
    let registerResponse: { hostId: string; natsUrl: string; natsWsUrl: string; natsToken: string };

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

    // Build config
    const config: HostConfig = {
      hostId: registerResponse.hostId,
      projectRoot: process.cwd(),
      nats: true,
      natsUrl: registerResponse.natsUrl,
      natsWsUrl: registerResponse.natsWsUrl,
      natsToken: registerResponse.natsToken,
      agents,
    };

    saveConfig(config);

    console.log(`\n${green("Host provisioned")} ID: ${cyan(config.hostId)}`);
    console.log(`Config saved to ${dim("~/.config/palmier/host.json")}`);

    getPlatform().installDaemon(config);

    console.log("\nStarting pairing...");
    rl.close();
    await pairCommand();
  } catch (err) {
    rl.close();
    throw err;
  }
}


async function registerHost(
  serverUrl: string,
  existingHostId?: string,
): Promise<{ hostId: string; natsUrl: string; natsWsUrl: string; natsToken: string }> {
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
      natsToken: string;
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("fetch failed") || message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("NetworkError")) {
      throw new Error(`Could not reach ${serverUrl} — check the URL and your network connection.`);
    }
    throw new Error(`Failed to register host: ${message}`);
  }
}
