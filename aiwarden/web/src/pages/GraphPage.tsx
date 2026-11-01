import { useMemo } from "react";
import { attackPaths, RelationshipGraph, TYPE_COLOR } from "../components/Graph";
import { DataTable } from "../components/Table";
import { Block, Empty, ErrorNote, Loading, PageHead, Stat } from "../components/ui";
import { api } from "../lib/api";
import { mergeGraphs } from "../lib/fleetGraph";
import { useApi } from "../lib/useApi";
import type { Fleet, GraphNode } from "../lib/types";

interface Hub {
  node: GraphNode;
  devices: string[];
}

export function GraphPage({ fleet, rev, onUnauthorized }: { fleet: Fleet; rev: number; onUnauthorized: () => void }) {
  const ids = fleet.devices.map((d) => d.id);
  const reports = useApi(() => Promise.all(ids.map((id) => api.device(id))), `${ids.join(",")}|${rev}`, onUnauthorized);
  const graph = useMemo(() => (reports.data ? mergeGraphs(reports.data) : null), [reports.data]);

  // packages and hosts that more than one device reaches: where one bad release or one leaky host hits many
  const hubs = useMemo<Hub[]>(() => {
    if (!graph) return [];
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const parents = new Map<string, string[]>();
    for (const e of graph.edges) (parents.get(e.target) || parents.set(e.target, []).get(e.target)!).push(e.source);
    const devicesOf = (id: string, seen = new Set<string>()): Set<string> => {
      const out = new Set<string>();
      for (const p of parents.get(id) || []) {
        if (seen.has(p)) continue;
        seen.add(p);
        const n = byId.get(p);
        if (n?.type === "device") out.add(String(n.label));
        else for (const d of devicesOf(p, seen)) out.add(d);
      }
      return out;
    };
    return graph.nodes
      .filter((n) => n.type === "package" || n.type === "host")
      .map((node) => ({ node, devices: [...devicesOf(node.id)].sort() }))
      .filter((h) => h.devices.length > 1)
      .sort((a, b) => b.devices.length - a.devices.length);
  }, [graph]);
  const paths = useMemo(() => (graph ? attackPaths(graph.nodes, graph.edges) : null), [graph]);
  const calls = graph ? graph.edges.reduce((a, e) => a + (Number(e.meta?.calls) || 0), 0) : 0;

  return (
    <>
      <PageHead
        title="Graph"
        sub="Every device, AI app, MCP server, package, remote host and model in the fleet, and how they connect. Packages, hosts and models used on several devices become hubs. Select anything to see what it touches."
      />
      {reports.error ? (
        <ErrorNote error={reports.error} retry={reports.reload} />
      ) : !graph ? (
        <Loading rows={5} />
      ) : !graph.nodes.length ? (
        <Empty title="No relationship data yet">Each device report carries its own map; it shows up here once a device has reported.</Empty>
      ) : (
        <>
          <div className="strip">
            <Stat value={graph.nodes.length} label="Items on the map" />
            <Stat value={graph.edges.length} label="Connections" />
            <Stat value={hubs.length} label="Shared packages and hosts" />
            <Stat value={paths?.targets.length || 0} label="Risky items" />
            <Stat value={calls} label="MCP calls mapped" />
          </div>
          <Block title="Fleet map" aside={<span className="aside hide-sm">Drag to move, scroll to zoom, search to find, toggle types below</span>}>
            <RelationshipGraph nodes={graph.nodes} edges={graph.edges} findings={fleet.findings} linkDevices />
          </Block>
          <Block title="Shared hubs" aside={<span className="aside">Used on more than one device</span>}>
            <DataTable<Hub>
              label="Shared hubs"
              rows={hubs}
              rowKey={(h) => h.node.id}
              initialSort={{ key: "devices", dir: "desc" }}
              empty={<Empty title="Nothing is shared between devices">Every package and remote host is used on one device only.</Empty>}
              columns={[
                {
                  key: "name",
                  label: "Package or host",
                  render: (h) => (
                    <span className="hub-name">
                      <i style={{ background: TYPE_COLOR[h.node.type] }} />
                      <code>{String(h.node.label)}</code>
                    </span>
                  ),
                  sort: (h) => String(h.node.label),
                },
                { key: "type", label: "Type", render: (h) => (h.node.type === "host" ? "Remote host" : "Package"), sort: (h) => h.node.type },
                { key: "devices", label: "Devices", num: true, render: (h) => h.devices.length, sort: (h) => h.devices.length },
                { key: "where", label: "On", render: (h) => <span className="muted">{h.devices.join(", ")}</span> },
              ]}
            />
          </Block>
        </>
      )}
    </>
  );
}
