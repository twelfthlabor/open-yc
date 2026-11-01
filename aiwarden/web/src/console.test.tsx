import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { shortcut } from "./lib/shortcuts";
import { FindingPeek, findingId } from "./components/FindingPeek";
import { ago, compact, pct, usd } from "./lib/format";
import { href, parseHash } from "./lib/router";
import { adoptTokenFromHash, tokenStore } from "./lib/api";
import { dailySeries } from "./components/Charts";
import { fitView, layout, RelationshipGraph } from "./components/Graph";
import { Profiler } from "react";
import { Findings, FindingsTable } from "./pages/Findings";
import { Overview } from "./pages/Overview";
import type { Fleet } from "./lib/types";
import { pageTitle } from "./components/nav";
import { REMEDIATION } from "./lib/remediation";
import { attackPaths } from "./components/Graph";
import { tweenText } from "./lib/motion";
import { mergeGraphs } from "./lib/fleetGraph";
import { heatmap } from "./pages/Insights";
import { Stat } from "./components/ui";
import { useApi } from "./lib/useApi";
import { act, renderHook, waitFor } from "@testing-library/react";

afterEach(cleanup);

describe("page titles", () => {
  it("use the sidebar label, not the raw path", () => {
    expect(pageTitle([])).toBe("Overview – aiwarden");
    expect(pageTitle(["mcp"])).toBe("MCP servers – aiwarden");
    expect(pageTitle(["weekly"])).toBe("Weekly report – aiwarden");
    expect(pageTitle(["devices", "dev-maya"])).toBe("Devices – aiwarden");
    expect(pageTitle(["nope"])).toBe("Overview – aiwarden");
  });
});

describe("count-up", () => {
  it("tweens the first number in a formatted value and keeps its format", () => {
    expect(tweenText("$1,234.50", 0.5)).toBe("$617.25");
    expect(tweenText("82.6M", 1)).toBe("82.6M");
    expect(tweenText("82.6M", 0)).toBe("0.0M");
    expect(tweenText("4/6", 0)).toBe("0/6");
    expect(tweenText("12,345", 1)).toBe("12,345");
    expect(tweenText("none", 0.3)).toBe("none");
  });
  it("renders the final value straight away when motion is unavailable", () => {
    const { container } = render(<Stat value="$723.01" label="Spend" />);
    expect(container.querySelector("b")!.textContent).toBe("$723.01");
  });
});

describe("live refresh", () => {
  it("keeps the last data when a background reload fails", async () => {
    let fail = false;
    const { result } = renderHook(() => useApi(() => (fail ? Promise.reject(new Error("offline")) : Promise.resolve({ n: 1 })), "k"));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    fail = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.data).toEqual({ n: 1 });
    expect(result.current.error).toBeNull();
  });
});

describe("attack paths", () => {
  it("lights the chain from the user to each risky node and what it reaches", () => {
    const nodes = [
      { id: "user:u", type: "user", label: "u" },
      { id: "device:d", type: "device", label: "d" },
      { id: "app:cc", type: "app", label: "Claude Code" },
      { id: "mcp:gh", type: "mcp", label: "github", meta: { max_severity: "high", findings: 1 } },
      { id: "host:x", type: "host", label: "x" },
      { id: "mcp:ok", type: "mcp", label: "docs" },
      { id: "model:m", type: "model", label: "m" },
      { id: "ext:e", type: "extension", label: "e", meta: { max_severity: "info", findings: 1 } },
    ];
    const edges = [
      ["user:u", "device:d"], ["device:d", "app:cc"], ["app:cc", "mcp:gh"], ["mcp:gh", "host:x"],
      ["app:cc", "mcp:ok"], ["app:cc", "model:m"], ["device:d", "ext:e"],
    ].map(([source, target]) => ({ source, target, type: "x" }));
    const p = attackPaths(nodes, edges);
    expect([...p.nodes].sort()).toEqual(["app:cc", "device:d", "host:x", "mcp:gh", "user:u"]);
    expect(p.edges.has("app:cc>mcp:gh")).toBe(true);
    expect(p.edges.has("app:cc>mcp:ok")).toBe(false);
    expect(p.targets).toEqual(["mcp:gh"]);
  });
  it("follows a risky app to what it can reach, not to its models or skills", () => {
    const nodes = [
      { id: "device:d", type: "device", label: "d" },
      { id: "app:cc", type: "app", label: "Claude Code", meta: { max_severity: "critical", findings: 1 } },
      { id: "mcp:fs", type: "mcp", label: "filesystem" },
      { id: "pkg:fs", type: "package", label: "server-filesystem" },
      { id: "model:m", type: "model", label: "m" },
      { id: "skill:s", type: "skill", label: "s" },
    ];
    const edges = [["device:d", "app:cc"], ["app:cc", "mcp:fs"], ["mcp:fs", "pkg:fs"], ["app:cc", "model:m"], ["app:cc", "skill:s"]].map(([source, target]) => ({ source, target, type: "x" }));
    expect([...attackPaths(nodes, edges).nodes].sort()).toEqual(["app:cc", "device:d", "mcp:fs", "pkg:fs"]);
  });
});

describe("fleet graph", () => {
  const dev = (id: string, host: string, risky: boolean) => ({
    device: { id, hostname: host },
    graph: {
      nodes: [
        { id: `device:${id}`, type: "device", label: host },
        { id: "user:maya", type: "user", label: "maya" },
        { id: "app:claude-code", type: "app", label: "Claude Code", meta: risky ? { max_severity: "high", findings: 1 } : {} },
        { id: "mcp:claude-code:user:github", type: "mcp", label: "github" },
        { id: "pkg:@mcp/github", type: "package", label: "@mcp/github" },
        { id: "model:opus", type: "model", label: "opus" },
      ],
      edges: [
        ["user:maya", `device:${id}`], [`device:${id}`, "app:claude-code"], ["app:claude-code", "mcp:claude-code:user:github"],
        ["mcp:claude-code:user:github", "pkg:@mcp/github"], ["app:claude-code", "model:opus"],
      ].map(([source, target]) => ({ source, target, type: "x" })),
    },
  });
  it("keeps each device's apps and servers apart and shares packages, models and people", () => {
    const g = mergeGraphs([dev("d1", "a", true), dev("d2", "b", false)]);
    const ids = g.nodes.map((n) => n.id);
    expect(ids.filter((i) => i.endsWith("app:claude-code"))).toHaveLength(2);
    expect(ids.filter((i) => i === "pkg:@mcp/github")).toHaveLength(1);
    expect(ids.filter((i) => i === "model:opus")).toHaveLength(1);
    expect(ids.filter((i) => i === "user:maya")).toHaveLength(1);
    expect(new Set(g.edges.map((e) => `${e.source}>${e.target}`)).size).toBe(g.edges.length);
    const app = g.nodes.find((n) => n.id === "d1/app:claude-code")!;
    expect(app.meta).toMatchObject({ device_id: "d1", subject: "app:claude-code", hostname: "a" });
  });
  it("never lights another device's nodes as an attack path", () => {
    const g = mergeGraphs([dev("d1", "a", true), dev("d2", "b", false)]);
    const p = attackPaths(g.nodes, g.edges);
    expect([...p.nodes].some((i) => i.startsWith("d2/"))).toBe(false);
    expect(p.nodes.has("device:d2")).toBe(false);
    expect(p.nodes.has("d1/mcp:claude-code:user:github")).toBe(true);
  });
});

describe("insights", () => {
  it("buckets session starts by weekday and hour in the viewer's time zone", () => {
    const local = new Date(2026, 9, 26, 14, 30); // a Monday, 14:30 local
    const h = heatmap([{ start: local.toISOString() }, { start: local.toISOString() }, { start: "not a date" }]);
    expect(h.cells[0][14]).toBe(2); // Monday row, 14:00 column
    expect(h.max).toBe(2);
    expect(h.total).toBe(2);
  });
});

describe("remediation", () => {
  it("has a fix for every finding rule the scanner emits", () => {
    for (const r of ["MCP001", "MCP002", "MCP003", "MCP004", "MCP005", "AGT001", "AGT002", "AGT003", "AGT004", "EXT001"]) {
      expect(REMEDIATION[r]?.steps.length, r).toBeGreaterThan(0);
    }
  });
});

describe("format", () => {
  it("compacts numbers", () => {
    expect(compact(950)).toBe("950");
    expect(compact(83_200_000)).toBe("83.2M");
    expect(compact(1_000)).toBe("1k");
    expect(compact(undefined)).toBe("0");
  });
  it("formats money, change and relative time", () => {
    expect(usd(715.234)).toBe("$715.23");
    expect(usd(12_345)).toBe("$12,345");
    expect(pct(null)).toBe("new");
    expect(pct(22)).toBe("+22%");
    expect(pct(-12.34)).toBe("-12.3%");
    const now = Date.parse("2026-10-26T12:00:00Z");
    expect(ago("2026-10-26T09:00:00Z", now)).toBe("3 hours ago");
    expect(ago("2026-10-25T12:00:00Z", now)).toBe("1 day ago");
    expect(ago("not a date", now)).toBe("not a date");
  });
});

describe("router", () => {
  it("parses and builds hash routes", () => {
    const r = parseHash("#/devices/dev%2Dx?sev=high");
    expect(r.path).toEqual(["devices", "dev-x"]);
    expect(r.params.get("sev")).toBe("high");
    expect(parseHash("").path).toEqual([]);
    expect(href("findings", { sev: "high", q: undefined })).toBe("#/findings?sev=high");
  });
  it("takes the token from the serve link and strips it", () => {
    const calls: string[] = [];
    const ok = adoptTokenFromHash({ hash: "#token=abcDEF_123-xyz", pathname: "/", search: "" } as Location, { replaceState: (_: unknown, __: string, u: string) => calls.push(u) } as unknown as History);
    expect(ok).toBe(true);
    expect(tokenStore.get()).toBe("abcDEF_123-xyz");
    expect(calls).toEqual(["/#/"]);
    expect(adoptTokenFromHash({ hash: "#/devices", pathname: "/", search: "" } as Location, { replaceState() {} } as unknown as History)).toBe(false);
    tokenStore.clear();
  });
});

describe("charts and graph", () => {
  it("fills quiet days with zero", () => {
    const s = dailySeries({ "2026-10-20": { a: 5 }, "2026-10-22": { a: 7 } }, 4, "2026-10-22");
    expect(s.map((p) => [p.x, p.a])).toEqual([["2026-10-19", 0], ["2026-10-20", 5], ["2026-10-21", 0], ["2026-10-22", 7]]);
  });
  it("lays out the same graph the same way, and fits it in the frame", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, type: i ? "mcp" : "device", label: `n${i}` }));
    const edges = nodes.slice(1).map((n) => ({ source: "n0", target: n.id, type: "x" }));
    const a = layout(nodes, edges);
    const b = layout(nodes, edges);
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
    expect(a.links).toHaveLength(11);
    const v = fitView(a.nodes);
    for (const n of a.nodes) {
      const x = n.x * v.k + v.x;
      const y = n.y * v.k + v.y;
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1100);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(620);
    }
  });
  it("ignores edges to unknown nodes", () => {
    expect(layout([{ id: "a", type: "app", label: "a" }], [{ source: "a", target: "ghost", type: "x" }]).links).toEqual([]);
  });
});

const EVIL = '<img src=x onerror="window.__pwned=1">';

describe("untrusted report text", () => {
  it("renders findings and graph labels as text", () => {
    const { container } = render(
      <>
        <FindingsTable rows={[{ rule: "X1", severity: EVIL, title: EVIL, detail: EVIL, location: EVIL, hostname: EVIL }]} />
        <RelationshipGraph nodes={[{ id: "a", type: EVIL, label: EVIL }]} edges={[]} />
      </>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(EVIL);
    expect(container.querySelector(".sev")!.className).toBe("sev info"); // unknown severity does not become a class
  });

  it("overview headline reads correctly for one device", () => {
    const fleet = {
      generated_at: "2026-10-26T00:00:00Z",
      totals: { devices: 1, apps: 1, mcp_servers: 0, guarded_devices: 0, findings: { high: 1 } },
      devices: [{ id: "d", hostname: "h", user: "u", os: "Linux", summary: {} }],
      apps: {},
      mcp_packages: [],
      findings: [{ rule: "R", severity: "high", title: "t" }],
      usage: { by_model: {}, by_day: {}, by_app: {} },
      guard_events: [],
      browser: { sites: [], detectors: [], profiles: [], events: [] },
    } as unknown as Fleet;
    const { container } = render(<Overview fleet={fleet} />);
    expect(container.querySelector("h1")!.textContent).toBe("1 device runs 1 AI app and 0 MCP servers. 1 high-risk finding needs attention.");
  });
});

describe("keyboard shortcuts", () => {
  it("maps g-sequences to pages and ignores typing in fields", () => {
    const t = (key: string, prev = "", tag = "BODY", mod = false) => shortcut({ key, prev, target: { tagName: tag, isContentEditable: false } as unknown as EventTarget, mod });
    expect(t("g")).toEqual({ pending: "g" });
    expect(t("f", "g")).toEqual({ go: "findings" });
    expect(t("o", "g")).toEqual({ go: "" });
    expect(t("d", "g")).toEqual({ go: "devices" });
    expect(t("?")).toEqual({ help: true });
    expect(t("f")).toBeNull();
    expect(t("f", "g", "INPUT")).toBeNull();
    expect(t("g", "", "TEXTAREA")).toBeNull();
    expect(t("f", "g", "BODY", true)).toBeNull();
  });
});

describe("finding peek", () => {
  const rows = [
    { rule: "MCP001", severity: "high", title: "Plaintext token", detail: "Move it to the OS keychain", location: "~/.claude.json", hostname: "build-01", device_id: "d1" },
    { rule: "MCP001", severity: "high", title: "Plaintext token", location: "~/.cursor/mcp.json", hostname: "maya-mbp", device_id: "d2" },
    { rule: "AGT001", severity: "medium", title: "Bash allowed", hostname: "build-01", device_id: "d1" },
  ];
  it("gives each finding a stable id", () => {
    expect(findingId(rows[0])).toBe(findingId({ ...rows[0] }));
    expect(new Set(rows.map(findingId)).size).toBe(3);
  });
  it("shows the finding, its device and the same rule elsewhere, and closes on Escape", () => {
    let closed = 0;
    let moved: string | null = null;
    const { getByRole } = render(<FindingPeek rows={rows} id={findingId(rows[0])} onClose={() => closed++} onMove={(id) => (moved = id)} />);
    const dlg = getByRole("dialog", { name: "Finding details" });
    expect(dlg.textContent).toContain("Plaintext token");
    expect(dlg.textContent).toContain("Move it to the OS keychain");
    expect(dlg.querySelector("a[href='#/devices/d1']")).not.toBeNull();
    expect(dlg.textContent).toContain("maya-mbp"); // same rule on another device
    expect(dlg.textContent).toContain("How to fix");
    expect(dlg.querySelector("tr")).toBeNull(); // never adds rows the findings-table selectors would count
    fireEvent.keyDown(window, { key: "j" });
    expect(moved).toBe(findingId(rows[1]));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(closed).toBe(1);
  });
  it("findings page settles instead of re-rendering forever", async () => {
    let commits = 0;
    const fleet = { findings: rows, totals: { findings: { high: 2, medium: 1 } } } as unknown as Fleet;
    render(
      <Profiler id="f" onRender={() => commits++}>
        <Findings fleet={fleet} params={new URLSearchParams()} />
      </Profiler>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(commits).toBeLessThan(5);
  });
  it("renders nothing for an unknown id", () => {
    const { container } = render(<FindingPeek rows={rows} id="nope" onClose={() => {}} onMove={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});
