#!/usr/bin/env node
// Hook relay for Claude Code and Codex. Both agents run it on lifecycle events with one JSON
// object on stdin. It forwards a trimmed copy of the event to the local backchannel server and,
// when the user has replied to this session in the chat, prints the reply in the shape the
// agent expects so the agent reads it.
//
// It must never slow down or break an agent session: it gives up after a short timeout and
// exits 0 with no output whenever the server is missing, slow or returns an error.
//
// Plain ESM with no dependencies on purpose: it runs on every tool call.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const TIMEOUT_MS = Number(process.env.BACKCHANNEL_HOOK_TIMEOUT_MS || 1500);
const MAX_FIELD = 2000;

// Events whose output can carry a reply into the agent's context.
const DELIVERS = new Set(["PostToolUse", "Stop", "UserPromptSubmit", "SessionStart", "SubagentStop"]);

function home() {
  return process.env.BACKCHANNEL_HOME || join(homedir(), ".backchannel");
}

function clip(value) {
  if (value == null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD)}…` : text;
}

// Only the fields the server uses. Tool output can be megabytes; the transcript has the rest.
export function trim(event) {
  const input = event.tool_input;
  return {
    hook_event_name: event.hook_event_name,
    session_id: event.session_id,
    transcript_path: event.transcript_path ?? undefined,
    cwd: event.cwd,
    model: event.model,
    turn_id: event.turn_id,
    tool_name: event.tool_name,
    tool_use_id: event.tool_use_id,
    tool_input: input === undefined ? undefined : clip(input),
    tool_description: input && typeof input === "object" ? clip(input.description) : undefined,
    notification_type: event.notification_type,
    message: clip(event.message),
    title: clip(event.title),
    prompt: clip(event.prompt),
    last_assistant_message: clip(event.last_assistant_message),
    stop_hook_active: event.stop_hook_active,
    source: event.source,
    permission_mode: event.permission_mode,
  };
}

// The JSON each agent reads back for a delivered reply. Claude Code and Codex share these shapes:
// Stop/SubagentStop continue the turn with `reason` as the next instruction; the other events
// add `additionalContext` next to the tool result or prompt.
export function render(eventName, text) {
  if (!text || !DELIVERS.has(eventName)) return null;
  if (eventName === "Stop" || eventName === "SubagentStop") return { decision: "block", reason: text };
  return { hookSpecificOutput: { hookEventName: eventName, additionalContext: text } };
}

export async function relay(agent, raw) {
  if (!raw.trim()) return null;
  const event = JSON.parse(raw);
  const server = JSON.parse(readFileSync(join(home(), "server.json"), "utf8"));
  const res = await fetch(`http://127.0.0.1:${server.port}/api/hook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-backchannel-token": server.token },
    body: JSON.stringify({ agent, event: trim(event) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return render(event.hook_event_name, body.deliver);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {}
  relay(process.argv[2] || "claude-code", raw)
    .then((out) => {
      if (out) process.stdout.write(JSON.stringify(out));
    })
    .catch(() => {})
    .finally(() => process.exit(0));
}
