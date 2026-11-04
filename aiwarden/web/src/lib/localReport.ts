// "Open your own report": the JSON from `aiwarden scan --json --out me.json`, read in this tab only.
// These are TypeScript ports of server.py's valid_report, aggregate and insights for a single report, so the
// console's pages render a file the same way they render a collector's answer. Nothing here touches the network.
import type { Fleet, Insights, Report } from "./types";

export class ReportError extends Error {}

const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isScalar = (v: unknown) => v == null || ["string", "number", "boolean"].includes(typeof v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Parse and shape-check a report file. Throws ReportError with a sentence a person can act on. */
export function parseReport(text: string): Report {
  let r: unknown;
  try {
    r = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new ReportError("That file is not valid JSON. Create one with: aiwarden scan --json --out me.json");
  }
  if (!isObj(r) || r.schema !== "aiwarden.report/v1") throw new ReportError("That JSON is not an aiwarden report. Create one with: aiwarden scan --json --out me.json");
  const dev = r.device;
  if (!isObj(dev) || !DEVICE_ID.test(String(dev.id ?? "")) || !["hostname", "user", "os"].every((k) => isScalar(dev[k])))
    throw new ReportError("The report's device block is missing or malformed.");
  const fields: Record<string, string[]> = {
    apps: ["name", "vendor", "kind"],
    mcp_servers: ["name", "client", "scope", "package", "url", "command", "transport"],
    findings: ["rule", "severity", "title", "subject", "detail", "location"],
    guard_events: ["ts", "app", "session", "tool", "action", "rule", "would_be"],
    browser_extensions: [],
  };
  for (const [key, keys] of Object.entries(fields)) {
    const list = r[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || !list.every(isObj) || !list.every((x) => keys.every((k) => isScalar(x[k]))))
      throw new ReportError(`The report's ${key} section is malformed.`);
  }
  if (!((r.apps as Obj[] | undefined) ?? []).every((a) => typeof a.id === "string")) throw new ReportError("The report's apps section is malformed.");
  const summ = r.summary ?? {};
  if (!isObj(summ) || !Object.entries(summ).every(([k, v]) => (k === "findings" ? isObj(v) && Object.values(v).every(isNum) : isNum(v) || typeof v === "boolean")))
    throw new ReportError("The report's summary section is malformed.");
  if (r.generated_at !== undefined && !isScalar(r.generated_at)) throw new ReportError("The report's generated_at is malformed.");
  const usage = r.usage;
  const listOfObjects = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(isObj));
  const objectOrAbsent = (v: unknown) => v === undefined || isObj(v);
  if (
    usage != null &&
    (!isObj(usage) ||
      !["by_model", "by_day", "by_app"].every((k) => usage[k] === undefined || (isObj(usage[k]) && Object.values(usage[k] as Obj).every(isObj))) ||
      !["sessions", "risky_events"].every((k) => listOfObjects(usage[k])) ||
      !["by_project", "tools", "mcp_calls", "cost"].every((k) => objectOrAbsent(usage[k])))
  )
    throw new ReportError("The report's usage section is malformed.");
  const out = r as unknown as Report;
  return {
    ...out,
    apps: out.apps ?? [],
    mcp_servers: (out.mcp_servers ?? []).map((s) => ({ ...s, secrets: Array.isArray(s.secrets) ? s.secrets : [] })),
    browser_extensions: out.browser_extensions ?? [],
    guard_events: out.guard_events ?? [],
    findings: out.findings ?? [],
    graph: isObj(out.graph) && Array.isArray(out.graph.nodes) && Array.isArray(out.graph.edges) ? out.graph : { nodes: [], edges: [] },
    summary: (summ as Report["summary"]) ?? {},
  };
}

function sumTokens(dst: Record<string, number>, src: unknown) {
  if (!isObj(src)) return;
  for (const [k, v] of Object.entries(src)) if (isNum(v)) dst[k] = (dst[k] || 0) + v;
}

function sumBy(src: Record<string, unknown> | undefined): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [k, t] of Object.entries(src ?? {})) sumTokens((out[k] ??= {}), t);
  return out;
}

/** server.aggregate() over one report; the browser section is empty because the extension reports to a collector. */
export function fleetFromReport(r: Report, now = new Date()): Fleet {
  const dev = r.device;
  const s = r.summary ?? {};
  const totals: Record<string, number> = { devices: 1, guarded_devices: s.guard_installed ? 1 : 0 };
  for (const k of ["apps", "mcp_servers", "plaintext_secrets", "tokens", "risky_events", "guard_blocks"] as const) totals[k] = Math.trunc(num(s[k]));
  for (const k of ["browser_profiles", "browser_events", "browser_blocks", "browser_warns", "invalid_browser_rows"]) totals[k] = 0;
  const apps: Fleet["apps"] = {};
  for (const a of r.apps) {
    const e = (apps[a.id] ??= { name: a.name, vendor: a.vendor, kind: a.kind, devices: 0, running: 0 });
    e.devices += 1;
    e.running += a.running ? 1 : 0;
  }
  const pk = new Map<string, Set<string>>();
  for (const m of r.mcp_servers) {
    const key = m.package || m.url || `${m.command} (${m.name})`;
    if (!pk.has(key)) pk.set(key, new Set());
    if (m.client) pk.get(key)!.add(m.client);
  }
  const findings = r.findings
    .map((f) => ({ ...f, device_id: dev.id, hostname: dev.hostname }))
    .sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9) || String(a.rule || "").localeCompare(String(b.rule || "")));
  const guard = r.guard_events
    .slice(-200)
    .map((e) => ({ ...e, hostname: dev.hostname }))
    .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
  const u = r.usage ?? undefined;
  const byDay = sumBy(u?.by_day);
  return {
    generated_at: now.toISOString().slice(0, 19) + "+00:00",
    totals: { ...totals, findings: { ...(s.findings ?? {}) } } as Fleet["totals"],
    devices: [{ id: dev.id, hostname: dev.hostname, user: dev.user, os: dev.os, generated_at: r.generated_at, received_at: r.generated_at, summary: s }],
    apps,
    mcp_packages: [...pk].map(([pkg, clients]) => ({ package: pkg, devices: 1, clients: [...clients].sort() })),
    findings,
    usage: {
      by_model: sumBy(u?.by_model),
      by_day: Object.fromEntries(Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b))),
      by_app: sumBy(u?.by_app),
    },
    guard_events: guard.slice(0, 500),
    browser: { sites: [], detectors: [], profiles: [], events: [], by_day: {} },
  };
}

type UsageExtra = {
  sessions?: Obj[];
  by_project?: Record<string, Obj>;
  tools?: Record<string, unknown>;
  mcp_calls?: Record<string, Record<string, unknown>>;
  risky_events?: Obj[];
  by_app?: Record<string, Obj>;
  cost?: { unpriced_models?: string[]; unverified_price_models?: string[]; prices_as_of?: string };
};

const str = (v: unknown) => (v == null ? undefined : String(v));

/** server.insights() over one report. */
export function insightsFromReport(r: Report): Insights {
  const did = String(r.device.id);
  const host = String(r.device.hostname ?? "");
  const u = (r.usage ?? {}) as UsageExtra;
  const sessions = (u.sessions ?? [])
    .filter((s) => isObj(s) && s.start)
    .map((s) => ({
      app: String(s.app ?? ""),
      project: str(s.project) ?? null,
      start: String(s.start),
      end: str(s.end) ?? null,
      models: Array.isArray(s.models) ? s.models.map(String) : undefined,
      input_tokens: num(s.input_tokens),
      output_tokens: num(s.output_tokens),
      cache_read_tokens: num(s.cache_read_tokens),
      cost_usd: num(s.cost_usd),
      tool_calls: num(s.tool_calls),
      mcp_servers: Array.isArray(s.mcp_servers) ? s.mcp_servers.map(String) : undefined,
      hostname: host,
      device_id: did,
    }))
    .sort((a, b) => b.start.localeCompare(a.start));
  let byProject: Record<string, Obj> = isObj(u.by_project) ? u.by_project : {};
  if (!Object.keys(byProject).length) {
    byProject = {};
    for (const s of u.sessions ?? []) {
      const b = (byProject[String(s.project || "(no project)")] ??= {});
      for (const k of ["input_tokens", "output_tokens", "cache_read_tokens", "cost_usd"]) b[k] = num(b[k]) + num(s[k]);
    }
  }
  const nSessions: Record<string, number> = {};
  for (const s of u.sessions ?? []) nSessions[String(s.project)] = (nSessions[String(s.project)] || 0) + 1;
  const projects = Object.entries(byProject)
    .map(([project, t]) => ({
      device_id: did,
      hostname: host,
      project,
      sessions: nSessions[project] || 0,
      input_tokens: num(t.input_tokens),
      output_tokens: num(t.output_tokens),
      cache_read_tokens: num(t.cache_read_tokens),
      cost_usd: num(t.cost_usd),
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd || b.output_tokens - a.output_tokens);
  const tools = Object.entries(u.tools ?? {})
    .map(([tool, n]) => ({ tool, calls: Math.trunc(num(n)) }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 40);
  const mcp = Object.entries(u.mcp_calls ?? {})
    .map(([server, calls]) => {
      const list = Object.entries(calls ?? {}).map(([tool, n]) => ({ tool, calls: Math.trunc(num(n)) })).sort((a, b) => b.calls - a.calls);
      return { server, calls: list.reduce((t, x) => t + x.calls, 0), tools: list.slice(0, 8) };
    })
    .sort((a, b) => b.calls - a.calls);
  const risky = (u.risky_events ?? [])
    .map((e) => ({
      timestamp: str(e.timestamp),
      app: str(e.app),
      tool: str(e.tool),
      rule: str(e.rule),
      action: str(e.action),
      reason: str(e.reason),
      project: str(e.project),
      subject: str(e.subject),
      hostname: host,
      device_id: did,
    }))
    .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  const tok = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0 };
  for (const t of Object.values(u.by_app ?? {})) for (const k of Object.keys(tok) as (keyof typeof tok)[]) tok[k] += num(t[k]);
  const c = (r as unknown as { claude?: Obj }).claude ?? {};
  const hooks = Array.isArray(c.hooks) ? (c.hooks as Obj[]) : [];
  const skills = Array.isArray(c.skills) ? (c.skills as Obj[]) : [];
  const cost = u.cost ?? {};
  return {
    sessions: sessions.slice(0, 500),
    sessions_total: sessions.length,
    projects: projects.slice(0, 100),
    tools,
    mcp_calls: mcp,
    risky_events: risky.slice(0, 300),
    risky_total: risky.length,
    agents: [
      {
        device_id: did,
        hostname: host,
        guard_installed: !!r.summary?.guard_installed,
        hooks: hooks.map((h) => ({ event: str(h.event), matcher: str(h.matcher), scope: str(h.scope) })),
        plugins: Array.isArray(c.plugins) ? c.plugins.map(String) : [],
        agents: Array.isArray(c.agents) ? c.agents.map(String) : [],
        skills: skills.filter(isObj).map((s) => String(s.name)),
        default_mode: isObj(c.permissions) ? (str(c.permissions.defaultMode) ?? null) : null,
      },
    ],
    tokens: tok,
    pricing: {
      unpriced_models: [...(cost.unpriced_models ?? [])].sort(),
      unverified_models: [...(cost.unverified_price_models ?? [])].sort(),
      prices_as_of: cost.prices_as_of ?? null,
    },
  };
}
