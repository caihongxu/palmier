import * as os from "node:os";
// @ts-expect-error - default-gateway ships no types
import { gateway4async } from "default-gateway";

/**
 * Resolve the name of the network interface used for the IPv4 default route.
 * Returns null when no default route is found (e.g. fully offline host) or
 * when the OS platform isn't supported by `default-gateway`.
 */
export async function detectDefaultInterface(): Promise<string | null> {
  try {
    const result = await gateway4async() as { int?: string | null };
    return result.int ?? null;
  } catch {
    return null;
  }
}

export function getInterfaceIpv4(interfaceName: string): string | null {
  const addrs = os.networkInterfaces()[interfaceName];
  if (!addrs) return null;
  for (const addr of addrs) {
    if (addr.family === "IPv4" && !addr.internal) return addr.address;
  }
  return null;
}

export function buildLanUrl(port: number, interfaceName: string | undefined): string | null {
  if (!interfaceName) return null;
  const ip = getInterfaceIpv4(interfaceName);
  return ip ? `http://${ip}:${port}` : null;
}
