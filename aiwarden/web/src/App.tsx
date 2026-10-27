import { useCallback, useEffect, useState } from "react";
import { adoptTokenFromHash, api, tokenStore } from "./lib/api";
import { useRoute } from "./lib/router";
import { useApi } from "./lib/useApi";
import { Shell, type Theme } from "./components/Shell";
import { ErrorNote, Loading } from "./components/ui";
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

const THEME_KEY = "aiwarden_theme";

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
  const [rejected, setRejected] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const route = useRoute();

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
    setRejected(false);
  }, []);
  const onUnauthorized = useCallback(() => {
    tokenStore.clear();
    setToken("");
    setRejected(true);
  }, []);

  const fleet = useApi(() => (token ? api.fleet() : Promise.resolve(null)), token, onUnauthorized);

  useEffect(() => {
    const page = route.path[0] || "overview";
    document.title = `${page.charAt(0).toUpperCase()}${page.slice(1)} – aiwarden`;
  }, [route.path]);

  if (!token) {
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
  if (fleet.error) body = <ErrorNote error={fleet.error} retry={fleet.reload} />;
  else if (!F) body = <Loading rows={6} />;
  else if (section === "devices" && sub) body = <Device id={sub} onUnauthorized={onUnauthorized} />;
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
        body = <Overview fleet={F} />;
    }
  }
  return (
    <Shell current={section === "devices" ? "devices" : section} fleet={F} theme={theme} onTheme={setTheme} onRefresh={fleet.reload} onSignOut={signOut}>
      {body}
    </Shell>
  );
}
