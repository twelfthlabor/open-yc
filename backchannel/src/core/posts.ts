// Turns the raw event stream into chat posts that are worth reading or hearing.
//
// - Blockers, errors, decisions, assumptions and finished turns post immediately.
// - Everything else (tool calls, edits, commands, running commentary) is folded into one progress
//   digest per agent, posted when the digest window closes or before the next immediate post.
// - The same text from the same agent is not posted twice within DEDUPE_MS.
import { baseName, firstLine, isTestCommand, testFailure } from "./tools.ts";
import type { AgentEvent, Post, PostKind } from "./types.ts";

export const DIGEST_MS = 20_000;
const DEDUPE_MS = 10 * 60_000;
const STUCK_AFTER = 3; // failed tool calls in a row

interface Digest {
  since: string;
  tools: number;
  files: string[];
  commands: string[];
  mcp: Set<string>;
  errors: number;
  testsPassed: boolean;
  narration?: string;
}

interface AgentState {
  digest?: Digest;
  tools: Map<string, { summary: string; test: boolean }>;
  failedInRow: number;
  recent: Map<string, number>; // text -> ms posted
}

// "Decision: …", "Assumption: …", "Blocked: …", "Question: …" lines. Agents are asked to use these
// tags by the SessionStart note the hook adds; untagged text still goes through the heuristics.
const TAG = /^\s*(?:[-*]\s*)?\**(decision|assumption|assuming|blocked|blocker|question)\**\s*[:—-]\s*(.+)$/i;
const DECISION = /\b(I(?:'ll| will) go with|I(?:'ve)? decided to|decided to|I chose|I'm choosing|opting for|going with)\b/i;
const ASSUMPTION = /\b(I(?:'ll| will)? assume|I'm assuming|assuming that|my assumption is)\b/i;

// Markdown the agents write, reduced to what reads well in a chat line and out loud.
export function plain(text: string): string {
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*|__|^#+\s*/gm, "");
}

export function sentences(text: string): string[] {
  return plain(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function listFiles(files: string[]): string {
  const names = [...new Set(files.map(baseName))];
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

export function digestText(d: Digest): string {
  const parts: string[] = [];
  if (d.files.length) parts.push(`edited ${listFiles(d.files)}`);
  // "Run the tests" reads as "ran run the tests"; keep proper nouns and commands as they are.
  const cmds = d.commands.filter(Boolean).map((c) => (/^[A-Z][a-z]/.test(c) ? c[0].toLowerCase() + c.slice(1) : c));
  if (cmds.length) parts.push(`ran ${cmds.slice(0, 2).map((c) => clip(c, 60)).join("; ")}${cmds.length > 2 ? ` and ${cmds.length - 2} more` : ""}`);
  if (d.mcp.size) parts.push(`used ${[...d.mcp].join(", ")} over MCP`);
  if (d.testsPassed) parts.push("tests passed");
  if (d.errors) parts.push(`${d.errors} failed call${d.errors > 1 ? "s" : ""}`);
  const activity = parts.join(", ");
  if (d.narration && activity) return `${d.narration} (${activity})`;
  if (d.narration) return d.narration;
  if (activity) return activity[0].toUpperCase() + activity.slice(1) + ".";
  return `${d.tools} tool call${d.tools === 1 ? "" : "s"}.`;
}

export class PostBuilder {
  private agents = new Map<string, AgentState>();
  private seq = 0;
  private readonly digestMs: number;
  private readonly newId: () => string;

  constructor(opts: { digestMs?: number; newId?: () => string } = {}) {
    this.digestMs = opts.digestMs ?? DIGEST_MS;
    this.newId = opts.newId ?? (() => `p${Date.now().toString(36)}${(this.seq++).toString(36)}`);
  }

  private state(sessionId: string): AgentState {
    let s = this.agents.get(sessionId);
    if (!s) {
      s = { tools: new Map(), failedInRow: 0, recent: new Map() };
      this.agents.set(sessionId, s);
    }
    return s;
  }

  private post(sessionId: string, ts: string, kind: PostKind, text: string, urgent = false): Post[] {
    const s = this.state(sessionId);
    const key = `${kind}:${text}`;
    const now = Date.parse(ts) || 0;
    const last = s.recent.get(key);
    if (last != null && now - last < DEDUPE_MS) return [];
    s.recent.set(key, now);
    if (s.recent.size > 200) s.recent.delete(s.recent.keys().next().value!);
    return [{ id: this.newId(), sessionId, ts, kind, text, urgent }];
  }

  private digest(sessionId: string, ts: string): Digest {
    const s = this.state(sessionId);
    if (!s.digest) s.digest = { since: ts, tools: 0, files: [], commands: [], mcp: new Set(), errors: 0, testsPassed: false };
    return s.digest;
  }

  // Close this agent's open digest, if any, as a progress post.
  private closeDigest(sessionId: string, ts: string): Post[] {
    const s = this.state(sessionId);
    const d = s.digest;
    s.digest = undefined;
    if (!d || (d.tools === 0 && !d.narration)) return [];
    return this.post(sessionId, ts, "progress", digestText(d));
  }

  // Digests whose window has elapsed.
  flush(nowMs: number): Post[] {
    const out: Post[] = [];
    for (const [sessionId, s] of this.agents) {
      if (s.digest && nowMs - Date.parse(s.digest.since) >= this.digestMs) out.push(...this.closeDigest(sessionId, new Date(nowMs).toISOString()));
    }
    return out;
  }

  ingest(ev: AgentEvent): Post[] {
    const { sessionId, ts } = ev;
    const s = this.state(sessionId);
    switch (ev.kind) {
      case "prompt":
        return [...this.closeDigest(sessionId, ts), ...this.post(sessionId, ts, "progress", `Picked up a new task: ${clip(plain(firstLine(ev.text, 400)), 160)}`)];
      case "text": {
        const out: Post[] = [];
        let rest: string[] = [];
        for (const line of ev.text.split(/\r?\n/)) {
          const m = TAG.exec(line);
          if (!m) {
            rest.push(line);
            continue;
          }
          const tag = m[1].toLowerCase();
          const kind: PostKind = tag.startsWith("decision") ? "decision" : tag.startsWith("assum") ? "assumption" : "blocker";
          const body = clip(plain(m[2]), 280);
          out.push(...this.closeDigest(sessionId, ts), ...this.post(sessionId, ts, kind, tag === "question" ? `Question: ${body}` : body, kind === "blocker"));
        }
        if (ev.final) return out; // the final message is posted by turn_end
        for (const sentence of sentences(rest.join("\n"))) {
          if (DECISION.test(sentence)) out.push(...this.closeDigest(sessionId, ts), ...this.post(sessionId, ts, "decision", clip(sentence, 280)));
          else if (ASSUMPTION.test(sentence)) out.push(...this.closeDigest(sessionId, ts), ...this.post(sessionId, ts, "assumption", clip(sentence, 280)));
        }
        const first = sentences(rest.join("\n"))[0];
        if (first) this.digest(sessionId, ts).narration = clip(first, 200);
        return out;
      }
      case "tool": {
        const d = this.digest(sessionId, ts);
        d.tools++;
        if (ev.files.length) d.files.push(...ev.files);
        else if (ev.mcpServer) d.mcp.add(ev.mcpServer);
        else if (/^(Bash|PowerShell|shell|exec_command|local_shell)$/.test(ev.name)) d.commands.push(ev.summary);
        s.tools.set(ev.id, { summary: ev.summary, test: isTestCommand(`${ev.command ?? ""} ${ev.summary}`) });
        if (s.tools.size > 500) s.tools.delete(s.tools.keys().next().value!);
        return [];
      }
      case "tool_result": {
        const call = s.tools.get(ev.id);
        const failLine = call?.test ? testFailure(ev.sample ?? ev.excerpt) : null;
        if (failLine && !ev.isError) ev = { ...ev, isError: true, excerpt: failLine };
        else if (failLine) ev = { ...ev, excerpt: failLine };
        if (!ev.isError) {
          s.failedInRow = 0;
          if (call?.test) this.digest(sessionId, ts).testsPassed = true;
          return [];
        }
        s.failedInRow++;
        const what = call?.summary ?? "a tool call";
        if (call?.test) {
          // The error post says it; don't also list the failing run in the digest.
          const d = s.digest;
          const i = d ? d.commands.lastIndexOf(call.summary) : -1;
          if (d && i !== -1) {
            d.commands.splice(i, 1);
            d.tools--;
          }
          return [...this.closeDigest(sessionId, ts), ...this.post(sessionId, ts, "error", `Tests are failing: ${clip(ev.excerpt || what, 200)}`, true)];
        }
        if (s.failedInRow === STUCK_AFTER) {
          return [...this.closeDigest(sessionId, ts), ...this.post(sessionId, ts, "blocker", `Might be stuck: ${STUCK_AFTER} failed calls in a row. Last: ${clip(what, 80)}${ev.excerpt ? ` — ${clip(ev.excerpt, 120)}` : ""}`, true)];
        }
        this.digest(sessionId, ts).errors++;
        return [];
      }
      case "attention": {
        const text = ev.reason === "approval" ? `Needs your approval: ${clip(ev.text, 200)}` : ev.reason === "question" ? `Asks: ${clip(ev.text, 240)}` : `Waiting for you: ${clip(ev.text, 200)}`;
        return [...this.closeDigest(sessionId, ts), ...this.post(sessionId, ts, "blocker", text, true)];
      }
      case "turn_end": {
        // Tagged lines were already posted on their own.
        const untagged = (ev.text ?? "").split(/\r?\n/).filter((l) => !TAG.test(l)).join("\n");
        const summary = sentences(untagged).slice(0, 2).join(" ");
        const out = this.closeDigest(sessionId, ts);
        s.failedInRow = 0;
        return [...out, ...this.post(sessionId, ts, "done", summary ? `Done: ${clip(summary, 280)}` : "Finished its turn.")];
      }
      default:
        return [];
    }
  }
}
