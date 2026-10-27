import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { SevBar } from "../components/Charts";
import { DataTable } from "../components/Table";
import { Empty, PageHead, Seg, Sev } from "../components/ui";
import { go } from "../lib/router";
import type { Finding, Fleet } from "../lib/types";

const LEVELS = ["all", "high and above", "medium", "low", "info"] as const;
type Level = (typeof LEVELS)[number];
const FROM_PARAM: Record<string, Level> = { high: "high and above", medium: "medium", low: "low", info: "info" };

function matches(f: Finding, level: Level): boolean {
  if (level === "all") return true;
  if (level === "high and above") return f.severity === "critical" || f.severity === "high";
  return f.severity === level;
}
const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function FindingsTable({ rows, showDevice = true, limit }: { rows: Finding[]; showDevice?: boolean; limit?: number }) {
  return (
    <DataTable<Finding>
      label="Findings"
      rows={rows}
      rowKey={(f, i) => `${f.device_id}-${f.rule}-${i}`}
      limit={limit}
      onRow={showDevice ? (f) => f.device_id && go(`devices/${f.device_id}`) : undefined}
      initialSort={{ key: "severity", dir: "asc" }}
      empty={<Empty title="No findings match">Clear the filters to see everything.</Empty>}
      columns={[
        { key: "severity", label: "Severity", render: (f) => <Sev s={f.severity} />, sort: (f) => RANK[f.severity] ?? 9 },
        { key: "rule", label: "Rule", render: (f) => <span className="rule-id">{f.rule}</span>, sort: (f) => f.rule },
        {
          key: "title",
          label: "Finding",
          render: (f) => (
            <>
              <span className="cell-title">{f.title}</span>
              {f.detail && <span className="sub">{f.detail}</span>}
              {f.location && <span className="sub mono">{f.location}</span>}
            </>
          ),
          sort: (f) => f.title,
        },
        ...(showDevice ? [{ key: "host", label: "Device", render: (f: Finding) => f.hostname || "", sort: (f: Finding) => f.hostname || "" }] : []),
      ]}
    />
  );
}

export function Findings({ fleet, params }: { fleet: Fleet; params: URLSearchParams }) {
  const [level, setLevel] = useState<Level>(FROM_PARAM[params.get("sev") || ""] || "all");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return fleet.findings.filter(
      (f) => matches(f, level) && (!needle || [f.title, f.detail, f.rule, f.hostname, f.location].some((s) => String(s || "").toLowerCase().includes(needle))),
    );
  }, [fleet.findings, level, q]);
  return (
    <>
      <PageHead title="Findings" sub="Risky configurations found on each device: plaintext secrets in MCP configs, agents allowed to run anything, unpinned packages, broad browser extensions." />
      <SevBar counts={fleet.totals.findings || {}} />
      <div className="toolbar" style={{ marginTop: 18 }}>
        <Seg label="Severity" value={level} options={LEVELS} onChange={setLevel} />
        <label className="field">
          <Search size={15} />
          <span className="sr-only">Filter findings</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by rule, device or text" />
        </label>
        <span className="muted" style={{ fontSize: 13.5 }}>
          {rows.length} of {fleet.findings.length}
        </span>
      </div>
      <FindingsTable rows={rows} />
    </>
  );
}
