import { spawnSync } from "child_process";
import { getNpmInstalledVersion } from "./agents/agent.js";
import { npmInstallGlobal, npmUninstallGlobal } from "./agents/wizard.js";

/** Palmier-managed browser-automation tool. Managed like an agent CLI (install,
 *  version-stamp, re-probe, PWA update prompt) but never offered for explicit
 *  uninstall — it's only removed by `palmier uninstall`. */
export const PLAYWRIGHT_CLI_PACKAGE = "@playwright/cli";
export const PLAYWRIGHT_CLI_COMMAND = "playwright-cli";
export const PLAYWRIGHT_CLI_LABEL = "Playwright CLI";

/** Installed global version, or null when not installed. Doubles as the
 *  "is it installed" check (mirrors how agents resolve their version). */
export function getPlaywrightCliVersion(): string | null {
  return getNpmInstalledVersion(PLAYWRIGHT_CLI_PACKAGE);
}

export function installPlaywrightCli(): boolean {
  return npmInstallGlobal(PLAYWRIGHT_CLI_PACKAGE);
}

/** Install the Playwright agent skills so agent CLIs know how to drive the
 *  browser. Runs in `cwd` (the Palmier task directory) so the skills land where
 *  agents execute. Best-effort: a failure leaves the CLI installed and managed. */
export function installPlaywrightSkills(cwd: string): boolean {
  console.log(`\nInstalling Playwright skills...\n`);
  const result = spawnSync(`${PLAYWRIGHT_CLI_COMMAND} install --skills`, { cwd, shell: true, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    console.log(`\nCould not install Playwright skills. Run \`${PLAYWRIGHT_CLI_COMMAND} install --skills\` manually.`);
    return false;
  }
  return true;
}

export function uninstallPlaywrightCli(): boolean {
  return npmUninstallGlobal(PLAYWRIGHT_CLI_PACKAGE);
}
