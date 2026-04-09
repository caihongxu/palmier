import * as http from "node:http";
import * as os from "os";
import { StringCodec, type NatsConnection } from "nats";
import { validateClient, addClient } from "../client-store.js";
import { registerPending } from "../pending-requests.js";
import * as fs from "node:fs";
import { getTaskDir, parseTaskFile, spliceUserMessage } from "../task.js";
import type { HostConfig, RpcMessage, RequiredPermission } from "../types.js";

const PWA_ORIGIN = "https://app.palmier.me";

// ── On-the-fly PWA asset cache ──────────────────────────────────────────

interface CachedAsset {
  data: Buffer;
  contentType: string;
}

const assetCache = new Map<string, CachedAsset>();
/** Paths currently being fetched (dedup concurrent requests). */
const assetInflight = new Map<string, Promise<CachedAsset | null>>();

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
  if (urlPath === "/") return "text/html; charset=utf-8";
  const ext = urlPath.match(/\.[^.]+$/)?.[0] ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Fetch a PWA asset on-the-fly, caching in memory.
 * Returns null if the asset cannot be fetched.
 */
async function getAsset(urlPath: string): Promise<CachedAsset | null> {
  const cached = assetCache.get(urlPath);
  if (cached) return cached;

  // Dedup concurrent requests for the same path
  const inflight = assetInflight.get(urlPath);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      let data = await fetchBuffer(`${PWA_ORIGIN}${urlPath}`);
      // Inject LAN mode marker into index HTML so the PWA can detect it's served by palmier
      if (urlPath === "/") {
        const html = data.toString("utf-8").replace("</head>", "<script>window.__PALMIER_SERVE__=true</script></head>");
        data = Buffer.from(html, "utf-8");
      }
      const asset: CachedAsset = { data, contentType: guessContentType(urlPath) };
      assetCache.set(urlPath, asset);
      return asset;
    } catch (err) {
      console.warn(`[pwa] Failed to fetch ${urlPath}: ${err}`);
      return null;
    } finally {
      assetInflight.delete(urlPath);
    }
  })();

  assetInflight.set(urlPath, promise);
  return promise;
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

/** Find the latest (highest-numbered) run directory for a task. */
function findLatestRunId(taskDir: string): string | null {
  try {
    const dirs = fs.readdirSync(taskDir)
      .filter((f) => /^\d+$/.test(f) && fs.statSync(`${taskDir}/${f}`).isDirectory())
      .sort();
    return dirs.length > 0 ? dirs[dirs.length - 1] : null;
  } catch {
    return null;
  }
}

/**
 * Start the HTTP transport: server with RPC, SSE, PWA proxy, pairing, and
 * localhost-only agent endpoints (notify, request-input, confirmation, permission).
 */
export async function startHttpTransport(
  config: HostConfig,
  handleRpc: (req: RpcMessage) => Promise<unknown>,
  port: number,
  nc: NatsConnection | undefined,
  pairingCode?: string,
  onReady?: () => void,
): Promise<void> {
  const sseClients = new Set<SseClient>();
  const lanEnabled = config.lanEnabled ?? false;
  const bindAddress = lanEnabled ? "0.0.0.0" : "127.0.0.1";

  // If a pairing code is provided, pre-register it
  if (pairingCode) {
    const EXPIRY_MS = 24 * 60 * 60 * 1000;
    const timer = setTimeout(() => { pendingPairs.delete(pairingCode); }, EXPIRY_MS);
    pendingPairs.set(pairingCode, { resolve: () => {}, timer });
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
    return validateClient(auth.slice(7));
  }

  function extractClientToken(req: http.IncomingMessage): string | undefined {
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

  /**
   * Publish an event via NATS and SSE.
   */
  async function publishEvent(taskId: string, payload: Record<string, unknown>): Promise<void> {
    const sc = StringCodec();
    const subject = `host-event.${config.hostId}.${taskId}`;
    if (nc) {
      nc.publish(subject, sc.encode(JSON.stringify(payload)));
    }
    broadcastSseEvent({ task_id: taskId, ...payload });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const pathname = url.pathname;

    // ── Localhost-only endpoints (no auth) ─────────────────────────────

    if (req.method === "POST" && pathname === "/event") {
      if (!isLocalhost(req)) { sendJson(res, 403, { error: "localhost only" }); return; }
      try {
        const body = await readBody(req);
        const event = JSON.parse(body);
        broadcastSseEvent(event);
        sendJson(res, 200, { ok: true });
      } catch { sendJson(res, 400, { error: "Invalid JSON" }); }
      return;
    }

    if (req.method === "POST" && pathname === "/pair-register") {
      if (!isLocalhost(req)) { sendJson(res, 403, { error: "localhost only" }); return; }
      try {
        const body = await readBody(req);
        const { code, expiryMs } = JSON.parse(body) as { code: string; expiryMs: number };
        if (!code) { sendJson(res, 400, { error: "Missing code" }); return; }
        if (pendingPairs.has(code)) { sendJson(res, 409, { error: "Code already registered" }); return; }

        const result = await new Promise<{ paired: boolean }>((resolve) => {
          const timer = setTimeout(() => {
            pendingPairs.delete(code);
            resolve({ paired: false });
          }, expiryMs ?? 5 * 60 * 1000);

          pendingPairs.set(code, { resolve, timer });
          req.on("close", () => {
            if (pendingPairs.has(code)) {
              clearTimeout(timer);
              pendingPairs.delete(code);
            }
          });
        });

        sendJson(res, 200, result);
      } catch { sendJson(res, 400, { error: "Invalid JSON" }); }
      return;
    }

    // ── POST /notify — send push notification via NATS ─────────────────

    if (req.method === "POST" && pathname === "/notify") {
      if (!isLocalhost(req)) { sendJson(res, 403, { error: "localhost only" }); return; }
      if (!nc) { sendJson(res, 503, { error: "NATS not connected — push notifications require server mode" }); return; }

      try {
        const body = await readBody(req);
        const { title, body: notifBody } = JSON.parse(body) as { title: string; body: string };
        if (!title || !notifBody) { sendJson(res, 400, { error: "title and body are required" }); return; }

        const sc = StringCodec();
        const payload = { hostId: config.hostId, title, body: notifBody };
        const subject = `host.${config.hostId}.push.send`;
        const reply = await nc.request(subject, sc.encode(JSON.stringify(payload)), { timeout: 15_000 });
        const result = JSON.parse(sc.decode(reply.data)) as { ok?: boolean; error?: string };

        if (result.ok) {
          sendJson(res, 200, { ok: true });
        } else {
          sendJson(res, 502, { error: result.error ?? "Push notification failed" });
        }
      } catch (err) {
        sendJson(res, 500, { error: `Failed to send notification: ${err}` });
      }
      return;
    }

    // ── POST /request-input — held connection until user responds ────────

    if (req.method === "POST" && pathname === "/request-input") {
      if (!isLocalhost(req)) { sendJson(res, 403, { error: "localhost only" }); return; }
      try {
        const body = await readBody(req);
        const { taskId, runId, descriptions } = JSON.parse(body) as {
          taskId: string; runId?: string; descriptions: string[];
        };
        if (!taskId || !descriptions?.length) {
          sendJson(res, 400, { error: "taskId and descriptions are required" });
          return;
        }

        const taskDir = getTaskDir(config.projectRoot, taskId);
        const task = parseTaskFile(taskDir);

        // Resolve runId: use provided value, otherwise find the latest run directory
        const effectiveRunId = runId ?? findLatestRunId(taskDir);

        const pendingPromise = registerPending(taskId, "input", descriptions);

        await publishEvent(taskId, {
          event_type: "input-request",
          host_id: config.hostId,
          input_descriptions: descriptions,
          name: task.frontmatter.name,
        });

        const response = await pendingPromise;

        const questionsBlock = "\n\n" + descriptions.map((d) => `**${d}**`).join("\n");

        if (response.length === 1 && response[0] === "aborted") {
          await publishEvent(taskId, { event_type: "input-resolved", host_id: config.hostId, status: "aborted" });
          if (effectiveRunId) {
            spliceUserMessage(taskDir, effectiveRunId, { role: "user", time: Date.now(), content: "Aborted", type: "input" }, questionsBlock);
            await publishEvent(taskId, { event_type: "result-updated", run_id: effectiveRunId });
          }
          sendJson(res, 200, { aborted: true });
        } else {
          await publishEvent(taskId, { event_type: "input-resolved", host_id: config.hostId, status: "provided" });
          if (effectiveRunId) {
            spliceUserMessage(taskDir, effectiveRunId, { role: "user", time: Date.now(), content: response.join("\n"), type: "input" }, questionsBlock);
            await publishEvent(taskId, { event_type: "result-updated", run_id: effectiveRunId });
          }
          sendJson(res, 200, { values: response });
        }
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
      return;
    }

    // ── POST /request-confirmation — held connection ────────────────────

    if (req.method === "POST" && pathname === "/request-confirmation") {
      if (!isLocalhost(req)) { sendJson(res, 403, { error: "localhost only" }); return; }
      try {
        const body = await readBody(req);
        const { taskId } = JSON.parse(body) as { taskId: string };
        if (!taskId) { sendJson(res, 400, { error: "taskId is required" }); return; }

        const pendingPromise = registerPending(taskId, "confirmation");

        await publishEvent(taskId, {
          event_type: "confirm-request",
          host_id: config.hostId,
        });

        const response = await pendingPromise;
        const confirmed = response[0] === "confirmed";

        await publishEvent(taskId, {
          event_type: "confirm-resolved",
          host_id: config.hostId,
          status: confirmed ? "confirmed" : "aborted",
        });

        sendJson(res, 200, { confirmed });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
      return;
    }

    // ── POST /request-permission — held connection ──────────────────────

    if (req.method === "POST" && pathname === "/request-permission") {
      if (!isLocalhost(req)) { sendJson(res, 403, { error: "localhost only" }); return; }
      try {
        const body = await readBody(req);
        const { taskId, taskName, permissions } = JSON.parse(body) as {
          taskId: string; taskName?: string; permissions: RequiredPermission[];
        };
        if (!taskId || !permissions?.length) {
          sendJson(res, 400, { error: "taskId and permissions are required" });
          return;
        }

        const pendingPromise = registerPending(taskId, "permission", permissions);

        await publishEvent(taskId, {
          event_type: "permission-request",
          host_id: config.hostId,
          required_permissions: permissions,
          name: taskName,
        });

        const response = await pendingPromise;
        const status = response[0] as "granted" | "granted_all" | "aborted";

        await publishEvent(taskId, {
          event_type: "permission-resolved",
          host_id: config.hostId,
          status,
        });

        sendJson(res, 200, { response: status });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
      return;
    }

    // ── Public pair endpoint — no auth, PWA posts OTP code here ────────

    if (req.method === "POST" && pathname === "/pair") {
      try {
        const body = await readBody(req);
        const { code, label } = JSON.parse(body) as { code: string; label?: string };
        if (!code) { sendJson(res, 400, { error: "Missing code" }); return; }

        const pending = pendingPairs.get(code);
        if (!pending) { sendJson(res, 401, { error: "Invalid code" }); return; }

        const client = addClient(label);
        const ip = detectLanIp();
        const response: Record<string, unknown> = {
          hostId: config.hostId,
          clientToken: client.token,
          directUrl: `http://${ip}:${port}`,
        };

        clearTimeout(pending.timer);
        pendingPairs.delete(code);
        pending.resolve({ paired: true });

        sendJson(res, 200, response);
      } catch { sendJson(res, 400, { error: "Invalid JSON" }); }
      return;
    }

    // ── PWA assets (on-the-fly, cached) ────────────────────────────────

    // Skip service worker and manifest — they require HTTPS which LAN mode doesn't use
    const SKIP = new Set(["/registerSW.js", "/service-worker.js", "/manifest.webmanifest"]);

    const isApiRoute = pathname === "/events" || pathname.startsWith("/rpc/");
    if (!isApiRoute) {
      if (SKIP.has(pathname)) { sendJson(res, 404, { error: "Not found" }); return; }

      // Try exact path, then fall back to index.html (SPA routing)
      let asset = await getAsset(pathname);
      if (!asset && pathname !== "/") {
        asset = await getAsset("/");
      }

      if (asset) {
        res.writeHead(200, { "Content-Type": asset.contentType });
        res.end(asset.data);
      } else {
        sendJson(res, 502, { error: "Failed to fetch PWA assets" });
      }
      return;
    }

    // ── API endpoints require auth (localhost is trusted) ───────────────

    if (!isLocalhost(req) && !checkAuth(req)) {
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
      if (!method) { sendJson(res, 400, { error: "Missing RPC method" }); return; }

      let params: Record<string, unknown> = {};
      try {
        const body = await readBody(req);
        if (body.trim().length > 0) {
          params = JSON.parse(body);
        }
      } catch { sendJson(res, 400, { error: "Invalid JSON" }); return; }

      const clientToken = extractClientToken(req);
      console.log(`[http] RPC: ${method}`);

      try {
        const response = await handleRpc({ method, params, clientToken, localhost: isLocalhost(req) });
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
    server.listen(port, bindAddress, () => {
      console.log(`[http] Listening on ${bindAddress}:${port}`);
      onReady?.();

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
