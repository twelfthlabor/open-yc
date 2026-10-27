import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { compact, day } from "../lib/format";

export interface Point {
  x: string; // YYYY-MM-DD
  a: number;
  b?: number;
}

const W = 720;

function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = 0; v <= max * 1.0001; v += step) out.push(v);
  return out;
}

/** Fill gaps so a quiet day reads as zero instead of being skipped. */
export function dailySeries(byDay: Record<string, { a: number; b?: number }>, days: number, end?: string): Point[] {
  const keys = Object.keys(byDay).sort();
  const last = end || keys[keys.length - 1];
  if (!last) return [];
  const out: Point[] = [];
  const t = Date.parse(`${last.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return [];
  for (let i = days - 1; i >= 0; i--) {
    const k = new Date(t - i * 86400000).toISOString().slice(0, 10);
    out.push({ x: k, a: byDay[k]?.a || 0, b: byDay[k]?.b || 0 });
  }
  return out;
}

interface ChartProps {
  points: Point[];
  height?: number;
  format?: (n: number) => string;
  labels?: [string, string?];
  tip?: (p: Point) => ReactNode;
}

function useHover(n: number) {
  const [i, setI] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !n) return;
    const x = ((e.clientX - r.left) / r.width) * W;
    setI(Math.max(0, Math.min(n - 1, Math.round(((x - 44) / (W - 52)) * (n - 1)))));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") setI((v) => Math.min(n - 1, (v ?? -1) + 1));
    else if (e.key === "ArrowLeft") setI((v) => Math.max(0, (v ?? n) - 1));
    else if (e.key === "Escape") setI(null);
  };
  return { i, setI, ref, onMove, onKey };
}

function Frame({ max, height, format, n, points }: { max: number; height: number; format: (n: number) => string; n: number; points: Point[] }) {
  const y = (v: number) => height - 24 - (v / (max || 1)) * (height - 36);
  const every = Math.max(1, Math.ceil(n / 6));
  return (
    <>
      {ticks(max).map((t) => (
        <g key={t}>
          <line className="grid" x1={44} x2={W - 8} y1={y(t)} y2={y(t)} />
          <text className="axis" x={36} y={y(t) + 4} textAnchor="end">
            {format(t)}
          </text>
        </g>
      ))}
      {points.map((p, i) =>
        i % every === 0 || i === n - 1 ? (
          <text key={p.x} className="axis" x={44 + (i / Math.max(1, n - 1)) * (W - 52)} y={height - 4} textAnchor="middle">
            {day(p.x)}
          </text>
        ) : null,
      )}
    </>
  );
}

export function AreaChart({ points, height = 220, format = compact, labels = ["Tokens"], tip }: ChartProps) {
  const id = useId();
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.a));
  const { i, setI, ref, onMove, onKey } = useHover(n);
  const x = (k: number) => 44 + (k / Math.max(1, n - 1)) * (W - 52);
  const y = (v: number) => height - 24 - (v / max) * (height - 36);
  const path = useMemo(() => points.map((p, k) => `${k ? "L" : "M"}${x(k).toFixed(1)},${y(p.a).toFixed(1)}`).join(""), [points, max, height]);
  if (!n) return null;
  const hp = i !== null ? points[i] : null;
  return (
    <div className="chart">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-labelledby={`${id}-d`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setI(null)}
        onKeyDown={onKey}
        onBlur={() => setI(null)}
      >
        <desc id={`${id}-d`}>
          {labels[0]} per day, {day(points[0].x)} to {day(points[n - 1].x)}. Peak {format(max)}.
        </desc>
        <Frame max={max} height={height} format={format} n={n} points={points} />
        <path className="area" d={`${path}L${x(n - 1)},${height - 24}L${x(0)},${height - 24}Z`} />
        <path className="line" d={path} />
        {hp && (
          <>
            <line className="cursor" x1={x(i!)} x2={x(i!)} y1={8} y2={height - 24} />
            <circle className="dotc" cx={x(i!)} cy={y(hp.a)} r={4} />
          </>
        )}
      </svg>
      {hp && (
        <div className="tip" style={{ left: `${(x(i!) / W) * 100}%`, top: `${(y(hp.a) / height) * 100}%` }}>
          {tip ? tip(hp) : (
            <>
              <b>{format(hp.a)}</b> {labels[0].toLowerCase()}
              <br />
              {day(hp.x)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function StackedBars({ points, height = 220, format = compact, labels = ["Input", "Output"] }: ChartProps) {
  const id = useId();
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.a + (p.b || 0)));
  const { i, setI, ref, onMove, onKey } = useHover(n);
  if (!n) return null;
  const slot = (W - 52) / Math.max(1, n - 1);
  const bw = Math.max(2, Math.min(18, slot * 0.62));
  const x = (k: number) => 44 + k * slot;
  const h = (v: number) => (v / max) * (height - 36);
  const hp = i !== null ? points[i] : null;
  return (
    <div className="chart">
      <div className="legend" style={{ marginBottom: 8 }}>
        <span>
          <i style={{ background: "var(--chart-1)" }} /> {labels[0]}
        </span>
        <span>
          <i style={{ background: "var(--chart-2)" }} /> {labels[1]}
        </span>
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-labelledby={`${id}-d`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setI(null)}
        onKeyDown={onKey}
        onBlur={() => setI(null)}
      >
        <desc id={`${id}-d`}>
          {labels[0]} and {labels[1]} per day, {day(points[0].x)} to {day(points[n - 1].x)}.
        </desc>
        <Frame max={max} height={height} format={format} n={n} points={points} />
        {points.map((p, k) => {
          const base = height - 24;
          const ha = h(p.a);
          const hb = h(p.b || 0);
          return (
            <g key={p.x} opacity={i === null || i === k ? 1 : 0.45}>
              <rect className="bar-a" x={x(k) - bw / 2} y={base - ha} width={bw} height={ha} rx={1.5} />
              <rect className="bar-b" x={x(k) - bw / 2} y={base - ha - hb - (hb ? 1.5 : 0)} width={bw} height={hb} rx={1.5} />
            </g>
          );
        })}
      </svg>
      {hp && (
        <div className="tip" style={{ left: `${(x(i!) / W) * 100}%`, top: `${((height - 24 - h(hp.a + (hp.b || 0))) / height) * 100}%` }}>
          <b>{day(hp.x)}</b>
          <br />
          {labels[0]} {format(hp.a)}
          <br />
          {labels[1]} {format(hp.b || 0)}
        </div>
      )}
    </div>
  );
}

export function BarList({ items, format = compact, empty }: { items: { label: ReactNode; value: number; key: string; hint?: string }[]; format?: (n: number) => string; empty?: ReactNode }) {
  if (!items.length) return <>{empty}</>;
  const max = Math.max(1, ...items.map((x) => x.value));
  return (
    <ul className="bars">
      {items.map((x) => (
        <li key={x.key} title={x.hint}>
          <span className="fill" style={{ width: `${Math.max(1.5, (x.value / max) * 100)}%` }} />
          <span className="label">{x.label}</span>
          <span className="val">{format(x.value)}</span>
        </li>
      ))}
    </ul>
  );
}

const ORDER = ["critical", "high", "medium", "low", "info"] as const;

export function SevBar({ counts }: { counts: Partial<Record<string, number>> }) {
  const total = ORDER.reduce((s, k) => s + (counts[k] || 0), 0);
  if (!total) return null;
  return (
    <>
      <div className="sevbar" role="img" aria-label={ORDER.filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(", ")}>
        {ORDER.filter((k) => counts[k]).map((k) => (
          <span key={k} className={k} style={{ flex: counts[k] }} />
        ))}
      </div>
      <div className="legend">
        {ORDER.filter((k) => counts[k]).map((k) => (
          <span key={k} className={`sev ${k}`}>
            {counts[k]} {k}
          </span>
        ))}
      </div>
    </>
  );
}
