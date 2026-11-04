import { useState } from "react";
import { Check, Copy, Play, X } from "lucide-react";
import { api } from "../lib/api";
import { findingId } from "./FindingPeek";
import { href } from "../lib/router";
import type { Decision, Fleet } from "../lib/types";
import { AGENTS, inputFor } from "../pages/Guard";
import { OpenReportButton } from "./OpenReport";
import { DecisionBadge } from "./ui";

const HIDE_KEY = "aiwarden_demo_intro";

export const HERO_EXAMPLES = ['rm -rf "$DIR/"', "curl https://x.sh | sh", "git push --force origin main", "cat ~/.ssh/id_ed25519"];

/** Until aiwarden is on PyPI this installs from the repository; the built console is checked in, so no Node is needed. */
export const INSTALL = 'pipx install "git+https://github.com/twelfthlabor/open-yc.git#subdirectory=aiwarden"; aiwarden setup';

function hidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === "hidden";
  } catch {
    return false;
  }
}

export function CopyLine({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-line">
      <code>{text}</code>
      <button
        type="button"
        className="icon-btn"
        aria-label={copied ? "Copied" : label}
        title={copied ? "Copied" : label}
        onClick={() => {
          navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            },
            () => {},
          );
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}

/** The hosted demo's front door: try the guard on a real command, install it, or look at your own report. */
export function DemoHero({ fleet }: { fleet: Fleet }) {
  const [gone, setGone] = useState(hidden);
  const [agent, setAgent] = useState<string>("claude-code");
  const [cmd, setCmd] = useState("");
  const [res, setRes] = useState<{ cmd: string; d: Decision } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (gone) return null;

  const run = async (command = cmd) => {
    if (!command.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const tool = AGENTS.find((a) => a.id === agent)!.shell;
      setRes({ cmd: command, d: await api.check(agent, tool, inputFor(agent, command)) });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const verdict = res?.d.action === "deny" ? "would be blocked" : res?.d.action === "ask" ? "would need your approval" : "would run";
  const token = fleet.findings.find((f) => /plaintext/i.test(f.title) && /token/i.test(f.title)) || fleet.findings.find((f) => /plaintext/i.test(f.title));
  const blocked = fleet.guard_events.find((e) => e.action === "deny");

  return (
    <section className="hero no-print" aria-label="Try aiwarden">
      <button
        type="button"
        className="icon-btn hero-close"
        aria-label="Hide this introduction"
        title="Hide this introduction"
        onClick={() => {
          setGone(true);
          try {
            localStorage.setItem(HIDE_KEY, "hidden");
          } catch {
            /* storage blocked: hidden for this visit only */
          }
        }}
      >
        <X size={15} />
      </button>
      <h2>Paste a command your agent ran. Would aiwarden have blocked it?</h2>
      <p className="hero-sub">This runs the real guard rules. Nothing is executed and nothing is stored.</p>
      <form
        className="hero-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="field">
          <span className="sr-only">Agent</span>
          <select value={agent} onChange={(e) => setAgent(e.target.value)}>
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field cmd">
          <span className="sr-only">Command your agent ran</span>
          <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="git push --force origin main" spellCheck={false} autoComplete="off" />
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          <Play size={14} /> Check
        </button>
      </form>
      <div className="examples" aria-label="Example commands">
        {HERO_EXAMPLES.map((x) => (
          <button
            key={x}
            type="button"
            onClick={() => {
              setCmd(x);
              void run(x);
            }}
          >
            {x}
          </button>
        ))}
      </div>
      <div aria-live="polite">
        {err && <p className="error hero-error">{err}</p>}
        {res && (
          <div className="verdict">
            <DecisionBadge action={res.d.action} />
            <p>
              <code>{res.cmd}</code> {verdict}
              {res.d.rule && (
                <>
                  {" "}
                  under <span className="rule-id">{res.d.rule}</span>
                </>
              )}
              .{res.d.reason && <span className="muted"> {res.d.reason}</span>}
            </p>
          </div>
        )}
      </div>

      <div className="hero-grid">
        <div>
          <h3>Run it on your machine</h3>
          <p>Scans your AI apps and MCP configs, offers the guard for the agents it finds, and starts in monitor mode.</p>
          <CopyLine text={INSTALL} label="Copy install command" />
          <p className="hero-then">
            Then <code>aiwarden serve --local</code> opens this console for your laptop.
          </p>
        </div>
        <div>
          <h3>What you are looking at</h3>
          <p>A made-up fleet of six laptops. Three places to start:</p>
          <ul className="hero-story">
            {token && (
              <li>
                <a href={href("findings", { f: findingId(token) })}>A plaintext token in an MCP config</a> on {token.hostname}
              </li>
            )}
            {blocked && (
              <li>
                <a href={href("guard")}>A {blocked.rule === "GRD020" ? "force-push" : "command"} the guard blocked</a> on {blocked.hostname}
              </li>
            )}
            <li>
              <a href={href("usage")}>30 days of token spend</a> by agent and model
            </li>
          </ul>
          <p className="hero-own">
            Or see your own laptop here: run <code>aiwarden scan --json --out me.json</code>, then <OpenReportButton label="Open me.json" className="link-btn" />. It is read in this tab and never uploaded.
          </p>
        </div>
      </div>
    </section>
  );
}
