// Where the console gets its data: the local backchannel server, or (hosted demo and landing
// page) a replay of a recorded run.
import type { Post, SessionInfo, Snapshot, StreamMessage, UsageReport } from "../../src/core/types.ts";

export type { Post, SessionInfo, Snapshot, StreamMessage, UsageReport };
export type Status = "connecting" | "live" | "offline" | "replay";
export type Usage = UsageReport & { unverifiedModels: string[] };

export interface Source {
  demo: boolean;
  connect(onMessage: (m: StreamMessage) => void, onStatus: (s: Status) => void): () => void;
  reply(sessionId: string, text: string): Promise<Post>;
  usage(days: number): Promise<Usage>;
}

declare const __DEMO__: boolean;
export const IS_DEMO = typeof __DEMO__ !== "undefined" && __DEMO__;

function token(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="backchannel-token"]')?.content;
  if (meta) return meta;
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("token");
  if (fromHash) {
    try {
      sessionStorage.setItem("backchannel-token", fromHash);
    } catch {}
    history.replaceState(null, "", location.pathname + location.search);
    return fromHash;
  }
  try {
    return sessionStorage.getItem("backchannel-token") ?? "";
  } catch {
    return "";
  }
}

export function liveSource(): Source {
  const t = token();
  const headers = { "content-type": "application/json", "x-backchannel-token": t };
  return {
    demo: false,
    connect(onMessage, onStatus) {
      onStatus("connecting");
      const es = new EventSource(`/api/stream?token=${encodeURIComponent(t)}`);
      es.onopen = () => onStatus("live");
      es.onerror = () => onStatus("offline");
      es.onmessage = (e) => onMessage(JSON.parse(e.data));
      return () => es.close();
    },
    async reply(sessionId, text) {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/reply`, { method: "POST", headers, body: JSON.stringify({ text }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `reply failed (${res.status})`);
      return body;
    },
    async usage(days) {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const res = await fetch(`/api/usage?since=${encodeURIComponent(since)}`, { headers });
      if (!res.ok) throw new Error(`usage failed (${res.status})`);
      return res.json();
    },
  };
}

export interface Recording {
  recordedAt: string;
  note: string;
  sessions: SessionInfo[];
  posts: Post[];
  usage: Usage;
}

let recording: Promise<Recording> | null = null;
export function loadRecording(): Promise<Recording> {
  recording ??= fetch("/demo/run.json").then((r) => {
    if (!r.ok) throw new Error("recording not found");
    return r.json();
  });
  return recording;
}

// Replays a recording in real order with shortened gaps, then starts over.
// - skip: post kinds to leave out (the landing page drops "joined"; its chips already say who is on).
// - prefill: show everything before the first urgent post at once, so a visitor lands on the
//   failing test or blocker instead of waiting through the warm-up.
export function replaySource(opts: { speed?: number; loop?: boolean; skip?: Post["kind"][]; prefill?: boolean } = {}): Source {
  const speed = opts.speed ?? 1;
  return {
    demo: true,
    connect(onMessage, onStatus) {
      let stopped = false;
      let timer: number | undefined;
      onStatus("replay");
      void loadRecording().then((rec) => {
        const posts = [...rec.posts].filter((p) => !opts.skip?.includes(p.kind)).sort((a, b) => a.ts.localeCompare(b.ts));
        const firstUrgent = opts.prefill ? Math.max(0, posts.findIndex((p) => p.urgent)) : 0;
        const run = () => {
          if (stopped) return;
          const sessions: SessionInfo[] = rec.sessions.map((s) => ({ ...s, status: "working" }));
          const base = Date.now();
          const anchor = posts[firstUrgent]?.ts ?? posts[0]?.ts;
          const shift = (ts: string) => new Date(base + (Date.parse(ts) - Date.parse(anchor ?? ts))).toISOString();
          const before = posts.slice(0, firstUrgent).map((p) => ({ ...p, ts: shift(p.ts), delivery: p.delivery?.at ? { ...p.delivery, at: shift(p.delivery.at) } : p.delivery }));
          onMessage({ type: "snapshot", data: { sessions, posts: before, demo: true } });
          let i = firstUrgent;
          const step = () => {
            if (stopped) return;
            if (i >= posts.length) {
              if (opts.loop !== false) timer = window.setTimeout(run, 9000);
              return;
            }
            const src = posts[i];
            const p = { ...src, ts: shift(src.ts), delivery: src.delivery?.at ? { ...src.delivery, at: shift(src.delivery.at) } : src.delivery };
            onMessage({ type: "post", data: p });
            const s = sessions.find((x) => x.id === p.sessionId);
            if (s && p.kind !== "user") {
              s.status = p.kind === "done" ? "idle" : p.kind === "blocker" ? "blocked" : "working";
              s.lastActivity = p.ts;
              onMessage({ type: "session", data: { ...s } });
            }
            i++;
            const next = posts[i];
            const gap = next ? Date.parse(next.ts) - Date.parse(posts[i - 1].ts) : 0;
            timer = window.setTimeout(step, Math.min(Math.max(gap, 900), 2600) / speed);
          };
          timer = window.setTimeout(step, 600 / speed);
        };
        run();
      });
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    },
    async reply(sessionId, text) {
      return { id: `demo-${Date.now()}`, sessionId, ts: new Date().toISOString(), kind: "user", text, urgent: false, delivery: { state: "queued" } };
    },
    async usage() {
      return (await loadRecording()).usage;
    },
  };
}
