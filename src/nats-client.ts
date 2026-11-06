import { connect, jwtAuthenticator, type NatsConnection } from "nats";
import type { HostConfig } from "./types.js";

export async function connectNats(
  config: HostConfig,
  opts: { reconnect?: boolean } = {},
): Promise<NatsConnection> {
  if (!config.natsJwt || !config.natsNkeySeed) {
    throw new Error("NATS JWT credentials not configured. Re-run palmier init.");
  }

  const nc = await connect({
    servers: config.natsUrl,
    authenticator: jwtAuthenticator(
      config.natsJwt,
      new TextEncoder().encode(config.natsNkeySeed),
    ),
    reconnect: opts.reconnect ?? true,
    // Sleep or a network switch kills the socket silently; the 2-min default
    // ping leaves the host unreachable for minutes, and the default 10
    // reconnect attempts close the connection for good after a short outage.
    maxReconnectAttempts: -1,
    pingInterval: 20_000,
    maxPingOut: 2,
  });

  return nc;
}
