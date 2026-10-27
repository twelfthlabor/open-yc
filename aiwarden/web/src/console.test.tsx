import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ago, compact, pct, usd } from "./lib/format";
import { href, parseHash } from "./lib/router";
import { adoptTokenFromHash, tokenStore } from "./lib/api";
import { dailySeries } from "./components/Charts";
import { fitView, layout, RelationshipGraph } from "./components/Graph";
import { FindingsTable } from "./pages/Findings";
import { Overview } from "./pages/Overview";
import type { Fleet } from "./lib/types";

afterEach(cleanup);

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
