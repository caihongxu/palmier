import { StringCodec } from "nats";
import { loadConfig } from "../config.js";
import { connectNats } from "../nats-client.js";

/**
 * Send a push notification to the user via NATS.
 * Usage: palmier notify --title "Title" --body "Body text"
 */
export async function notifyCommand(opts: { title: string; body: string }): Promise<void> {
  const config = loadConfig();
  const nc = await connectNats(config);

  if (!nc) {
    console.error("Error: NATS connection required for push notifications.");
    process.exit(1);
  }

  const sc = StringCodec();
  const payload = {
    hostId: config.hostId,
    title: opts.title,
    body: opts.body,
  };

  try {
    const subject = `host.${config.hostId}.push.send`;
    const reply = await nc.request(subject, sc.encode(JSON.stringify(payload)), {
      timeout: 15_000,
    });
    const result = JSON.parse(sc.decode(reply.data)) as { ok?: boolean; error?: string };

    if (result.ok) {
      console.log("Push notification sent successfully.");
    } else {
      console.error(`Failed to send push notification: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error sending push notification: ${err}`);
    process.exit(1);
  } finally {
    await nc.drain();
  }
}
