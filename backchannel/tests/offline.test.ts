import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentForPath, isSkippedTranscript, usageFromTranscripts } from "../src/core/offline.ts";
import { Store } from "../src/core/store.ts";
import { TranscriptWatcher } from "../src/server/watch.ts";
import { claudeAssistant, claudeUser, COD, codex, codexTokens } from "./fixtures.ts";

const jsonl = (recs: unknown[]) => `${recs.map((r) => JSON.stringify(r)).join("\n")}\n`;

const claudeLines = jsonl([
  claudeUser("fix the failing test", 0),
  claudeAssistant("msg_1", [{ type: "text", text: "Looking." }], 1),
  claudeAssistant("msg_1", [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }], 1),
  claudeAssistant("msg_2", [{ type: "text", text: "Done." }], 5, { stop: "end_turn", model: "claude-opus-5-5" }),
]);

const codexLines = jsonl([
  codex("session_meta", { id: COD, cwd: "/home/dev/projects/site", timestamp: "2026-10-28T12:00:00.000Z" }, 0),
  codex("turn_context", { model: "gpt-5.5", cwd: "/home/dev/projects/site" }, 0),
  codexTokens(1200, 200, 300, 2),
  codexTokens(2400, 400, 700, 6),
]);

describe("spend from dropped transcripts", () => {
  it("tells Codex rollouts from Claude Code transcripts by path", () => {
    expect(agentForPath("sessions/2026/10/28/rollout-2026-10-28T12-00-00-abc.jsonl")).toBe("codex");
    expect(agentForPath(".codex/sessions/x.jsonl")).toBe("codex");
    expect(agentForPath("projects/-home-dev-shop/1111.jsonl")).toBe("claude-code");
    expect(agentForPath("C:\\Users\\me\\.claude\\projects\\p\\s.jsonl")).toBe("claude-code");
  });

  it("skips what the local watcher skips: non-JSONL files and subagent transcripts", () => {
    expect(isSkippedTranscript("projects/p/s.jsonl")).toBe(false);
    expect(isSkippedTranscript("projects/p/1111/subagents/agent-1.jsonl")).toBe(true);
    expect(isSkippedTranscript("projects/p/notes.json")).toBe(true);
    expect(isSkippedTranscript("sessions/2026/10/28/history.jsonl")).toBe(true);
  });

  it("gives the same report as the local server reading the same files from disk", async () => {
    const root = mkdtempSync(join(tmpdir(), "bc-offline-"));
    const claudeDir = join(root, "projects", "-home-dev-projects-shop-api");
    const codexDir = join(root, "sessions", "2026", "10", "28");
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(join(claudeDir, "11111111-2222-4333-8444-555555555555.jsonl"), claudeLines);
    writeFileSync(join(codexDir, `rollout-2026-10-28T12-00-00-${COD}.jsonl`), codexLines);

    const store = new Store({ introduce: false });
    const watcher = new TranscriptWatcher({ claudeProjects: join(root, "projects"), codexSessions: join(root, "sessions"), sinceMs: 0, onEvents: (evs) => evs.forEach((e) => store.ingest(e)) });
    await watcher.discover();
    await watcher.readAll();
    const fromDisk = store.usageReport();

    const fromDrop = usageFromTranscripts([
      { path: `projects/-home-dev-projects-shop-api/11111111-2222-4333-8444-555555555555.jsonl`, text: claudeLines },
      { path: `sessions/2026/10/28/rollout-2026-10-28T12-00-00-${COD}.jsonl`, text: codexLines },
      { path: "projects/-home-dev-projects-shop-api/11111111/subagents/agent-1.jsonl", text: claudeLines },
    ]);

    expect(fromDrop.totals).toEqual(fromDisk.totals);
    expect(fromDrop.byModel).toEqual(fromDisk.byModel);
    expect(fromDrop.byProvider).toEqual(fromDisk.byProvider);
    expect(fromDrop.bySession.map((r) => r.total)).toEqual(fromDisk.bySession.map((r) => r.total));
    expect(fromDrop.totals.total).toBeGreaterThan(0);
    expect(fromDrop.files).toEqual({ read: 2, skipped: 1, badLines: 0 });
  });

  it("filters by day and ignores lines that are not JSON", () => {
    const r = usageFromTranscripts([{ path: "projects/p/s.jsonl", text: `not json\n${claudeLines}{"half":` }], "2026-10-29T00:00:00.000Z");
    expect(r.totals.total).toBe(0);
    expect(r.files.badLines).toBe(2);
    const all = usageFromTranscripts([{ path: "projects/p/s.jsonl", text: claudeLines }]);
    expect(all.unverifiedModels).toEqual(expect.any(Array));
  });

  it("survives JSON lines that are not objects, like null, and a byte-order mark", () => {
    const r = usageFromTranscripts([{ path: "projects/p/s.jsonl", text: `null
42
[1]
﻿${claudeLines}` }]);
    expect(r.totals.total).toBe(usageFromTranscripts([{ path: "projects/p/s.jsonl", text: claudeLines }]).totals.total);
  });

  it("skips archived Codex sessions, which the local server never reads", () => {
    expect(isSkippedTranscript(".codex/archived_sessions/2026/10/01/rollout-2026-10-01T00-00-00-x.jsonl")).toBe(true);
    expect(isSkippedTranscript(".codex/sessions/2026/10/01/rollout-2026-10-01T00-00-00-x.jsonl")).toBe(false);
  });
});
