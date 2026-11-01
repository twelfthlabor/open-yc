// Synthetic transcript records in the shapes Claude Code and Codex write. No real session data.

export const SID = "11111111-2222-4333-8444-555555555555";
export const CWD = "/home/dev/projects/shop-api";

let n = 0;
const t = (s: number) => new Date(Date.UTC(2026, 9, 28, 12, 0, s)).toISOString();

export function claudeUser(content: unknown, s = 0, extra: Record<string, unknown> = {}) {
  return { type: "user", sessionId: SID, cwd: CWD, gitBranch: "main", timestamp: t(s), uuid: `u${n++}`, message: { role: "user", content }, ...extra };
}

export function claudeAssistant(id: string, content: unknown[], s = 0, opts: { stop?: string; model?: string; usage?: Record<string, unknown> } = {}) {
  return {
    type: "assistant",
    sessionId: SID,
    cwd: CWD,
    gitBranch: "main",
    timestamp: t(s),
    uuid: `a${n++}`,
    message: {
      id,
      model: opts.model ?? "claude-haiku-5-5",
      role: "assistant",
      content,
      stop_reason: opts.stop ?? "tool_use",
      usage: opts.usage ?? {
        input_tokens: 10,
        output_tokens: 100,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 500,
        cache_creation: { ephemeral_1h_input_tokens: 500, ephemeral_5m_input_tokens: 0 },
      },
    },
  };
}

export const COD = "019a0000-0000-7000-8000-00000000c0de";

export function codex(type: string, payload: Record<string, unknown>, s = 0) {
  return { timestamp: t(s), type, payload };
}

export function codexTokens(input: number, cached: number, output: number, s = 0) {
  return codex("event_msg", { type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output } } }, s);
}
