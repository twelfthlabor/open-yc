// Spend from transcript files the user drops into the hosted page. Runs in the browser: the files
// are read there and nothing is uploaded. It applies the same parsers, ledger and file rules as the
// local server, so the numbers match `backchannel usage` for the same files.
import { newClaudeState, parseClaude } from "./claude.ts";
import { newCodexState, parseCodex } from "./codex.ts";
import { Store } from "./store.ts";
import type { AgentKind, UsageReport } from "./types.ts";

export interface TranscriptFile {
  path: string; // relative path inside the dropped folder, either separator
  text: string;
}

export type OfflineUsage = UsageReport & { unverifiedModels: string[]; files: { read: number; skipped: number; badLines: number } };

const base = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function agentForPath(path: string): AgentKind {
  return base(path).startsWith("rollout-") || /(^|[\\/])\.codex[\\/]/.test(path) ? "codex" : "claude-code";
}

// The local watcher reads <projects>/<project>/*.jsonl and <sessions>/YYYY/MM/DD/rollout-*.jsonl.
// Subagent transcripts sit one level deeper and Codex archives sit outside sessions/, so the
// watcher never reads either; they are skipped here too.
export function isSkippedTranscript(path: string): boolean {
  if (!path.endsWith(".jsonl")) return true;
  if (/(^|[\\/])(subagents|archived_sessions)[\\/]/.test(path)) return true;
  const codexTree = /(^|[\\/])(\.codex|sessions[\\/]\d{4})[\\/]/.test(path);
  return codexTree && !base(path).startsWith("rollout-");
}

export function usageFromTranscripts(files: TranscriptFile[], since?: string): OfflineUsage {
  const store = new Store({ introduce: false });
  const counts = { read: 0, skipped: 0, badLines: 0 };
  for (const f of files) {
    if (isSkippedTranscript(f.path)) {
      counts.skipped++;
      continue;
    }
    counts.read++;
    const agent = agentForPath(f.path);
    const claude = newClaudeState();
    const codex = newCodexState();
    for (const line of f.text.split("\n")) {
      if (!line.trim()) continue;
      let rec: unknown;
      try {
        rec = JSON.parse(line.replace(/^\uFEFF/, ""));
      } catch {
        counts.badLines++;
        continue;
      }
      const events = agent === "codex" ? parseCodex(rec as Record<string, unknown>, codex) : parseClaude(rec as Record<string, unknown>, claude);
      for (const e of events) store.ingest(e);
    }
  }
  return { ...store.usageReport(since), unverifiedModels: store.usage.unverifiedModels(), files: counts };
}
