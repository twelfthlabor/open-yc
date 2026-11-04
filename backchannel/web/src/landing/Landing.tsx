import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Feed } from "../Feed.tsx";
import { loadRecording, replaySource, type Post, type Recording, type SessionInfo, type StreamMessage } from "../data.ts";

const REPO = "https://github.com/twelfthlabor/open-yc/tree/main/backchannel";

const SECTIONS = [
  ["listen", "Listen in"],
  ["how", "How it works"],
  ["privacy", "Privacy"],
  ["compared", "Compared"],
  ["install", "Install"],
] as const;

interface State {
  sessions: Map<string, SessionInfo>;
  posts: Post[];
  beat: number;
}

function reduce(s: State, m: StreamMessage): State {
  if (m.type === "snapshot") return { sessions: new Map(m.data.sessions.map((x) => [x.id, x])), posts: m.data.posts, beat: s.beat };
  if (m.type === "session") return { ...s, sessions: new Map(s.sessions).set(m.data.id, m.data) };
  if (m.type === "post") return { ...s, posts: [...s.posts, m.data].slice(-14), beat: s.beat + 1 };
  return s;
}

// The signal trace under the wordmark: flat at rest, one burst each time a post arrives.
function Trace({ beat, urgent }: { beat: number; urgent: boolean }) {
  return (
    <svg className={`trace${urgent ? " urgent" : ""}`} viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 20 H400" className="trace-base" />
      <path key={beat} className="trace-burst" d="M0 20 H150 l8 -12 l9 26 l10 -30 l9 34 l8 -22 l7 8 H400" />
    </svg>
  );
}

function useActiveSection(): string {
  const [active, setActive] = useState<string>("listen");
  useEffect(() => {
    const els = SECTIONS.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return active;
}

export function Landing() {
  const [state, dispatch] = useReducer(reduce, { sessions: new Map(), posts: [], beat: 0 });
  const [rec, setRec] = useState<Recording | null>(null);
  const source = useMemo(() => replaySource({ speed: 1, skip: ["joined"], prefill: true }), []);
  const active = useActiveSection();
  const listenRef = useRef<HTMLDivElement>(null);

  useEffect(() => source.connect(dispatch, () => {}), [source]);
  useEffect(() => {
    loadRecording().then(setRec, () => {});
  }, []);

  const last = state.posts.at(-1);
  const recordedOn = rec ? new Date(rec.recordedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";

  return (
    <div className="landing">
      <header className="side">
        <div className="side-inner">
          <p className="wordmark">backchannel</p>
          <Trace beat={state.beat} urgent={!!last?.urgent} />
          <h1>One group chat to hear and steer your coding agents.</h1>
          <p className="lede">
            Every Claude Code and Codex session on your machine reports into one channel. Blockers jump the line, you can listen instead of reading terminals, and a reply reaches the agent at its next
            step.
          </p>
          <nav aria-label="Sections">
            <ul>
              {SECTIONS.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} className={active === id ? "on" : undefined} aria-current={active === id ? "true" : undefined}>
                    <span className="rule" aria-hidden="true" />
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ctas">
            <a className="cta primary" href="/app.html">
              Open the demo channel
            </a>
            <a className="cta" href="/app.html#spend">
              See your own spend
            </a>
          </div>
          <p className="fine">
            <a href={REPO}>Read the source</a>. Open source, MIT. Runs on your machine. Not affiliated with Agent FM.
          </p>
        </div>
      </header>

      <main className="content">
        <section id="listen" aria-labelledby="listen-h">
          <h2 id="listen-h" className="visually-hidden">
            Listen in
          </h2>
          <div className="radio" ref={listenRef}>
            <div className="radio-head">
              <span className="onair">On the channel</span>
              <span className="who">
                {[...state.sessions.values()].map((s) => (
                  <span key={s.id} className="chip">
                    <i style={{ background: s.color }} />
                    {s.name}
                    <small>{s.agent === "codex" ? "Codex" : "Claude Code"}</small>
                  </span>
                ))}
              </span>
            </div>
            <div className="radio-feed">
              <Feed posts={state.posts} sessions={state.sessions} empty="Tuning in…" />
            </div>
          </div>
          <p className="caption">
            {rec ? `A replay of a real run recorded on ${recordedOn}. ${rec.note}` : "A replay of a real recorded run."} <a href="/app.html">Open it in the full console</a>, with the spend view.
          </p>
        </section>

        <section id="how" aria-labelledby="how-h">
          <h2 id="how-h">How it works</h2>
          <ol className="steps">
            <li>
              <h3>Install the hook</h3>
              <p>
                <code>backchannel hooks install</code> adds one small hook to Claude Code and Codex. It reports blockers, like a permission prompt, the moment they happen, and it is how your replies reach
                the agent. Your other hooks are left alone.
              </p>
            </li>
            <li>
              <h3>Start the channel</h3>
              <p>
                <code>backchannel serve</code> tails the session transcripts both agents already write to disk and turns them into posts: progress digests, decisions, assumptions, failing tests, finished
                turns. Each session gets a call sign so you can tell them apart by name and by voice.
              </p>
            </li>
            <li>
              <h3>Work as usual, and answer when asked</h3>
              <p>
                Leave the channel open or press Listen. When you reply, the agent gets your message as it finishes its current step and carries on with it, and the chat marks the reply delivered. No
                copy-pasting between terminals.
              </p>
            </li>
          </ol>
          <dl className="facts">
            <div>
              <dt>Blockers first</dt>
              <dd>Approvals, questions, failing tests and an agent stuck in a loop interrupt whatever is being read out, with a chime. Routine progress waits, and stale progress is dropped.</dd>
            </div>
            <div>
              <dt>Tune in to one agent</dt>
              <dd>Pick a station to hear everything from that agent and only the urgent posts from the rest.</dd>
            </div>
            <div>
              <dt>See what it costs</dt>
              <dd>
                Tokens and estimated spend by provider, model, session and day, plus how much context each MCP server and skill added. The totals match Claude Code’s own cost report to the cent.{" "}
                <a href="/app.html#spend">Try it on your own transcripts</a> here, read in your browser.
              </dd>
            </div>
            <div>
              <dt>Talk back</dt>
              <dd>Dictate a reply instead of typing it, in browsers that support speech input.</dd>
            </div>
          </dl>
        </section>

        <section id="privacy" aria-labelledby="privacy-h">
          <h2 id="privacy-h">Privacy</h2>
          <p>
            Nothing leaves your machine. backchannel reads the transcripts Claude Code and Codex already keep, and needs no account and no API key. The server listens on 127.0.0.1 only, and every request
            needs a random token from a file only you can read, so other websites open in your browser cannot read the channel or send your agents instructions.
          </p>
          <p>
            Read-aloud uses your browser’s built-in voices. Dictation uses your browser’s speech recognition; Chrome sends that audio to Google to transcribe it, so leave the microphone off if that matters
            to you.
          </p>
        </section>

        <section id="compared" aria-labelledby="compared-h">
          <h2 id="compared-h">Compared with Agent FM</h2>
          <p>
            backchannel is an independent open-source take on the product Agent FM (YC F26) launched as “one group chat to hear and steer your coding agents.” It is not affiliated with them and uses none of
            their code.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col" />
                  <th scope="col">Agent FM</th>
                  <th scope="col">backchannel</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Agents</th>
                  <td>Claude Code, Codex, OpenCode</td>
                  <td>Claude Code, Codex</td>
                </tr>
                <tr>
                  <th scope="row">Runs on</th>
                  <td>Desktop app (macOS; Windows listed)</td>
                  <td>Any OS with Node 22; opens in your browser</td>
                </tr>
                <tr>
                  <th scope="row">Updates</th>
                  <td>Narrated by an LLM, with your Gemini or OpenAI key</td>
                  <td>Rule-based digests from transcripts and hooks; no key</td>
                </tr>
                <tr>
                  <th scope="row">Replies to agents</th>
                  <td>From the chat</td>
                  <td>From the chat, delivered by hook, with delivery receipts</td>
                </tr>
                <tr>
                  <th scope="row">Voice</th>
                  <td>Provider text-to-speech, system-wide dictation</td>
                  <td>Browser voices, dictation in the reply box</td>
                </tr>
                <tr>
                  <th scope="row">Spend</th>
                  <td>By provider, skill and MCP server</td>
                  <td>By provider, model, session, day; MCP and skill context estimated</td>
                </tr>
                <tr>
                  <th scope="row">Price</th>
                  <td>Paid plans</td>
                  <td>Free</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="install" aria-labelledby="install-h">
          <h2 id="install-h">Install</h2>
          <p>Needs Node 22.18 or later and Claude Code or Codex on the same machine.</p>
          <pre>
            <code>{`git clone https://github.com/twelfthlabor/open-yc
cd open-yc/backchannel
npm install
npm run build
node src/cli.ts hooks install      # Claude Code and Codex
node src/cli.ts serve --open       # opens your channel in the browser
node src/cli.ts doctor             # if a reply never arrives: checks hooks, server, paths`}</code>
          </pre>
          <p>
            Codex runs a new hook only after you trust it: open Codex and run <code>/hooks</code>. To remove everything, run <code>node src/cli.ts hooks uninstall</code>.
          </p>
        </section>

        <footer>
          <p>
            Part of <a href="https://github.com/twelfthlabor/open-yc">open-yc</a>, open-source rebuilds of the products behind recent YC companies.
          </p>
        </footer>
      </main>
    </div>
  );
}
