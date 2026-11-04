// Tails Claude Code and Codex transcript files. Polls instead of fs.watch: watch events are
// unreliable for appends on Windows and network drives, and a 1 s poll of a few open files is cheap.
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { newClaudeState, parseClaude, type ClaudeState } from "../core/claude.ts";
import { newCodexState, parseCodex, type CodexState } from "../core/codex.ts";
import type { AgentEvent, AgentKind } from "../core/types.ts";

interface Tail {
  path: string;
  agent: AgentKind;
  offset: number;
  claude?: ClaudeState;
  codex?: CodexState;
}

export interface WatchOptions {
  claudeProjects: string;
  codexSessions: string;
  sinceMs: number; // ignore files not modified since
  onEvents: (events: AgentEvent[]) => void;
  pollMs?: number;
  rescanMs?: number;
}

async function list(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function recent(path: string, sinceMs: number): Promise<boolean> {
  try {
    return (await stat(path)).mtimeMs >= sinceMs;
  } catch {
    return false;
  }
}

export class TranscriptWatcher {
  private tails = new Map<string, Tail>();
  private timers: NodeJS.Timeout[] = [];
  private busy = false;
  private opts: WatchOptions;
  constructor(opts: WatchOptions) {
    this.opts = opts;
  }

  async discover(): Promise<void> {
    const { claudeProjects, codexSessions, sinceMs } = this.opts;
    for (const project of await list(claudeProjects)) {
      const dir = join(claudeProjects, project);
      for (const f of await list(dir)) {
        if (f.endsWith(".jsonl")) await this.consider(join(dir, f), "claude-code", sinceMs);
      }
    }
    // sessions/YYYY/MM/DD/rollout-*.jsonl; only walk the days that can hold recent files.
    const sinceDay = new Date(sinceMs - 86_400_000).toISOString().slice(0, 10);
    for (const y of await list(codexSessions)) {
      for (const m of await list(join(codexSessions, y))) {
        for (const d of await list(join(codexSessions, y, m))) {
          if (`${y}-${m}-${d}` < sinceDay) continue;
          const dir = join(codexSessions, y, m, d);
          for (const f of await list(dir)) {
            if (f.startsWith("rollout-") && f.endsWith(".jsonl")) await this.consider(join(dir, f), "codex", sinceMs);
          }
        }
      }
    }
  }

  private async consider(path: string, agent: AgentKind, sinceMs: number): Promise<void> {
    if (this.tails.has(path)) return;
    if (!(await recent(path, sinceMs))) return;
    this.track(path, agent);
  }

  // Start tailing a file now, e.g. the transcript_path a hook just reported.
  track(path: string, agent?: AgentKind): void {
    if (this.tails.has(path)) return;
    const kind: AgentKind = agent ?? (/[\\/]\.codex[\\/]|rollout-/.test(path) ? "codex" : "claude-code");
    this.tails.set(path, { path, agent: kind, offset: 0, claude: kind === "claude-code" ? newClaudeState() : undefined, codex: kind === "codex" ? newCodexState() : undefined });
  }

  async readAll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const t of this.tails.values()) await this.read(t);
    } finally {
      this.busy = false;
    }
  }

  private async read(t: Tail): Promise<void> {
    let size: number;
    try {
      size = (await stat(t.path)).size;
    } catch {
      return;
    }
    if (size < t.offset) t.offset = 0; // rewritten or truncated: start over
    if (size === t.offset) return;
    const fh = await open(t.path, "r");
    try {
      const buf = Buffer.alloc(size - t.offset);
      await fh.read(buf, 0, buf.length, t.offset);
      // Consume only complete lines, so a line (or a multi-byte character) still being written
      // is read whole on the next poll.
      const end = buf.lastIndexOf(0x0a);
      if (end === -1) return;
      t.offset += end + 1;
      const lines = buf.subarray(0, end).toString("utf8").split("\n");
      const events: AgentEvent[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        let rec: unknown;
        try {
          rec = JSON.parse(line.replace(/^\uFEFF/, ""));
        } catch {
          continue;
        }
        events.push(...(t.agent === "codex" ? parseCodex(rec as Record<string, unknown>, t.codex!) : parseClaude(rec as Record<string, unknown>, t.claude!)));
      }
      if (events.length) this.opts.onEvents(events);
    } finally {
      await fh.close();
    }
  }

  async start(): Promise<void> {
    await this.discover();
    await this.readAll();
    this.timers.push(setInterval(() => void this.readAll(), this.opts.pollMs ?? 1000));
    this.timers.push(setInterval(() => void this.discover(), this.opts.rescanMs ?? 5000));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  get files(): string[] {
    return [...this.tails.keys()];
  }
}
