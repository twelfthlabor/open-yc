import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { GraphEdge, GraphNode } from "../lib/types";

export const TYPE_COLOR: Record<string, string> = {
  device: "#5d6a80",
  user: "#8b5cf6",
  app: "#3b5bdb",
  mcp: "#0f9d78",
  package: "#d97706",
  host: "#e8590c",
  model: "#7048e8",
  skill: "#0c8599",
  browser: "#64748b",
  extension: "#d6336c",
};

const TYPE_LABEL: Record<string, string> = {
  device: "Device",
  user: "User",
  app: "AI app",
  mcp: "MCP server",
  package: "Package",
  host: "Remote host",
  model: "Model",
  skill: "Skill",
  browser: "Browser",
  extension: "Extension",
};

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const W = 1100;
const H = 620;

/** Deterministic force layout (seeded on a golden-angle spiral), so the same report always draws the same map. */
export function layout(nodes: GraphNode[], edges: GraphEdge[], iterations = 320): { nodes: SimNode[]; links: [number, number, string][] } {
  const sim: SimNode[] = nodes.map((n, i) => {
    const a = i * 2.39996;
    const d = 24 * Math.sqrt(i + 1);
    return { ...n, x: W / 2 + Math.cos(a) * d, y: H / 2 + Math.sin(a) * d, vx: 0, vy: 0, r: n.type === "device" ? 13 : n.type === "app" ? 9.5 : 7 };
  });
  const idx = new Map(sim.map((n, i) => [n.id, i]));
  const links: [number, number, string][] = [];
  for (const e of edges) {
    const s = idx.get(e.source);
    const t = idx.get(e.target);
    if (s !== undefined && t !== undefined && s !== t) links.push([s, t, e.type]);
  }
  const n = sim.length;
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = sim[i];
        const b = sim[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = 0.1 * (i - j);
          dy = 0.1;
          d2 = 0.02;
        }
        if (d2 > 160000) continue;
        const f = 4200 / d2;
        const d = Math.sqrt(d2);
        a.vx += (f * dx) / d;
        a.vy += (f * dy) / d;
        b.vx -= (f * dx) / d;
        b.vy -= (f * dy) / d;
      }
    }
    for (const [s, t] of links) {
      const a = sim[s];
      const b = sim[t];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = (d - 104) * 0.03;
      a.vx += (f * dx) / d;
      a.vy += (f * dy) / d;
      b.vx -= (f * dx) / d;
      b.vy -= (f * dy) / d;
    }
    for (const p of sim) {
      p.vx += (W / 2 - p.x) * 0.004;
      p.vy += (H / 2 - p.y) * 0.004;
      const step = 22 * cool + 2;
      p.x += Math.max(-step, Math.min(step, p.vx * 0.5));
      p.y += Math.max(-step, Math.min(step, p.vy * 0.5));
      p.vx *= 0.55;
      p.vy *= 0.55;
    }
  }
  return { nodes: sim, links };
}

/** Scale and centre the laid-out nodes in the frame, leaving room on the right for labels. */
export function fitView(ns: { x: number; y: number }[]): { x: number; y: number; k: number } {
  if (!ns.length) return { x: 0, y: 0, k: 1 };
  const xs = ns.map((n) => n.x);
  const ys = ns.map((n) => n.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.max(0.4, Math.min(2, (W - 260) / Math.max(1, x1 - x0), (H - 90) / Math.max(1, y1 - y0)));
  const cx = (x0 + x1) / 2 + 50 / k; // labels sit to the right of each node
  const cy = (y0 + y1) / 2;
  return { k, x: W / 2 - cx * k, y: H / 2 - cy * k };
}

function sevStroke(s: unknown): string | undefined {
  return s === "critical" ? "var(--critical)" : s === "high" ? "var(--high)" : s === "medium" ? "var(--medium)" : undefined;
}

export function RelationshipGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const base = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const fit = useMemo(() => fitView(base.nodes), [base]);
  const [pos, setPos] = useState(() => base.nodes.map((p) => ({ x: p.x, y: p.y })));
  const [view, setView] = useState(fit);
  useEffect(() => {
    setPos(base.nodes.map((p) => ({ x: p.x, y: p.y })));
    setView(fit);
  }, [base, fit]);
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: "pan" | "node"; i?: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const neighbors = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const [s, t] of base.links) {
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [base]);

  const focus = hover ?? selected;
  const near = focus !== null ? neighbors.get(focus) || new Set<number>() : null;
  const lit = (i: number) => focus === null || i === focus || near!.has(i);

  const toSvg = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    // the viewBox keeps aspect ratio with "meet": find the scale actually used
    const s = Math.min(r.width / W, r.height / H);
    const ox = (r.width - W * s) / 2;
    const oy = (r.height - H * s) / 2;
    return { x: (cx - r.left - ox) / s, y: (cy - r.top - oy) / s };
  };

  const onDown = (e: React.PointerEvent, i?: number) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toSvg(e.clientX, e.clientY);
    drag.current = i === undefined ? { kind: "pan", sx: p.x, sy: p.y, ox: view.x, oy: view.y, moved: false } : { kind: "node", i, sx: p.x, sy: p.y, ox: pos[i].x, oy: pos[i].y, moved: false };
    setDragging(true);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toSvg(e.clientX, e.clientY);
    const dx = p.x - d.sx;
    const dy = p.y - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.kind === "pan") setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    else setPos((ps) => ps.map((q, k) => (k === d.i ? { x: d.ox + dx / view.k, y: d.oy + dy / view.k } : q)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && !d.moved) setSelected(d.kind === "node" ? (selected === d.i ? null : d.i!) : null);
  };
  const zoom = (f: number, cx = W / 2, cy = H / 2) =>
    setView((v) => {
      const k = Math.max(0.35, Math.min(4, v.k * f));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  const types = useMemo(() => [...new Set(base.nodes.map((n) => n.type))], [base]);
  const sel = selected !== null ? base.nodes[selected] : null;
  const labelAll = base.nodes.length <= 60 || view.k > 1.4;

  if (!base.nodes.length) return null;
  return (
    <>
      <div className="graph">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className={dragging ? "dragging" : undefined}
          role="img"
          aria-label={`Relationship map with ${base.nodes.length} items and ${base.links.length} connections`}
          onPointerDown={(e) => onDown(e)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {base.links.map(([s, t], k) => (
              <line
                key={k}
                x1={pos[s]?.x}
                y1={pos[s]?.y}
                x2={pos[t]?.x}
                y2={pos[t]?.y}
                className={focus !== null && (s === focus || t === focus) ? "hot" : focus !== null ? "dim" : undefined}
              />
            ))}
            {base.nodes.map((n, i) => {
              const ring = sevStroke(n.meta?.max_severity);
              return (
                <g
                  key={n.id}
                  className={`node${lit(i) ? "" : " dim"}`}
                  transform={`translate(${pos[i]?.x ?? n.x} ${pos[i]?.y ?? n.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${TYPE_LABEL[n.type] || n.type}: ${n.label}${n.meta?.max_severity ? `, ${n.meta.findings} findings` : ""}`}
                  aria-pressed={selected === i}
                  onPointerDown={(e) => onDown(e, i)}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(selected === i ? null : i);
                    }
                  }}
                >
                  {ring && <circle r={n.r + 4.5} fill="none" stroke={ring} strokeWidth={2.5} />}
                  <circle r={n.r} fill={TYPE_COLOR[n.type] || "#868e96"} stroke="var(--panel)" strokeWidth={2} />
                  {(labelAll || n.type === "device" || n.type === "app" || i === focus || near?.has(i)) && (
                    <text x={n.r + 6} y={4}>
                      {String(n.label).length > 30 ? `${String(n.label).slice(0, 29)}…` : String(n.label)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <div className="graph-tools">
          <button className="icon-btn" type="button" aria-label="Zoom in" onClick={() => zoom(1.25)}>
            <Plus size={16} />
          </button>
          <button className="icon-btn" type="button" aria-label="Zoom out" onClick={() => zoom(0.8)}>
            <Minus size={16} />
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label="Reset view"
            onClick={() => {
              setView(fit);
              setPos(base.nodes.map((p) => ({ x: p.x, y: p.y })));
            }}
          >
            <Maximize2 size={15} />
          </button>
        </div>
        {sel && (
          <div className="graph-info" aria-live="polite">
            <span className="muted">{TYPE_LABEL[sel.type] || sel.type}</span>
            <b>{String(sel.label)}</b>
            <span className="muted">
              {neighbors.get(selected!)?.size || 0} connections
              {sel.meta?.max_severity ? `, ${sel.meta.findings} findings, worst ${sel.meta.max_severity}` : ""}
            </span>
          </div>
        )}
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        {types.map((t) => (
          <span key={t}>
            <i style={{ background: TYPE_COLOR[t] || "#868e96" }} />
            {TYPE_LABEL[t] || t}
          </span>
        ))}
        <span>
          <i style={{ background: "transparent", boxShadow: "0 0 0 2px var(--high)" }} />
          Has findings
        </span>
      </div>
    </>
  );
}
