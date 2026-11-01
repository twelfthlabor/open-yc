#!/usr/bin/env node
// backchannel command line.
//   serve                       start the local server and web app (default port 47321)
//   hooks install|uninstall|status [--agent claude-code|codex|all] [--project DIR]
//   usage [--days N] [--json]   token usage and estimated cost from local transcripts
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Store } from "./core/store.ts";
import type { AgentKind, UsageRow } from "./core/types.ts";
import { install, settingsPath, status, uninstall } from "./server/install.ts";
import { resolvePaths } from "./server/paths.ts";
import { serve } from "./server/server.ts";
import { TranscriptWatcher } from "./server/watch.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string" },
    "since-hours": { type: "string" },
    days: { type: "string" },
    agent: { type: "string", default: "all" },
    project: { type: "string" },
    only: { type: "string", multiple: true },
    "mid-run": { type: "boolean" },
    "no-intro": { type: "boolean" },
    dev: { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const HELP = `backchannel: one group chat to hear and steer your coding agents

  backchannel serve [--port 47321] [--since-hours 24] [--only DIR]... [--mid-run] [--no-intro] [--dev]
  backchannel hooks install   [--agent claude-code|codex|all] [--project DIR]
  backchannel hooks uninstall [--agent claude-code|codex|all] [--project DIR]
  backchannel hooks status    [--project DIR]
  backchannel usage [--days 7] [--json]
`;

function agents(): AgentKind[] {
  const a = values.agent ?? "all";
  if (a === "all") return ["claude-code", "codex"];
  if (a === "claude-code" || a === "codex") return [a];
  throw new Error(`unknown agent: ${a}`);
}

function scope() {
  return {
    userHome: homedir(),
    project: values.project ? resolve(values.project) : undefined,
    claudeDir: process.env.CLAUDE_CONFIG_DIR,
    codexDir: process.env.CODEX_HOME,
  };
}

const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

function table(title: string, rows: UsageRow[], limit = 10): string {
  if (!rows.length) return "";
  const lines = rows.slice(0, limit).map((r) => {
    const cost = r.estimated ? `~${fmt(r.total)} tok est.` : `${usd(r.costUsd)}${r.unpriced ? ` (+${fmt(r.unpriced)} unpriced tok)` : ""}`;
    return `  ${r.label.padEnd(36).slice(0, 36)} ${fmt(r.total).padStart(14)}  ${cost}${r.calls != null ? `  ${r.calls} calls` : ""}`;
  });
  return `${title}\n${lines.join("\n")}\n`;
}

async function main() {
  const [cmd, sub] = positionals;
  if (values.help || !cmd) {
    process.stdout.write(HELP);
    return;
  }
  const paths = resolvePaths();

  if (cmd === "serve") {
    const running = await serve({
      paths,
      port: values.port ? Number(values.port) : undefined,
      sinceHours: values["since-hours"] ? Number(values["since-hours"]) : undefined,
      webRoot: resolve(ROOT, "dist"),
      devOrigin: values.dev ? "http://localhost:5173" : undefined,
      introduce: !values["no-intro"],
      only: values.only?.map((d) => resolve(d)),
      midRun: values["mid-run"],
    });
    const installed = [...status(settingsPath("claude-code", { userHome: homedir(), claudeDir: process.env.CLAUDE_CONFIG_DIR })), ...status(settingsPath("codex", { userHome: homedir(), codexDir: process.env.CODEX_HOME }))];
    console.log(`backchannel is listening on ${running.url}`);
    console.log(`watching ${running.watcher.files.length} transcript files, ${running.store.sessions.size} sessions`);
    if (!installed.length) console.log("hooks are not installed: you can read agents but not reply. Run: backchannel hooks install");
    if (values.dev) console.log(`dev UI: http://localhost:5173/app.html#token=${running.token}`);
    const stop = () => void running.close().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return;
  }

  if (cmd === "hooks") {
    for (const agent of agents()) {
      const path = settingsPath(agent, scope());
      if (sub === "install") {
        const added = install(agent, path);
        console.log(`${agent}: ${added.length ? `added ${added.join(", ")}` : "already installed"} in ${path}`);
        if (agent === "codex" && added.length) console.log("  Codex runs new hooks only after you trust them: open Codex and run /hooks.");
      } else if (sub === "uninstall") {
        const removed = uninstall(path);
        console.log(`${agent}: ${removed.length ? `removed ${removed.join(", ")}` : "nothing to remove"} in ${path}`);
      } else if (sub === "status") {
        const events = status(path);
        console.log(`${agent}: ${events.length ? events.join(", ") : "not installed"} (${path})`);
      } else {
        throw new Error("usage: backchannel hooks install|uninstall|status");
      }
    }
    return;
  }

  if (cmd === "usage") {
    const days = Number(values.days ?? 7);
    const store = new Store({ introduce: false });
    const watcher = new TranscriptWatcher({
      claudeProjects: paths.claudeProjects,
      codexSessions: paths.codexSessions,
      sinceMs: Date.now() - days * 86_400_000,
      onEvents: (events) => events.forEach((e) => store.ingest(e)),
    });
    await watcher.discover();
    await watcher.readAll();
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const report = store.usageReport(since);
    if (values.json) {
      process.stdout.write(`${JSON.stringify({ ...report, unverifiedModels: store.usage.unverifiedModels() }, null, 2)}\n`);
      return;
    }
    const t = report.totals;
    console.log(`Last ${days} days: ${fmt(t.total)} tokens, ${usd(t.costUsd)} at API list prices${t.unpriced ? ` (+${fmt(t.unpriced)} tokens from unpriced models)` : ""}`);
    console.log(`  input ${fmt(t.input)} · output ${fmt(t.output)} · cache read ${fmt(t.cacheRead)} · cache write ${fmt(t.cacheWrite)}\n`);
    process.stdout.write(table("By provider", report.byProvider));
    process.stdout.write(table("By model", report.byModel));
    process.stdout.write(table("By session", report.bySession));
    process.stdout.write(table("MCP servers (estimated context tokens)", report.byMcp));
    process.stdout.write(table("Skills (estimated context tokens)", report.bySkill));
    const unverified = store.usage.unverifiedModels();
    if (unverified.length) console.log(`Prices not verified for: ${unverified.join(", ")} (prices as of ${report.pricesAsOf})`);
    return;
  }

  process.stdout.write(HELP);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`backchannel: ${err.message}`);
  process.exit(1);
});
