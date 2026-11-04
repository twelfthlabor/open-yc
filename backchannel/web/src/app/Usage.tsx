import { useEffect, useState } from "react";
import type { TranscriptFile } from "../../../src/core/offline.ts";
import type { Source, Usage, UsageReport } from "../data.ts";
import { fmtInt, fmtTokens, fmtUsd } from "../format.ts";
import { OwnSpend, type Own } from "./OwnSpend.tsx";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Loaded = Usage & { files?: { read: number; skipped: number; badLines: number } };

// The parser and ledger are only needed once someone drops their own files, so load them then.
async function ownUsage(files: TranscriptFile[], days: number): Promise<Loaded> {
  const { usageFromTranscripts } = await import("../../../src/core/offline.ts");
  return usageFromTranscripts(files, new Date(Date.now() - days * 86_400_000).toISOString());
}

type Row = UsageReport["byModel"][number];

function Bars({ rows, money = true, max = 8 }: { rows: Row[]; money?: boolean; max?: number }) {
  if (!rows.length) return <p className="u-empty">None in this period.</p>;
  const top = Math.max(...rows.map((r) => r.total), 1);
  return (
    <ul className="bars">
      {rows.slice(0, max).map((r) => (
        <li key={r.key}>
          <span className="b-label" title={r.label}>
            {r.label}
          </span>
          <span className="b-track" aria-hidden="true">
            <span className="b-fill" style={{ width: `${Math.max(1.5, (r.total / top) * 100)}%` }} />
          </span>
          <span className="b-val">
            {fmtTokens(r.total)}
            {money ? <span className="b-cost">{r.unpriced && !r.costUsd ? "unpriced" : fmtUsd(r.costUsd)}</span> : <span className="b-cost">{r.calls} calls</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Daily({ rows }: { rows: Row[] }) {
  if (rows.length < 2) return null;
  const w = 640;
  const h = 120;
  const top = Math.max(...rows.map((r) => r.costUsd), 0.0001);
  const bw = w / rows.length;
  return (
    <figure className="daily">
      <svg viewBox={`0 0 ${w} ${h + 22}`} role="img" aria-label="Estimated cost per day">
        {rows.map((r, i) => {
          const bh = Math.max(2, (r.costUsd / top) * h);
          return (
            <g key={r.key}>
              <rect x={i * bw + 3} y={h - bh} width={Math.max(2, bw - 6)} height={bh} rx="3" className="d-bar">
                <title>{`${r.key}: ${fmtUsd(r.costUsd)}, ${fmtInt(r.total)} tokens`}</title>
              </rect>
              {rows.length <= 14 || i % Math.ceil(rows.length / 10) === 0 ? (
                <text x={i * bw + bw / 2} y={h + 16} textAnchor="middle" className="d-label">
                  {r.key.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption>Estimated cost per day</figcaption>
    </figure>
  );
}

export function UsageView({ source }: { source: Source }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [own, setOwn] = useState<Own | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    const load = () => (own ? ownUsage(own.files, days) : source.usage(days));
    load()
      .then((d) => live && setData(d))
      .catch((e) => live && setError(String(e.message ?? e)));
    const t = source.demo || own ? undefined : window.setInterval(() => load().then((d) => live && setData(d)).catch(() => {}), 15_000);
    return () => {
      live = false;
      if (t) clearInterval(t);
    };
  }, [source, days, own]);

  if (error) return <p className="u-error">Could not load spend: {error}</p>;
  if (!data) return <p className="u-empty">Loading spend…</p>;
  const t = data.totals;
  const recorded = source.demo && !own;
  return (
    <div className="usage">
      {recorded ? (
        <OwnSpend
          onLoad={(picked) => {
            setData(null);
            setDays(30);
            setOwn(picked);
          }}
        />
      ) : null}
      {own ? (
        <p className="own-loaded" role="status">
          Your transcripts: {plural(data.files?.read ?? own.files.length, "file")} read in this tab
          {own.skipped + (data.files?.skipped ?? 0) ? `, ${own.skipped + (data.files?.skipped ?? 0)} skipped (older than 30 days, subagent or not a transcript)` : ""}. Nothing was uploaded.{" "}
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setData(null);
              setDays(7);
              setOwn(null);
            }}
          >
            Back to the recorded run
          </button>
        </p>
      ) : null}
      <div className="u-head">
        <div>
          <h1>{fmtUsd(t.costUsd)}</h1>
          <p>
            {fmtInt(t.total)} tokens across {plural(data.bySession.length, "session")}{recorded ? " in the recorded run" : ""}, at API list prices.
            {t.unpriced ? ` Another ${fmtInt(t.unpriced)} tokens came from models with no price on file.` : ""}
          </p>
        </div>
        {recorded ? null : (
          <div className="u-range" role="group" aria-label="Period">
            {[1, 7, 30].map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
                {d === 1 ? "24 hours" : `${d} days`}
              </button>
            ))}
          </div>
        )}
      </div>
      <dl className="u-split">
        <div>
          <dt>Input</dt>
          <dd>{fmtTokens(t.input)}</dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd>{fmtTokens(t.output)}</dd>
        </div>
        <div>
          <dt>Cache read</dt>
          <dd>{fmtTokens(t.cacheRead)}</dd>
        </div>
        <div>
          <dt>Cache write</dt>
          <dd>{fmtTokens(t.cacheWrite)}</dd>
        </div>
      </dl>
      <Daily rows={data.byDay} />
      <div className="u-grid">
        <section>
          <h2>By provider</h2>
          <Bars rows={data.byProvider} />
        </section>
        <section>
          <h2>By model</h2>
          <Bars rows={data.byModel} />
        </section>
        <section className="wide">
          <h2>By agent session</h2>
          <Bars rows={data.bySession} max={12} />
        </section>
        <section>
          <h2>MCP servers</h2>
          <Bars rows={data.byMcp} money={false} />
        </section>
        <section>
          <h2>Skills</h2>
          <Bars rows={data.bySkill} money={false} />
        </section>
      </div>
      <p className="u-note">
        MCP and skill figures estimate the context each one added (characters of its calls and results divided by four); they are not billed amounts. Costs use API list prices as of {data.pricesAsOf}; a Claude
        or ChatGPT subscription is not billed per token.
        {data.unverifiedModels.length ? ` Prices for ${data.unverifiedModels.join(", ")} are not verified.` : ""}
      </p>
    </div>
  );
}
