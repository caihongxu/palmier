import * as os from "node:os";
import * as dgram from "node:dgram";

/**
 * Resolve the name of the network interface used for the IPv4 default route.
 * Falls back to the first non-internal IPv4 interface when the gateway lookup
 * fails — `default-gateway` shells out to `wmic` on Windows, which was removed
 * in Windows 11 24H2.
 */
function findInterfaceByIp(ip: string): string | null {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && addr.address === ip) return name;
    }
  }
  return null;
}

/** Ask the kernel which local IPv4 would route to an external address. No packet is sent. */
function probeOutboundIp(): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    const cleanup = (ip: string | null) => { try { sock.close(); } catch { /* ignore */ } resolve(ip); };
    sock.on("error", () => cleanup(null));
    try {
      sock.connect(80, "8.8.8.8", () => {
        const addr = sock.address();
        cleanup(addr.address && addr.address !== "0.0.0.0" ? addr.address : null);
      });
    } catch {
      cleanup(null);
    }
  });
}

type IpClass = 0 | 1 | 2 | 3;

/** Lower score = more preferred. 0=192.168, 1=10.x, 2=172.16-31, 3=everything else. */
function ipClass(ip: string): IpClass {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return 3;
  const [a, b] = parts;
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b >= 16 && b <= 31) return 2;
  return 3;
}

/** Names that commonly belong to virtual/VPN adapters we'd rather skip. */
const VIRTUAL_NAME_PATTERNS = [
  "vethernet", "virtualbox", "vmware", "hyper-v", "docker", "bridge",
  "tailscale", "wireguard", "meta", "vpn", "tun", "tap", "loopback",
  "wsl", "utun",
];

function isVirtualName(name: string): boolean {
  const lower = name.toLowerCase();
  return VIRTUAL_NAME_PATTERNS.some((p) => lower.includes(p));
}

export async function detectDefaultInterface(): Promise<string | null> {
  const probedIp = await probeOutboundIp();
  if (probedIp) {
    const name = findInterfaceByIp(probedIp);
    if (name && !isVirtualName(name)) return name;
  }

  type Candidate = { name: string; klass: IpClass; virtual: boolean };
  const candidates: Candidate[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      candidates.push({ name, klass: ipClass(addr.address), virtual: isVirtualName(name) });
    }
  }
  candidates.sort((a, b) => {
    if (a.virtual !== b.virtual) return a.virtual ? 1 : -1;
    return a.klass - b.klass;
  });
  return candidates[0]?.name ?? null;
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
