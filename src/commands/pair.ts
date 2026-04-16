import * as http from "node:http";
import { StringCodec } from "nats";
import { loadConfig } from "../config.js";
import { connectNats } from "../nats-client.js";
import { addClient } from "../client-store.js";
import type { HostConfig } from "../types.js";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no O/0/I/1/L
const CODE_LENGTH = 6;

export const PAIRING_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export function generatePairingCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

function buildPairResponse(config: HostConfig, label?: string) {
  const client = addClient(label);
  return {
    hostId: config.hostId,
    clientToken: client.token,
  };
}

/**
 * POST to the running serve daemon and long-poll until paired or expired.
 */
function httpPairRegister(port: number, code: string): Promise<boolean> {
  const body = JSON.stringify({ code, expiryMs: PAIRING_EXPIRY_MS });

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/pair-register",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeout: PAIRING_EXPIRY_MS + 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as { paired: boolean };
            resolve(result.paired);
          } catch {
            resolve(false);
          }
        });
      },
    );

    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end(body);
  });
}

/**
 * Generate a pairing code and wait for a PWA client to pair.
 * Listens on NATS (server mode) and HTTP (via serve daemon) in parallel.
 */
export async function pairCommand(): Promise<void> {
  const config = loadConfig();
  const code = generatePairingCode();
  const httpPort = config.httpPort ?? 7256;

  let paired = false;

  function onPaired() {
    paired = true;
    console.log("Paired successfully!");
  }

  const cleanups: Array<() => void | Promise<void>> = [];

  // Display pairing info
  console.log("");
  console.log("Enter this code in your Palmier app:");
  console.log("");
  console.log(`  ${code}`);
  console.log("");
  console.log("Code expires in 5 minutes.");

  // NATS pairing (server mode)
  const nc = await connectNats(config);
  const sc = StringCodec();
  const subject = `pair.${code}`;
  const sub = nc.subscribe(subject, { max: 1 });

  cleanups.push(() => {
    sub.unsubscribe();
    nc.close();
  });

  (async () => {
    for await (const msg of sub) {
      if (paired) break;
      let label: string | undefined;
      try {
        if (msg.data && msg.data.length > 0) {
          const body = JSON.parse(sc.decode(msg.data)) as { label?: string };
          label = body.label;
        }
      } catch { /* empty body is fine */ }

      const response = buildPairResponse(config, label);
      if (msg.reply) {
        msg.respond(sc.encode(JSON.stringify(response)));
      }
      onPaired();
    }
  })();

  // HTTP pairing — register with serve daemon's /pair-register endpoint
  (async () => {
    const result = await httpPairRegister(httpPort, code);
    if (result) onPaired();
  })();

  // Wait for pairing or timeout
  const start = Date.now();
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (paired || Date.now() - start >= PAIRING_EXPIRY_MS) {
        clearInterval(interval);
        resolve();
      }
    }, 500);
  });

  // Cleanup
  for (const cleanup of cleanups) {
    await cleanup();
  }

  if (!paired) {
    console.log("Code expired. Run `palmier pair` to try again.");
  }

  process.exit(paired ? 0 : 1);
}
