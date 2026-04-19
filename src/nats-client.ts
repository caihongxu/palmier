import { connect, jwtAuthenticator, type NatsConnection } from "nats";
import type { HostConfig } from "./types.js";

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

  // Do not log — it would pollute stdout for the MCP server.
  return nc;
}
