import { useEffect, useState } from "react";

// Hash routes keep the collector to a single HTML path: #/devices/abc, #/findings?sev=high
export interface Route {
  path: string[];
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [p, q = ""] = raw.split("?", 2);
  const path = p
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  return { path, params: new URLSearchParams(q) };
}

export function href(path: string, params?: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v) q.set(k, v);
  const s = q.toString();
  return `#/${path.replace(/^\//, "")}${s ? `?${s}` : ""}`;
}

export function go(path: string, params?: Record<string, string | undefined>) {
  window.location.hash = href(path, params);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
