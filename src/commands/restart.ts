import { getPlatform } from "../platform/index.js";

export async function restartCommand(): Promise<void> {
  const platform = getPlatform();
  await platform.restartDaemon();
}
