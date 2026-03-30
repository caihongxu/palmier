import * as http from "node:http";
import * as os from "os";
import { validateSession, addSession } from "../session-store.js";
import type { HostConfig, RpcMessage } from "../types.js";

const PWA_ORIGIN = "https://app.palmier.me";

// ── In-memory PWA asset cache ──────────────────────────────────────────

interface CachedAsset {
  data: Buffer;
  contentType: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",

  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
};

function guessContentType(urlPath: string): string {
  const ext = urlPath.match(/\.[^.]+$/)?.[0] ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Download the PWA from palmier.me into memory.
 * Parses index.html for asset references, then fetches each one.
 */
async function downloadPwaAssets(): Promise<Map<string, CachedAsset>> {
  const assets = new Map<string, CachedAsset>();

  // 1. Fetch index.html
  const html = await fetchBuffer(`${PWA_ORIGIN}/`);
  assets.set("/", { data: html, contentType: "text/html; charset=utf-8" });

  const htmlStr = html.toString("utf-8");

  // 2. Extract references from HTML (src="..." and href="...")
  // Skip service worker and manifest — they require HTTPS which LAN mode doesn't use
  const SKIP = new Set(["/registerSW.js", "/service-worker.js", "/manifest.webmanifest"]);
  const refRegex = /(?:src|href)="([^"]+)"/g;
  const htmlRefs = new Set<string>();
  let match;
  while ((match = refRegex.exec(htmlStr)) !== null) {
    const ref = match[1];
    if (ref.startsWith("/") && !ref.startsWith("//") && !SKIP.has(ref)) {
      htmlRefs.add(ref);
    }
  }

  // 3. Fetch all HTML-referenced assets
  for (const ref of htmlRefs) {
    try {
      const data = await fetchBuffer(`${PWA_ORIGIN}${ref}`);
      assets.set(ref, { data, contentType: guessContentType(ref) });

      // 4. Parse CSS for font url() references
      if (ref.endsWith(".css")) {
        const cssStr = data.toString("utf-8");
        const urlRegex = /url\(["']?([^"')]+)["']?\)/g;
        let cssMatch;
        while ((cssMatch = urlRegex.exec(cssStr)) !== null) {
          let fontRef = cssMatch[1];
          if (fontRef.startsWith("data:")) continue;
          // Resolve relative URLs against the CSS file's directory
          if (!fontRef.startsWith("/")) {
            const cssDir = ref.substring(0, ref.lastIndexOf("/") + 1);
            fontRef = cssDir + fontRef;
          }
          htmlRefs.add(fontRef);
        }
      }
    } catch (err) {
      console.warn(`[pwa] Failed to fetch ${ref}: ${err}`);
    }
  }

  return assets;
}

type SseClient = http.ServerResponse;

interface PendingPair {
  resolve: (result: { paired: boolean }) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingPairs = new Map<string, PendingPair>();

export function detectLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

/**
 * Start the HTTP transport: Express-like server with RPC, SSE, and health endpoints.
 */
export async function startHttpTransport(
  config: HostConfig,
  handleRpc: (req: RpcMessage) => Promise<unknown>,
  port: number,
  pairingCode?: string,
  onReady?: () => void,
): Promise<void> {
  // Download PWA assets into memory before starting the server
  console.log("[http] Downloading PWA assets...");
  const pwaAssets = await downloadPwaAssets();
  console.log(`[http] Cached ${pwaAssets.size} PWA assets in memory.`);

  const sseClients = new Set<SseClient>();

  // If a pairing code is provided (from `palmier lan`), pre-register it
  if (pairingCode) {
    const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours — stays valid while lan server runs
    const timer = setTimeout(() => { pendingPairs.delete(pairingCode); }, EXPIRY_MS);
    pendingPairs.set(pairingCode, {
      resolve: () => {},
      timer,
    });
  }

  function broadcastSseEvent(data: unknown) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  }


  function checkAuth(req: http.IncomingMessage): boolean {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) return false;
    const token = auth.slice(7);
    return validateSession(token);
  }

  function extractSessionToken(req: http.IncomingMessage): string | undefined {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) return undefined;
    return auth.slice(7);
  }

  function sendJson(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

  function isLocalhost(req: http.IncomingMessage): boolean {
    const addr = req.socket.remoteAddress;
    return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const pathname = url.pathname;

    // Internal event endpoint — localhost only, no auth
    if (req.method === "POST" && pathname === "/internal/event") {
      if (!isLocalhost(req)) {
        sendJson(res, 403, { error: "localhost only" });
        return;
      }
      try {
        const body = await readBody(req);
        const event = JSON.parse(body);
        broadcastSseEvent(event);
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { error: "Invalid JSON" });
      }
      return;
    }

    // Internal pair-register endpoint — localhost only, long-poll
    // The pair CLI posts here and blocks until paired or expired.
    if (req.method === "POST" && pathname === "/internal/pair-register") {
      if (!isLocalhost(req)) {
        sendJson(res, 403, { error: "localhost only" });
        return;
      }
      try {
        const body = await readBody(req);
        const { code, expiryMs } = JSON.parse(body) as {
          code: string;
          expiryMs: number;
        };

        if (!code) {
          sendJson(res, 400, { error: "Missing code" });
          return;
        }

        if (pendingPairs.has(code)) {
          sendJson(res, 409, { error: "Code already registered" });
          return;
        }

        const result = await new Promise<{ paired: boolean }>((resolve) => {
          const timer = setTimeout(() => {
            pendingPairs.delete(code);
            resolve({ paired: false });
          }, expiryMs ?? 5 * 60 * 1000);

          pendingPairs.set(code, { resolve, timer });

          // Clean up if the CLI disconnects early
          req.on("close", () => {
            if (pendingPairs.has(code)) {
              clearTimeout(timer);
              pendingPairs.delete(code);
            }
          });
        });

        sendJson(res, 200, result);
      } catch {
        sendJson(res, 400, { error: "Invalid JSON" });
      }
      return;
    }

    // Public pair endpoint — no auth required, PWA posts OTP code here
    if (req.method === "POST" && pathname === "/pair") {
      try {
        const body = await readBody(req);
        const { code, label } = JSON.parse(body) as {
          code: string;
          label?: string;
        };

        if (!code) {
          sendJson(res, 400, { error: "Missing code" });
          return;
        }

        const pending = pendingPairs.get(code);
        if (!pending) {
          sendJson(res, 401, { error: "Invalid code" });
          return;
        }

        // Create session and build response
        const session = addSession(label);
        const ip = detectLanIp();
        const response: Record<string, unknown> = {
          hostId: config.hostId,
          sessionToken: session.token,
          directUrl: `http://${ip}:${port}`,
        };

        // Resolve the long-poll and clean up
        clearTimeout(pending.timer);
        pendingPairs.delete(code);
        pending.resolve({ paired: true });

        sendJson(res, 200, response);
      } catch {
        sendJson(res, 400, { error: "Invalid JSON" });
      }
      return;
    }

    // Serve cached PWA assets for non-API routes (no auth required)
    const isApiRoute = pathname === "/events" || pathname.startsWith("/rpc/");
    if (!isApiRoute) {
      // SPA fallback: serve index.html for unrecognized paths
      const asset = pwaAssets.get(pathname) ?? (pathname !== "/" ? pwaAssets.get("/") : undefined);
      if (asset) {
        res.writeHead(200, { "Content-Type": asset.contentType });
        res.end(asset.data);
      } else {
        sendJson(res, 404, { error: "Not found" });
      }
      return;
    }

    // API endpoints require auth
    if (!checkAuth(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    // SSE event stream
    if (req.method === "GET" && pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(":ok\n\n");

      // Send heartbeat every 5 seconds
      const heartbeat = setInterval(() => {
        res.write("data: {\"heartbeat\":true}\n\n");
      }, 5000);

      sseClients.add(res);
      req.on("close", () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
      });
      return;
    }

    // RPC endpoint: POST /rpc/<method>
    if (req.method === "POST" && pathname.startsWith("/rpc/")) {
      const method = pathname.slice("/rpc/".length);
      if (!method) {
        sendJson(res, 400, { error: "Missing RPC method" });
        return;
      }

      let params: Record<string, unknown> = {};
      try {
        const body = await readBody(req);
        if (body.trim().length > 0) {
          params = JSON.parse(body);
        }
      } catch {
        sendJson(res, 400, { error: "Invalid JSON" });
        return;
      }

      const sessionToken = extractSessionToken(req);
      console.log(`[http] RPC: ${method}`);

      try {
        const response = await handleRpc({ method, params, sessionToken });
        console.log(`[http] RPC done: ${method}`, JSON.stringify(response).slice(0, 200));
        sendJson(res, 200, response);
      } catch (err) {
        console.error(`[http] RPC error (${method}):`, err);
        sendJson(res, 500, { error: String(err) });
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });

  return new Promise<void>((resolve, reject) => {
    server.listen(port, () => {
      console.log(`[http] Listening on port ${port}`);
      onReady?.();

      // Graceful shutdown
      const shutdown = () => {
        console.log("[http] Shutting down...");
        for (const client of sseClients) {
          client.end();
        }
        server.close(() => process.exit(0));
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

    server.on("error", reject);
  });
}
