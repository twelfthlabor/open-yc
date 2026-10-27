import type { AskResult, Alert, Decision, Fleet, Report, Rules, Weekly } from "./types";

const KEY = "aiwarden_token";
let memory = "";

/** Set only in the hosted demo build (npm run build:demo): the public token of the read-only demo collector. */
export const DEMO_TOKEN: string = import.meta.env.VITE_DEMO_TOKEN || "";

export class Unauthorized extends Error {}

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
  const headers: Record<string, string> = { Authorization: `Bearer ${tokenStore.get()}` };
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

export const api = {
  fleet: () => call<Fleet>("/api/fleet"),
  device: (id: string) => call<Report>(`/api/devices/${encodeURIComponent(id)}`),
  rules: () => call<Rules>("/api/rules"),
  weekly: (asOf?: string) => call<Weekly>(`/api/weekly${asOf ? `?as_of=${encodeURIComponent(asOf)}` : ""}`),
  alerts: () => call<{ alerts: Alert[] }>("/api/alerts"),
  ask: (question: string) => post<AskResult>("/api/ask", { question }),
  check: (agent: string, tool: string, input: Record<string, unknown>) => post<Decision>("/api/check", { agent, tool, input }),
};
