import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { NAV } from "./nav";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const GENERAL: Array<[string[], string]> = [
  [[MAC ? "⌘" : "Ctrl", "K"], "Search or ask"],
  [["/"], "Search or ask"],
  [["j", "k"], "Next or previous finding, in the findings panel"],
  [["Esc"], "Close a panel or dialog"],
  [["?"], "Show this list"],
];

// Same plain-dialog approach as the command menu: no injected <style> tags, so the CSP holds.
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => back?.focus?.();
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div
        ref={ref}
        className="cmdk-dialog keys-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "?") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <h2>Keyboard shortcuts</h2>
        <div className="keys-cols">
          <section>
            <h3>Go to</h3>
            <dl>
              {NAV.map((n) => (
                <div key={n.path}>
                  <dt>{n.label}</dt>
                  <dd>
                    <kbd>g</kbd> <kbd>{n.key}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>Anywhere</h3>
            <dl>
              {GENERAL.map(([keys, what]) => (
                <div key={what + keys.join()}>
                  <dt>{what}</dt>
                  <dd>
                    {keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
