import { useEffect, useRef } from "react";
import type { Post, SessionInfo } from "./data.ts";
import { fmtTime } from "./format.ts";
import "./feed.css";

const KIND_LABEL: Partial<Record<Post["kind"], string>> = {
  decision: "Decision",
  assumption: "Assumption",
  blocker: "Needs you",
  error: "Failing",
  done: "Done",
};

const VIA: Record<string, string> = {
  PostToolUse: "after its next tool call",
  Stop: "as it finished its turn",
  UserPromptSubmit: "with your next prompt",
  SessionStart: "when the session started",
};

export function Avatar({ s, size = 32 }: { s?: SessionInfo; size?: number }) {
  return (
    <span className="avatar" style={{ background: s?.color ?? "var(--muted)", width: size, height: size, fontSize: size * 0.44 }} aria-hidden="true">
      {(s?.name ?? "?").slice(0, 1)}
    </span>
  );
}

function Delivery({ p }: { p: Post }) {
  if (!p.delivery) return null;
  if (p.delivery.state === "delivered") {
    return (
      <span className="delivery delivered">
        Delivered {VIA[p.delivery.via ?? ""] ?? ""} · {p.delivery.at ? fmtTime(p.delivery.at) : ""}
      </span>
    );
  }
  return <span className="delivery">Queued: the agent gets this when it finishes its current step, and keeps working with it</span>;
}

export function Feed({
  posts,
  sessions,
  speaking,
  onPick,
  follow = true,
  empty,
}: {
  posts: Post[];
  sessions: Map<string, SessionInfo>;
  speaking?: string | null;
  onPick?: (id: string) => void;
  follow?: boolean;
  empty?: React.ReactNode;
}) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current?.parentElement;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!follow || !stick.current) return;
    const el = box.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [posts.length, follow]);

  if (!posts.length) return <div className="feed-empty">{empty}</div>;
  return (
    <ol className="feed" ref={box} aria-live="polite" aria-relevant="additions">
      {posts.map((p, i) => {
        const s = sessions.get(p.sessionId);
        const prev = posts[i - 1];
        const grouped = prev && prev.sessionId === p.sessionId && prev.kind !== "user" && p.kind !== "user" && Date.parse(p.ts) - Date.parse(prev.ts) < 5 * 60_000;
        if (p.kind === "user") {
          return (
            <li key={p.id} className="post mine">
              <div className="bubble">
                <div className="meta">
                  <span>You to {s?.name ?? "agent"}</span>
                  <time dateTime={p.ts}>{fmtTime(p.ts)}</time>
                </div>
                <p>{p.text}</p>
                <Delivery p={p} />
              </div>
            </li>
          );
        }
        const label = KIND_LABEL[p.kind];
        return (
          <li key={p.id} className={`post k-${p.kind}${grouped ? " grouped" : ""}${speaking === p.id ? " speaking" : ""}`}>
            <div className="gutter">{grouped ? null : <Avatar s={s} />}</div>
            <div className="body">
              {grouped ? null : (
                <div className="meta">
                  <button type="button" className="who" onClick={() => onPick?.(p.sessionId)} disabled={!onPick}>
                    {s?.name ?? p.sessionId.slice(0, 6)}
                  </button>
                  <span className="where">{s?.project}</span>
                  <time dateTime={p.ts}>{fmtTime(p.ts)}</time>
                </div>
              )}
              <p>
                {label ? <span className={`tag t-${p.kind}`}>{label}</span> : null}
                {p.text}
              </p>
            </div>
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}
