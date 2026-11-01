import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Avatar, Feed } from "../Feed.tsx";
import { IS_DEMO, liveSource, replaySource, type Post, type SessionInfo, type Source, type Status, type StreamMessage } from "../data.ts";
import { ago, fmtTokens, fmtUsd } from "../format.ts";
import { Narrator, dictate, dictationSupported } from "../speech.ts";
import { UsageView } from "./Usage.tsx";

interface State {
  sessions: Map<string, SessionInfo>;
  posts: Post[];
  lastPost: Post | null; // the newest post that arrived live (not from a snapshot)
}

function reduce(state: State, m: StreamMessage | { type: "local"; data: Post }): State {
  switch (m.type) {
    case "snapshot":
      return { sessions: new Map(m.data.sessions.map((s) => [s.id, s])), posts: m.data.posts, lastPost: null };
    case "session": {
      const sessions = new Map(state.sessions);
      sessions.set(m.data.id, m.data);
      return { ...state, sessions };
    }
    case "post":
    case "local":
      if (state.posts.some((p) => p.id === m.data.id)) return state;
      return { ...state, posts: [...state.posts, m.data].slice(-1500), lastPost: m.type === "post" ? m.data : state.lastPost };
    case "post_update":
      return { ...state, posts: state.posts.map((p) => (p.id === m.data.id ? m.data : p)) };
    default:
      return state;
  }
}

const STATUS_TEXT: Record<SessionInfo["status"], string> = { working: "Working", blocked: "Needs you", idle: "Idle" };

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("backchannel-theme") ?? "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("theme-dark", theme === "dark");
    try {
      localStorage.setItem("backchannel-theme", theme);
    } catch {}
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

export function App() {
  const source: Source = useMemo(() => (IS_DEMO ? replaySource({ speed: 1 }) : liveSource()), []);
  const [state, dispatch] = useReducer(reduce, { sessions: new Map(), posts: [], lastPost: null });
  const [status, setStatus] = useState<Status>("connecting");
  const [tab, setTab] = useState<"channel" | "spend">("channel");
  const [tuned, setTuned] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [onlyUrgent, setOnlyUrgent] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();
  const narrator = useRef<Narrator>(null);
  narrator.current ??= new Narrator();

  useEffect(() => source.connect(dispatch, setStatus), [source]);

  useEffect(() => {
    narrator.current!.onSpeaking = setSpeaking;
  }, []);
  useEffect(() => {
    narrator.current!.configure(onlyUrgent ? "urgent" : "all", tuned);
  }, [onlyUrgent, tuned]);
  useEffect(() => {
    const p = state.lastPost;
    if (p && listening) narrator.current!.hear(p, state.sessions.get(p.sessionId)?.name ?? "An agent");
  }, [state.lastPost, listening, state.sessions]);

  const sessions = useMemo(() => [...state.sessions.values()].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity)), [state.sessions]);
  const visible = useMemo(() => (tuned ? state.posts.filter((p) => p.sessionId === tuned) : state.posts), [state.posts, tuned]);
  const blocked = sessions.filter((s) => s.status === "blocked").length;

  const toggleListen = () => {
    if (listening) {
      narrator.current!.disable();
      setListening(false);
    } else {
      narrator.current!.enable();
      setListening(true);
    }
  };

  const tune = useCallback((id: string | null) => {
    setTuned(id);
    setTab("channel");
  }, []);

  // Keyboard: [ and ] move between stations, / focuses the reply box, l toggles listening.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("textarea, input, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        document.getElementById("reply")?.focus();
      } else if (e.key === "[" || e.key === "]") {
        const ids = [null, ...sessions.map((s) => s.id)];
        const i = ids.indexOf(tuned);
        tune(ids[(i + (e.key === "]" ? 1 : ids.length - 1)) % ids.length]);
      } else if (e.key === "l") {
        toggleListen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const current = tuned ? state.sessions.get(tuned) : undefined;

  return (
    <div className="shell">
      <header className="top">
        <a className="mark" href="/" aria-label="backchannel home">
          backchannel
        </a>
        <span className={`conn c-${status}`} role="status">
          {status === "live" ? "Live" : status === "replay" ? "Demo replay" : status === "offline" ? "Server offline, retrying" : "Connecting"}
        </span>
        <nav className="tabs" aria-label="Views">
          <button type="button" aria-pressed={tab === "channel"} onClick={() => setTab("channel")}>
            Channel{blocked ? <span className="count">{blocked}</span> : null}
          </button>
          <button type="button" aria-pressed={tab === "spend"} onClick={() => setTab("spend")}>
            Spend
          </button>
        </nav>
        <div className="listen">
          <button type="button" className={`listen-btn${listening ? " on" : ""}`} onClick={toggleListen} disabled={!narrator.current.supported} title="Read posts aloud (l)">
            <Meter active={!!speaking} />
            {listening ? "Listening" : "Listen"}
          </button>
          <label className="urgent-only">
            <input type="checkbox" checked={onlyUrgent} onChange={(e) => setOnlyUrgent(e.target.checked)} />
            Only when someone needs me
          </label>
        </div>
        <button type="button" className="theme" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </header>

      {IS_DEMO ? (
        <p className="demo-note">
          This is a replay of a recorded run of real Claude Code and Codex sessions. Replies you type here are not sent anywhere. <a href="/#install">Run it on your own agents</a>.
        </p>
      ) : null}

      <aside className="stations" aria-label="Agents">
        <button type="button" className={`station all${tuned === null ? " on" : ""}`} onClick={() => tune(null)}>
          <span className="all-icon" aria-hidden="true">
            {sessions.slice(0, 3).map((s) => (
              <Avatar key={s.id} s={s} size={18} />
            ))}
          </span>
          <span className="st-name">Everyone</span>
          <span className="st-sub">{sessions.length} agents on the channel</span>
        </button>
        {sessions.map((s) => (
          <button type="button" key={s.id} className={`station${tuned === s.id ? " on" : ""} s-${s.status}`} onClick={() => tune(s.id)}>
            <Avatar s={s} size={30} />
            <span className="st-name">
              {s.name}
              <span className="st-agent">{s.agent === "codex" ? "Codex" : "Claude Code"}</span>
            </span>
            <span className="st-sub">
              <span className="dot" aria-hidden="true" />
              {STATUS_TEXT[s.status]} · {s.project || "unknown project"}
            </span>
            <span className="st-meta">
              {fmtTokens(s.tokens)} tokens · {fmtUsd(s.costUsd)}
            </span>
          </button>
        ))}
        {!sessions.length && status !== "replay" ? <p className="st-empty">No agent sessions in the last 24 hours. Start Claude Code or Codex and it will show up here.</p> : null}
        <p className="keys">
          <kbd>[</kbd> <kbd>]</kbd> switch agent · <kbd>/</kbd> reply · <kbd>l</kbd> listen
        </p>
      </aside>

      <main className="main">
        {tab === "spend" ? (
          <UsageView source={source} />
        ) : (
          <>
            {current ? <StationHeader s={current} demo={source.demo} /> : null}
            <div className="scroll">
              <Feed
                posts={visible}
                sessions={state.sessions}
                speaking={speaking}
                onPick={(id) => tune(id)}
                empty={
                  status === "replay" ? "Starting the replay…" : current ? `${current.name} has not posted yet.` : "Nothing on the channel yet. Updates appear here as your agents work."
                }
              />
            </div>
            <Composer
              source={source}
              sessions={sessions}
              tuned={tuned}
              onPosted={(p) => dispatch({ type: "local", data: p })}
              onDelivered={(p) => dispatch({ type: "post_update", data: p })}
            />
          </>
        )}
      </main>
    </div>
  );
}

function Meter({ active }: { active: boolean }) {
  return (
    <span className={`meter${active ? " active" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function StationHeader({ s, demo }: { s: SessionInfo; demo: boolean }) {
  return (
    <div className="station-head">
      <Avatar s={s} size={40} />
      <div>
        <h1>
          {s.name} <span>{s.title ?? s.project}</span>
        </h1>
        <p>
          {s.agent === "codex" ? "Codex" : "Claude Code"}
          {s.model ? ` · ${s.model}` : ""} · {s.cwd}
          {s.branch && s.branch !== "HEAD" ? ` · ${s.branch}` : ""} · last active {ago(s.lastActivity)}
        </p>
        {!demo && !s.hooked ? <p className="warn">Read only: this session has not reported through the backchannel hook, so replies wait until it does. Run backchannel hooks install, then start a new session.</p> : null}
      </div>
    </div>
  );
}

function Composer({
  source,
  sessions,
  tuned,
  onPosted,
  onDelivered,
}: {
  source: Source;
  sessions: SessionInfo[];
  tuned: string | null;
  onPosted: (p: Post) => void;
  onDelivered: (p: Post) => void;
}) {
  const [text, setText] = useState("");
  const [to, setTo] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const target = tuned ?? (to || sessions.find((s) => s.status !== "idle")?.id || sessions[0]?.id || "");
  const targetName = sessions.find((s) => s.id === target)?.name;

  const send = async () => {
    const body = text.trim();
    if (!body || !target) return;
    setSending(true);
    setError(null);
    try {
      const p = await source.reply(target, body);
      onPosted(p);
      setText("");
      if (source.demo) window.setTimeout(() => onDelivered({ ...p, delivery: { state: "delivered", at: new Date().toISOString(), via: "Stop" } }), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const mic = () => {
    if (listening) {
      stop.current?.();
      return;
    }
    setError(null);
    setListening(true);
    const before = text ? `${text.trimEnd()} ` : "";
    stop.current = dictate(
      (t) => setText(before + t),
      (err) => {
        setListening(false);
        if (err && err !== "aborted" && err !== "no-speech") setError(`Dictation stopped: ${err}`);
      },
    );
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {tuned ? null : (
        <label className="to">
          To
          <select value={target} onChange={(e) => setTo(e.target.value)} disabled={!sessions.length}>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.project}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="field">
        <label htmlFor="reply" className="visually-hidden">
          Reply
        </label>
        <textarea
          id="reply"
          rows={1}
          value={text}
          placeholder={targetName ? `Reply to ${targetName}` : "No agent to reply to yet"}
          disabled={!target}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {dictationSupported() ? (
          <button type="button" className={`mic${listening ? " on" : ""}`} onClick={mic} aria-pressed={listening} aria-label={listening ? "Stop dictation" : "Dictate a reply"}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" fill="currentColor" />
            </svg>
          </button>
        ) : null}
        <button type="submit" className="send" disabled={!text.trim() || !target || sending}>
          Send
        </button>
      </div>
      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
