import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Menu, Monitor, Moon, RefreshCw, Search, Sun } from "lucide-react";
import { DEMO_TOKEN } from "../lib/api";
import { ago } from "../lib/format";
import { href } from "../lib/router";
import type { Fleet } from "../lib/types";
import { CommandMenu } from "./CommandMenu";
import { NAV } from "./nav";

export type Theme = "system" | "light" | "dark";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#16213a" />
      <path d="M16 6l8 3v6.5c0 5-3.4 8.6-8 10.5-4.6-1.9-8-5.5-8-10.5V9z" fill="none" stroke="#9fb0ff" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="16" cy="15.5" r="2.6" fill="#9fb0ff" />
    </svg>
  );
}

interface Props {
  current: string;
  fleet: Fleet | null;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onRefresh: () => void;
  onSignOut: () => void;
  children: ReactNode;
}

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };

export function Shell({ current, fleet, theme, onTheme, onRefresh, onSignOut, children }: Props) {
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (e.key === "/" && !/input|textarea|select/i.test((e.target as HTMLElement)?.tagName || "")) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => setDrawer(false), [current]);

  const t = fleet?.totals;
  const serious = (t?.findings?.critical || 0) + (t?.findings?.high || 0);
  const counts: Record<string, { n: number; hot?: boolean } | undefined> = {
    findings: t ? { n: serious || fleet!.findings.length, hot: serious > 0 } : undefined,
    devices: t ? { n: t.devices || 0 } : undefined,
    mcp: t ? { n: t.mcp_servers || 0 } : undefined,
  };
  const ThemeIcon = THEME_ICON[theme];
  let group = "";
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className={`shell${drawer ? " open" : ""}`}>
      <a className="sr-only" href="#main">
        Skip to content
      </a>
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
      <aside className="side" aria-label="Sidebar">
        <a className="brand" href={href("")}>
          <Logo />
          aiwarden
        </a>
        <button className="search-btn" type="button" onClick={() => setPalette(true)}>
          <Search size={15} />
          Search or ask
          <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => {
            const head = n.group !== group ? ((group = n.group), <div className="nav-group" key={`g-${n.group}`}>{n.group}</div>) : null;
            const c = counts[n.path];
            return (
              <div key={n.path} style={{ display: "contents" }}>
                {head}
                <a href={href(n.path)} aria-current={current === n.path ? "page" : undefined}>
                  <n.icon size={16} strokeWidth={1.9} />
                  {n.label}
                  {c && c.n > 0 && <span className={`count${c.hot ? " hot" : ""}`}>{c.n}</span>}
                </a>
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <div className="status">
            <span className="dot" />
            {fleet ? `Collector updated ${ago(fleet.generated_at)}` : "Connecting"}
          </div>
          <div className="side-actions">
            <button className="icon-btn" type="button" onClick={onRefresh} aria-label="Refresh data" title="Refresh data">
              <RefreshCw size={15} />
            </button>
            <button className="icon-btn" type="button" onClick={() => onTheme(NEXT[theme])} aria-label={`Theme: ${theme}. Switch to ${NEXT[theme]}`} title={`Theme: ${theme}`}>
              <ThemeIcon size={15} />
            </button>
            {!DEMO_TOKEN && (
              <button className="icon-btn" type="button" onClick={onSignOut} aria-label="Disconnect from collector" title="Disconnect">
                <LogOut size={15} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="icon-btn" type="button" aria-label="Open menu" onClick={() => setDrawer(true)}>
            <Menu size={18} />
          </button>
          <a className="brand" href={href("")}>
            <Logo size={20} />
            aiwarden
          </a>
          <button className="icon-btn" type="button" aria-label="Search or ask" onClick={() => setPalette(true)}>
            <Search size={17} />
          </button>
        </div>
        <main id="main" className="page" tabIndex={-1}>
          {DEMO_TOKEN && (
            <p className="demo-note no-print">
              Public demo with six made-up laptops. It is read-only; run <code>aiwarden serve</code> to see your own fleet.{" "}
              <a href="https://github.com/twelfthlabor/open-yc/tree/main/aiwarden">Source on GitHub</a>
            </p>
          )}
          {children}
        </main>
      </div>
      <CommandMenu open={palette} onOpenChange={setPalette} fleet={fleet} onTheme={() => onTheme(NEXT[theme])} />
    </div>
  );
}
