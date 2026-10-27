import { DataTable } from "../components/Table";
import { Block, Empty, PageHead, Sev, Tag } from "../components/ui";
import { api } from "../lib/api";
import type { Fleet } from "../lib/types";
import { useApi } from "../lib/useApi";

type Pkg = Fleet["mcp_packages"][number];

export function Mcp({ fleet, onUnauthorized }: { fleet: Fleet; onUnauthorized: () => void }) {
  const rules = useApi(() => api.rules(), "rules", onUnauthorized);
  const remote = fleet.mcp_packages.filter((p) => /^https?:\/\//i.test(p.package)).length;
  return (
    <>
      <PageHead
        title="MCP servers"
        sub={`${fleet.mcp_packages.length} distinct servers across the fleet, ${remote} of them remote. Grouped by the package or URL they run, so one risky package shows every device that has it.`}
      />
      <Block title="Servers by package or endpoint">
        <DataTable<Pkg>
          label="MCP servers by package"
          rows={fleet.mcp_packages}
          rowKey={(p) => p.package}
          initialSort={{ key: "devices", dir: "desc" }}
          empty={<Empty title="No MCP servers reported">Devices report MCP servers from Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Gemini CLI, Codex and more.</Empty>}
          columns={[
            { key: "pkg", label: "Package or URL", render: (p) => <code style={{ overflowWrap: "anywhere" }}>{p.package}</code>, sort: (p) => p.package },
            { key: "kind", label: "Type", render: (p) => (/^https?:\/\//i.test(p.package) ? "Remote" : "Local"), sort: (p) => (/^https?:/i.test(p.package) ? 1 : 0) },
            { key: "clients", label: "Configured in", render: (p) => p.clients.map((c) => <Tag key={c}>{c}</Tag>) },
            { key: "devices", label: "Devices", num: true, render: (p) => p.devices, sort: (p) => p.devices },
          ]}
        />
      </Block>
      <Block title="Tool poisoning scan" aside={<span className="aside">Runs on each device</span>}>
        <p className="note" style={{ marginTop: 0 }}>
          <code>aiwarden mcp-scan --connect</code> starts each configured server, lists its tools (it never calls one) and checks the definitions for the problems below. Results are part of the device findings.
        </p>
        {rules.data && (
          <DataTable
            label="MCP scan rules"
            rows={rules.data.mcp_scan}
            rowKey={(r) => r.id}
            columns={[
              { key: "id", label: "Rule", render: (r) => <span className="rule-id">{r.id}</span> },
              { key: "sev", label: "Severity", render: (r) => <Sev s={r.severity} /> },
              { key: "d", label: "Checks for", render: (r) => r.description },
            ]}
          />
        )}
      </Block>
    </>
  );
}
