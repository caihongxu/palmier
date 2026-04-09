import { getPlatform } from "../platform/index.js";

export async function uninstallCommand(): Promise<void> {
  const platform = getPlatform();
  platform.uninstallDaemon();

  console.log("\nTo uninstall the package: npm uninstall -g palmier");
  console.log("To also remove configuration and task data, see https://github.com/caihongxu/palmier#uninstalling");
}
