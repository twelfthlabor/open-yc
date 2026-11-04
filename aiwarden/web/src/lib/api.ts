import { fleetFromReport, insightsFromReport } from "./localReport";
import type { AskResult, Alert, Decision, Fleet, Insights, Meta, Report, Rules, Weekly } from "./types";

const KEY = "aiwarden_token";
let memory = "";

/** Set only in the hosted demo build (npm run build:demo): the public token of the read-only demo collector. */
export const DEMO_TOKEN: string = import.meta.env.VITE_DEMO_TOKEN || "";

export class Unauthorized extends Error {}

/** A page that needs the Python backend (Ask, Alerts, Weekly) was asked for while a report file is open. */
export class LocalOnly extends Error {}

// "Open your own report": while a file is open, every data call is answered from it in this tab. The report never
// goes over the network; only the guard tester (/api/rules, /api/check) still asks the server, with no report data.
let file: { report: Report; name: string } | null = null;
const listeners = new Set<() => void>();

export function setFileReport(report: Report, name: string) {
  file = { report, name };
  listeners.forEach((f) => f());
}

export function clearFileReport() {
  if (!file) return;
  file = null;
  listeners.forEach((f) => f());
}

export function fileReportName(): string | null {
  return file ? file.name : null;
}

export function onSourceChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

function fromFile<T>(make: (r: Report) => T): Promise<T> | null {
  return file ? Promise.resolve(make(file.report)) : null;
}

const localOnly = (what: string) => Promise.reject(new LocalOnly(`${what} runs in the aiwarden backend, so it needs the local install: aiwarden serve --local`));

export const tokenStore = {
  get(): string {
    try {
      return localStorage.getItem(KEY) || memory || DEMO_TOKEN;
    } catch {
      return memory || DEMO_TOKEN;
    }
  },
  set(t: string) {
    memory = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* storage blocked: the token lives in memory for this tab */
    }
  },
  clear() {
    memory = "";
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};

/** `aiwarden serve` prints a link ending in #token=...; keep the token and drop it from the address bar. */
export function adoptTokenFromHash(loc: Location = window.location, hist: History = window.history): boolean {
  const m = /(?:^#|&)token=([A-Za-z0-9_-]{8,200})/.exec(loc.hash);
  if (!m) return false;
  tokenStore.set(m[1]);
  hist.replaceState(null, "", `${loc.pathname}${loc.search}#/`);
  return true;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // The local console (aiwarden serve --local) needs no token; send one only when there is one.
  const t = tokenStore.get();
  const headers: Record<string, string> = t ? { Authorization: `Bearer ${t}` } : {};
  if (init?.body) headers["Content-Type"] = "application/json";
  const r = await fetch(path, { ...init, headers });
  if (r.status === 401) throw new Unauthorized("The collector rejected this token.");
  let body: unknown = null;
  try {
    body = await r.json();
  } catch {
    /* not JSON */
  }
  if (!r.ok) {
    const err = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "";
    throw new Error(err || `${r.status} ${r.statusText}`);
  }
  return body as T;
}

function post<T>(path: string, data: unknown): Promise<T> {
  return call<T>(path, { method: "POST", body: JSON.stringify(data) });
}

const FILE_META: Meta = { mode: "file", auth: "none", read_only: true, rescan: { available: false, running: false, last: null, error: null } };

export const api = {
  meta: () => fromFile(() => FILE_META) ?? call<Meta>("/api/meta"),
  fleet: () => fromFile((r) => fleetFromReport(r)) ?? call<Fleet>("/api/fleet"),
  insights: () => fromFile(insightsFromReport) ?? call<Insights>("/api/insights"),
  rescan: () => post<{ started: boolean; running: boolean }>("/api/rescan", {}),
  device: (id: string) =>
    file
      ? file.report.device.id === id
        ? Promise.resolve(file.report)
        : Promise.reject(new Error("That device is not in this report."))
      : call<Report>(`/api/devices/${encodeURIComponent(id)}`),
  rules: () => call<Rules>("/api/rules"),
  weekly: (asOf?: string) => (file ? localOnly("The weekly report") : call<Weekly>(`/api/weekly${asOf ? `?as_of=${encodeURIComponent(asOf)}` : ""}`)),
  alerts: () => (file ? localOnly("Alerts") : call<{ alerts: Alert[] }>("/api/alerts")),
  ask: (question: string) => (file ? localOnly("Ask") : post<AskResult>("/api/ask", { question })),
  check: (agent: string, tool: string, input: Record<string, unknown>) => post<Decision>("/api/check", { agent, tool, input }),
};
