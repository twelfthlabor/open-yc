import { useState } from "react";
import { Printer } from "lucide-react";
import { BarList, SevBar } from "../components/Charts";
import { DataTable } from "../components/Table";
import { Block, Empty, ErrorNote, Loading, PageHead, Sev, Stat } from "../components/ui";
import { api } from "../lib/api";
import { compact, day, int, pct, usd } from "../lib/format";
import type { Breakdown, Change, Weekly as W } from "../lib/types";
import { useApi } from "../lib/useApi";

function delta(c: Change): { delta: string; deltaKind?: "up" | "down" } {
  if (c.change_pct === null) return { delta: c.current ? "new this week" : "none either week" };
  return { delta: `${pct(c.change_pct)} vs last week`, deltaKind: c.change_pct > 25 ? "up" : c.change_pct < -25 ? "down" : undefined };
}

function BreakdownTable({ rows, dim }: { rows: Breakdown[]; dim: string }) {
  return (
    <DataTable<Breakdown>
      label={`By ${dim}`}
      rows={rows}
      rowKey={(r, i) => `${String(r[dim])}-${i}`}
      initialSort={{ key: "tokens", dir: "desc" }}
      empty={<Empty title="No usage this week" />}
      columns={[
        { key: "k", label: dim.charAt(0).toUpperCase() + dim.slice(1), render: (r) => (r[dim] === null || r[dim] === undefined ? <span className="muted">Unassigned</span> : String(r[dim])), sort: (r) => String(r[dim] ?? "") },
        { key: "tokens", label: "Tokens", num: true, render: (r) => compact(r.tokens), sort: (r) => r.tokens },
        { key: "cost", label: "Est. cost", num: true, render: (r) => usd(r.cost_usd), sort: (r) => r.cost_usd },
        { key: "chg", label: "Change", num: true, render: (r) => <span style={{ color: r.change_pct !== null && r.change_pct > 50 ? "var(--high)" : undefined }}>{pct(r.change_pct)}</span>, sort: (r) => r.change_pct ?? 1e9 },
      ]}
    />
  );
}

export function Weekly({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [asOf, setAsOf] = useState("");
  const r = useApi(() => api.weekly(asOf || undefined), `weekly-${asOf}`, onUnauthorized);
  const w: W | null = r.data;
  return (
    <>
      <PageHead
        title="Weekly report"
        sub={w ? `${day(w.period.since)} to ${day(w.period.until)}, compared with the week before. ${w.devices} devices.` : "Usage and risk for the last seven days."}
        actions={
          <>
            <label className="field" style={{ minWidth: 0 }}>
              <span className="sr-only">Week ending</span>
              <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="Week ending" />
            </label>
            <button className="btn" type="button" onClick={() => window.print()}>
              <Printer size={15} /> Print
            </button>
          </>
        }
      />
      {r.error ? (
        <ErrorNote error={r.error} retry={r.reload} />
      ) : !w ? (
        <Loading rows={6} />
      ) : (
        <>
          <div className="strip">
            <Stat value={compact(w.totals.tokens.current)} label="Tokens" {...delta(w.totals.tokens)} />
            <Stat value={usd(w.totals.cost_usd.current)} label="Estimated spend" {...delta(w.totals.cost_usd)} />
            <Stat value={int(w.totals.sessions.current)} label="Agent sessions" {...delta(w.totals.sessions)} />
            <Stat value={int(w.guard_blocks.total)} label="Guard blocks" />
            <Stat value={w.mcp_servers_configured} label="MCP servers configured" />
          </div>
          <div className="grid-even">
            <Block title="By team">
              <BreakdownTable rows={w.by_team} dim="team" />
            </Block>
            <Block title="By user">
              <BreakdownTable rows={w.by_user} dim="user" />
            </Block>
          </div>
          <div className="grid-even">
            <Block title="By agent">
              <BreakdownTable rows={w.by_app} dim="app" />
            </Block>
            <Block title="MCP calls by server">
              <BarList items={w.mcp_calls.map((x) => ({ key: String(x.mcp_server), label: String(x.mcp_server), value: Number(x.value) || 0 }))} format={int} empty={<Empty title="No MCP calls this week" />} />
            </Block>
          </div>
          <Block title="Findings">
            <SevBar counts={w.findings.by_severity} />
            <DataTable
              label="Critical and high findings"
              rows={w.findings.serious}
              rowKey={(f, i) => `${f.rule}-${i}`}
              empty={<Empty title="No critical or high findings" />}
              columns={[
                { key: "s", label: "Severity", render: (f) => <Sev s={f.severity} /> },
                { key: "r", label: "Rule", render: (f) => <span className="rule-id">{f.rule}</span> },
                { key: "t", label: "Finding", render: (f) => <span className="cell-title">{f.title}</span> },
                { key: "h", label: "Device", render: (f) => <>{f.hostname}<span className="sub">{f.user}{f.team ? `, ${f.team}` : ""}</span></> },
              ]}
            />
          </Block>
          <div className="grid-even">
            <Block title="Guard blocks by rule">
              <BarList items={w.guard_blocks.by_rule.map((x) => ({ key: String(x.rule), label: String(x.rule), value: Number(x.value) || 0 }))} format={int} empty={<Empty title="No blocks this week" />} />
            </Block>
            <Block title="Risky actions in transcripts">
              <BarList items={w.risky_events.map((x) => ({ key: String(x.rule), label: String(x.rule), value: Number(x.value) || 0 }))} format={int} empty={<Empty title="None this week" />} />
            </Block>
          </div>
        </>
      )}
    </>
  );
}
