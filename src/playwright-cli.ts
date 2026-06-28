import { getNpmInstalledVersion } from "./agents/agent.js";
import { npmInstallGlobal, npmUninstallGlobal } from "./agents/wizard.js";

/** Palmier-managed browser-automation tool. Managed like an agent CLI (install,
 *  version-stamp, re-probe, PWA update prompt) but never offered for explicit
 *  uninstall — it's only removed by `palmier uninstall`. */
export const PLAYWRIGHT_CLI_PACKAGE = "@playwright/cli";
export const PLAYWRIGHT_CLI_LABEL = "Playwright CLI";

/** Installed global version, or null when not installed. Doubles as the
 *  "is it installed" check (mirrors how agents resolve their version). */
export function getPlaywrightCliVersion(): string | null {
  return getNpmInstalledVersion(PLAYWRIGHT_CLI_PACKAGE);
}

export function installPlaywrightCli(): boolean {
  return npmInstallGlobal(PLAYWRIGHT_CLI_PACKAGE);
}

export function uninstallPlaywrightCli(): boolean {
  return npmUninstallGlobal(PLAYWRIGHT_CLI_PACKAGE);
}
