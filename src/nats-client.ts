import { connect, type NatsConnection } from "nats";
import type { HostConfig } from "./types.js";

/**
 * Connect to NATS using the host config's TCP URL and token auth.
 */
export async function connectNats(config: HostConfig): Promise<NatsConnection> {
  const nc = await connect({
    servers: config.natsUrl,
    token: config.natsToken,
  });

  // Do not log anything as that will pollute stdout for mcp server.
  return nc;
}
