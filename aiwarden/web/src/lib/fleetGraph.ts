import type { GraphEdge, GraphNode } from "./types";

// Node ids in a device report are only unique within that device ("app:claude-code", "browser:chrome").
// When the maps of several devices are drawn as one, those get the device id in front; people, models,
// packages and remote hosts are the same thing everywhere, so they stay shared and become the hubs that
// show which laptops run the same MCP package or talk to the same host.
const SHARED = new Set(["user", "model", "package", "host"]);
const ORDER = ["critical", "high", "medium", "low", "info"];

export interface DeviceGraph {
  device: { id: string; hostname?: string };
  graph?: { nodes: GraphNode[]; edges: GraphEdge[] } | null;
}

export function mergeGraphs(devices: DeviceGraph[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  for (const d of devices) {
    const g = d.graph;
    if (!g) continue;
    const local = new Map<string, string>();
    for (const n of g.nodes) {
      const shared = SHARED.has(n.type) || n.type === "device";
      const id = shared ? n.id : `${d.device.id}/${n.id}`;
      local.set(n.id, id);
      const meta = { ...(n.meta || {}), ...(shared ? {} : { device_id: d.device.id, hostname: d.device.hostname, subject: n.id }) };
      const prev = nodes.get(id);
      if (!prev) {
        nodes.set(id, { ...n, id, meta: n.type === "device" ? { ...meta, device_id: d.device.id, subject: n.id } : meta });
        continue;
      }
      // the same package or host on several devices: keep the worst severity and add up findings
      const a = prev.meta?.max_severity;
      const b = meta.max_severity;
      const worst = [a, b].filter(Boolean).sort((x, y) => ORDER.indexOf(String(x)) - ORDER.indexOf(String(y)))[0];
      const findings = (Number(prev.meta?.findings) || 0) + (Number(meta.findings) || 0);
      prev.meta = { ...prev.meta, ...(worst ? { max_severity: String(worst) } : {}), ...(findings ? { findings } : {}) };
    }
    for (const e of g.edges) {
      const s = local.get(e.source);
      const t = local.get(e.target);
      if (!s || !t) continue;
      const key = `${s}>${t}`;
      const prev = edges.get(key);
      const calls = Number(e.meta?.calls) || 0;
      if (prev) prev.meta = { ...prev.meta, calls: (Number(prev.meta?.calls) || 0) + calls };
      else edges.set(key, { ...e, source: s, target: t, meta: { ...(e.meta || {}) } });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
