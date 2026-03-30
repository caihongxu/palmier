import type { PlatformService } from "./platform.js";
import { LinuxPlatform } from "./linux.js";
import { WindowsPlatform } from "./windows.js";

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
