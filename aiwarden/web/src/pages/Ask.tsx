import { useEffect, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";
import { api, Unauthorized } from "../lib/api";
import { compact, int, pct, usd } from "../lib/format";
import type { AskResult, Row } from "../lib/types";
import { DataTable } from "../components/Table";
import { Empty, PageHead } from "../components/ui";

const SUGGESTIONS = [
  "which teams' token usage doubled this month",
  "top 5 users by cost",
  "token usage by app in the last 30 days",
  "which devices have plaintext secrets",
  "which claude code sessions used the github mcp",
  "high findings by device",
  "guard blocks by rule",
  "most called mcp servers",
];

const LABELS: Record<string, string> = {
  value: "Value",
  previous: "Previous",
  change_pct: "Change",
  hostname: "Device",
  mcp_server: "MCP server",
  mcp_servers: "MCP servers",
  cost_usd: "Est. cost",
};

function label(k: string) {
  return LABELS[k] || k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " ");
}

function fmtValue(v: unknown, metric: string | undefined, key: string): string {
  if (v === null || v === undefined) return "-";
  if (key === "change_pct") return pct(v as number);
  if (typeof v === "number") return metric === "cost_usd" || key === "cost_usd" ? usd(v) : Number.isInteger(v) ? int(v) : v.toFixed(2);
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

interface Entry {
  q: string;
  res?: AskResult;
  error?: string;
}

export function Ask({ initial, onUnauthorized }: { initial: string; onUnauthorized: () => void }) {
  const [q, setQ] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await api.ask(text);
      setLog((l) => [{ q: text, res }, ...l].slice(0, 8));
    } catch (e) {
      if (e instanceof Unauthorized) return onUnauthorized();
      setLog((l) => [{ q: text, error: (e as Error).message }, ...l].slice(0, 8));
    } finally {
      setBusy(false);
    }
  };

  const asked = useRef("");
  useEffect(() => {
    if (initial && asked.current !== initial) {
      asked.current = initial; // StrictMode runs effects twice in dev; ask once
      setQ(initial);
      ask(initial);
    } else if (!initial) input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  return (
    <>
      <PageHead title="Ask" sub="Questions about usage, spend, sessions, MCP calls, findings and guard decisions, answered from the reports on this collector." />
      <form
        className="ask-box"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <label htmlFor="ask" className="sr-only">
          Question
        </label>
        <input id="ask" ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Which users' token usage doubled this month?" maxLength={500} autoComplete="off" />
        <button className="btn primary" type="submit" disabled={busy || !q.trim()}>
          {busy ? "Asking" : "Ask"} <CornerDownLeft size={15} />
        </button>
      </form>
      <div className="chips" aria-label="Example questions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            className="chip"
            type="button"
            onClick={() => {
              setQ(s);
              ask(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <div aria-live="polite">
        {log.map((e, i) => (
          <Answer key={`${i}-${e.q}`} entry={e} />
        ))}
      </div>
      {!log.length && (
        <p className="note">
          Questions are parsed on the collector and never leave it. To translate free-form questions with Claude, start the collector with <code>AIWARDEN_ASK_LLM=1</code> and an <code>ANTHROPIC_API_KEY</code>; only the question text is sent, never fleet data.
        </p>
      )}
    </>
  );
}

function Answer({ entry }: { entry: Entry }) {
  if (entry.error) {
    return (
      <div className="answer">
        <h3>{entry.q}</h3>
        <p className="error">{entry.error}</p>
      </div>
    );
  }
  const r = entry.res!;
  const { rows, total, window, previous_window, notes } = r.result;
  const metric = r.query.metric as string | undefined;
  const keys = [...new Set(rows.flatMap((x) => Object.keys(x)))];
  const timed = ["usage", "model_usage", "sessions", "guard_events", "risky_events"].includes(r.query.entity);
  const span = window ? `${window.since} to ${window.until}` : timed ? "All time" : "Latest snapshot";
  const grouped = (r.query.group_by || []).length > 0;
  return (
    <div className="answer">
      <h3>{entry.q}</h3>
      <div className="meta">
        {span}
        {previous_window ? `, compared with ${previous_window.since} to ${previous_window.until}` : ""}. {rows.length} {rows.length === 1 ? "row" : "rows"}.
      </div>
      {(grouped || r.query.entity === "usage" || r.query.entity === "model_usage") && (
        <div className="total">{metric === "cost_usd" ? usd(total) : compact(total)}</div>
      )}
      {notes.map((n) => (
        <p key={n} className="note">
          {n}
        </p>
      ))}
      <DataTable<Row>
        label={entry.q}
        rows={rows}
        rowKey={(_, i) => String(i)}
        limit={25}
        empty={<Empty title="No matches">Try a wider window, such as “in the last 90 days”.</Empty>}
        columns={keys.map((k) => ({
          key: k,
          label: label(k),
          num: k === "value" || k === "previous" || k === "change_pct" || typeof rows[0]?.[k] === "number",
          render: (row: Row) => fmtValue(row[k], metric, k),
          sort: (row: Row) => (typeof row[k] === "number" ? (row[k] as number) : String(row[k] ?? "")),
        }))}
      />
      <details className="query">
        <summary>How this was answered ({r.translated_by})</summary>
        <pre className="code">{JSON.stringify(r.query, null, 2)}</pre>
      </details>
    </div>
  );
}
