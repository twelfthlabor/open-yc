// Token usage and estimated cost, by provider, model, session, day, MCP server and skill.
//
// Usage records are keyed (Claude Code: the API message id; Codex: the cumulative total), so a
// record seen twice, as happens when Claude Code writes one message as several lines, counts once.
//
// MCP and skill figures are estimates: the characters of each call's input and result, divided by
// four. That is the context the call added, not a billed amount.
import { costOf, priceFor, PRICES_AS_OF } from "./pricing.ts";
import type { AgentEvent, UsageReport, UsageRow } from "./types.ts";

type UsageEvent = Extract<AgentEvent, { kind: "usage" }>;

interface ToolUse {
  sessionId: string;
  ts: string;
  mcpServer?: string;
  skill?: string;
  chars: number;
}

export class UsageLedger {
  private records = new Map<string, UsageEvent>();
  private tools = new Map<string, ToolUse>();

  add(ev: AgentEvent): void {
    if (ev.kind === "usage") {
      this.records.set(ev.key, ev);
    } else if (ev.kind === "tool" && (ev.mcpServer || ev.skill)) {
      this.tools.set(`${ev.sessionId}:${ev.id}`, { sessionId: ev.sessionId, ts: ev.ts, mcpServer: ev.mcpServer, skill: ev.skill, chars: ev.inputChars });
    } else if (ev.kind === "tool_result") {
      const t = this.tools.get(`${ev.sessionId}:${ev.id}`);
      if (t) t.chars += ev.chars;
    }
  }

  sessionTotals(sessionId: string): { tokens: number; costUsd: number | null } {
    let tokens = 0;
    let cost = 0;
    let unpriced = false;
    for (const r of this.records.values()) {
      if (r.sessionId !== sessionId) continue;
      tokens += r.input + r.output + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h;
      const c = costOf(r.model, r);
      if (c == null) unpriced = true;
      else cost += c;
    }
    return { tokens, costUsd: unpriced && cost === 0 ? null : cost };
  }

  report(opts: { since?: string; sessionLabel?: (id: string) => string } = {}): UsageReport {
    const since = opts.since ?? new Date(0).toISOString();
    const label = opts.sessionLabel ?? ((id: string) => id.slice(0, 8));
    const totals = row("total", "All agents");
    const groups = { provider: new Map<string, UsageRow>(), model: new Map<string, UsageRow>(), session: new Map<string, UsageRow>(), day: new Map<string, UsageRow>() };
    for (const r of this.records.values()) {
      if (r.ts < since) continue;
      const day = r.ts.slice(0, 10);
      for (const [map, key, name] of [
        [groups.provider, r.provider, r.provider],
        [groups.model, r.model, r.model],
        [groups.session, r.sessionId, label(r.sessionId)],
        [groups.day, day, day],
      ] as const) {
        if (!map.has(key)) map.set(key, row(key, name));
        accumulate(map.get(key)!, r);
      }
      accumulate(totals, r);
    }
    const mcp = new Map<string, UsageRow>();
    const skill = new Map<string, UsageRow>();
    for (const t of this.tools.values()) {
      if (t.ts < since) continue;
      const est = Math.round(t.chars / 4);
      for (const [map, key] of [
        [mcp, t.mcpServer],
        [skill, t.skill],
      ] as const) {
        if (!key) continue;
        if (!map.has(key)) map.set(key, { ...row(key, key), calls: 0, estimated: true });
        const g = map.get(key)!;
        g.calls = (g.calls ?? 0) + 1;
        g.input += est;
        g.total += est;
      }
    }
    const byTotal = (m: Map<string, UsageRow>) => [...m.values()].sort((a, b) => b.total - a.total);
    return {
      since,
      totals,
      byProvider: byTotal(groups.provider),
      byModel: byTotal(groups.model),
      bySession: byTotal(groups.session),
      byDay: [...groups.day.values()].sort((a, b) => a.key.localeCompare(b.key)),
      byMcp: byTotal(mcp),
      bySkill: byTotal(skill),
      pricesAsOf: PRICES_AS_OF,
    };
  }

  unverifiedModels(): string[] {
    const models = new Set<string>();
    for (const r of this.records.values()) {
      const p = priceFor(r.model);
      if (p && !p.verified) models.add(r.model);
    }
    return [...models];
  }
}

function row(key: string, label: string): UsageRow {
  return { key, label, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: 0, unpriced: 0 };
}

function accumulate(g: UsageRow, r: UsageEvent): void {
  const write = r.cacheWrite5m + r.cacheWrite1h;
  const total = r.input + r.output + r.cacheRead + write;
  g.input += r.input;
  g.output += r.output;
  g.cacheRead += r.cacheRead;
  g.cacheWrite += write;
  g.total += total;
  const c = costOf(r.model, r);
  if (c == null) g.unpriced += total;
  else g.costUsd += c;
}
