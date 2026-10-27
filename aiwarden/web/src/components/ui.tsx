import type { ReactNode } from "react";

const SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);
const DECISIONS = new Set(["deny", "ask", "allow", "block", "warn"]);

export function Sev({ s }: { s: string | undefined }) {
  const v = SEVERITIES.has(String(s)) ? String(s) : "info";
  return <span className={`sev ${v}`}>{s || "info"}</span>;
}

const DECISION_LABEL: Record<string, string> = { deny: "Blocked", ask: "Asked", allow: "Allowed", block: "Blocked", warn: "Warned" };

export function DecisionBadge({ action, wouldBe }: { action: string | undefined; wouldBe?: string | null }) {
  const a = DECISIONS.has(String(action)) ? String(action) : "allow";
  const label = DECISION_LABEL[a];
  return (
    <span className={`decision ${wouldBe ? wouldBe : a}`} title={wouldBe ? `Monitor mode: would have been ${wouldBe}` : undefined}>
      {wouldBe ? `Would ${wouldBe === "deny" ? "block" : wouldBe}` : label}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="loading" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} style={{ width: `${92 - i * 13}%` }} />
      ))}
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <strong>Could not load this view</strong>
      <span className="error">{error.message}</span>{" "}
      {retry && (
        <button className="btn" onClick={retry} style={{ marginTop: 10 }}>
          Try again
        </button>
      )}
    </div>
  );
}

export function PageHead({ title, sub, actions, crumb }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; crumb?: ReactNode }) {
  return (
    <>
      {crumb}
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
        {actions && <div className="split no-print">{actions}</div>}
      </header>
    </>
  );
}

export function Block({ title, aside, children, id }: { title: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="block" id={id} aria-label={typeof title === "string" ? title : undefined}>
      <div className="block-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Stat({ value, label, delta, deltaKind }: { value: ReactNode; label: string; delta?: string; deltaKind?: "up" | "down" }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
      {delta && <small className={deltaKind}>{delta}</small>}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}
