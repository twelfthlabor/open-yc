import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Laptop, Maximize2, Minus, Plus, Route, Search, X } from "lucide-react";
import { motionOK } from "../lib/motion";
import { href } from "../lib/router";
import type { Finding, GraphEdge, GraphNode } from "../lib/types";
import { findingId } from "./FindingPeek";
import { Sev } from "./ui";

export const TYPE_COLOR: Record<string, string> = {
  device: "#94a3b8",
  user: "#a78bfa",
  app: "#6d8bff",
  mcp: "#2dd4a7",
  package: "#f5a524",
  host: "#ff7a45",
  model: "#c084fc",
  skill: "#22c3dd",
  browser: "#7c8aa5",
  extension: "#f472b6",
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

const TYPE_ORDER = ["user", "device", "app", "mcp", "package", "host", "model", "skill", "browser", "extension"];

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const W = 1100;
const H = 620;
const ITERATIONS = 320;

function seed(nodes: GraphNode[]): SimNode[] {
  return nodes.map((n, i) => {
    const a = i * 2.39996;
    const d = 24 * Math.sqrt(i + 1);
    return { ...n, x: W / 2 + Math.cos(a) * d, y: H / 2 + Math.sin(a) * d, vx: 0, vy: 0, r: n.type === "device" ? 13 : n.type === "app" ? 9.5 : 7 };
  });
}

function linksOf(sim: SimNode[], edges: GraphEdge[]): [number, number, string][] {
  const idx = new Map(sim.map((n, i) => [n.id, i]));
  const links: [number, number, string][] = [];
  for (const e of edges) {
    const s = idx.get(e.source);
    const t = idx.get(e.target);
    if (s !== undefined && t !== undefined && s !== t) links.push([s, t, e.type]);
  }
  return links;
}

/** One step of the force model: pairwise repulsion, springy links, a pull to the centre. `pinned` stays put. */
function step(sim: SimNode[], links: [number, number, string][], cool: number, pinned = -1) {
  const n = sim.length;
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
  for (let i = 0; i < n; i++) {
    const p = sim[i];
    p.vx += (W / 2 - p.x) * 0.004;
    p.vy += (H / 2 - p.y) * 0.004;
    const max = 22 * cool + 2;
    if (i !== pinned) {
      p.x += Math.max(-max, Math.min(max, p.vx * 0.5));
      p.y += Math.max(-max, Math.min(max, p.vy * 0.5));
    }
    p.vx *= 0.55;
    p.vy *= 0.55;
  }
}

/** Deterministic force layout (seeded on a golden-angle spiral), so the same report always draws the same map. */
export function layout(nodes: GraphNode[], edges: GraphEdge[], iterations = ITERATIONS): { nodes: SimNode[]; links: [number, number, string][] } {
  const sim = seed(nodes);
  const links = linksOf(sim, edges);
  for (let it = 0; it < iterations; it++) step(sim, links, 1 - it / iterations);
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

const RISKY = new Set(["critical", "high", "medium"]);
/** What a compromised node can pass data or commands to; models and skills are not on that route. */
const REACH = new Set(["mcp", "package", "host", "extension"]);

/** Attack paths: for every node with a medium-or-worse finding, the chain of edges leading to it from the
 *  top of the map (user, device, app) and the MCP servers, packages, hosts and extensions it reaches. */
export function attackPaths(nodes: GraphNode[], edges: GraphEdge[]): { nodes: Set<string>; edges: Set<string>; targets: string[] } {
  const type = new Map(nodes.map((n) => [n.id, n.type]));
  const ids = new Set(type.keys());
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    (parents.get(e.target) || parents.set(e.target, []).get(e.target)!).push(e.source);
    (children.get(e.source) || children.set(e.source, []).get(e.source)!).push(e.target);
  }
  const targets = nodes.filter((n) => RISKY.has(String(n.meta?.max_severity))).map((n) => n.id);
  const onPath = new Set<string>();
  const links = new Set<string>();
  const walk = (start: string, next: Map<string, string[]>, up: boolean) => {
    const stack = [start];
    const seen = new Set([start]);
    while (stack.length) {
      const cur = stack.pop()!;
      onPath.add(cur);
      for (const o of next.get(cur) || []) {
        if (!up && !REACH.has(type.get(o) || "")) continue;
        links.add(up ? `${o}>${cur}` : `${cur}>${o}`);
        if (!seen.has(o)) {
          seen.add(o);
          stack.push(o);
        }
      }
    }
  };
  for (const t of targets) {
    walk(t, parents, true);
    walk(t, children, false);
  }
  return { nodes: onPath, edges: links, targets };
}

function sevStroke(s: unknown): string | undefined {
  return s === "critical" ? "var(--critical)" : s === "high" ? "var(--high)" : s === "medium" ? "var(--medium)" : undefined;
}

const HIDDEN_META = new Set(["subject", "device_id", "hostname", "max_severity", "findings"]);

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Findings to list in the inspector, matched to nodes by device and subject. */
  findings?: Finding[];
  /** Link device nodes to their page (the fleet map). */
  linkDevices?: boolean;
}

// A live relationship map in the style of an Obsidian graph: the layout blooms out from the centre, nodes glow by
// type and grow with their connections, edges that carry MCP calls flow, and an inspector on the right explains
// whatever is selected. Positions are written straight to the DOM on each animation frame, not through React state.
export function RelationshipGraph({ nodes, edges, findings, linkDevices }: Props) {
  const uid = useId().replace(/:/g, "");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set());
  const vis = useMemo(() => {
    const ns = nodes.filter((n) => !hiddenTypes.has(n.type));
    const keep = new Set(ns.map((n) => n.id));
    return { nodes: ns, edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
  }, [nodes, edges, hiddenTypes]);
  const base = useMemo(() => layout(vis.nodes, vis.edges), [vis]);
  const fit = useMemo(() => fitView(base.nodes), [base]);
  const pos = useRef(base.nodes.map((p) => ({ x: p.x, y: p.y })));
  if (pos.current.length !== base.nodes.length) pos.current = base.nodes.map((p) => ({ x: p.x, y: p.y }));
  const [view, setView] = useState(fit);
  const nodeEls = useRef<(SVGGElement | null)[]>([]);
  const lineEls = useRef<(SVGLineElement | null)[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [showPaths, setShowPaths] = useState(false);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: "pan" | "node"; i?: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const anim = useRef(0);

  const paint = () => {
    const p = pos.current;
    base.nodes.forEach((_, i) => nodeEls.current[i]?.setAttribute("transform", `translate(${p[i].x.toFixed(1)} ${p[i].y.toFixed(1)})`));
    base.links.forEach(([s, t], k) => {
      const el = lineEls.current[k];
      if (!el) return;
      el.setAttribute("x1", p[s].x.toFixed(1));
      el.setAttribute("y1", p[s].y.toFixed(1));
      el.setAttribute("x2", p[t].x.toFixed(1));
      el.setAttribute("y2", p[t].y.toFixed(1));
    });
  };

  // Bloom: replay the layout's own iterations on screen, so the map unfolds from the centre and lands exactly on
  // the deterministic layout. Under reduced motion (and in tests) it is drawn settled.
  useEffect(() => {
    setView(fit);
    setSelected(null);
    cancelAnimationFrame(anim.current);
    if (!motionOK() || !base.nodes.length) {
      pos.current = base.nodes.map((p) => ({ x: p.x, y: p.y }));
      paint();
      return;
    }
    const sim = seed(base.nodes);
    let it = 0;
    const frame = () => {
      for (let k = 0; k < 6 && it < ITERATIONS; k++, it++) step(sim, base.links, 1 - it / ITERATIONS);
      pos.current = sim.map((p) => ({ x: p.x, y: p.y }));
      paint();
      if (it < ITERATIONS && document.visibilityState === "visible") anim.current = requestAnimationFrame(frame);
      else {
        pos.current = base.nodes.map((p) => ({ x: p.x, y: p.y }));
        paint();
      }
    };
    anim.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(anim.current);
    // paint only reads refs and `base`, which is a dependency already
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, fit]);

  /** After a drag the neighbours settle around the node's new place for a moment. */
  const settle = (pinned: number) => {
    if (!motionOK()) return;
    const sim = base.nodes.map((n, i) => ({ ...n, x: pos.current[i].x, y: pos.current[i].y, vx: 0, vy: 0 }));
    let f = 0;
    cancelAnimationFrame(anim.current);
    const frame = () => {
      step(sim, base.links, 0.08, pinned);
      pos.current = sim.map((p) => ({ x: p.x, y: p.y }));
      paint();
      if (++f < 45) anim.current = requestAnimationFrame(frame);
    };
    anim.current = requestAnimationFrame(frame);
  };

  const degree = useMemo(() => {
    const d: number[] = new Array(base.nodes.length).fill(0);
    for (const [s, t] of base.links) {
      d[s]++;
      d[t]++;
    }
    return d;
  }, [base]);
  const radius = (i: number) => {
    const n = base.nodes[i];
    const b = n.type === "device" ? 11 : n.type === "app" ? 8.5 : n.type === "user" ? 8 : 6;
    return b + Math.min(9, Math.sqrt(degree[i]) * 1.4);
  };
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
  const calls = useMemo(() => {
    const m = new Map(vis.edges.map((e) => [`${e.source}>${e.target}`, Number(e.meta?.calls) || 0]));
    return base.links.map(([s, t]) => m.get(`${base.nodes[s].id}>${base.nodes[t].id}`) || 0);
  }, [base, vis.edges]);

  const paths = useMemo(() => attackPaths(vis.nodes, vis.edges), [vis]);
  const tracing = showPaths && paths.targets.length > 0;
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => (q ? new Set(base.nodes.flatMap((n, i) => (String(n.label).toLowerCase().includes(q) ? [i] : []))) : null), [q, base]);

  const focus = hover ?? selected;
  const near = focus !== null ? neighbors.get(focus) || new Set<number>() : null;
  const lit = (i: number) => {
    if (focus !== null) return i === focus || near!.has(i);
    if (matches) return matches.has(i);
    return !tracing || paths.nodes.has(base.nodes[i].id);
  };
  const linkClass = (k: number) => {
    const [s, t] = base.links[k];
    if (focus !== null) return s === focus || t === focus ? "hot" : "dim";
    if (matches) return matches.has(s) && matches.has(t) ? undefined : "dim";
    if (tracing) {
      const a = base.nodes[s].id;
      const b = base.nodes[t].id;
      return paths.edges.has(`${a}>${b}`) || paths.edges.has(`${b}>${a}`) ? "path" : "dim";
    }
    return calls[k] ? "flow" : undefined;
  };

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
    if (i !== undefined) cancelAnimationFrame(anim.current);
    drag.current =
      i === undefined
        ? { kind: "pan", sx: p.x, sy: p.y, ox: view.x, oy: view.y, moved: false }
        : { kind: "node", i, sx: p.x, sy: p.y, ox: pos.current[i].x, oy: pos.current[i].y, moved: false };
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
    else {
      pos.current[d.i!] = { x: d.ox + dx / view.k, y: d.oy + dy / view.k };
      paint();
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    if (d.kind === "node" && d.moved) settle(d.i!);
    if (!d.moved) setSelected(d.kind === "node" ? (selected === d.i ? null : d.i!) : null);
  };
  const zoom = (f: number, cx = W / 2, cy = H / 2) =>
    setView((v) => {
      const k = Math.max(0.35, Math.min(4, v.k * f));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  const centerOn = (i: number) => {
    setSelected(i);
    setView((v) => {
      const k = Math.max(v.k, 1.1);
      return { k, x: W / 2 - 120 - pos.current[i].x * k, y: H / 2 - pos.current[i].y * k };
    });
  };
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

  const allTypes = useMemo(() => {
    const present = new Set(nodes.map((n) => n.type));
    return [...TYPE_ORDER.filter((t) => present.has(t)), ...[...present].filter((t) => !TYPE_ORDER.includes(t))];
  }, [nodes]);
  const sel = selected !== null ? base.nodes[selected] : null;
  const labelAll = base.nodes.length <= 40 || view.k > 1.35;
  const showLabel = (i: number) => {
    const n = base.nodes[i];
    return labelAll || n.type === "device" || n.type === "app" || n.type === "user" || degree[i] >= 4 || i === focus || !!near?.has(i) || !!matches?.has(i);
  };
  const selFindings = useMemo(() => {
    if (!sel || !findings) return [];
    const subject = String(sel.meta?.subject ?? sel.id);
    const dev = sel.meta?.device_id;
    return findings.filter((f) => f.subject === subject && (!dev || !f.device_id || f.device_id === dev));
  }, [sel, findings]);
  const selLinks = useMemo(() => {
    if (selected === null) return [];
    const out: { i: number; calls: number }[] = [];
    base.links.forEach(([s, t], k) => {
      if (s === selected) out.push({ i: t, calls: calls[k] });
      else if (t === selected) out.push({ i: s, calls: calls[k] });
    });
    return out.sort((a, b) => TYPE_ORDER.indexOf(base.nodes[a.i].type) - TYPE_ORDER.indexOf(base.nodes[b.i].type));
  }, [selected, base, calls]);

  if (!nodes.length) return null;
  return (
    <>
      <div className="graph">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className={dragging ? "dragging" : undefined}
          role="group"
          aria-label={`Relationship map with ${base.nodes.length} items and ${base.links.length} connections`}
          onPointerDown={(e) => onDown(e)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <defs>
            {allTypes.map((t) => (
              <radialGradient key={t} id={`${uid}-${t}`}>
                <stop offset="0%" stopColor={TYPE_COLOR[t] || "#94a3b8"} stopOpacity={0.5} />
                <stop offset="100%" stopColor={TYPE_COLOR[t] || "#94a3b8"} stopOpacity={0} />
              </radialGradient>
            ))}
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {base.links.map(([s, t], k) => (
              <line
                key={k}
                ref={(el) => {
                  lineEls.current[k] = el;
                }}
                x1={pos.current[s]?.x}
                y1={pos.current[s]?.y}
                x2={pos.current[t]?.x}
                y2={pos.current[t]?.y}
                className={linkClass(k)}
                style={calls[k] ? ({ "--w": Math.min(3.2, 1 + Math.log10(calls[k] + 1)).toFixed(2) } as React.CSSProperties) : undefined}
              />
            ))}
            {base.nodes.map((n, i) => {
              const ring = sevStroke(n.meta?.max_severity);
              const r = radius(i);
              const sev = String(n.meta?.max_severity || "");
              return (
                <g
                  key={n.id}
                  ref={(el) => {
                    nodeEls.current[i] = el;
                  }}
                  className={`node${lit(i) ? "" : " dim"}${selected === i ? " selected" : ""}`}
                  transform={`translate(${pos.current[i]?.x ?? n.x} ${pos.current[i]?.y ?? n.y})`}
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
                    } else if (e.key === "Escape") setSelected(null);
                  }}
                >
                  <circle className="halo" r={r * 2.6} fill={`url(#${uid}-${n.type})`} />
                  {ring && <circle className={`ring${sev === "critical" || sev === "high" ? " pulse" : ""}`} r={r + 4.5} fill="none" stroke={ring} strokeWidth={2.2} />}
                  <circle className="core" r={r} fill={TYPE_COLOR[n.type] || "#94a3b8"} />
                  {showLabel(i) && (
                    <text x={r + 6} y={4}>
                      {String(n.label).length > 30 ? `${String(n.label).slice(0, 29)}…` : String(n.label)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <div className="graph-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            name="graph-search"
            aria-label="Search the map"
            placeholder="Search the map"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches?.size) centerOn([...matches][0]);
              if (e.key === "Escape") setQuery("");
            }}
          />
          {matches && <span className="graph-count">{matches.size}</span>}
        </div>
        <div className="graph-tools">
          {paths.targets.length > 0 && (
            <button
              className={`icon-btn${showPaths ? " on" : ""}`}
              type="button"
              aria-pressed={showPaths}
              aria-label={`${showPaths ? "Hide" : "Show"} attack paths`}
              title={`Attack paths: how a user reaches the ${paths.targets.length} risky item${paths.targets.length === 1 ? "" : "s"}`}
              onClick={() => setShowPaths((v) => !v)}
            >
              <Route size={15} />
            </button>
          )}
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
              pos.current = base.nodes.map((p) => ({ x: p.x, y: p.y }));
              paint();
            }}
          >
            <Maximize2 size={15} />
          </button>
        </div>
        {sel && (
          <aside className="graph-info" aria-label="Selected item" aria-live="polite">
            <header>
              <span className="graph-type">
                <i style={{ background: TYPE_COLOR[sel.type] || "#94a3b8" }} />
                {TYPE_LABEL[sel.type] || sel.type}
              </span>
              <button className="icon-btn" type="button" aria-label="Close details" onClick={() => setSelected(null)}>
                <X size={14} />
              </button>
            </header>
            <b>{String(sel.label)}</b>
            <dl>
              {!!sel.meta?.hostname && (
                <div className="kv-row">
                  <dt>Device</dt>
                  <dd>{String(sel.meta.hostname)}</dd>
                </div>
              )}
              {Object.entries(sel.meta || {})
                .filter(([k, v]) => !HIDDEN_META.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean") && v !== "")
                .slice(0, 8)
                .map(([k, v]) => (
                  <div key={k} className="kv-row">
                    <dt>{k.replace(/_/g, " ")}</dt>
                    <dd>{typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</dd>
                  </div>
                ))}
              <div className="kv-row">
                <dt>Connections</dt>
                <dd>{selLinks.length}</dd>
              </div>
            </dl>
            {linkDevices && sel.type === "device" && !!sel.meta?.device_id && (
              <a className="btn graph-open" href={href(`devices/${String(sel.meta.device_id)}`)}>
                <Laptop size={14} /> Open device
              </a>
            )}
            {selFindings.length > 0 && (
              <>
                <h4>Findings</h4>
                <ul className="graph-findings">
                  {selFindings.map((f) => (
                    <li key={findingId(f)}>
                      <a href={href("findings", { f: findingId(f) })}>
                        <Sev s={f.severity} /> <span>{f.title}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {selLinks.length > 0 && (
              <>
                <h4>Connected to</h4>
                <ul className="graph-links">
                  {selLinks.slice(0, 30).map((l) => (
                    <li key={l.i}>
                      <button type="button" onClick={() => centerOn(l.i)}>
                        <i style={{ background: TYPE_COLOR[base.nodes[l.i].type] || "#94a3b8" }} />
                        <span>{String(base.nodes[l.i].label)}</span>
                        {l.calls > 0 && <span className="muted">{l.calls} calls</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        )}
      </div>
      <div className="legend graph-legend" role="group" aria-label="Show or hide item types">
        {allTypes.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={!hiddenTypes.has(t)}
            disabled={t === "device"}
            title={t === "device" ? undefined : `${hiddenTypes.has(t) ? "Show" : "Hide"} ${TYPE_LABEL[t] || t}`}
            onClick={() =>
              setHiddenTypes((h) => {
                const next = new Set(h);
                if (next.has(t)) next.delete(t);
                else next.add(t);
                return next;
              })
            }
          >
            <i style={{ background: TYPE_COLOR[t] || "#94a3b8" }} />
            {TYPE_LABEL[t] || t}
          </button>
        ))}
        <span>
          <i style={{ background: "transparent", boxShadow: "0 0 0 2px var(--high)" }} />
          Has findings
        </span>
        {calls.some(Boolean) && (
          <span className="flow-key">
            <i />
            Carries MCP calls
          </span>
        )}
        {tracing && (
          <span className="path-key">
            <i />
            Attack path to {paths.targets.length} risky item{paths.targets.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </>
  );
}
