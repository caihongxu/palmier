import * as fs from "fs";
import { loadConfig, CONFIG_DIR } from "../config.js";
import { createRpcHandler } from "../rpc-handler.js";
import { startHttpTransport, detectLanIp } from "../transports/http-transport.js";
import { generatePairingCode } from "./pair.js";
import { LAN_LOCKFILE } from "../lan-lock.js";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function writeLockfile(port: number): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(LAN_LOCKFILE, JSON.stringify({ port, pid: process.pid }), "utf-8");
}

function removeLockfile(): void {
  try { fs.unlinkSync(LAN_LOCKFILE); } catch { /* ignore */ }
}

/**
 * Start an on-demand LAN server for direct HTTP connections.
 * Generates a pairing code and displays it — no separate `palmier pair` needed.
 */
export async function lanCommand(opts: { port: number }): Promise<void> {
  const config = loadConfig();
  const port = opts.port;
  const ip = detectLanIp();
  const code = generatePairingCode();

  const handleRpc = createRpcHandler(config);

  // Write lockfile so other palmier processes can discover us
  writeLockfile(port);

  // Clean up on exit
  process.on("SIGINT", () => { removeLockfile(); process.exit(0); });
  process.on("SIGTERM", () => { removeLockfile(); process.exit(0); });
  process.on("exit", removeLockfile);

  // Start the HTTP transport with the pre-generated pairing code
  await startHttpTransport(config, handleRpc, port, code, () => {
    console.log(`\n${bold("Palmier LAN Server")}\n`);
    console.log(`  ${cyan("Open the app at:")} ${bold(`http://${ip}:${port}`)}\n`);
    console.log(`  ${cyan("Pairing code:")}    ${bold(code)}\n`);
    console.log(`  ${dim("Press Ctrl+C to stop.")}\n`);
  });
}
