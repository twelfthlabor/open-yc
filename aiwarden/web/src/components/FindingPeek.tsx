import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, Laptop, X } from "lucide-react";
import { href } from "../lib/router";
import { isTyping } from "../lib/shortcuts";
import type { Finding } from "../lib/types";
import { Sev } from "./ui";

/** Stable across reloads, so a peek link (#/findings?f=...) survives a refresh. */
export function findingId(f: Finding): string {
  return [f.device_id || f.hostname || "", f.rule, f.location || f.subject || f.title].join("|");
}

interface Props {
  /** The list the peek steps through with j/k: the rows currently shown in the table. */
  rows: Finding[];
  id: string | null;
  onClose: () => void;
  onMove: (id: string) => void;
}

// A side sheet in the style of Linear's issue peek: the table stays visible and clickable,
// j/k step through rows, Escape closes. The open finding lives in the URL (?f=), so back works.
export function FindingPeek({ rows, id, onClose, onMove }: Props) {
  const i = id ? rows.findIndex((f) => findingId(f) === id) : -1;
  const f = i >= 0 ? rows[i] : null;
  const ref = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!f) return;
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const step = e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (step) {
        const next = rows[i + step];
        if (next) {
          e.preventDefault();
          onMove(findingId(next));
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [f, i, rows, onClose, onMove]);

  useEffect(() => setCopied(false), [id]);
  const open = Boolean(f);
  useEffect(() => {
    if (open) ref.current?.focus({ preventScroll: true });
  }, [open]);

  if (!f) return null;
  const elsewhere = rows.filter((o) => o !== f && o.rule === f.rule);
  const copy = () => {
    if (!f.location) return;
    navigator.clipboard?.writeText(f.location).then(() => setCopied(true), () => {});
  };

  return (
    <aside ref={ref} className="peek" role="dialog" aria-label="Finding details" tabIndex={-1}>
      <header className="peek-head">
        <Sev s={f.severity} />
        <span className="rule-id">{f.rule}</span>
        <span className="peek-pos muted">
          {i + 1} / {rows.length}
        </span>
        <button className="icon-btn" type="button" aria-label="Previous finding" title="Previous (k)" disabled={i === 0} onClick={() => onMove(findingId(rows[i - 1]))}>
          <ArrowUp size={15} />
        </button>
        <button className="icon-btn" type="button" aria-label="Next finding" title="Next (j)" disabled={i === rows.length - 1} onClick={() => onMove(findingId(rows[i + 1]))}>
          <ArrowDown size={15} />
        </button>
        <button className="icon-btn" type="button" aria-label="Close details" title="Close (Esc)" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="peek-body">
        <h2>{f.title}</h2>
        {f.detail && <p className="peek-detail">{f.detail}</p>}
        <dl className="peek-facts">
          {f.location && (
            <>
              <dt>Location</dt>
              <dd className="peek-loc">
                <code>{f.location}</code>
                <button className="icon-btn" type="button" onClick={copy} aria-label="Copy location" title="Copy location">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </dd>
            </>
          )}
          {f.subject && (
            <>
              <dt>Subject</dt>
              <dd>{f.subject}</dd>
            </>
          )}
          <dt>Device</dt>
          <dd>
            {f.device_id ? (
              <a className="peek-device" href={href(`devices/${f.device_id}`)}>
                <Laptop size={14} /> {f.hostname || f.device_id}
              </a>
            ) : (
              f.hostname || "Unknown"
            )}
          </dd>
        </dl>
        <h3>
          Same rule elsewhere <span className="muted">{elsewhere.length}</span>
        </h3>
        {elsewhere.length ? (
          <ul className="peek-list">
            {elsewhere.map((o) => (
              <li key={findingId(o)}>
                <button type="button" onClick={() => onMove(findingId(o))}>
                  <span>{o.hostname || o.device_id}</span>
                  {o.location && <span className="mono muted">{o.location}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Only this device has it.</p>
        )}
      </div>
      <footer className="peek-foot muted">
        <kbd>j</kbd> <kbd>k</kbd> to move · <kbd>Esc</kbd> to close
      </footer>
    </aside>
  );
}
