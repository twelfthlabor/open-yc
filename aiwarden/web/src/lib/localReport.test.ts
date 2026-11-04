import { afterEach, describe, expect, it, vi } from "vitest";
import { api, clearFileReport, fileReportName, LocalOnly, setFileReport } from "./api";
import { fleetFromReport, insightsFromReport, parseReport, ReportError } from "./localReport";

const REPORT = {
  schema: "aiwarden.report/v1",
  generated_at: "2026-10-30T12:00:00+00:00",
  aiwarden_version: "0.1.0",
  device: { id: "abc123", hostname: "my-laptop", user: "me", os: "Windows" },
  apps: [
    { id: "claude-code", name: "Claude Code", vendor: "Anthropic", kind: "cli", running: true },
    { id: "cursor", name: "Cursor", vendor: "Anysphere", kind: "ide", running: false },
  ],
  mcp_servers: [
    { client: "claude-code", scope: "user", name: "github", transport: "stdio", package: "@modelcontextprotocol/server-github", secrets: [{ field: "env.GH", kind: "github_pat", redacted: "ghp_QQ…" }] },
    { client: "cursor", scope: "user", name: "github", transport: "stdio", package: "@modelcontextprotocol/server-github", secrets: [] },
    { client: "cursor", scope: "user", name: "remote", transport: "http", url: "http://x.example.com/mcp", secrets: [] },
  ],
  browser_extensions: [],
  usage: {
    by_app: { "claude-code": { input_tokens: 100, output_tokens: 50, cache_read_tokens: 10, cache_write_tokens: 5, cost_usd: 1.5 } },
    by_model: { "claude-sonnet-5-5": { input_tokens: 100, output_tokens: 50, cost_usd: 1.5 } },
    by_day: { "2026-10-29": { input_tokens: 60, output_tokens: 20 }, "2026-10-28": { input_tokens: 40, output_tokens: 30 } },
    by_project: { "~/code/api": { input_tokens: 100, output_tokens: 50, cache_read_tokens: 10, cost_usd: 1.5 } },
    sessions: [
      { app: "claude-code", project: "~/code/api", start: "2026-10-28T10:00:00Z", end: "2026-10-28T11:00:00Z", input_tokens: 40, output_tokens: 30, cost_usd: 0.5 },
      { app: "claude-code", project: "~/code/api", start: "2026-10-29T10:00:00Z", input_tokens: 60, output_tokens: 20, cost_usd: 1 },
    ],
    tools: { Bash: 7, Read: 3 },
    mcp_calls: { github: { search_code: 4, create_issue: 1 } },
    risky_events: [{ timestamp: "2026-10-29T10:05:00Z", app: "claude-code", tool: "Bash", rule: "GRD020", action: "deny" }],
    cost: { unpriced_models: ["mystery-1"], unverified_price_models: [], prices_as_of: "2026-10-06" },
  },
  claude: { hooks: [{ event: "PreToolUse", matcher: "*", scope: "user" }], plugins: ["p1"], agents: [], skills: [{ name: "deploy" }], permissions: { defaultMode: "default" } },
  guard_events: [
    { ts: "2026-10-28T10:00:00Z", app: "claude-code", tool: "Bash", action: "deny", rule: "GRD020" },
    { ts: "2026-10-29T10:00:00Z", app: "claude-code", tool: "Read", action: "ask", rule: "GRD041" },
  ],
  findings: [
    { rule: "SEC001", severity: "medium", title: "m", subject: "s" },
    { rule: "SEC002", severity: "high", title: "Plaintext github token", subject: "github" },
  ],
  graph: { nodes: [], edges: [] },
  summary: { apps: 2, running: 1, mcp_servers: 3, plaintext_secrets: 1, findings: { high: 1, medium: 1 }, tokens: 150, risky_events: 1, guard_blocks: 1, guard_installed: true },
};

afterEach(() => {
  clearFileReport();
  vi.restoreAllMocks();
});

describe("parseReport", () => {
  it("accepts the JSON that aiwarden scan --json writes", () => {
    expect(parseReport(JSON.stringify(REPORT)).device.hostname).toBe("my-laptop");
  });
  it("accepts a UTF-8 BOM (PowerShell's Out-File adds one)", () => {
    expect(parseReport(`﻿${JSON.stringify(REPORT)}`).device.id).toBe("abc123");
  });
  it.each([
    ["not JSON", "{nope", /not valid JSON/],
    ["another JSON file", JSON.stringify({ hello: 1 }), /not an aiwarden report/],
    ["a bad device id", JSON.stringify({ ...REPORT, device: { ...REPORT.device, id: "../../x" } }), /device/],
    ["findings that are not a list", JSON.stringify({ ...REPORT, findings: {} }), /findings/],
    ["a nested object where text belongs", JSON.stringify({ ...REPORT, findings: [{ rule: { x: 1 }, severity: "high", title: "t" }] }), /findings/],
  ])("rejects %s with a readable message", (_, text, msg) => {
    expect(() => parseReport(text)).toThrow(ReportError);
    expect(() => parseReport(text)).toThrow(msg);
  });
});

describe("parseReport rejects shapes that would break a page later", () => {
  it("rejects a non-scalar generated_at, like the collector does", () => {
    expect(() => parseReport(JSON.stringify({ ...REPORT, generated_at: {} }))).toThrow(ReportError);
  });
  it("rejects usage.sessions that is not a list, instead of erroring on the Insights page", () => {
    const bad = { ...REPORT, usage: { ...((REPORT as { usage?: object }).usage ?? {}), sessions: "x" } };
    expect(() => parseReport(JSON.stringify(bad))).toThrow("usage section is malformed");
  });
});

describe("fleetFromReport", () => {
  const f = fleetFromReport(parseReport(JSON.stringify(REPORT)));
  it("is a one-device fleet with the collector's totals", () => {
    expect(f.devices).toHaveLength(1);
    expect(f.devices[0]).toMatchObject({ id: "abc123", hostname: "my-laptop", user: "me" });
    expect(f.totals).toMatchObject({ devices: 1, apps: 2, mcp_servers: 3, plaintext_secrets: 1, guarded_devices: 1, guard_blocks: 1 });
    expect(f.totals.findings).toEqual({ high: 1, medium: 1 });
  });
  it("sorts findings by severity and tags them with the device", () => {
    expect(f.findings.map((x) => x.rule)).toEqual(["SEC002", "SEC001"]);
    expect(f.findings[0]).toMatchObject({ device_id: "abc123", hostname: "my-laptop" });
  });
  it("groups MCP servers by package or URL", () => {
    expect(f.mcp_packages[0]).toEqual({ package: "@modelcontextprotocol/server-github", devices: 1, clients: ["claude-code", "cursor"] });
    expect(f.mcp_packages.map((p) => p.package)).toContain("http://x.example.com/mcp");
  });
  it("keeps usage and newest-first guard events, with an empty browser section", () => {
    expect(Object.keys(f.usage.by_day)).toEqual(["2026-10-28", "2026-10-29"]);
    expect(f.guard_events[0].ts).toBe("2026-10-29T10:00:00Z");
    expect(f.guard_events[0].hostname).toBe("my-laptop");
    expect(f.browser.profiles).toEqual([]);
    expect(f.apps["claude-code"]).toMatchObject({ devices: 1, running: 1 });
  });
});

describe("insightsFromReport", () => {
  const i = insightsFromReport(parseReport(JSON.stringify(REPORT)));
  it("lists sessions newest first and per-project spend", () => {
    expect(i.sessions.map((s) => s.start)).toEqual(["2026-10-29T10:00:00Z", "2026-10-28T10:00:00Z"]);
    expect(i.sessions_total).toBe(2);
    expect(i.projects[0]).toMatchObject({ project: "~/code/api", sessions: 2, cost_usd: 1.5 });
  });
  it("counts tools, MCP calls and risky actions", () => {
    expect(i.tools[0]).toEqual({ tool: "Bash", calls: 7 });
    expect(i.mcp_calls[0]).toMatchObject({ server: "github", calls: 5 });
    expect(i.risky_total).toBe(1);
  });
  it("reads agent configuration and pricing caveats", () => {
    expect(i.agents[0]).toMatchObject({ guard_installed: true, plugins: ["p1"], skills: ["deploy"], default_mode: "default" });
    expect(i.tokens.cost_usd).toBe(1.5);
    expect(i.pricing).toEqual({ unpriced_models: ["mystery-1"], unverified_models: [], prices_as_of: "2026-10-06" });
  });
});

describe("api with a file report", () => {
  it("answers fleet, device and insights from the file without any request", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    setFileReport(parseReport(JSON.stringify(REPORT)), "me.json");
    expect(fileReportName()).toBe("me.json");
    expect((await api.meta()).mode).toBe("file");
    expect((await api.fleet()).devices[0].id).toBe("abc123");
    expect((await api.device("abc123")).device.hostname).toBe("my-laptop");
    expect((await api.insights()).sessions_total).toBe(2);
    await expect(api.device("other")).rejects.toThrow(/not in this report/);
    expect(spy).not.toHaveBeenCalled();
  });
  it("says Ask, Alerts and Weekly need the local install", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    setFileReport(parseReport(JSON.stringify(REPORT)), "me.json");
    await expect(api.ask("q")).rejects.toBeInstanceOf(LocalOnly);
    await expect(api.alerts()).rejects.toBeInstanceOf(LocalOnly);
    await expect(api.weekly()).rejects.toBeInstanceOf(LocalOnly);
    expect(spy).not.toHaveBeenCalled();
  });
  it("goes back to the server once the report is closed", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ mode: "demo" }), { status: 200 }));
    setFileReport(parseReport(JSON.stringify(REPORT)), "me.json");
    clearFileReport();
    expect(fileReportName()).toBeNull();
    expect((await api.meta()).mode).toBe("demo");
    expect(spy).toHaveBeenCalledOnce();
  });
});
