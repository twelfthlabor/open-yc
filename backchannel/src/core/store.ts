// The live state behind the chat: sessions, posts, usage and the reply inbox.
// No I/O here; the server feeds events in, persists replies through `save`, and broadcasts.
import { callSign, colorFor } from "./names.ts";
import { PostBuilder } from "./posts.ts";
import type { AgentEvent, AgentKind, Post, SessionInfo, Snapshot, StreamMessage } from "./types.ts";
import { UsageLedger } from "./usage.ts";

export const REPLY_PREFIX = "Message from the user via backchannel:";

export const INTRO =
  "This session is connected to backchannel, a local chat app the user set up to follow and steer their coding agents. " +
  `Messages the user types to this session there arrive through hooks, starting with '${REPLY_PREFIX}'. ` +
  "To help the user follow along, when you make a decision, rely on an assumption, or get blocked, say so in one line " +
  "starting with 'Decision:', 'Assumption:' or 'Blocked:'.";

// Where a queued reply can be handed over. At Stop the reply becomes the agent's next instruction,
// which agents follow reliably. Mid-run (PostToolUse) the reply arrives as context next to a tool
// result, and in live runs Claude sometimes declined it as a possible prompt injection, so it is
// opt-in (--mid-run).
export type Delivery = "turn-end" | "mid-run";

const MAX_POSTS = 3000;
const IDLE_AFTER_MS = 10 * 60_000;

export interface HookEvent {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  model?: string;
  tool_name?: string;
  tool_input?: string;
  tool_description?: string;
  notification_type?: string;
  message?: string;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
}

export interface StoreOptions {
  introduce?: boolean;
  delivery?: Delivery;
  digestMs?: number;
  now?: () => number;
  save?: (userPosts: Post[]) => void;
  onTranscript?: (path: string) => void;
  accept?: (cwd: string) => boolean; // limit the channel to some projects (--only)
}

export class Store {
  readonly sessions = new Map<string, SessionInfo>();
  readonly posts: Post[] = [];
  readonly usage = new UsageLedger();
  private builder: PostBuilder;
  private inbox = new Map<string, string[]>(); // session -> queued user post ids
  private listeners = new Set<(m: StreamMessage) => void>();
  private opts: Required<Pick<StoreOptions, "introduce" | "now">> & StoreOptions;
  private live = false; // false while the initial backlog loads
  private ignored = new Set<string>(); // sessions outside the --only directories

  constructor(opts: StoreOptions = {}) {
    this.opts = { introduce: true, now: Date.now, ...opts };
    this.builder = new PostBuilder({ digestMs: opts.digestMs });
  }

  subscribe(fn: (m: StreamMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(m: StreamMessage): void {
    if (!this.live) return;
    for (const fn of this.listeners) fn(m);
  }

  goLive(): void {
    for (const p of this.builder.flush(this.opts.now())) this.addPost(p);
    this.live = true;
  }

  private session(id: string, agent: AgentKind, ts: string): SessionInfo {
    let s = this.sessions.get(id);
    if (!s) {
      const taken = new Set([...this.sessions.values()].map((x) => x.name));
      s = {
        id,
        agent,
        name: callSign(id, taken),
        color: colorFor(id),
        cwd: "",
        project: "",
        startedAt: ts,
        lastActivity: ts,
        status: "working",
        hooked: false,
        introduced: false,
        tokens: 0,
        costUsd: 0,
      };
      this.sessions.set(id, s);
    }
    return s;
  }

  private addPost(p: Post): void {
    this.posts.push(p);
    if (this.posts.length > MAX_POSTS) this.posts.splice(0, this.posts.length - MAX_POSTS);
    this.emit({ type: "post", data: p });
  }

  ingest(ev: AgentEvent): void {
    if (this.ignored.has(ev.sessionId)) return;
    const known = this.sessions.get(ev.sessionId);
    if (ev.kind === "session") {
      if (ev.cwd && this.opts.accept && !this.opts.accept(ev.cwd)) {
        this.ignored.add(ev.sessionId);
        this.sessions.delete(ev.sessionId);
        return;
      }
      const s = this.session(ev.sessionId, ev.agent, ev.ts);
      const isNew = !s.cwd && !!ev.cwd;
      if (ev.cwd) {
        s.cwd = ev.cwd;
        s.project = ev.cwd.split(/[\\/]/).filter(Boolean).pop() ?? ev.cwd;
      }
      if (ev.model) s.model = ev.model;
      if (ev.branch) s.branch = ev.branch;
      if (ev.title) s.title = ev.title;
      if (isNew) {
        const where = s.branch && s.branch !== "HEAD" ? `${s.project} (${s.branch})` : s.project;
        this.addPost({ id: `j-${s.id}`, sessionId: s.id, ts: ev.ts, kind: "joined", text: `Joined from ${where}.`, urgent: false });
      }
      this.emit({ type: "session", data: this.view(s) });
      return;
    }
    if (!known) return; // events before the session record are dropped
    if (ev.ts > known.lastActivity) known.lastActivity = ev.ts;
    if (ev.kind === "prompt" && !known.firstPrompt) known.firstPrompt = ev.text.slice(0, 300);
    if (ev.kind === "usage" || ev.kind === "tool" || ev.kind === "tool_result") {
      this.usage.add(ev);
      if (ev.kind === "usage") {
        const t = this.usage.sessionTotals(known.id);
        known.tokens = t.tokens;
        known.costUsd = t.costUsd;
      }
    }
    const before = known.status;
    if (ev.kind === "turn_end") known.status = "idle";
    else if (ev.kind === "attention") known.status = "blocked";
    else if (ev.kind === "tool" || ev.kind === "prompt" || (ev.kind === "text" && !ev.final)) known.status = "working";
    for (const p of this.builder.ingest(ev)) {
      if (p.kind === "blocker") known.status = "blocked";
      this.addPost(p);
    }
    if (known.status !== before || ev.kind === "usage") this.emit({ type: "session", data: this.view(known) });
  }

  tick(): void {
    for (const p of this.builder.flush(this.opts.now())) this.addPost(p);
  }

  // A hook call from a running agent. Returns the text to hand back to the agent, if any.
  hook(agent: AgentKind, ev: HookEvent): string | null {
    const id = ev.session_id;
    if (!id) return null;
    const ts = new Date(this.opts.now()).toISOString();
    if (!this.sessions.has(id)) this.ingest({ kind: "session", sessionId: id, agent, ts, cwd: ev.cwd, model: ev.model });
    const s = this.sessions.get(id);
    if (!s) return null; // outside --only
    if (!s.hooked) {
      s.hooked = true;
      this.emit({ type: "session", data: this.view(s) });
    }
    if (ev.transcript_path) this.opts.onTranscript?.(ev.transcript_path);

    const name = ev.hook_event_name;
    if (name === "Notification") {
      if (ev.notification_type === "permission_prompt") this.ingest({ kind: "attention", sessionId: id, ts, reason: "approval", text: ev.message ?? "permission prompt" });
      else if (ev.notification_type === "idle_prompt" || ev.notification_type === "agent_needs_input") this.ingest({ kind: "attention", sessionId: id, ts, reason: "waiting", text: ev.message ?? "waiting for input" });
      return null;
    }
    if (name === "PermissionRequest") {
      this.ingest({ kind: "attention", sessionId: id, ts, reason: "approval", text: `${ev.tool_name ?? "tool"}: ${ev.tool_description ?? ev.tool_input ?? ""}`.trim() });
      return null;
    }
    if (name === "SessionStart") {
      const parts: string[] = [];
      if (this.opts.introduce) {
        s.introduced = true;
        parts.push(INTRO);
      }
      const queued = this.take(id, "SessionStart");
      if (queued) parts.push(queued);
      return parts.join("\n\n") || null;
    }
    if (name === "PostToolUse") return this.opts.delivery === "mid-run" && s.introduced ? this.take(id, "PostToolUse") : null;
    if (name === "Stop" || name === "UserPromptSubmit") return this.take(id, name);
    return null;
  }

  // Queued replies for a session, joined into one message, marked delivered.
  private take(sessionId: string, via: string): string | null {
    const ids = this.inbox.get(sessionId);
    if (!ids?.length) return null;
    this.inbox.delete(sessionId);
    const at = new Date(this.opts.now()).toISOString();
    const texts: string[] = [];
    for (const pid of ids) {
      const p = this.posts.find((x) => x.id === pid);
      if (!p) continue;
      texts.push(p.text);
      p.delivery = { state: "delivered", at, via };
      this.emit({ type: "post_update", data: p });
    }
    this.persist();
    if (!texts.length) return null;
    return texts.map((t) => `${REPLY_PREFIX} ${t}`).join("\n\n");
  }

  reply(sessionId: string, text: string): Post {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error("unknown session");
    const clean = text.replace(/\s+$/g, "").slice(0, 4000);
    if (!clean.trim()) throw new Error("empty reply");
    const p: Post = {
      id: `u${this.opts.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      ts: new Date(this.opts.now()).toISOString(),
      kind: "user",
      text: clean,
      urgent: false,
      delivery: { state: "queued" },
    };
    const list = this.inbox.get(sessionId) ?? [];
    list.push(p.id);
    this.inbox.set(sessionId, list);
    this.addPost(p);
    this.persist();
    return p;
  }

  // Replies saved by an earlier run; queued ones go back in the inbox.
  restore(userPosts: Post[]): void {
    for (const p of userPosts) {
      if (this.posts.some((x) => x.id === p.id)) continue;
      this.posts.push(p);
      if (p.delivery?.state === "queued") {
        const list = this.inbox.get(p.sessionId) ?? [];
        list.push(p.id);
        this.inbox.set(p.sessionId, list);
      }
    }
    this.posts.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  private persist(): void {
    this.opts.save?.(this.posts.filter((p) => p.kind === "user"));
  }

  view(s: SessionInfo): SessionInfo {
    const quiet = this.opts.now() - Date.parse(s.lastActivity) > IDLE_AFTER_MS;
    return { ...s, status: quiet && s.status === "working" ? "idle" : s.status };
  }

  snapshot(limit = 600): Snapshot {
    const sessions = [...this.sessions.values()].filter((s) => s.cwd).map((s) => this.view(s));
    sessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    return { sessions, posts: this.posts.slice(-limit) };
  }

  usageReport(since?: string) {
    return this.usage.report({ since, sessionLabel: (id) => {
      const s = this.sessions.get(id);
      return s ? `${s.name} · ${s.project || id.slice(0, 8)}` : id.slice(0, 8);
    } });
  }
}
