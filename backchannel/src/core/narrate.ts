// What to say out loud, in what order. Pure logic: the web app feeds posts in and plays what
// next() returns with the browser's speech engine.
//
// - Blockers and errors jump the queue and interrupt anything less important that is playing.
// - Decisions, assumptions and finished turns are spoken in order.
// - Progress digests are the first to go: dropped when stale or when the queue is full.
// - Tuned to one agent: everything from that agent, plus only urgent posts from the others.
import type { Post } from "./types.ts";

export type ListenMode = "all" | "urgent";

export interface Utterance {
  postId: string;
  sessionId: string;
  text: string;
  priority: 0 | 1 | 2; // 0 urgent, 1 notable, 2 progress
  queuedAt: number;
}

export const STALE_PROGRESS_MS = 60_000;

export function priorityOf(post: Post): 0 | 1 | 2 {
  if (post.urgent || post.kind === "blocker" || post.kind === "error") return 0;
  if (post.kind === "progress" || post.kind === "joined") return 2;
  return 1;
}

export function phrase(post: Post, speaker: string): string {
  const text = post.text.replace(/https?:\/\/\S+/g, "a link").replace(/[`*_#>]/g, "");
  if (post.kind === "blocker" || post.kind === "error") return `Heads up. ${speaker}. ${text}`;
  return `${speaker}. ${text}`;
}

export class NarrationQueue {
  private queue: Utterance[] = [];
  private playing: Utterance | null = null;
  mode: ListenMode;
  focus: string | null;
  readonly max: number;

  constructor(opts: { mode?: ListenMode; focus?: string | null; max?: number } = {}) {
    this.mode = opts.mode ?? "all";
    this.focus = opts.focus ?? null;
    this.max = opts.max ?? 6;
  }

  wants(post: Post): boolean {
    if (post.kind === "user") return false;
    const p = priorityOf(post);
    if (p === 0) return true;
    if (this.mode === "urgent") return false;
    if (this.focus && post.sessionId !== this.focus) return false;
    return true;
  }

  // Returns true when the caller should cut off what is playing now.
  enqueue(post: Post, speaker: string, now: number): boolean {
    if (!this.wants(post)) return false;
    const u: Utterance = { postId: post.id, sessionId: post.sessionId, text: phrase(post, speaker), priority: priorityOf(post), queuedAt: now };
    // Stable by priority: urgent goes ahead of notable and progress, behind earlier urgent posts.
    const at = this.queue.findIndex((q) => q.priority > u.priority);
    if (at === -1) this.queue.push(u);
    else this.queue.splice(at, 0, u);
    while (this.queue.length > this.max) {
      const drop = this.queue.map((q) => q.priority).lastIndexOf(Math.max(...this.queue.map((q) => q.priority)) as 0 | 1 | 2);
      this.queue.splice(drop, 1);
    }
    return u.priority === 0 && this.playing != null && this.playing.priority > 0;
  }

  next(now: number): Utterance | null {
    while (this.queue.length) {
      const u = this.queue.shift()!;
      if (u.priority === 2 && now - u.queuedAt > STALE_PROGRESS_MS) continue;
      this.playing = u;
      return u;
    }
    this.playing = null;
    return null;
  }

  finished(): void {
    this.playing = null;
  }

  clear(): void {
    this.queue = [];
    this.playing = null;
  }

  get pending(): readonly Utterance[] {
    return this.queue;
  }
}
