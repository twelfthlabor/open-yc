import { useCallback, useEffect, useState } from "react";
import { FileUp } from "lucide-react";
import { setFileReport } from "../lib/api";
import { parseReport, ReportError } from "../lib/localReport";
import { go } from "../lib/router";

const MAX_BYTES = 25 * 1024 * 1024;

/** Read a report file in this tab and switch the console to it. Never uploads: File.text() is local. */
export async function openReportFile(f: File): Promise<void> {
  if (f.size > MAX_BYTES) throw new ReportError("That file is larger than 25 MB, which is too big for an aiwarden report.");
  setFileReport(parseReport(await f.text()), f.name);
  go("");
}

export function useOpenReport() {
  const [error, setError] = useState("");
  const open = useCallback(async (f: File | undefined | null) => {
    if (!f) return;
    setError("");
    try {
      await openReportFile(f);
    } catch (e) {
      setError(e instanceof ReportError ? e.message : `Could not read that file: ${(e as Error).message}`);
    }
  }, []);
  return { open, error };
}

/** A button that opens the file chooser. The file input is the real control, so it works with the keyboard too. */
export function OpenReportButton({ label = "Open your own report", className = "btn" }: { label?: string; className?: string }) {
  const { open, error } = useOpenReport();
  return (
    <>
      <label className={`${className} file-btn`}>
        <FileUp size={14} aria-hidden="true" />
        {label}
        <input
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label={label}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            void open(f);
          }}
        />
      </label>
      {error && (
        <span className="error file-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** Drop a report anywhere on the page (hosted demo only). Returns whether a file is being dragged over the page. */
export function useReportDrop(enabled: boolean): { dragging: boolean; error: string } {
  const { open, error } = useOpenReport();
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const hasFile = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const over = (e: DragEvent) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      setDragging(false);
      void open(e.dataTransfer?.files?.[0]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [enabled, open]);
  return { dragging, error };
}
