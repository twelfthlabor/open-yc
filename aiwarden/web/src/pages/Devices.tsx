import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { DataTable } from "../components/Table";
import { Empty, PageHead } from "../components/ui";
import { ago, compact } from "../lib/format";
import { go } from "../lib/router";
import type { DeviceRow, Fleet } from "../lib/types";

const serious = (d: DeviceRow) => (d.summary.findings?.critical || 0) + (d.summary.findings?.high || 0);

export function Devices({ fleet }: { fleet: Fleet }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? fleet.devices.filter((d) => [d.hostname, d.user, d.os, d.id].some((s) => String(s || "").toLowerCase().includes(n))) : fleet.devices;
  }, [fleet.devices, q]);
  return (
    <>
      <PageHead title="Devices" sub="Every laptop that reports to this collector, with its latest inventory. Open one to see how its apps, MCP servers, packages and models connect." />
      <div className="toolbar">
        <label className="field">
          <Search size={15} />
          <span className="sr-only">Filter devices</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by host, user or OS" />
        </label>
      </div>
      <DataTable<DeviceRow>
        label="Devices"
        rows={rows}
        rowKey={(d) => d.id}
        onRow={(d) => go(`devices/${d.id}`)}
        initialSort={{ key: "risk", dir: "desc" }}
        empty={<Empty title="No devices match" />}
        columns={[
          {
            key: "host",
            label: "Device",
            render: (d) => (
              <>
                <span className="cell-title">{d.hostname}</span>
                <span className="sub">
                  {d.user}, {d.os}
                </span>
              </>
            ),
            sort: (d) => d.hostname,
          },
          { key: "apps", label: "AI apps", num: true, render: (d) => d.summary.apps || 0, sort: (d) => d.summary.apps || 0 },
          { key: "mcp", label: "MCP", num: true, render: (d) => d.summary.mcp_servers || 0, sort: (d) => d.summary.mcp_servers || 0 },
          { key: "secrets", label: "Secrets", num: true, render: (d) => <span style={{ color: d.summary.plaintext_secrets ? "var(--high)" : undefined }}>{d.summary.plaintext_secrets || 0}</span>, sort: (d) => d.summary.plaintext_secrets || 0 },
          { key: "risk", label: "High findings", num: true, render: (d) => <span style={{ color: serious(d) ? "var(--high)" : undefined, fontWeight: serious(d) ? 600 : undefined }}>{serious(d)}</span>, sort: serious },
          { key: "tokens", label: "Tokens", num: true, render: (d) => compact(d.summary.tokens), sort: (d) => d.summary.tokens || 0 },
          { key: "guard", label: "Guard", render: (d) => (d.summary.guard_installed ? <span style={{ color: "var(--allow)" }}>On</span> : <span className="muted">Off</span>), sort: (d) => (d.summary.guard_installed ? 1 : 0) },
          { key: "seen", label: "Last report", render: (d) => <span title={d.received_at}>{ago(d.received_at)}</span>, sort: (d) => d.received_at || "" },
        ]}
      />
    </>
  );
}
