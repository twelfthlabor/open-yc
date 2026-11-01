import { useEffect, useState } from "react";
import type { Source, Usage, UsageReport } from "../data.ts";
import { fmtInt, fmtTokens, fmtUsd } from "../format.ts";

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
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    source
      .usage(days)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(String(e.message ?? e)));
    const t = source.demo ? undefined : window.setInterval(() => source.usage(days).then((d) => live && setData(d)).catch(() => {}), 15_000);
    return () => {
      live = false;
      if (t) clearInterval(t);
    };
  }, [source, days]);

  if (error) return <p className="u-error">Could not load spend: {error}</p>;
  if (!data) return <p className="u-empty">Loading spend…</p>;
  const t = data.totals;
  return (
    <div className="usage">
      <div className="u-head">
        <div>
          <h1>{fmtUsd(t.costUsd)}</h1>
          <p>
            {fmtInt(t.total)} tokens across {data.bySession.length} sessions{source.demo ? " in the recorded run" : ""}, at API list prices.
            {t.unpriced ? ` Another ${fmtInt(t.unpriced)} tokens came from models with no price on file.` : ""}
          </p>
        </div>
        {source.demo ? null : (
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
