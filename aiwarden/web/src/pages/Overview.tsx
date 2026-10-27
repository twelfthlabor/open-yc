import { useMemo } from "react";
import { AreaChart, BarList, SevBar, dailySeries } from "../components/Charts";
import { DataTable } from "../components/Table";
import { Block, DecisionBadge, Empty, Sev, Stat } from "../components/ui";
import { ago, compact, day, pct, plural, tokens, usd } from "../lib/format";
import { href } from "../lib/router";
import type { Fleet, GuardEvent } from "../lib/types";

export function sumWindow(byDay: Record<string, { input_tokens?: number; output_tokens?: number; cost_usd?: number }>, end: string, days: number, offset = 0) {
  const t = Date.parse(`${end}T00:00:00Z`);
  let tok = 0;
  let cost = 0;
  for (let i = offset; i < offset + days; i++) {
    const k = new Date(t - i * 86400000).toISOString().slice(0, 10);
    tok += tokens(byDay[k]);
    cost += Number(byDay[k]?.cost_usd) || 0;
  }
  return { tok, cost };
}

export function Overview({ fleet }: { fleet: Fleet }) {
  const t = fleet.totals;
  const f = t.findings || {};
  const serious = (f.critical || 0) + (f.high || 0);
  const devices = t.devices || 0;
  const byDay = fleet.usage.by_day;
  const end = Object.keys(byDay).sort().pop() || fleet.generated_at.slice(0, 10);
  const series = useMemo(() => dailySeries(Object.fromEntries(Object.entries(byDay).map(([d, v]) => [d, { a: tokens(v) }])), 30, end), [byDay, end]);
  const cur = sumWindow(byDay, end, 30);
  const prev = sumWindow(byDay, end, 30, 30);
  const change = prev.tok ? ((cur.tok - prev.tok) / prev.tok) * 100 : null;
  const newest = fleet.devices.map((d) => d.received_at || "").sort().pop();
  const blocked = fleet.guard_events.filter((e) => e.action === "deny").length;
  const apps = Object.entries(fleet.usage.by_app).map(([k, v]) => ({ key: k, label: k, value: tokens(v) })).sort((a, b) => b.value - a.value).slice(0, 6);
  const models = Object.entries(fleet.usage.by_model).map(([k, v]) => ({ key: k, label: k, value: tokens(v) })).sort((a, b) => b.value - a.value).slice(0, 6);
  const top = fleet.findings.filter((x) => x.severity === "critical" || x.severity === "high").slice(0, 6);

  if (!devices) {
    return (
      <>
        <h1 className="posture">No devices have reported yet.</h1>
        <p className="posture-sub">Each laptop sends its inventory, findings and usage with one command. The first report shows up here within seconds.</p>
        <div className="terminal" aria-label="Commands to send a report">
          <span className="p">$</span> pip install aiwarden{"\n"}
          <span className="p">$</span> aiwarden push --server {window.location.origin} --token $AIWARDEN_TOKEN{"\n"}
          <span className="ok">{'{"ok": true}'}</span>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="posture">
        <a href={href("devices")}>{plural(devices, "device")}</a> {devices === 1 ? "runs" : "run"} <a href={href("devices")}>{plural(t.apps || 0, "AI app")}</a> and{" "}
        <a href={href("mcp")}>{plural(t.mcp_servers || 0, "MCP server")}</a>.{" "}
        {serious ? (
          <>
            <a className="risk" href={href("findings", { sev: "high" })}>
              {plural(serious, "high-risk finding")}
            </a>{" "}
            {serious === 1 ? "needs" : "need"} attention
          </>
        ) : (
          "Nothing high-risk is open"
        )}
        {blocked ? (
          <>
            , and the guard blocked <a href={href("guard")}>{plural(blocked, "action")}</a>.
          </>
        ) : (
          "."
        )}
      </h1>
      <p className="posture-sub">
        Guard is installed on {t.guarded_devices || 0} of {plural(devices, "device")}. Each device shows its latest report; the newest arrived {ago(newest)}.
      </p>

      <div className="strip">
        <Stat value={compact(cur.tok)} label="Tokens, last 30 days" delta={change === null ? undefined : `${pct(Math.round(change))} vs previous 30`} deltaKind={change !== null && change > 25 ? "up" : undefined} />
        <Stat value={usd(cur.cost)} label="Estimated spend, 30 days" />
        <Stat value={t.plaintext_secrets || 0} label="Plaintext secrets" />
        <Stat value={`${t.guarded_devices || 0}/${devices}`} label="Devices with guard" />
        <Stat value={t.browser_blocks || 0} label="Browser DLP blocks" />
      </div>

      <div className="grid-2">
        <div>
          <Block title="Token usage" aside={<span className="aside">{series.length ? `${day(series[0].x)} to ${day(series[series.length - 1].x)}` : ""}</span>}>
            {series.some((p) => p.a) ? <AreaChart points={series} /> : <Empty title="No agent activity in this window">Usage comes from Claude Code, Codex and Gemini CLI transcripts on each device.</Empty>}
          </Block>
          <div className="grid-even" style={{ gap: 28, marginBottom: 0 }}>
            <Block title="Agents by tokens" aside={<a className="aside" href={href("usage")}>Usage</a>}>
              <BarList items={apps} empty={<Empty title="No agent usage yet" />} />
            </Block>
            <Block title="Models by tokens">
              <BarList items={models} empty={<Empty title="No model usage yet" />} />
            </Block>
          </div>
        </div>
        <Block title="Findings" aside={<a className="aside" href={href("findings")}>All findings</a>}>
          <SevBar counts={f} />
          {top.length ? (
            <ul className="bars" style={{ marginTop: 14 }}>
              {top.map((x, i) => (
                <li key={i} style={{ display: "block", padding: "8px 0", borderBottom: "1px solid var(--line)", borderRadius: 0 }}>
                  <Sev s={x.severity} /> <span className="rule-id">{x.rule}</span>
                  <div className="cell-title" style={{ marginTop: 2 }}>{x.title}</div>
                  <span className="muted" style={{ fontSize: 13 }}>{x.hostname}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No critical or high findings">Medium and low findings are on the findings page.</Empty>
          )}
        </Block>
      </div>

      <Block title="Recent guard decisions" aside={<a className="aside" href={href("guard")}>Guard</a>}>
        <GuardTable events={fleet.guard_events} limit={8} />
      </Block>
    </>
  );
}

export function GuardTable({ events, limit }: { events: GuardEvent[]; limit?: number }) {
  return (
    <DataTable
      label="Guard decisions"
      rows={events}
      rowKey={(_, i) => String(i)}
      limit={limit}
      initialSort={{ key: "ts", dir: "desc" }}
      empty={<Empty title="No guard decisions yet">Install the guard with <code>aiwarden hooks install --agent all</code>; every blocked or asked tool call appears here.</Empty>}
      columns={[
        { key: "ts", label: "When", render: (e) => <span className="nowrap" title={e.ts}>{ago(e.ts)}</span>, sort: (e) => e.ts || "" },
        { key: "action", label: "Decision", render: (e) => <DecisionBadge action={e.action} wouldBe={e.would_be} />, sort: (e) => e.action || "" },
        { key: "rule", label: "Rule", render: (e) => <span className="rule-id">{e.rule || "-"}</span>, sort: (e) => e.rule || "" },
        { key: "tool", label: "Tool", render: (e) => <code>{e.tool || ""}</code> },
        { key: "app", label: "Agent", render: (e) => e.app || "" },
        { key: "host", label: "Device", render: (e) => e.hostname || "", sort: (e) => e.hostname || "" },
      ]}
    />
  );
}
