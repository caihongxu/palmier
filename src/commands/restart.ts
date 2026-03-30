import { getPlatform } from "../platform/index.js";

/**
 * Restart the palmier serve daemon.
 */
export async function restartCommand(): Promise<void> {
  const platform = getPlatform();
  await platform.restartDaemon();
}
