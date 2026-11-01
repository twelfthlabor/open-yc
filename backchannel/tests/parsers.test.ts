import { describe, expect, it } from "vitest";
import { newClaudeState, parseClaude } from "../src/core/claude.ts";
import { newCodexState, parseCodex } from "../src/core/codex.ts";
import type { AgentEvent } from "../src/core/types.ts";
import { COD, CWD, SID, claudeAssistant, claudeUser, codex, codexTokens } from "./fixtures.ts";

const kinds = (evs: AgentEvent[]) => evs.map((e) => e.kind);

describe("Claude Code transcripts", () => {
  it("announces the session once, with cwd and branch", () => {
    const st = newClaudeState();
    const a = parseClaude(claudeUser("Add a /health endpoint"), st);
    const b = parseClaude(claudeUser("and tests"), st);
    expect(a[0]).toMatchObject({ kind: "session", sessionId: SID, agent: "claude-code", cwd: CWD, branch: "main" });
    expect(kinds(b)).toEqual(["prompt"]);
  });

  it("skips prompts Claude Code writes itself and meta records", () => {
    const st = newClaudeState();
    parseClaude(claudeUser("first"), st);
    expect(parseClaude(claudeUser("<command-name>/clear</command-name>"), st)).toEqual([]);
    expect(parseClaude(claudeUser("Caveat text", 0, { isMeta: true }), st)).toEqual([]);
    expect(parseClaude(claudeUser("[Request interrupted by user]"), st)).toEqual([]);
  });

  it("ignores internal record types that repeat message content", () => {
    const st = newClaudeState();
    const blob = { type: "api-request-blob", sessionId: SID, message: { role: "assistant", content: [{ type: "text", text: "dup" }] } };
    expect(parseClaude(blob, st)).toEqual([]);
    expect(parseClaude({ type: "attachment", sessionId: SID, cwd: CWD }, st)).toEqual([]);
    expect(parseClaude({ type: "assistant", sessionId: SID, isSidechain: true, cwd: CWD, message: { content: [] } }, st)).toEqual([]);
  });

  it("reads tool calls, results, errors and the files they touch", () => {
    const st = newClaudeState();
    const evs = [
      ...parseClaude(claudeAssistant("m1", [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/x/src/app.ts", old_string: "a", new_string: "b" } }]), st),
      ...parseClaude(claudeAssistant("m2", [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "npm test", description: "Run the tests" } }]), st),
      ...parseClaude(claudeUser([{ type: "tool_result", tool_use_id: "t2", is_error: true, content: "FAIL src/app.test.ts\n  expected 200" }]), st),
      ...parseClaude(claudeAssistant("m3", [{ type: "tool_use", id: "t3", name: "mcp__github__create_issue", input: { title: "x" } }]), st),
      ...parseClaude(claudeAssistant("m4", [{ type: "tool_use", id: "t4", name: "Skill", input: { skill: "pdf" } }]), st),
    ];
    const tools = evs.filter((e) => e.kind === "tool");
    expect(tools.map((e) => (e as any).summary)).toEqual(["edited src/app.ts", "Run the tests", "github · create_issue", "used the pdf skill"]);
    expect((tools[0] as any).files).toEqual(["/x/src/app.ts"]);
    expect((tools[2] as any).mcpServer).toBe("github");
    expect((tools[3] as any).skill).toBe("pdf");
    const result = evs.find((e) => e.kind === "tool_result") as any;
    expect(result).toMatchObject({ id: "t2", isError: true, excerpt: "FAIL src/app.test.ts" });
    // a tool_result record is not a prompt
    expect(evs.some((e) => e.kind === "prompt")).toBe(false);
  });

  it("keys usage by message id so a message written as several records counts once", () => {
    const st = newClaudeState();
    const a = parseClaude(claudeAssistant("msg_same", [{ type: "thinking", thinking: "" }]), st);
    const b = parseClaude(claudeAssistant("msg_same", [{ type: "tool_use", id: "t", name: "Read", input: { file_path: "a" } }]), st);
    const keys = [...a, ...b].filter((e) => e.kind === "usage").map((e) => (e as any).key);
    expect(keys).toEqual(["claude:msg_same", "claude:msg_same"]);
    const u = a.find((e) => e.kind === "usage") as any;
    expect(u).toMatchObject({ input: 10, output: 100, cacheRead: 1000, cacheWrite1h: 500, cacheWrite5m: 0, provider: "anthropic" });
  });

  it("splits cache writes into 5-minute and 1-hour when only the total is given", () => {
    const st = newClaudeState();
    const evs = parseClaude(claudeAssistant("m", [], 0, { usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 300 } }), st);
    expect(evs.find((e) => e.kind === "usage")).toMatchObject({ cacheWrite5m: 300, cacheWrite1h: 0 });
  });

  it("marks the end of a turn and the final text", () => {
    const st = newClaudeState();
    const evs = parseClaude(claudeAssistant("m", [{ type: "text", text: "Added the endpoint. Tests pass." }], 0, { stop: "end_turn" }), st);
    expect(evs.find((e) => e.kind === "text")).toMatchObject({ final: true });
    expect(evs.find((e) => e.kind === "turn_end")).toMatchObject({ text: "Added the endpoint. Tests pass." });
  });

  it("ends the turn once when the final message is split into thinking and text records", () => {
    const st = newClaudeState();
    const a = parseClaude(claudeAssistant("m", [{ type: "thinking", thinking: "" }], 0, { stop: "end_turn" }), st);
    const b = parseClaude(claudeAssistant("m", [{ type: "text", text: "Blocked: no .env file." }], 0, { stop: "end_turn" }), st);
    expect(a.some((e) => e.kind === "turn_end")).toBe(false);
    expect(b.filter((e) => e.kind === "turn_end")).toHaveLength(1);
  });

  it("turns AskUserQuestion into an attention event, and reads ai-title", () => {
    const st = newClaudeState();
    const evs = parseClaude(claudeAssistant("m", [{ type: "tool_use", id: "q", name: "AskUserQuestion", input: { questions: [{ question: "Postgres or SQLite?" }] } }]), st);
    expect(evs.find((e) => e.kind === "attention")).toMatchObject({ reason: "question", text: "Postgres or SQLite?" });
    expect(parseClaude({ type: "ai-title", aiTitle: "Health endpoint", sessionId: SID }, st)[0]).toMatchObject({ kind: "session", title: "Health endpoint" });
  });

  it("ignores synthetic model records", () => {
    const st = newClaudeState();
    const evs = parseClaude(claudeAssistant("m", [{ type: "text", text: "x" }], 0, { model: "<synthetic>" }), st);
    expect(evs.some((e) => e.kind === "usage")).toBe(false);
  });
});

describe("Codex transcripts", () => {
  const meta = codex("session_meta", { id: COD, cwd: "/home/dev/web", git: { branch: "feat/login" } });

  it("reads the session, model, prompts and replies", () => {
    const st = newCodexState();
    const evs = [
      ...parseCodex(meta, st),
      ...parseCodex(codex("turn_context", { model: "gpt-5-codex", cwd: "/home/dev/web" }), st),
      ...parseCodex(codex("event_msg", { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "Fix the login bug" }] } }), st),
      ...parseCodex(codex("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>…" }] }), st),
      ...parseCodex(codex("response_item", { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "Looking at auth.ts first." }] }), st),
    ];
    expect(evs[0]).toMatchObject({ kind: "session", agent: "codex", sessionId: COD, cwd: "/home/dev/web", branch: "feat/login" });
    expect(evs.find((e) => e.kind === "session" && (e as any).model)).toMatchObject({ model: "gpt-5-codex" });
    expect(evs.filter((e) => e.kind === "prompt").map((e) => (e as any).text)).toEqual(["Fix the login bug"]);
    expect(evs.find((e) => e.kind === "text")).toMatchObject({ text: "Looking at auth.ts first.", final: false });
  });

  it("reads exec code-mode calls, patches, and failed outputs", () => {
    const st = newCodexState();
    parseCodex(meta, st);
    const exec = parseCodex(codex("response_item", { type: "custom_tool_call", call_id: "c1", name: "exec", input: 'const r = await tools.exec_command({"cmd":"npm test -- auth"});' }), st);
    const patch = parseCodex(codex("response_item", { type: "custom_tool_call", call_id: "c2", name: "apply_patch", input: "*** Begin Patch\n*** Update File: src/auth.ts\n@@\n-a\n+b\n*** End Patch" }), st);
    const fn = parseCodex(codex("response_item", { type: "function_call", call_id: "c3", name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", "ls"] }) }), st);
    const out = parseCodex(codex("response_item", { type: "custom_tool_call_output", call_id: "c1", output: [{ type: "input_text", text: "Script failed\nWall time 0.4 seconds" }] }), st);
    const ok = parseCodex(codex("response_item", { type: "function_call_output", call_id: "c3", output: JSON.stringify({ output: "a\nb", metadata: { exit_code: 0 } }) }), st);
    expect(exec[0]).toMatchObject({ kind: "tool", name: "exec_command", summary: "npm test -- auth" });
    expect(patch[0]).toMatchObject({ kind: "tool", files: ["src/auth.ts"], summary: "patched src/auth.ts" });
    expect(fn[0]).toMatchObject({ kind: "tool", summary: "bash -lc ls" });
    expect(out[0]).toMatchObject({ kind: "tool_result", id: "c1", isError: true });
    expect(ok[0]).toMatchObject({ kind: "tool_result", id: "c3", isError: false, excerpt: "a" });
  });

  it("turns cumulative token totals into increments and drops repeats", () => {
    const st = newCodexState();
    parseCodex(meta, st);
    parseCodex(codex("turn_context", { model: "gpt-5-codex" }), st);
    const a = parseCodex(codexTokens(1000, 200, 50), st);
    const repeat = parseCodex(codexTokens(1000, 200, 50), st);
    const b = parseCodex(codexTokens(2500, 1200, 80), st);
    expect(repeat).toEqual([]);
    expect(a[0]).toMatchObject({ kind: "usage", provider: "openai", model: "gpt-5-codex", input: 800, cacheRead: 200, output: 50 });
    expect(b[0]).toMatchObject({ input: 500, cacheRead: 1000, output: 30 });
  });

  it("reads approvals and the end of a task", () => {
    const st = newCodexState();
    parseCodex(meta, st);
    expect(parseCodex(codex("event_msg", { type: "exec_approval_request", command: ["git", "push"] }), st)[0]).toMatchObject({ kind: "attention", reason: "approval", text: "git push" });
    expect(parseCodex(codex("event_msg", { type: "task_complete", last_agent_message: "Fixed it." }), st)[0]).toMatchObject({ kind: "turn_end", text: "Fixed it." });
  });

  it("reads Windows paths from a patch inside a code-mode string", () => {
    const st = newCodexState();
    parseCodex(meta, st);
    const code = 'await tools.apply_patch("*** Begin Patch\\n*** Add File: D:\\\\work\\\\notes\\\\todo.txt\\n+a\\n*** End Patch");';
    expect(parseCodex(codex("response_item", { type: "custom_tool_call", call_id: "x", name: "exec", input: code }), st)[0]).toMatchObject({ files: ["D:\\work\\notes\\todo.txt"] });
  });

  it("ignores lines before session_meta", () => {
    expect(parseCodex(codexTokens(1, 0, 1), newCodexState())).toEqual([]);
  });
});
