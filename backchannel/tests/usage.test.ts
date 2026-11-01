import { describe, expect, it } from "vitest";
import { costOf, priceFor } from "../src/core/pricing.ts";
import type { AgentEvent } from "../src/core/types.ts";
import { UsageLedger } from "../src/core/usage.ts";

const usage = (key: string, model: string, over: Partial<Extract<AgentEvent, { kind: "usage" }>> = {}): AgentEvent => ({
  kind: "usage",
  sessionId: "s1",
  ts: "2026-10-28T12:00:00.000Z",
  key,
  model,
  provider: model.startsWith("claude") ? "anthropic" : "openai",
  input: 1_000_000,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  ...over,
});

describe("pricing", () => {
  it("matches dated and prefixed model ids to the table", () => {
    expect(priceFor("claude-sonnet-4-5-20250929")?.input).toBe(3);
    expect(priceFor("us.anthropic.claude-opus-4-1-v1:0")?.input).toBe(15);
    expect(priceFor("claude-haiku-5-5")).toMatchObject({ input: 0.1, output: 0.5, verified: true });
  });

  it("does not price a different model that shares a prefix", () => {
    expect(priceFor("gpt-5.6-terra")).toBeNull();
    expect(priceFor("claude-opus-5x")).toBeNull();
    expect(priceFor(undefined)).toBeNull();
  });

  it("prices cache writes at 1.25x (5 minutes) and 2x (1 hour) input, reads at the listed rate", () => {
    const t = { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000 };
    // haiku-5-5: input 0.10 -> read 0.01 (0.1x), 5m write 0.125, 1h write 0.20
    expect(costOf("claude-haiku-5-5", t)).toBeCloseTo(0.01 + 0.125 + 0.2, 10);
    // opus-5-5 lists its own cache read price
    expect(costOf("claude-opus-5-5", { ...t, cacheWrite5m: 0, cacheWrite1h: 0 })).toBeCloseTo(0.2, 10);
  });
});

describe("usage ledger", () => {
  it("counts a repeated record once", () => {
    const l = new UsageLedger();
    l.add(usage("claude:m1", "claude-haiku-5-5"));
    l.add(usage("claude:m1", "claude-haiku-5-5"));
    const r = l.report();
    expect(r.totals.input).toBe(1_000_000);
    expect(r.totals.costUsd).toBeCloseTo(0.1, 10);
  });

  it("reports unpriced models as unpriced tokens, not as free", () => {
    const l = new UsageLedger();
    l.add(usage("a", "gpt-5.6-terra", { input: 500 }));
    l.add(usage("b", "claude-haiku-5-5"));
    const r = l.report();
    expect(r.totals.unpriced).toBe(500);
    expect(r.byModel.find((m) => m.key === "gpt-5.6-terra")).toMatchObject({ costUsd: 0, unpriced: 500 });
    expect(l.sessionTotals("s1").costUsd).toBeCloseTo(0.1, 10);
  });

  it("gives null session cost when nothing in the session has a price", () => {
    const l = new UsageLedger();
    l.add(usage("a", "mystery-model", { sessionId: "s2" }));
    expect(l.sessionTotals("s2")).toEqual({ tokens: 1_000_000, costUsd: null });
  });

  it("groups by provider, model, session and day, and filters by since", () => {
    const l = new UsageLedger();
    l.add(usage("a", "claude-haiku-5-5", { ts: "2026-10-27T10:00:00.000Z" }));
    l.add(usage("b", "gpt-5-codex", { sessionId: "s2", ts: "2026-10-28T10:00:00.000Z" }));
    const r = l.report({ sessionLabel: (id) => `agent ${id}` });
    expect(r.byProvider.map((p) => p.key).sort()).toEqual(["anthropic", "openai"]);
    expect(r.byDay.map((d) => d.key)).toEqual(["2026-10-27", "2026-10-28"]);
    expect(r.bySession.map((s) => s.label).sort()).toEqual(["agent s1", "agent s2"]);
    expect(l.report({ since: "2026-10-28T00:00:00.000Z" }).byDay.map((d) => d.key)).toEqual(["2026-10-28"]);
    expect(l.unverifiedModels()).toEqual(["gpt-5-codex"]);
  });

  it("estimates MCP and skill context from call input and result size", () => {
    const l = new UsageLedger();
    l.add({ kind: "tool", sessionId: "s1", ts: "2026-10-28T12:00:00.000Z", id: "t1", name: "mcp__github__get_issue", summary: "", files: [], mcpServer: "github", inputChars: 40 });
    l.add({ kind: "tool_result", sessionId: "s1", ts: "2026-10-28T12:00:01.000Z", id: "t1", isError: false, excerpt: "", chars: 4000 });
    l.add({ kind: "tool", sessionId: "s1", ts: "2026-10-28T12:00:02.000Z", id: "t2", name: "Skill", summary: "", files: [], skill: "pdf", inputChars: 20 });
    // a result for a non-MCP tool is not attributed
    l.add({ kind: "tool_result", sessionId: "s1", ts: "2026-10-28T12:00:03.000Z", id: "other", isError: false, excerpt: "", chars: 999 });
    const r = l.report();
    expect(r.byMcp).toEqual([expect.objectContaining({ key: "github", total: 1010, calls: 1, estimated: true })]);
    expect(r.bySkill).toEqual([expect.objectContaining({ key: "pdf", total: 5, calls: 1 })]);
  });
});
