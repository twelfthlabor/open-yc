import { useCallback, useEffect, useRef, useState } from "react";
import { adoptTokenFromHash, api, onSourceChange, tokenStore } from "./lib/api";
import { useRoute } from "./lib/router";
import { useApi } from "./lib/useApi";
import { Shell, type Theme } from "./components/Shell";
import { pageTitle } from "./components/nav";
import { Empty, ErrorNote, Loading, PageHead } from "./components/ui";
import { Connect } from "./pages/Connect";
import { Overview } from "./pages/Overview";
import { Ask } from "./pages/Ask";
import { Findings } from "./pages/Findings";
import { Devices } from "./pages/Devices";
import { Device } from "./pages/Device";
import { Mcp } from "./pages/Mcp";
import { Usage } from "./pages/Usage";
import { Guard } from "./pages/Guard";
import { Browser } from "./pages/Browser";
import { Alerts } from "./pages/Alerts";
import { Weekly } from "./pages/Weekly";
import { Insights } from "./pages/Insights";
import { GraphPage } from "./pages/GraphPage";

const THEME_KEY = "aiwarden_theme";
const LIVE_MS = 30_000;
const SCAN_POLL_MS = 2_000;

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function App() {
  const [token, setToken] = useState(() => (adoptTokenFromHash(), tokenStore.get()));
  // false until the server answers 401: the local console (serve --local) needs no token at all
  const [needsToken, setNeedsToken] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  // bumped when the data behind every view changes (a rescan finished), so pages with their own fetch reload
  const [rev, setRev] = useState(0);
  const route = useRoute();
  // bumped when a report file is opened or closed (hosted demo), so every view re-reads its data source
  const [source, setSource] = useState(0);
  useEffect(() => onSourceChange(() => {
    setSource((n) => n + 1);
    setRev((r) => r + 1);
  }), []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const signOut = useCallback(() => {
    tokenStore.clear();
    setToken("");
    setNeedsToken(true);
    setRejected(false);
  }, []);
  const onUnauthorized = useCallback(() => {
    const sent = !!tokenStore.get();
    tokenStore.clear();
    setToken("");
    setNeedsToken(true);
    setRejected(sent);
  }, []);

  const waiting = needsToken && !token;
  const meta = useApi(() => (waiting ? Promise.resolve(null) : api.meta()), `${token}|${waiting}|${source}`, onUnauthorized);
  const M = meta.data;
  const fleet = useApi(() => (M ? api.fleet() : Promise.resolve(null)), `${token}|${M ? M.mode : ""}|${source}`, onUnauthorized);

  useEffect(() => {
    document.title = pageTitle(route.path);
  }, [route.path]);

  // Devices push on their own schedule; poll so new reports appear without a manual refresh.
  // The local console also re-reads its scan status, to pick up the periodic rescan.
  const { reload } = fleet;
  const reloadMeta = meta.reload;
  const local = M?.mode === "local";
  useEffect(() => {
    if (!M) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      reload();
      if (local) reloadMeta();
    };
    const t = window.setInterval(tick, LIVE_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [M, local, reload, reloadMeta]);

  // While a rescan runs, watch it; when a new scan lands, reload everything.
  const scanning = !!M?.rescan.running;
  useEffect(() => {
    if (!scanning) return;
    const t = window.setInterval(reloadMeta, SCAN_POLL_MS);
    return () => window.clearInterval(t);
  }, [scanning, reloadMeta]);
  const lastScan = M?.rescan.last;
  const seenScan = useRef(lastScan);
  useEffect(() => {
    if (lastScan && lastScan !== seenScan.current) {
      seenScan.current = lastScan;
      reload();
      setRev((r) => r + 1);
    }
  }, [lastScan, reload]);

  const refresh = useCallback(() => {
    if (M?.rescan.available) {
      api.rescan().then(reloadMeta, reloadMeta);
    } else {
      reload();
      setRev((r) => r + 1);
    }
  }, [M, reload, reloadMeta]);

  if (waiting) {
    return (
      <Connect
        rejected={rejected}
        onConnect={(t) => {
          tokenStore.set(t);
          setRejected(false);
          setToken(t);
        }}
      />
    );
  }

  const [section = "", sub] = route.path;
  const F = fleet.data;
  let body;
  if (meta.error && !M) body = <ErrorNote error={meta.error} retry={meta.reload} />;
  else if (fleet.error) body = <ErrorNote error={fleet.error} retry={fleet.reload} />;
  else if (!F || !M) body = <Loading rows={6} />;
  else if (M.mode === "file" && (section === "ask" || section === "alerts" || section === "weekly")) body = <NeedsLocal section={section} />;
  else if (section === "devices" && sub) body = <Device id={sub} rev={rev} onUnauthorized={onUnauthorized} />;
  else {
    switch (section) {
      case "ask":
        body = <Ask initial={route.params.get("q") || ""} onUnauthorized={onUnauthorized} />;
        break;
      case "findings":
        body = <Findings fleet={F} params={route.params} />;
        break;
      case "devices":
        body = <Devices fleet={F} />;
        break;
      case "graph":
        body = <GraphPage fleet={F} rev={rev} onUnauthorized={onUnauthorized} />;
        break;
      case "insights":
        body = <Insights rev={rev} onUnauthorized={onUnauthorized} />;
        break;
      case "mcp":
        body = <Mcp fleet={F} onUnauthorized={onUnauthorized} />;
        break;
      case "usage":
        body = <Usage fleet={F} />;
        break;
      case "guard":
        body = <Guard fleet={F} onUnauthorized={onUnauthorized} />;
        break;
      case "browser":
        body = <Browser fleet={F} />;
        break;
      case "alerts":
        body = <Alerts onUnauthorized={onUnauthorized} />;
        break;
      case "weekly":
        body = <Weekly onUnauthorized={onUnauthorized} />;
        break;
      default:
        body = <Overview fleet={F} demo={M.mode === "demo"} />;
    }
  }
  return (
    <Shell
      current={section === "devices" ? "devices" : section}
      fleet={F}
      meta={M}
      stale={fleet.stale}
      theme={theme}
      onTheme={setTheme}
      onRefresh={refresh}
      onSignOut={signOut}
    >
      {/* keyed by path so each page plays its entrance once; query changes (filters, peeks) do not remount */}
      <div className="page-enter" key={route.path.join("/")}>
        {body}
      </div>
    </Shell>
  );
}

const LOCAL_ONLY: Record<string, { title: string; what: string; cmd: string }> = {
  ask: { title: "Ask", what: "Questions are answered by aiwarden's query engine, which runs in Python.", cmd: 'aiwarden ask "top 5 models by cost in the last 30 days"' },
  alerts: { title: "Alerts", what: "Alert rules compare reports over time in Python, and one report file has no history.", cmd: "aiwarden alerts --dry-run" },
  weekly: { title: "Weekly report", what: "The weekly report is built in Python from a week of reports.", cmd: "aiwarden report weekly --format html --out weekly.html" },
};

/** Ask, Alerts and Weekly need the Python backend; with a report file open there is none. */
function NeedsLocal({ section }: { section: string }) {
  const p = LOCAL_ONLY[section];
  return (
    <>
      <PageHead title={p.title} />
      <Empty title="This page needs the local install">
        {p.what} Your report file is open in the browser only, so run this on your machine instead: <code>{p.cmd}</code>, or open the whole console with{" "}
        <code>aiwarden serve --local</code>.
      </Empty>
    </>
  );
}
