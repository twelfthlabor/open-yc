import { useRef, useState } from "react";
import type { TranscriptFile } from "../../../src/core/offline.ts";

// Picks transcript folders in the hosted demo and reads them in this tab. Nothing is uploaded:
// the page's CSP allows connections to its own origin only, and the files never leave memory.

export const WINDOW_DAYS = 30;

interface Picked {
  path: string;
  file: File;
}

// Same file rules as src/core/offline.ts, applied before reading so old or irrelevant files
// in a large ~/.claude folder are never opened.
function wanted(p: Picked, sinceMs: number): boolean {
  return p.path.endsWith(".jsonl") && !/(^|\/)subagents\//.test(p.path) && p.file.lastModified >= sinceMs;
}

async function fromEntry(entry: FileSystemEntry, out: Picked[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail));
    out.push({ path: entry.fullPath.replace(/^\//, ""), file });
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns at most ~100 entries per call; keep reading until it returns none.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (!batch.length) break;
    for (const e of batch) await fromEntry(e, out);
  }
}

export interface Own {
  files: TranscriptFile[];
  skipped: number; // files left unread: not transcripts, subagent transcripts, or older than the window
}

export async function readPicked(picked: Picked[], now = Date.now()): Promise<Own> {
  const since = now - WINDOW_DAYS * 86_400_000;
  const keep = picked.filter((p) => wanted(p, since));
  const files = await Promise.all(keep.map(async (p) => ({ path: p.path, text: await p.file.text() })));
  return { files, skipped: picked.length - keep.length };
}

export function OwnSpend({ onLoad }: { onLoad: (own: Own) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "over" | "reading">("idle");
  const [error, setError] = useState<string | null>(null);

  const load = async (picked: Picked[]) => {
    setState("reading");
    setError(null);
    try {
      const own = await readPicked(picked);
      if (!own.files.length) {
        setError(`No transcripts from the last ${WINDOW_DAYS} days in that folder. Pick ~/.claude/projects or ~/.codex/sessions.`);
        setState("idle");
        return;
      }
      onLoad(own);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  };

  return (
    <section
      className={`own${state === "over" ? " over" : ""}`}
      aria-labelledby="own-title"
      onDragOver={(e) => {
        e.preventDefault();
        setState((s) => (s === "reading" ? s : "over"));
      }}
      onDragLeave={() => setState((s) => (s === "over" ? "idle" : s))}
      onDrop={(e) => {
        e.preventDefault();
        const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry()).filter((x): x is FileSystemEntry => !!x);
        void (async () => {
          const out: Picked[] = [];
          for (const entry of entries) await fromEntry(entry, out);
          await load(out);
        })();
      }}
    >
      <div>
        <h2 id="own-title">See your own spend</h2>
        <p>
          Drop your <code>~/.claude/projects</code> or <code>~/.codex/sessions</code> folder here, or choose it. The files are read in this tab and are not uploaded. Last {WINDOW_DAYS} days, priced the same way as
          the local app.
        </p>
        <p className="own-hint">
          On a Mac, press <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>.</kbd> in the picker to show hidden folders. On Windows they are in <code>C:\Users\you\.claude</code>.
        </p>
        {error ? (
          <p className="err" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button type="button" className="own-btn" disabled={state === "reading"} onClick={() => input.current?.click()}>
        {state === "reading" ? "Reading…" : "Choose folder"}
      </button>
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        aria-label="Transcript folder"
        multiple
        {...{ webkitdirectory: "" }}
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          if (list.length) void load(list.map((file) => ({ path: file.webkitRelativePath || file.name, file })));
        }}
      />
    </section>
  );
}
