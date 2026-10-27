export function compact(n: number | null | undefined): string {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e9) return `${trim(v / 1e9)}B`;
  if (a >= 1e6) return `${trim(v / 1e6)}M`;
  if (a >= 1e3) return `${trim(v / 1e3)}k`;
  return String(Math.round(v));
}

function trim(x: number): string {
  return Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, "");
}

export function usd(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return v >= 1000 ? `$${Math.round(v).toLocaleString("en-US")}` : `$${v.toFixed(2)}`;
}

export function int(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString("en-US");
}

export function pct(p: number | null | undefined): string {
  if (p === null || p === undefined) return "new";
  return `${p > 0 ? "+" : ""}${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}

export function duration(s: number | null | undefined): string {
  const v = Math.max(0, Number(s) || 0);
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${Math.round(v)}s`;
}

const UNITS: [number, string][] = [[60, "minute"], [3600, "hour"], [86400, "day"], [2592000, "month"], [31536000, "year"]];

/** "3 hours ago", falling back to the raw string for anything unparseable. */
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "just now";
  let pick = UNITS[0];
  for (const u of UNITS) if (s >= u[0]) pick = u;
  const n = Math.max(1, Math.round(s / pick[0]));
  return `${n} ${pick[1]}${n === 1 ? "" : "s"} ago`;
}

export function day(iso: string): string {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export const tokens = (t: { input_tokens?: number; output_tokens?: number } | undefined) =>
  (Number(t?.input_tokens) || 0) + (Number(t?.output_tokens) || 0);

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${int(n)} ${n === 1 ? one : many}`;
}
