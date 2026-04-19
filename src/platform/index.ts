import type { PlatformService } from "./platform.js";
import { LinuxPlatform } from "./linux.js";
import { WindowsPlatform } from "./windows.js";
import { MacOsPlatform } from "./macos.js";

/** Windows needs an explicit shell for execSync to resolve .cmd shims. */
export const SHELL: string | undefined = process.platform === "win32" ? "cmd.exe" : undefined;

let _instance: PlatformService | undefined;

export function getPlatform(): PlatformService {
  if (!_instance) {
    if (process.platform === "win32") _instance = new WindowsPlatform();
    else if (process.platform === "darwin") _instance = new MacOsPlatform();
    else _instance = new LinuxPlatform();
  }
  return _instance;
}

export type { PlatformService } from "./platform.js";
