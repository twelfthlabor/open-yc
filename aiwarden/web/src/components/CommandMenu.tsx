import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Command, defaultFilter } from "cmdk";
import { Laptop, MessageSquareText, MoonStar } from "lucide-react";
import { go } from "../lib/router";
import type { Fleet } from "../lib/types";
import { NAV } from "./nav";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fleet: Fleet | null;
  onTheme: () => void;
}

// The "Ask ..." fallback always shows, but ranks below any page or device that matches.
const filter = (value: string, search: string, keywords?: string[]) => (value.startsWith("ask ") ? 0.001 : defaultFilter(value, search, keywords));

export function CommandMenu({ open, onOpenChange, fleet, onTheme }: Props) {
  const [q, setQ] = useState("");
  const returnTo = useRef<Element | null>(null);
  const run = (fn: () => void) => {
    onOpenChange(false);
    setQ("");
    fn();
  };
  // A plain dialog rather than Command.Dialog: Radix's scroll lock injects a <style> tag, which the
  // collector's CSP (style-src 'self') blocks.
  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      (returnTo.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="cmdk-overlay" onMouseDown={() => onOpenChange(false)}>
      <div
        className="cmdk-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onOpenChange(false);
          } else if (e.key === "Tab") e.preventDefault(); // focus stays in the input; arrow keys move through results
        }}
      >
        <Command label="Command menu" filter={filter}>
          <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Jump to a page or device, or ask a question" />
          <Command.List>
            <Command.Empty>Nothing matches.</Command.Empty>
            <Command.Group heading="Pages">
              {NAV.map((n) => (
                <Command.Item key={n.path} value={`page ${n.label}`} onSelect={() => run(() => go(n.path))}>
                  <n.icon size={16} />
                  {n.label}
                  <span className="hint keys" aria-hidden="true">
                    <kbd>g</kbd>
                    <kbd>{n.key}</kbd>
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
            {!!fleet?.devices.length && (
              <Command.Group heading="Devices">
                {fleet.devices.map((d) => (
                  <Command.Item key={d.id} value={`device ${d.hostname} ${d.user} ${d.id}`} onSelect={() => run(() => go(`devices/${d.id}`))}>
                    <Laptop size={16} />
                    {d.hostname}
                    <span className="hint">{d.user}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {q.trim().length > 2 && (
              <Command.Group heading="Ask" forceMount>
                <Command.Item value={`ask ${q}`} onSelect={() => run(() => go("ask", { q: q.trim() }))} forceMount>
                  <MessageSquareText size={16} />
                  Ask “{q.trim()}”
                </Command.Item>
              </Command.Group>
            )}
            <Command.Group heading="Settings">
              <Command.Item value="toggle theme dark light" onSelect={() => run(onTheme)}>
                <MoonStar size={16} />
                Switch theme
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>,
    document.body,
  );
}
