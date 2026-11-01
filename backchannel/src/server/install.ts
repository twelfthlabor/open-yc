// Adds or removes the backchannel hook in Claude Code and Codex settings.
//
// - Claude Code: ~/.claude/settings.json, or <project>/.claude/settings.local.json with --project.
//   Exec form (command = node, args = [hook, agent]) so a path with spaces needs no shell quoting.
// - Codex: ~/.codex/hooks.json, or <project>/.codex/hooks.json. Codex runs hook commands through a
//   shell (PowerShell on Windows), so the command is a quoted string. Codex runs a new or changed
//   hook only after you trust it with /hooks.
//
// Existing hooks are left alone, the file is backed up to <file>.backchannel.bak before the first
// change, and installing twice is a no-op.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentKind } from "../core/types.ts";

export const HOOK_FILE = "backchannel-hook.mjs";
export const HOOK_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "hook", HOOK_FILE);

export const EVENTS: Record<AgentKind, string[]> = {
  "claude-code": ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "Notification"],
  codex: ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "PermissionRequest"],
};

const TOOL_EVENTS = new Set(["PostToolUse", "PermissionRequest"]);

interface Handler {
  type: "command";
  command: string;
  args?: string[];
  timeout: number;
}

export function handlerFor(agent: AgentKind, opts: { node?: string; hook?: string; platform?: string } = {}): Handler {
  const node = (opts.node ?? process.execPath).replace(/\\/g, "/");
  const hook = (opts.hook ?? HOOK_PATH).replace(/\\/g, "/");
  if (agent === "claude-code") return { type: "command", command: node, args: [hook, agent], timeout: 5 };
  const q = (s: string) => `"${s}"`;
  const win = (opts.platform ?? process.platform) === "win32";
  // PowerShell needs the call operator before a quoted executable path.
  return { type: "command", command: `${win ? "& " : ""}${q(node)} ${q(hook)} codex`, timeout: 5 };
}

function isOurs(h: unknown): boolean {
  if (!h || typeof h !== "object") return false;
  const x = h as Handler;
  return `${x.command ?? ""} ${(x.args ?? []).join(" ")}`.includes(HOOK_FILE);
}

function load(path: string): any {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8").replace(/^﻿/, "").trim();
  const data = text ? JSON.parse(text) : {};
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${path} is not a JSON object`);
  if (data.hooks != null && (typeof data.hooks !== "object" || Array.isArray(data.hooks))) throw new Error(`${path}: "hooks" is not an object`);
  return data;
}

function save(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const backup = `${path}.backchannel.bak`;
  if (existsSync(path) && !existsSync(backup)) copyFileSync(path, backup);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

export function settingsPath(agent: AgentKind, scope: { userHome: string; project?: string; claudeDir?: string; codexDir?: string }): string {
  if (agent === "claude-code") return scope.project ? join(scope.project, ".claude", "settings.local.json") : join(scope.claudeDir ?? join(scope.userHome, ".claude"), "settings.json");
  return scope.project ? join(scope.project, ".codex", "hooks.json") : join(scope.codexDir ?? join(scope.userHome, ".codex"), "hooks.json");
}

export function install(agent: AgentKind, path: string, handler: Handler = handlerFor(agent)): string[] {
  const data = load(path);
  data.hooks ??= {};
  const added: string[] = [];
  for (const event of EVENTS[agent]) {
    const groups: any[] = Array.isArray(data.hooks[event]) ? data.hooks[event] : [];
    if (groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some(isOurs))) continue;
    groups.push({ ...(TOOL_EVENTS.has(event) ? { matcher: "*" } : {}), hooks: [handler] });
    data.hooks[event] = groups;
    added.push(event);
  }
  if (added.length) save(path, data);
  return added;
}

export function uninstall(path: string): string[] {
  if (!existsSync(path)) return [];
  const data = load(path);
  const removed: string[] = [];
  for (const [event, groups] of Object.entries<any>(data.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    const kept: any[] = [];
    let changed = false;
    for (const g of groups) {
      if (!Array.isArray(g?.hooks)) {
        kept.push(g);
        continue;
      }
      const hooks = g.hooks.filter((h: unknown) => !isOurs(h));
      if (hooks.length !== g.hooks.length) changed = true;
      if (hooks.length) kept.push({ ...g, hooks });
    }
    if (!changed) continue;
    removed.push(event);
    if (kept.length) data.hooks[event] = kept;
    else delete data.hooks[event];
  }
  if (removed.length) {
    if (data.hooks && !Object.keys(data.hooks).length) delete data.hooks;
    save(path, data);
  }
  return removed;
}

export function status(path: string): string[] {
  if (!existsSync(path)) return [];
  const data = load(path);
  return Object.entries<any>(data.hooks ?? {})
    .filter(([, groups]) => Array.isArray(groups) && groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some(isOurs)))
    .map(([event]) => event);
}
