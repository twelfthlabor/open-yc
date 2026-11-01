// Claude Code transcripts: ~/.claude/projects/<project>/<session>.jsonl, one JSON record per line.
// Only `user`, `assistant` and `ai-title` records are read. The file also holds internal records
// (api-request*, attachments, snapshots) that repeat message content and must not be counted.
import type { AgentEvent } from "./types.ts";
import { describeTool, firstLine } from "./tools.ts";

export interface ClaudeState {
  announced: Set<string>;
}

export function newClaudeState(): ClaudeState {
  return { announced: new Set() };
}

type Rec = Record<string, any>;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p) => (p && typeof p === "object" && p.type === "text" ? String(p.text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

// Prompts Claude Code writes on the user's behalf: slash-command wrappers, caveats, reminders.
function isSyntheticPrompt(text: string): boolean {
  const t = text.trimStart();
  return t === "" || t.startsWith("<") || t.startsWith("[Request interrupted");
}

export function parseClaude(rec: Rec, state: ClaudeState): AgentEvent[] {
  const out: AgentEvent[] = [];
  const sessionId: string | undefined = rec.sessionId;
  if (!sessionId) return out;
  const ts: string = rec.timestamp ?? new Date(0).toISOString();

  if (rec.type === "ai-title" && rec.aiTitle) {
    out.push({ kind: "session", sessionId, agent: "claude-code", ts, title: String(rec.aiTitle) });
    return out;
  }
  if (rec.type !== "user" && rec.type !== "assistant") return out;
  if (rec.isSidechain) return out;

  if (!state.announced.has(sessionId) && rec.cwd) {
    state.announced.add(sessionId);
    out.push({ kind: "session", sessionId, agent: "claude-code", ts, cwd: rec.cwd, branch: rec.gitBranch || undefined });
  }

  const msg = rec.message ?? {};
  if (rec.type === "user") {
    const content = msg.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type !== "tool_result") continue;
        const text = typeof part.content === "string" ? part.content : textOf(part.content);
        out.push({
          kind: "tool_result",
          sessionId,
          ts,
          id: String(part.tool_use_id ?? ""),
          isError: Boolean(part.is_error),
          excerpt: firstLine(text, 200),
          chars: text.length,
          sample: text.slice(0, 4000),
        });
      }
    }
    if (!rec.isMeta) {
      const text = textOf(content);
      if (text && !isSyntheticPrompt(text) && !(Array.isArray(content) && content.some((p: Rec) => p?.type === "tool_result"))) {
        out.push({ kind: "prompt", sessionId, ts, text });
      }
    }
    return out;
  }

  // assistant
  const model: string = msg.model ?? "";
  const endTurn = msg.stop_reason === "end_turn";
  for (const part of Array.isArray(msg.content) ? msg.content : []) {
    if (part?.type === "text" && String(part.text ?? "").trim()) {
      out.push({ kind: "text", sessionId, ts, text: String(part.text), final: endTurn });
    } else if (part?.type === "tool_use") {
      const input = part.input ?? {};
      const d = describeTool(String(part.name ?? ""), input);
      out.push({ kind: "tool", sessionId, ts, id: String(part.id ?? ""), ...d, inputChars: JSON.stringify(input).length });
      if (part.name === "AskUserQuestion") {
        const q = Array.isArray(input.questions) ? input.questions.map((x: Rec) => x?.question).filter(Boolean).join(" / ") : "";
        out.push({ kind: "attention", sessionId, ts, reason: "question", text: q || "has a question for you" });
      }
    }
  }
  const u = msg.usage;
  if (u && msg.id && model && model !== "<synthetic>") {
    const split = u.cache_creation ?? {};
    const write1h = Number(split.ephemeral_1h_input_tokens ?? 0);
    const write5m = split.ephemeral_5m_input_tokens != null ? Number(split.ephemeral_5m_input_tokens) : Number(u.cache_creation_input_tokens ?? 0) - write1h;
    out.push({
      kind: "usage",
      sessionId,
      ts,
      key: `claude:${msg.id}`,
      model,
      provider: "anthropic",
      input: Number(u.input_tokens ?? 0),
      output: Number(u.output_tokens ?? 0),
      cacheRead: Number(u.cache_read_input_tokens ?? 0),
      cacheWrite5m: Math.max(0, write5m),
      cacheWrite1h: write1h,
    });
  }
  // Claude Code writes one API message as several records (thinking, then text), each carrying
  // the message's stop_reason. Only the record with the visible text ends the turn.
  const parts: Rec[] = Array.isArray(msg.content) ? msg.content : [];
  const thinkingOnly = parts.length > 0 && parts.every((p) => p?.type === "thinking" || p?.type === "redacted_thinking");
  if (endTurn && !thinkingOnly) {
    const final = textOf(parts);
    out.push({ kind: "turn_end", sessionId, ts, text: final || undefined });
  }
  if (model) out.push({ kind: "session", sessionId, agent: "claude-code", ts, model });
  return out;
}
