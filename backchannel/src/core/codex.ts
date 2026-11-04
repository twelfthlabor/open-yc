// Codex transcripts: ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl.
// Each line is { timestamp, type, payload }. Token counts arrive as cumulative totals in
// `event_msg/token_count`; the parser turns them into increments so totals are never summed twice
// (`token_usage_record` repeats the same numbers and is ignored).
import type { AgentEvent } from "./types.ts";
import { describeTool, firstLine, patchFiles, unescapeJs } from "./tools.ts";

export interface CodexState {
  sessionId?: string;
  model?: string;
  lastTotal: { input: number; cached: number; output: number; total: number };
  calls: Map<string, string>; // call_id -> tool name
}

export function newCodexState(): CodexState {
  return { lastTotal: { input: 0, cached: 0, output: 0, total: 0 }, calls: new Map() };
}

type Rec = Record<string, any>;

function outputText(output: unknown): string {
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output);
      if (parsed && typeof parsed === "object" && "output" in parsed) return String(parsed.output);
    } catch {}
    return output;
  }
  if (Array.isArray(output)) return output.map((p) => (typeof p === "string" ? p : String(p?.text ?? ""))).join("\n");
  return "";
}

function failed(text: string): boolean {
  return /Script failed|Process exited with code [1-9]|exit code:? [1-9]\d*|Exit code: [1-9]|\berror\b:/i.test(text.slice(0, 600));
}

// The `exec` tool in newer Codex builds takes a small JS program that calls tools.exec_command
// and tools.apply_patch. Pull the shell commands and patched files out of it.
function describeExec(code: string) {
  const cmds = [...code.matchAll(/"cmd"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => {
    try {
      return JSON.parse(`"${m[1]}"`) as string;
    } catch {
      return m[1];
    }
  });
  const files = patchFiles(unescapeJs(code));
  if (files.length) return { name: "apply_patch", summary: `patched ${files.join(", ")}`, files };
  return { name: "exec_command", summary: firstLine(cmds.join(" && ") || code, 100), files: [] as string[] };
}

export function parseCodex(rec: Rec, state: CodexState): AgentEvent[] {
  const out: AgentEvent[] = [];
  // A JSONL line can hold any JSON value; only objects are records.
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return out;
  const ts: string = rec.timestamp ?? new Date(0).toISOString();
  const p: Rec = rec.payload ?? {};

  if (rec.type === "session_meta") {
    state.sessionId = String(p.id ?? p.session_id ?? "");
    if (state.sessionId) out.push({ kind: "session", sessionId: state.sessionId, agent: "codex", ts, cwd: p.cwd, branch: p.git?.branch });
    return out;
  }
  const sessionId = state.sessionId;
  if (!sessionId) return out;

  if (rec.type === "turn_context") {
    if (p.model && p.model !== state.model) {
      state.model = String(p.model);
      out.push({ kind: "session", sessionId, agent: "codex", ts, model: state.model, cwd: p.cwd });
    }
    return out;
  }

  if (rec.type === "response_item") {
    if (p.type === "message" && p.role === "assistant") {
      const text = (p.content ?? []).map((c: Rec) => c?.text ?? "").join("\n").trim();
      if (text) out.push({ kind: "text", sessionId, ts, text, final: p.phase === "final_answer" });
    } else if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") {
      const callId = String(p.call_id ?? p.id ?? "");
      let input: Rec = {};
      let raw = "";
      if (p.type === "function_call") {
        raw = String(p.arguments ?? "");
        try {
          input = JSON.parse(raw);
        } catch {}
      } else if (p.type === "local_shell_call") {
        input = { command: p.action?.command ?? [] };
        raw = JSON.stringify(input);
      } else {
        raw = String(p.input ?? "");
        input = { input: raw };
      }
      const name = String(p.name ?? (p.type === "local_shell_call" ? "shell" : ""));
      const d = name === "exec" ? describeExec(raw) : describeTool(name === "container.exec" ? "shell" : name, input);
      state.calls.set(callId, d.name);
      out.push({ kind: "tool", sessionId, ts, id: callId, inputChars: raw.length, mcpServer: undefined, skill: undefined, ...d });
    } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
      const text = outputText(p.output);
      out.push({ kind: "tool_result", sessionId, ts, id: String(p.call_id ?? ""), isError: failed(text), excerpt: firstLine(text.replace(/^Script (completed|failed)\s*/i, ""), 200), chars: text.length, sample: text.slice(0, 4000) });
    }
    return out;
  }

  if (rec.type === "event_msg") {
    switch (p.type) {
      case "user_message":
        if (p.message && !String(p.message).trimStart().startsWith("<")) out.push({ kind: "prompt", sessionId, ts, text: String(p.message) });
        break;
      case "item_completed":
        if (p.item?.type === "UserMessage") {
          const text = (p.item.content ?? []).map((c: Rec) => c?.text ?? "").join("\n").trim();
          if (text && !text.startsWith("<")) out.push({ kind: "prompt", sessionId, ts, text });
        }
        break;
      case "token_count": {
        const t = p.info?.total_token_usage;
        if (!t) break;
        const total = Number(t.total_tokens ?? 0);
        if (total <= state.lastTotal.total) break;
        const input = Number(t.input_tokens ?? 0);
        const cached = Number(t.cached_input_tokens ?? 0);
        const output = Number(t.output_tokens ?? 0);
        const prev = state.lastTotal;
        // OpenAI counts cached tokens inside input_tokens; split them out so they are priced as cache reads.
        out.push({
          kind: "usage",
          sessionId,
          ts,
          key: `codex:${sessionId}:${total}`,
          model: state.model ?? "unknown",
          provider: "openai",
          input: Math.max(0, input - cached - (prev.input - prev.cached)),
          output: Math.max(0, output - prev.output),
          cacheRead: Math.max(0, cached - prev.cached),
          cacheWrite5m: 0,
          cacheWrite1h: 0,
        });
        state.lastTotal = { input, cached, output, total };
        break;
      }
      case "task_complete":
        out.push({ kind: "turn_end", sessionId, ts, text: p.last_agent_message ?? undefined });
        break;
      case "exec_approval_request":
      case "apply_patch_approval_request":
        out.push({ kind: "attention", sessionId, ts, reason: "approval", text: firstLine(Array.isArray(p.command) ? p.command.join(" ") : String(p.reason ?? "wants approval"), 120) });
        break;
      default:
        break;
    }
  }
  return out;
}
