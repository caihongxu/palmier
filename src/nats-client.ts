import { connect, jwtAuthenticator, type NatsConnection } from "nats";
import type { HostConfig } from "./types.js";

/**
 * Connect to NATS using the host config's JWT credentials.
 */
export async function connectNats(config: HostConfig): Promise<NatsConnection> {
  if (!config.natsJwt || !config.natsNkeySeed) {
    throw new Error("NATS JWT credentials not configured. Re-run palmier init.");
  }

  const nc = await connect({
    servers: config.natsUrl,
    authenticator: jwtAuthenticator(
      config.natsJwt,
      new TextEncoder().encode(config.natsNkeySeed),
    ),
  });

  // Do not log anything as that will pollute stdout for mcp server.
  return nc;
}
