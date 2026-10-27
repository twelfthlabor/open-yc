import { DataTable } from "../components/Table";
import { Block, Empty, ErrorNote, Loading, PageHead, Sev } from "../components/ui";
import { api } from "../lib/api";
import type { Alert } from "../lib/types";
import { useApi } from "../lib/useApi";

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const RULE_NAME: Record<string, string> = {
  ALR001: "Token spike",
  ALR002: "Cost spike",
  ALR003: "MCP server",
  ALR004: "Plaintext secret",
  ALR005: "Guard blocks",
  ALR006: "AI app",
};
// Inventory rules fire the first time something is seen. With no alert history, the preview lists the whole
// inventory, so it is shown as what exists rather than as "new".
const INVENTORY = new Set(["ALR003", "ALR004", "ALR006"]);

export function asInventory(title: string): string {
  return title.replace(/^New (MCP server|plaintext secret)/, (_, w: string) => w.charAt(0).toUpperCase() + w.slice(1)).replace(/ newly installed on /, " installed on ");
}

function AlertTable({ rows, label, inventory }: { rows: Alert[]; label: string; inventory?: boolean }) {
  return (
    <DataTable<Alert>
      label={label}
      rows={rows}
      rowKey={(a) => a.id}
      limit={inventory ? 12 : undefined}
      initialSort={{ key: "sev", dir: "asc" }}
      empty={<Empty title={inventory ? "No MCP servers, secrets or AI apps reported" : "No spikes or guard bursts"}>{!inventory && "Spend, tokens and guard blocks are within the thresholds in config.toml."}</Empty>}
      columns={[
        { key: "sev", label: "Severity", render: (a) => <Sev s={a.severity} />, sort: (a) => RANK[a.severity] ?? 9 },
        { key: "rule", label: "Type", render: (a) => <><span>{RULE_NAME[a.rule] || a.rule}</span><span className="sub rule-id">{a.rule}</span></>, sort: (a) => a.rule },
        { key: "title", label: "Alert", render: (a) => <><span className="cell-title">{inventory ? asInventory(a.title) : a.title}</span>{a.detail && <span className="sub">{a.detail}</span>}</>, sort: (a) => a.title },
        { key: "who", label: "Who", render: (a) => <>{a.user || ""}{a.team && <span className="sub">{a.team}</span>}</>, sort: (a) => a.user || "" },
      ]}
    />
  );
}

export function Alerts({ onUnauthorized }: { onUnauthorized: () => void }) {
  const r = useApi(() => api.alerts(), "alerts", onUnauthorized);
  const all = r.data?.alerts || [];
  const activity = all.filter((a) => !INVENTORY.has(a.rule));
  const inventory = all.filter((a) => INVENTORY.has(a.rule));
  return (
    <>
      <PageHead title="Alerts" sub="What the alert rules see right now: token and spend spikes, bursts of guard blocks, and the inventory that triggers an alert when it first appears." />
      <p className="note" style={{ marginTop: -12, marginBottom: 26 }}>
        To get alerts in Slack, schedule <code>aiwarden alerts --server URL --webhook https://hooks.slack.com/...</code>. That job remembers what it has already sent, so an MCP server, secret or app only alerts the first time it shows up.
      </p>
      {r.error ? (
        <ErrorNote error={r.error} retry={r.reload} />
      ) : !r.data ? (
        <Loading />
      ) : (
        <>
          <Block title="Spend and guard activity" aside={<span className="aside">{activity.length}</span>}>
            <AlertTable rows={activity} label="Activity alerts" />
          </Block>
          <Block title="Inventory" aside={<span className="aside">Alerts when first seen</span>}>
            <AlertTable rows={inventory} label="Inventory alerts" inventory />
          </Block>
        </>
      )}
    </>
  );
}
