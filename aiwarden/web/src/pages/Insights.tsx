import { useMemo, useState } from "react";
import { BarList } from "../components/Charts";
import { DataTable } from "../components/Table";
import { Block, DecisionBadge, Empty, ErrorNote, Loading, PageHead, Stat, Tag } from "../components/ui";
import { api } from "../lib/api";
import { ago, compact, duration, int, usd } from "../lib/format";
import { useApi } from "../lib/useApi";
import type { AgentConfig, RiskyRow, SessionRow } from "../lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Session starts by weekday (Monday first) and hour, in the viewer's own time zone. */
export function heatmap(sessions: { start?: string | null }[]): { cells: number[][]; max: number; total: number } {
  const cells = DAYS.map(() => new Array<number>(24).fill(0));
  let total = 0;
  for (const s of sessions) {
    const t = Date.parse(String(s.start));
    if (Number.isNaN(t)) continue;
    const d = new Date(t);
    cells[(d.getDay() + 6) % 7][d.getHours()]++;
    total++;
  }
  return { cells, max: Math.max(0, ...cells.flat()), total };
}

function seconds(s: SessionRow): number {
  const a = Date.parse(s.start);
  const b = Date.parse(String(s.end));
  return Number.isNaN(a) || Number.isNaN(b) || b < a ? 0 : (b - a) / 1000;
}

function lastPart(path: string | null | undefined): string {
  return (path || "").split(/[\\/]/).filter(Boolean).pop() || path || "-";
}

function Heatmap({ sessions }: { sessions: SessionRow[] }) {
  const h = useMemo(() => heatmap(sessions), [sessions]);
  const [hover, setHover] = useState<[number, number] | null>(null);
  if (!h.total) return <Empty title="No sessions with a start time" />;
  let best: [number, number] = [0, 0];
  h.cells.forEach((row, d) =>
    row.forEach((v, hr) => {
      if (v > h.cells[best[0]][best[1]]) best = [d, hr];
    }),
  );
  const cw = 26;
  const ch = 22;
  const left = 38;
  const top = 18;
  const shown = hover ?? best;
  const n = h.cells[shown[0]][shown[1]];
  return (
    <div className="heat">
      <svg viewBox={`0 0 ${left + 24 * cw} ${top + 7 * ch + 4}`} role="img" aria-label={`Sessions by weekday and hour; busiest ${DAYS[best[0]]} ${best[1]}:00`}>
        {[0, 3, 6, 9, 12, 15, 18, 21].map((hr) => (
          <text key={hr} className="axis" x={left + hr * cw + cw / 2} y={11} textAnchor="middle">
            {String(hr).padStart(2, "0")}
          </text>
        ))}
        {h.cells.map((row, d) => (
          <g key={d}>
            <text className="axis" x={0} y={top + d * ch + ch / 2 + 4}>
              {DAYS[d]}
            </text>
            {row.map((v, hr) => (
              <rect
                key={hr}
                className={`cell${v ? "" : " zero"}${shown[0] === d && shown[1] === hr ? " on" : ""}`}
                x={left + hr * cw + 1.5}
                y={top + d * ch + 1.5}
                width={cw - 3}
                height={ch - 3}
                rx={4}
                style={{ "--v": v ? (0.2 + 0.8 * (v / h.max)).toFixed(3) : "0", "--d": `${hr * 18 + d * 30}ms` } as React.CSSProperties}
                onPointerEnter={() => setHover([d, hr])}
                onPointerLeave={() => setHover(null)}
              />
            ))}
          </g>
        ))}
      </svg>
      <p className="heat-note">
        <b>
          {DAYS[shown[0]]} {String(shown[1]).padStart(2, "0")}:00
        </b>{" "}
        {int(n)} session{n === 1 ? "" : "s"} started{hover ? "" : ", the busiest hour of the week"}. Times are in your time zone.
      </p>
    </div>
  );
}

export function Insights({ rev, onUnauthorized }: { rev: number; onUnauthorized: () => void }) {
  const r = useApi(() => api.insights(), String(rev), onUnauthorized);
  const I = r.data;
  const stats = useMemo(() => {
    if (!I) return null;
    const secs = I.sessions.map(seconds).filter((x) => x > 0).sort((a, b) => a - b);
    const t = I.tokens;
    const fromCache = t.cache_read_tokens + t.input_tokens ? t.cache_read_tokens / (t.cache_read_tokens + t.input_tokens) : 0;
    return {
      hours: secs.reduce((a, b) => a + b, 0) / 3600,
      median: secs.length ? secs[Math.floor(secs.length / 2)] : 0,
      fromCache,
      perSession: I.sessions.length ? I.sessions.reduce((a, s) => a + (Number(s.cost_usd) || 0), 0) / I.sessions.length : 0,
    };
  }, [I]);
  if (r.error) return <ErrorNote error={r.error} retry={r.reload} />;
  if (!I || !stats) return <Loading rows={6} />;

  const priced = I.projects.some((p) => p.cost_usd > 0);
  const projects = I.projects.slice(0, 8).map((p) => ({
    key: `${p.device_id}|${p.project}`,
    label: (
      <>
        {lastPart(p.project)} <span className="muted">· {p.hostname}</span>
      </>
    ),
    value: priced ? p.cost_usd : p.output_tokens,
    hint: p.project,
  }));
  const tools = I.tools.filter((t) => !t.tool.startsWith("mcp__")).slice(0, 10).map((t) => ({ key: t.tool, label: t.tool, value: t.calls }));
  const mcp = I.mcp_calls.slice(0, 8).map((m) => ({ key: m.server, label: m.server, value: m.calls, hint: m.tools.map((t) => `${t.tool} ${t.calls}`).join(", ") }));

  return (
    <>
      <PageHead
        title="Insights"
        sub="What the agents on these devices actually do: when they work, which projects the spend goes to, which tools and MCP servers they lean on, and what they tried that the guard would stop."
      />
      <div className="strip">
        <Stat value={int(I.sessions_total)} label="Agent sessions" />
        <Stat value={`${stats.hours.toFixed(1)}h`} label="Time in sessions" />
        <Stat value={duration(stats.median)} label="Median session" />
        <Stat value={`${Math.round(stats.fromCache * 100)}%`} label="Input read from cache" />
        <Stat value={usd(stats.perSession)} label="Average cost per session" />
      </div>

      <Block title="When agents work" aside={<span className="aside">Session starts by weekday and hour</span>}>
        <Heatmap sessions={I.sessions} />
      </Block>

      <div className="grid-even">
        <Block title={priced ? "Spend by project" : "Output by project"} aside={<span className="aside">{I.projects.length} project{I.projects.length === 1 ? "" : "s"}</span>}>
          <BarList items={projects} format={priced ? usd : compact} empty={<Empty title="No project activity">Projects come from Claude Code, Codex and Gemini CLI session transcripts.</Empty>} />
        </Block>
        <Block title="Tools agents call" aside={<span className="aside">Built-in tools</span>}>
          <BarList items={tools} empty={<Empty title="No tool calls recorded" />} />
        </Block>
      </div>

      <Block title="MCP servers by calls" aside={<span className="aside">Hover a row for its busiest tools</span>}>
        <BarList items={mcp} empty={<Empty title="No MCP calls in the transcripts">Configured servers that agents never call are on the MCP servers page.</Empty>} />
      </Block>

      <Block
        title="Recent sessions"
        aside={<span className="aside">{I.sessions_total > I.sessions.length ? `Latest ${I.sessions.length} of ${int(I.sessions_total)}` : `${I.sessions.length} sessions`}</span>}
      >
        <DataTable<SessionRow>
          label="Recent sessions"
          rows={I.sessions}
          rowKey={(s, i) => `${s.device_id}|${s.start}|${i}`}
          limit={10}
          initialSort={{ key: "when", dir: "desc" }}
          empty={<Empty title="No sessions" />}
          columns={[
            { key: "when", label: "Started", render: (s) => <span className="nowrap" title={s.start}>{ago(s.start)}</span>, sort: (s) => s.start },
            { key: "app", label: "Agent", render: (s) => s.app, sort: (s) => s.app },
            { key: "project", label: "Project", render: (s) => <span title={s.project || ""}>{lastPart(s.project)}</span>, sort: (s) => s.project || "" },
            { key: "host", label: "Device", render: (s) => s.hostname, sort: (s) => s.hostname },
            { key: "dur", label: "Length", num: true, render: (s) => duration(seconds(s)), sort: (s) => seconds(s) },
            { key: "out", label: "Output", num: true, render: (s) => compact(s.output_tokens), sort: (s) => s.output_tokens || 0 },
            { key: "cost", label: "Cost", num: true, render: (s) => (s.cost_usd ? usd(s.cost_usd) : "-"), sort: (s) => s.cost_usd || 0 },
            { key: "tools", label: "Tool calls", num: true, render: (s) => int(s.tool_calls), sort: (s) => s.tool_calls || 0 },
            { key: "mcp", label: "MCP", render: (s) => (s.mcp_servers || []).slice(0, 3).map((m) => <Tag key={m}>{m}</Tag>) },
          ]}
        />
      </Block>

      <Block title="What the guard would have stopped" aside={<span className="aside">{int(I.risky_total)} risky action{I.risky_total === 1 ? "" : "s"} in the transcripts</span>}>
        <DataTable<RiskyRow>
          label="Risky actions"
          rows={I.risky_events}
          rowKey={(e, i) => `${e.device_id}|${e.timestamp}|${i}`}
          limit={8}
          initialSort={{ key: "when", dir: "desc" }}
          empty={<Empty title="Nothing risky in the transcripts">Past tool calls are replayed through the guard rules on every scan.</Empty>}
          columns={[
            { key: "when", label: "When", render: (e) => <span className="nowrap" title={e.timestamp}>{ago(e.timestamp)}</span>, sort: (e) => e.timestamp || "" },
            { key: "would", label: "Would", render: (e) => <DecisionBadge action={e.action} />, sort: (e) => e.action || "" },
            { key: "rule", label: "Rule", render: (e) => <span className="rule-id">{e.rule}</span>, sort: (e) => e.rule || "" },
            { key: "reason", label: "Why", render: (e) => e.reason || "" },
            { key: "tool", label: "Tool", render: (e) => <code>{e.tool}</code> },
            { key: "host", label: "Device", render: (e) => e.hostname, sort: (e) => e.hostname },
          ]}
        />
      </Block>

      <Block title="Agent configuration" aside={<span className="aside">Claude Code hooks, plugins, subagents and skills</span>}>
        <DataTable<AgentConfig>
          label="Agent configuration"
          rows={I.agents}
          rowKey={(a) => a.device_id}
          empty={<Empty title="No agent configuration in the reports" />}
          columns={[
            { key: "host", label: "Device", render: (a) => <span className="cell-title">{a.hostname}</span>, sort: (a) => a.hostname },
            { key: "guard", label: "Guard", render: (a) => <span className={a.guard_installed ? "ok-text" : "muted"}>{a.guard_installed ? "On" : "Off"}</span>, sort: (a) => Number(a.guard_installed) },
            { key: "mode", label: "Permission mode", render: (a) => (a.default_mode ? <code>{a.default_mode}</code> : <span className="muted">-</span>) },
            {
              key: "hooks",
              label: "Hooks",
              render: (a) => (a.hooks.length ? [...new Set(a.hooks.map((h) => h.event || ""))].map((e) => <Tag key={e}>{e}</Tag>) : <span className="muted">None</span>),
              sort: (a) => a.hooks.length,
            },
            { key: "plugins", label: "Plugins", render: (a) => (a.plugins.length ? a.plugins.map((p) => <Tag key={p}>{p.split("@")[0]}</Tag>) : <span className="muted">None</span>), sort: (a) => a.plugins.length },
            { key: "agents", label: "Subagents", num: true, render: (a) => a.agents.length, sort: (a) => a.agents.length },
            { key: "skills", label: "Skills", num: true, render: (a) => a.skills.length, sort: (a) => a.skills.length },
          ]}
        />
      </Block>

      {(I.pricing.unpriced_models.length > 0 || I.pricing.unverified_models.length > 0) && (
        <p className="note">
          {I.pricing.unpriced_models.length > 0 && (
            <>
              No list price for <code>{I.pricing.unpriced_models.join(", ")}</code>, so those tokens are counted but not in the spend.{" "}
            </>
          )}
          {I.pricing.unverified_models.length > 0 && (
            <>
              The price for <code>{I.pricing.unverified_models.join(", ")}</code> is not verified.{" "}
            </>
          )}
          Prices as of {I.pricing.prices_as_of || "an unknown date"}; override them in <code>~/.aiwarden/config.toml</code>.
        </p>
      )}
    </>
  );
}
