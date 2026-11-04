// `backchannel doctor`: checks the setup end to end and says how to fix what is wrong. The most
// common silent failure is a reply that stays queued, and every cause of that shows up here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentKind } from "../core/types.ts";
import { EVENTS, hookTargets, settingsPath, status } from "./install.ts";
import type { Paths } from "./paths.ts";

export interface Check {
  name: string;
  level: "ok" | "warn" | "fail";
  detail: string;
  fix?: string;
}

interface Scope {
  userHome: string;
  project?: string;
  claudeDir?: string;
  codexDir?: string;
}

const LABEL: Record<AgentKind, string> = { "claude-code": "Claude Code", codex: "Codex" };
// Type stripping, which runs src/ straight from a clone, is on by default from 22.18 and from 23.6.
function nodeCheck(version = process.versions.node): Check {
  const [major, minor] = version.split(".").map(Number);
  const ok = major >= 24 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
  return ok
    ? { name: "Node", level: "ok", detail: `v${version}` }
    : { name: "Node", level: "fail", detail: `v${version}; backchannel needs 22.18+ (or 23.6+)`, fix: "Install the current Node LTS from https://nodejs.org" };
}

function hookCheck(agent: AgentKind, scope: Scope): Check {
  const name = `${LABEL[agent]} hook`;
  const where = scope.project ? ` --project ${scope.project}` : "";
  const path = settingsPath(agent, scope);
  let events: string[];
  try {
    events = status(path);
  } catch (e) {
    return { name, level: "fail", detail: `${path} could not be read: ${e instanceof Error ? e.message : e}`, fix: `Fix the JSON in ${path}` };
  }
  if (!events.length) return { name, level: "fail", detail: `not installed in ${path}`, fix: `backchannel hooks install --agent ${agent}${where}` };
  const missing = EVENTS[agent].filter((e) => !events.includes(e));
  const broken = hookTargets(path).flatMap((t) => [!existsSync(t.node) ? `node ${t.node}` : null, !existsSync(t.hook) ? `hook script ${t.hook}` : null]).filter(Boolean);
  if (broken.length) {
    return {
      name,
      level: "fail",
      detail: `${broken.join(" and ")} does not exist, so the hook fails on every call`,
      fix: `backchannel hooks install --agent ${agent}${where}  (repoints the hook at a fresh copy)`,
    };
  }
  if (missing.length) return { name, level: "warn", detail: `installed for ${events.join(", ")} but not ${missing.join(", ")}`, fix: `backchannel hooks install --agent ${agent}${where}` };
  if (agent === "codex") {
    return { name, level: "warn", detail: `installed in ${path}. Codex runs it only after you trust it: open Codex and run /hooks (again after any change)` };
  }
  return { name, level: "ok", detail: `installed in ${path}. Sessions started before the install stay read only` };
}

function dirCheck(name: string, dir: string, agent: string): Check {
  return existsSync(dir) ? { name, level: "ok", detail: dir } : { name, level: "warn", detail: `${dir} does not exist yet; it appears once you run ${agent}` };
}

async function serverCheck(home: string, fetchImpl: typeof fetch): Promise<Check> {
  const file = join(home, "server.json");
  if (!existsSync(file)) return { name: "Server", level: "fail", detail: "not running", fix: "backchannel serve" };
  let info: { port: number; token: string };
  try {
    info = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { name: "Server", level: "fail", detail: `${file} is unreadable`, fix: "backchannel serve" };
  }
  try {
    const res = await fetchImpl(`http://127.0.0.1:${info.port}/api/status`, { headers: { "x-backchannel-token": info.token }, signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { name: "Server", level: "fail", detail: `port ${info.port} answered ${res.status}; another program may hold it`, fix: "backchannel serve --port 47322" };
    const s = (await res.json()) as { sessions: number; files: number };
    return { name: "Server", level: "ok", detail: `listening on http://127.0.0.1:${info.port}/app, ${s.sessions} sessions from ${s.files} transcripts` };
  } catch {
    return { name: "Server", level: "fail", detail: `server.json names port ${info.port}, but the server is not answering there (it was stopped or crashed)`, fix: "backchannel serve" };
  }
}

export async function doctor(opts: { paths: Paths; scope: Scope; fetchImpl?: typeof fetch; nodeVersion?: string }): Promise<Check[]> {
  const { paths, scope } = opts;
  return [
    nodeCheck(opts.nodeVersion),
    hookCheck("claude-code", scope),
    hookCheck("codex", scope),
    dirCheck("Claude Code transcripts", paths.claudeProjects, "Claude Code"),
    dirCheck("Codex transcripts", paths.codexSessions, "Codex"),
    await serverCheck(paths.home, opts.fetchImpl ?? fetch),
  ];
}

export function formatChecks(checks: Check[]): string {
  const mark = { ok: "ok  ", warn: "warn", fail: "FAIL" };
  return checks.map((c) => `${mark[c.level]}  ${c.name}: ${c.detail}${c.fix ? `\n      fix: ${c.fix}` : ""}`).join("\n");
}
