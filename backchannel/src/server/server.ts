// Local HTTP server: hook endpoint, chat API, live stream and the built web app.
//
// Security: replies are injected into coding agents, so the API must not be reachable from other
// sites in the user's browser or from the network.
// - Listens on 127.0.0.1 only.
// - Every /api request needs the random token from <home>/server.json (header, or ?token= for the
//   event stream, which cannot set headers). The token is written with mode 0600.
// - The Host header must name this server (blocks DNS rebinding), and a browser Origin, when sent,
//   must be this server's own origin (or the Vite dev server when started with --dev).
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Store } from "../core/store.ts";
import type { AgentKind, Post, StreamMessage } from "../core/types.ts";
import type { Paths } from "./paths.ts";
import { TranscriptWatcher } from "./watch.ts";

export interface ServeOptions {
  paths: Paths;
  port?: number; // 0 picks a free port
  sinceHours?: number;
  webRoot?: string; // built web app (dist/); omitted in tests
  devOrigin?: string; // e.g. http://localhost:5173 when the UI runs under Vite
  introduce?: boolean;
  digestMs?: number;
  pollMs?: number;
  token?: string;
  only?: string[]; // only sessions whose working directory is inside one of these
  midRun?: boolean; // also hand replies over after tool calls, not only at the end of a turn
}

export function underAny(dirs: string[]): (cwd: string) => boolean {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, "").toLowerCase();
  const roots = dirs.map(norm);
  return (cwd) => {
    const c = norm(cwd);
    return roots.some((r) => c === r || c.startsWith(r + sep) || c.startsWith(`${r}/`));
  };
}

export interface Running {
  port: number;
  token: string;
  url: string;
  store: Store;
  watcher: TranscriptWatcher;
  server: Server;
  close: () => Promise<void>;
}

const MAX_BODY = 64 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("invalid JSON"), { status: 400 });
  }
}

export async function serve(opts: ServeOptions): Promise<Running> {
  const { paths } = opts;
  mkdirSync(paths.home, { recursive: true });
  const token = opts.token ?? randomBytes(24).toString("hex");
  const inboxFile = join(paths.home, "inbox.json");

  let watcher: TranscriptWatcher;
  const store = new Store({
    introduce: opts.introduce ?? true,
    digestMs: opts.digestMs,
    save: (posts: Post[]) => writeFileSync(inboxFile, JSON.stringify({ posts }, null, 1), { mode: 0o600 }),
    onTranscript: (p) => watcher?.track(p),
    accept: opts.only?.length ? underAny(opts.only) : undefined,
    delivery: opts.midRun ? "mid-run" : "turn-end",
  });
  watcher = new TranscriptWatcher({
    claudeProjects: paths.claudeProjects,
    codexSessions: paths.codexSessions,
    sinceMs: Date.now() - (opts.sinceHours ?? 24) * 3_600_000,
    pollMs: opts.pollMs,
    onEvents: (events) => {
      for (const e of events) store.ingest(e);
    },
  });
  if (existsSync(inboxFile)) {
    try {
      store.restore(JSON.parse(readFileSync(inboxFile, "utf8")).posts ?? []);
    } catch {}
  }
  await watcher.start();
  store.goLive();
  const ticker = setInterval(() => store.tick(), 1000);

  let port = 0;
  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = () => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(opts.devOrigin ? [opts.devOrigin] : [])]);
  const webRoot = opts.webRoot ? resolve(opts.webRoot) : null;
  const streams = new Set<ServerResponse>();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const host = req.headers.host ?? "";
      const devHost = opts.devOrigin ? new URL(opts.devOrigin).host : null;
      if (!allowedHosts().has(host) && host !== devHost) return send(res, 421, { error: "unexpected Host header" });
      const origin = req.headers.origin;
      if (origin && !allowedOrigins().has(origin)) return send(res, 403, { error: "cross-origin request refused" });

      if (url.pathname.startsWith("/api/")) {
        const given = req.headers["x-backchannel-token"] ?? url.searchParams.get("token");
        if (given !== token) return send(res, 401, { error: "missing or wrong token" });
        return await api(req, res, url);
      }
      return serveStatic(req, res, url);
    } catch (err: any) {
      send(res, err?.status ?? 500, { error: err?.message ?? "error" });
    }
  });

  async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
    const path = url.pathname;
    if (req.method === "POST" && path === "/api/hook") {
      const body = await readJson(req);
      const agent: AgentKind = body.agent === "codex" ? "codex" : "claude-code";
      const deliver = store.hook(agent, body.event ?? {});
      // The hook's transcript may have grown; read it before the next poll so posts stay in order.
      void watcher.readAll();
      return send(res, 200, { deliver });
    }
    if (req.method === "GET" && path === "/api/snapshot") return send(res, 200, store.snapshot());
    if (req.method === "GET" && path === "/api/usage") {
      const since = url.searchParams.get("since") ?? undefined;
      return send(res, 200, { ...store.usageReport(since), unverifiedModels: store.usage.unverifiedModels() });
    }
    if (req.method === "GET" && path === "/api/status") {
      return send(res, 200, { files: watcher.files.length, sessions: store.sessions.size, version: "0.1.0" });
    }
    const m = /^\/api\/sessions\/([^/]+)\/reply$/.exec(path);
    if (req.method === "POST" && m) {
      const body = await readJson(req);
      const id = decodeURIComponent(m[1]);
      if (!store.sessions.has(id)) return send(res, 404, { error: "unknown session" });
      if (typeof body.text !== "string" || !body.text.trim()) return send(res, 400, { error: "text is required" });
      return send(res, 200, store.reply(id, body.text));
    }
    if (req.method === "GET" && path === "/api/stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      const write = (m: StreamMessage) => res.write(`data: ${JSON.stringify(m)}\n\n`);
      write({ type: "snapshot", data: store.snapshot() });
      const off = store.subscribe(write);
      const beat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
      streams.add(res);
      req.on("close", () => {
        off();
        clearInterval(beat);
        streams.delete(res);
      });
      return;
    }
    send(res, 404, { error: "not found" });
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!webRoot) return send(res, 404, { error: "web app not built; run npm run build" });
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method not allowed" });
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    if (rel === "/app" || rel === "/app/") rel = "/app.html";
    const file = normalize(join(webRoot, rel));
    if (!file.startsWith(webRoot + sep) || !existsSync(file)) return send(res, 404, { error: "not found" });
    let body: Buffer | string = readFileSync(file);
    if (file.endsWith("app.html")) {
      // The app on this origin gets the token in a meta tag; other origins cannot read this response.
      body = body.toString("utf8").replace("</head>", `<meta name="backchannel-token" content="${token}"></head>`);
    }
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": file.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  }

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 47321, "127.0.0.1", () => ok());
  });
  port = (server.address() as { port: number }).port;
  const serverFile = join(paths.home, "server.json");
  writeFileSync(serverFile, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 });

  return {
    port,
    token,
    url: `http://127.0.0.1:${port}/app`,
    store,
    watcher,
    server,
    close: async () => {
      clearInterval(ticker);
      watcher.stop();
      for (const s of streams) s.end();
      await new Promise<void>((ok) => server.close(() => ok()));
      try {
        const cur = JSON.parse(readFileSync(serverFile, "utf8"));
        if (cur.port === port) rmSync(serverFile);
      } catch {}
    },
  };
}
