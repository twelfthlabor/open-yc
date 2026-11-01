import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Post, StreamMessage } from "../src/core/types.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { serve, type Running } from "../src/server/server.ts";
import { SID, claudeAssistant, claudeUser } from "./fixtures.ts";

let dir: string;
let run: Running;
let transcript: string;

function raw(path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port: run.port, path, method: opts.method ?? "GET", headers: opts.headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", fail);
    req.end(opts.body);
  });
}

const api = (path: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${run.port}${path}`, { ...init, headers: { "content-type": "application/json", "x-backchannel-token": run.token, ...(init.headers ?? {}) } });

async function until<T>(fn: () => T | Promise<T>, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 30));
  }
}

const line = (rec: unknown) => appendFileSync(transcript, `${JSON.stringify(rec)}\n`);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "bc-server-"));
  const env = { BACKCHANNEL_HOME: join(dir, "bc"), CLAUDE_CONFIG_DIR: join(dir, "claude"), CODEX_HOME: join(dir, "codex") };
  const paths = resolvePaths(env, dir);
  mkdirSync(join(paths.claudeProjects, "proj"), { recursive: true });
  mkdirSync(paths.codexSessions, { recursive: true });
  transcript = join(paths.claudeProjects, "proj", `${SID}.jsonl`);
  line(claudeUser("Add a health check"));
  const web = join(dir, "web");
  mkdirSync(web);
  writeFileSync(join(web, "app.html"), "<html><head></head><body>app</body></html>");
  writeFileSync(join(web, "index.html"), "<html><head></head><body>home</body></html>");
  writeFileSync(join(dir, "secret.txt"), "do not serve");
  run = await serve({ paths, port: 0, pollMs: 40, digestMs: 150, webRoot: web });
});

afterEach(async () => {
  await run.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("security", () => {
  it("writes the token file and requires the token on every API route", async () => {
    const file = JSON.parse(readFileSync(join(dir, "bc", "server.json"), "utf8"));
    expect(file).toMatchObject({ port: run.port, token: run.token });
    expect((await fetch(`http://127.0.0.1:${run.port}/api/snapshot`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${run.port}/api/snapshot`, { headers: { "x-backchannel-token": "nope" } })).status).toBe(401);
    expect((await api("/api/snapshot")).status).toBe(200);
  });

  it("refuses a foreign Host header (DNS rebinding) and a foreign Origin", async () => {
    expect((await raw("/api/snapshot", { headers: { host: "evil.example:80", "x-backchannel-token": run.token } })).status).toBe(421);
    const r = await raw(`/api/sessions/${SID}/reply`, { method: "POST", headers: { host: `127.0.0.1:${run.port}`, origin: "https://evil.example", "content-type": "application/json", "x-backchannel-token": run.token }, body: JSON.stringify({ text: "rm -rf /" }) });
    expect(r.status).toBe(403);
    expect((await raw("/", { headers: { host: `localhost:${run.port}` } })).status).toBe(200);
  });

  it("injects the token only into the app page and does not serve files outside the web root", async () => {
    const app = await raw("/app", { headers: { host: `127.0.0.1:${run.port}` } });
    expect(app.body).toContain(`<meta name="backchannel-token" content="${run.token}">`);
    const home = await raw("/", { headers: { host: `127.0.0.1:${run.port}` } });
    expect(home.body).not.toContain(run.token);
    expect((await raw("/../secret.txt", { headers: { host: `127.0.0.1:${run.port}` } })).status).toBe(404);
    expect((await raw("/%2e%2e/secret.txt", { headers: { host: `127.0.0.1:${run.port}` } })).status).toBe(404);
  });

  it("rejects oversized and malformed bodies", async () => {
    expect((await api("/api/hook", { method: "POST", body: "x".repeat(70 * 1024) })).status).toBe(413);
    expect((await api("/api/hook", { method: "POST", body: "{not json" })).status).toBe(400);
  });
});

describe("chat", () => {
  it("builds sessions and posts from transcripts, including lines appended later", async () => {
    const snap = await (await api("/api/snapshot")).json();
    expect(snap.sessions[0]).toMatchObject({ id: SID, project: "shop-api", agent: "claude-code" });
    line(claudeAssistant("m1", [{ type: "text", text: "Decision: return 503 when the DB is down." }], 1));
    line(claudeAssistant("m2", [{ type: "text", text: "Added /health." }], 2, { stop: "end_turn" }));
    const posts: Post[] = await until(async () => {
      const s = await (await api("/api/snapshot")).json();
      return s.posts.some((p: Post) => p.kind === "done") && s.posts;
    });
    expect(posts.map((p) => p.kind)).toEqual(["joined", "progress", "decision", "done"]);
    const usage = await (await api("/api/usage")).json();
    expect(usage.totals.total).toBe(2 * (10 + 100 + 1000 + 500));
  });

  it("streams new posts over server-sent events", async () => {
    const res = await fetch(`http://127.0.0.1:${run.port}/api/stream?token=${run.token}`);
    const reader = res.body!.getReader();
    const seen: StreamMessage[] = [];
    let buf = "";
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += new TextDecoder().decode(value);
        for (const chunk of buf.split("\n\n").slice(0, -1)) if (chunk.startsWith("data: ")) seen.push(JSON.parse(chunk.slice(6)));
        buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
      }
    })();
    await until(() => seen.some((m) => m.type === "snapshot"));
    line(claudeAssistant("m9", [{ type: "text", text: "Blocked: the DB URL is not set." }], 3));
    const p = await until(() => seen.find((m) => m.type === "post" && m.data.kind === "blocker"));
    expect(p).toMatchObject({ data: { urgent: true, text: "the DB URL is not set." } });
    await reader.cancel();
    await pump.catch(() => {});
  });

  it("queues a reply and hands it to the agent on its next hook call, once", async () => {
    const hook = (event: object) => api("/api/hook", { method: "POST", body: JSON.stringify({ agent: "claude-code", event: { session_id: SID, ...event } }) }).then((r) => r.json());
    const reply = await (await api(`/api/sessions/${SID}/reply`, { method: "POST", body: JSON.stringify({ text: "Use port 8080." }) })).json();
    expect(reply).toMatchObject({ kind: "user", delivery: { state: "queued" } });
    // A session started before backchannel was introduced gets nothing mid-run...
    expect(await hook({ hook_event_name: "PostToolUse", tool_name: "Bash" })).toEqual({ deliver: null });
    // ...and the reply at the end of its turn.
    expect(await hook({ hook_event_name: "Stop" })).toEqual({ deliver: "Message from the user via backchannel: Use port 8080." });
    expect(await hook({ hook_event_name: "Stop" })).toEqual({ deliver: null });
    const snap = await (await api("/api/snapshot")).json();
    expect(snap.posts.find((p: Post) => p.id === reply.id).delivery).toMatchObject({ state: "delivered", via: "Stop" });
    // persisted for the next run
    const saved = JSON.parse(readFileSync(join(dir, "bc", "inbox.json"), "utf8"));
    expect(saved.posts[0]).toMatchObject({ id: reply.id, delivery: { state: "delivered" } });
  });

  it("introduces itself at SessionStart, and by default holds replies until the end of the turn", async () => {
    const hook = (event: object) => api("/api/hook", { method: "POST", body: JSON.stringify({ agent: "claude-code", event: { session_id: SID, ...event } }) }).then((r) => r.json());
    const start = await hook({ hook_event_name: "SessionStart", source: "startup" });
    expect(start.deliver).toContain("This session is connected to backchannel");
    await api(`/api/sessions/${SID}/reply`, { method: "POST", body: JSON.stringify({ text: "Also update the README." }) });
    expect((await hook({ hook_event_name: "PostToolUse" })).deliver).toBeNull();
    expect((await hook({ hook_event_name: "Stop" })).deliver).toBe("Message from the user via backchannel: Also update the README.");
  });

  it("with --mid-run, hands a reply to an introduced session after its next tool call", async () => {
    const paths = resolvePaths({ BACKCHANNEL_HOME: join(dir, "bc3"), CLAUDE_CONFIG_DIR: join(dir, "claude"), CODEX_HOME: join(dir, "codex") }, dir);
    const mid = await serve({ paths, port: 0, pollMs: 40, midRun: true });
    try {
      const s = mid.store;
      expect(s.hook("claude-code", { session_id: "m1", hook_event_name: "SessionStart", cwd: "/w" })).toContain("backchannel");
      s.reply("m1", "Use port 8080.");
      expect(s.hook("claude-code", { session_id: "m1", hook_event_name: "PostToolUse" })).toBe("Message from the user via backchannel: Use port 8080.");
      // a session that started before backchannel (never introduced) still waits for Stop
      s.hook("claude-code", { session_id: "m2", hook_event_name: "PostToolUse", cwd: "/w" });
      s.reply("m2", "hi");
      expect(s.hook("claude-code", { session_id: "m2", hook_event_name: "PostToolUse" })).toBeNull();
      expect(s.hook("claude-code", { session_id: "m2", hook_event_name: "Stop" })).toBe("Message from the user via backchannel: hi");
    } finally {
      await mid.close();
    }
  });

  it("turns permission prompts into urgent blockers", async () => {
    await api("/api/hook", { method: "POST", body: JSON.stringify({ agent: "claude-code", event: { session_id: SID, hook_event_name: "Notification", notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" } }) });
    const snap = await (await api("/api/snapshot")).json();
    expect(snap.posts.at(-1)).toMatchObject({ kind: "blocker", urgent: true, text: "Needs your approval: Claude needs your permission to use Bash" });
    expect(snap.sessions[0].status).toBe("blocked");
  });

  it("with --only, leaves out sessions from other directories, including their hooks", async () => {
    const paths = resolvePaths({ BACKCHANNEL_HOME: join(dir, "bc2"), CLAUDE_CONFIG_DIR: join(dir, "claude"), CODEX_HOME: join(dir, "codex") }, dir);
    const scoped = await serve({ paths, port: 0, pollMs: 40, only: [join(dir, "elsewhere")] });
    try {
      expect(scoped.store.snapshot().sessions).toEqual([]);
      expect(scoped.store.hook("claude-code", { session_id: SID, hook_event_name: "SessionStart", cwd: "/home/dev/projects/shop-api" })).toBeNull();
      expect(scoped.store.hook("claude-code", { session_id: "in", hook_event_name: "SessionStart", cwd: join(dir, "elsewhere", "app") })).toContain("backchannel");
      expect(scoped.store.snapshot().sessions.map((s) => s.id)).toEqual(["in"]);
    } finally {
      await scoped.close();
    }
  });

  it("refuses replies to unknown sessions and empty replies", async () => {
    expect((await api("/api/sessions/nope/reply", { method: "POST", body: JSON.stringify({ text: "hi" }) })).status).toBe(404);
    expect((await api(`/api/sessions/${SID}/reply`, { method: "POST", body: JSON.stringify({ text: "  " }) })).status).toBe(400);
  });
});
