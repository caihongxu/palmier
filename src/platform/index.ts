import type { PlatformService } from "./platform.js";
import { LinuxPlatform } from "./linux.js";
import { WindowsPlatform } from "./windows.js";

/**
 * On Windows, execSync needs an explicit shell so .cmd shims resolve correctly.
 * On Unix, undefined lets Node use the default shell.
 */
export const SHELL: string | undefined = process.platform === "win32" ? "cmd.exe" : undefined;

let _instance: PlatformService | undefined;

export function getPlatform(): PlatformService {
  if (!_instance) {
    _instance = process.platform === "win32"
      ? new WindowsPlatform()
      : new LinuxPlatform();
  }
  return _instance;
}

export type { PlatformService } from "./platform.js";
