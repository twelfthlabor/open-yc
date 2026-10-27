import { ArrowLeft } from "lucide-react";
import { BarList } from "../components/Charts";
import { RelationshipGraph } from "../components/Graph";
import { DataTable } from "../components/Table";
import { Block, DecisionBadge, Empty, ErrorNote, Loading, PageHead, Stat, Tag } from "../components/ui";
import { api } from "../lib/api";
import { ago, compact, tokens, usd } from "../lib/format";
import { href } from "../lib/router";
import type { McpServer, Report } from "../lib/types";
import { useApi } from "../lib/useApi";
import { FindingsTable } from "./Findings";

export function McpTable({ rows }: { rows: McpServer[] }) {
  return (
    <DataTable<McpServer>
      label="MCP servers"
      rows={rows}
      rowKey={(m, i) => `${m.client}-${m.name}-${i}`}
      initialSort={{ key: "secrets", dir: "desc" }}
      empty={<Empty title="No MCP servers configured" />}
      columns={[
        { key: "name", label: "Server", render: (m) => <span className="cell-title">{m.name}</span>, sort: (m) => m.name },
        { key: "client", label: "Client", render: (m) => <><Tag>{m.client}</Tag><span className="sub">{m.scope}</span></>, sort: (m) => m.client },
        { key: "transport", label: "Transport", render: (m) => m.transport, sort: (m) => m.transport },
        { key: "pkg", label: "Package or URL", render: (m) => <code style={{ overflowWrap: "anywhere" }}>{m.package || m.url || m.command || ""}</code> },
        {
          key: "secrets",
          label: "Secrets",
          render: (m) =>
            m.secrets.length ? (
              m.secrets.map((s, i) => (
                <span key={i} className="sub" style={{ color: "var(--high)" }}>
                  {s.kind} in <code>{s.field}</code>
                </span>
              ))
            ) : (
              <span className="muted">None</span>
            ),
          sort: (m) => m.secrets.length,
        },
      ]}
    />
  );
}

export function Device({ id, onUnauthorized }: { id: string; onUnauthorized: () => void }) {
  const r = useApi(() => api.device(id), id, onUnauthorized);
  const back = (
    <a className="crumb" href={href("devices")}>
      <ArrowLeft size={15} /> Devices
    </a>
  );
  if (r.error) return <>{back}<ErrorNote error={r.error} retry={r.reload} /></>;
  if (!r.data) return <>{back}<Loading rows={6} /></>;
  const rep: Report = r.data;
  const d = rep.device;
  const s = rep.summary;
  const u = rep.usage;
  const serious = (s.findings?.critical || 0) + (s.findings?.high || 0);
  const models = Object.entries(u?.by_model || {}).map(([k, v]) => ({ key: k, label: k, value: tokens(v) })).sort((a, b) => b.value - a.value);
  const mcpCalls = Object.entries(u?.mcp_calls || {}).map(([k, v]) => ({ key: k, label: k, value: Object.values(v).reduce((a, b) => a + (Number(b) || 0), 0) })).sort((a, b) => b.value - a.value);
  const cost = Object.values(u?.by_app || {}).reduce((a, v) => a + (Number(v.cost_usd) || 0), 0);
  return (
    <>
      <PageHead
        crumb={back}
        title={d.hostname}
        sub={`${d.user}${d.team ? `, team ${d.team}` : ""}. ${d.os}${d.arch ? ` (${d.arch})` : ""}. Reported ${ago(rep.generated_at)}${rep.aiwarden_version ? ` by aiwarden ${rep.aiwarden_version}` : ""}.`}
      />
      <div className="strip">
        <Stat value={s.apps || 0} label="AI apps" delta={s.running ? `${s.running} running` : undefined} />
        <Stat value={s.mcp_servers || 0} label="MCP servers" delta={s.remote_mcp_servers ? `${s.remote_mcp_servers} remote` : undefined} />
        <Stat value={s.plaintext_secrets || 0} label="Plaintext secrets" />
        <Stat value={serious} label="High findings" />
        <Stat value={compact(s.tokens)} label="Tokens" delta={cost ? `${usd(cost)} estimated` : undefined} />
        <Stat value={s.guard_installed ? "On" : "Off"} label="Guard" delta={s.guard_blocks ? `${s.guard_blocks} blocked` : undefined} />
      </div>

      <Block title="Relationship map" aside={<span className="aside hide-sm">Drag to move, scroll to zoom, select a node for details</span>}>
        {rep.graph.nodes.length ? <RelationshipGraph nodes={rep.graph.nodes} edges={rep.graph.edges} /> : <Empty title="No graph in this report" />}
      </Block>

      <Block title="Findings" aside={<span className="aside">{rep.findings.length}</span>}>
        <FindingsTable rows={rep.findings} showDevice={false} />
      </Block>

      <Block title="MCP servers">
        <McpTable rows={rep.mcp_servers} />
      </Block>

      <div className="grid-even">
        <Block title="AI apps">
          <DataTable
            label="AI apps"
            rows={rep.apps}
            rowKey={(a) => a.id}
            empty={<Empty title="No AI apps found" />}
            columns={[
              { key: "name", label: "App", render: (a) => <><span className="cell-title">{a.name}</span><span className="sub">{a.vendor}</span></>, sort: (a) => a.name },
              { key: "kind", label: "Kind", render: (a) => a.kind || "" },
              { key: "run", label: "Running", render: (a) => (a.running ? "Yes" : <span className="muted">No</span>), sort: (a) => (a.running ? 1 : 0) },
            ]}
          />
        </Block>
        <Block title="Models used">
          <BarList items={models} empty={<Empty title="No transcript usage" />} />
          {!!mcpCalls.length && (
            <>
              <h3 style={{ fontSize: 15, margin: "22px 0 10px" }}>MCP calls by server</h3>
              <BarList items={mcpCalls} />
            </>
          )}
        </Block>
      </div>

      {!!rep.browser_extensions.length && (
        <Block title="AI browser extensions">
          <DataTable
            label="AI browser extensions"
            rows={rep.browser_extensions}
            rowKey={(e, i) => `${e.name}-${i}`}
            columns={[
              { key: "name", label: "Extension", render: (e) => <span className="cell-title">{e.name}</span> },
              { key: "browser", label: "Browser", render: (e) => e.browser },
              { key: "ver", label: "Version", render: (e) => e.version || "" },
              { key: "access", label: "Access", render: (e) => (e.broad_access ? <span style={{ color: "var(--high)" }}>All sites</span> : "Limited") },
            ]}
          />
        </Block>
      )}

      <Block title="Guard decisions on this device">
        <DataTable
          label="Guard decisions"
          rows={rep.guard_events}
          rowKey={(_, i) => String(i)}
          limit={15}
          initialSort={{ key: "ts", dir: "desc" }}
          empty={<Empty title={s.guard_installed ? "No decisions yet" : "Guard is not installed"}>{!s.guard_installed && <>Run <code>aiwarden hooks install --agent all</code> on this device.</>}</Empty>}
          columns={[
            { key: "ts", label: "When", render: (e) => <span className="nowrap" title={e.ts}>{ago(e.ts)}</span>, sort: (e) => e.ts || "" },
            { key: "action", label: "Decision", render: (e) => <DecisionBadge action={e.action} wouldBe={e.would_be} /> },
            { key: "rule", label: "Rule", render: (e) => <span className="rule-id">{e.rule || "-"}</span> },
            { key: "tool", label: "Tool", render: (e) => <code>{e.tool}</code> },
            { key: "app", label: "Agent", render: (e) => e.app || "" },
          ]}
        />
      </Block>

      {!!u?.risky_events?.length && (
        <Block title="Risky actions found in transcripts" aside={<span className="aside">What the guard would have done</span>}>
          <DataTable
            label="Risky actions in transcripts"
            rows={u.risky_events}
            rowKey={(_, i) => String(i)}
            limit={15}
            initialSort={{ key: "ts", dir: "desc" }}
            columns={[
              { key: "ts", label: "When", render: (e) => <span className="nowrap" title={e.timestamp}>{ago(e.timestamp)}</span>, sort: (e) => e.timestamp || "" },
              { key: "action", label: "Would", render: (e) => <DecisionBadge action={e.action} /> },
              { key: "rule", label: "Rule", render: (e) => <span className="rule-id">{e.rule}</span> },
              { key: "tool", label: "Tool", render: (e) => <code>{e.tool}</code> },
              { key: "subject", label: "Subject", render: (e) => <code style={{ overflowWrap: "anywhere" }}>{e.subject || ""}</code> },
            ]}
          />
        </Block>
      )}
    </>
  );
}
