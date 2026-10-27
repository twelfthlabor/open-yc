"""Fleet collector: devices push reports, the dashboard reads the aggregate.

Stdlib only (http.server + sqlite3). Intended to run behind TLS (reverse proxy) when exposed
beyond localhost. Every API call needs the bearer token; the dashboard page itself is static.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import sqlite3
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from pathlib import Path

MAX_BODY = 10 * 1024 * 1024
KEEP_PER_DEVICE = 20
_DEVICE_ID = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")

# Browser extension batches (metadata only). See extension/README.md for the producer side.
BROWSER_SCHEMA = "aiwarden.browser-events/v1"
BROWSER_MAX_BODY = 256 * 1024
BROWSER_MAX_EVENTS = 500
KEEP_EVENTS_PER_PROFILE = 2000
KEEP_USAGE_DAYS = 120
_EXT_ORIGIN = re.compile(r"^chrome-extension://([a-p]{32})$")
_PROFILE_ID = re.compile(r"^[A-Za-z0-9_\-]{8,64}$")
_EVENT_ID = re.compile(r"^[A-Za-z0-9_\-]{8,64}$")
_HOST = re.compile(r"^(?=.{1,253}$)[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?)+$")
_TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+\-]\d{2}:\d{2})$")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_KIND = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
_LABEL = re.compile(r"^[A-Za-z0-9 _.@\-]{0,64}$")
_VERSION = re.compile(r"^[0-9A-Za-z.\-]{0,32}$")
_FILE_EXT = re.compile(r"^[a-z0-9]{0,10}$")
BROWSERS = {"chrome", "edge", "brave", "chromium", "opera", "vivaldi", "other"}
CHANNELS = {"submit", "paste", "drop", "file"}
ACTIONS = {"allow", "warn", "block"}
DECISIONS = {"allowed", "sent_anyway", "cancelled", "blocked"}
# Field names a sloppy or compromised client might use to smuggle prompt text. Unknown keys are rejected
# anyway; these get a clearer error so client authors see why.
_CONTENT_KEYS = {"text", "content", "prompt", "prompts", "body", "message", "messages", "value", "values", "snippet",
                 "sample", "samples", "match", "matches", "raw", "input", "output", "response", "filename", "file_name",
                 "name", "title", "url", "href", "html", "selection", "clipboard", "data", "excerpt", "preview"}
_PROFILE_KEYS = {"id", "browser", "label", "extension_version", "device_id"}
_EVENT_KEYS = {"event_id", "ts", "site", "channel", "action", "decision", "detectors", "file_ext", "file_size", "file_inspected"}
_BATCH_KEYS = {"schema", "profile", "events", "usage"}
BROWSER_PATH = "/api/browser-events"


class Store:
    def __init__(self, path: Path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.execute("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL,"
                      " received_at TEXT NOT NULL, hostname TEXT, user TEXT, report_json TEXT NOT NULL)")
            c.execute("CREATE INDEX IF NOT EXISTS reports_device ON reports(device_id, id)")
            c.execute("CREATE TABLE IF NOT EXISTS browser_profiles (profile_id TEXT PRIMARY KEY, browser TEXT, label TEXT,"
                      " extension_version TEXT, device_id TEXT, last_seen TEXT)")
            c.execute("CREATE TABLE IF NOT EXISTS browser_events (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL,"
                      " event_id TEXT NOT NULL, received_at TEXT, ts TEXT, site TEXT, channel TEXT, action TEXT, decision TEXT,"
                      " detectors_json TEXT, file_ext TEXT, file_size INTEGER, file_inspected INTEGER,"
                      " UNIQUE(profile_id, event_id))")
            c.execute("CREATE TABLE IF NOT EXISTS browser_usage (profile_id TEXT NOT NULL, day TEXT NOT NULL, site TEXT NOT NULL,"
                      " seconds INTEGER, visits INTEGER, PRIMARY KEY(profile_id, day, site))")

    def add_browser(self, batch: dict) -> int:
        """Store a validated batch. Event ids make client retries idempotent; usage is cumulative per day, so keep the max."""
        p = batch["profile"]
        pid = p["id"]
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self._conn() as c:
            c.execute("INSERT INTO browser_profiles (profile_id, browser, label, extension_version, device_id, last_seen)"
                      " VALUES (?,?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET browser=excluded.browser,"
                      " label=excluded.label, extension_version=excluded.extension_version, device_id=excluded.device_id,"
                      " last_seen=excluded.last_seen",
                      (pid, p.get("browser", "other"), p.get("label", ""), p.get("extension_version", ""),
                       p.get("device_id"), now))
            before = c.total_changes
            for e in batch.get("events", []):
                c.execute("INSERT OR IGNORE INTO browser_events (profile_id, event_id, received_at, ts, site, channel, action,"
                          " decision, detectors_json, file_ext, file_size, file_inspected) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                          (pid, e["event_id"], now, e["ts"], e["site"], e["channel"], e["action"], e["decision"],
                           json.dumps(e["detectors"]), e.get("file_ext"), e.get("file_size"),
                           None if "file_inspected" not in e else int(bool(e["file_inspected"]))))
            accepted = c.total_changes - before
            for day, sites in (batch.get("usage") or {}).items():
                for site, u in sites.items():
                    c.execute("INSERT INTO browser_usage (profile_id, day, site, seconds, visits) VALUES (?,?,?,?,?)"
                              " ON CONFLICT(profile_id, day, site) DO UPDATE SET seconds=MAX(seconds, excluded.seconds),"
                              " visits=MAX(visits, excluded.visits)", (pid, day, site, int(u.get("seconds", 0)),
                                                                        int(u.get("visits", 0))))
            c.execute("DELETE FROM browser_events WHERE profile_id = ? AND id NOT IN (SELECT id FROM browser_events"
                      " WHERE profile_id = ? ORDER BY id DESC LIMIT ?)", (pid, pid, KEEP_EVENTS_PER_PROFILE))
            c.execute("DELETE FROM browser_usage WHERE profile_id = ? AND day NOT IN (SELECT DISTINCT day FROM browser_usage"
                      " WHERE profile_id = ? ORDER BY day DESC LIMIT ?)", (pid, pid, KEEP_USAGE_DAYS))
        return accepted

    def browser_rows(self) -> dict:
        with self._conn() as c:
            return {
                "profiles": c.execute("SELECT profile_id, browser, label, extension_version, device_id, last_seen"
                                      " FROM browser_profiles").fetchall(),
                "events": c.execute("SELECT profile_id, ts, site, channel, action, decision, detectors_json, file_ext,"
                                    " file_size, file_inspected FROM browser_events ORDER BY id DESC LIMIT 20000").fetchall(),
                "usage": c.execute("SELECT profile_id, day, site, seconds, visits FROM browser_usage").fetchall(),
            }

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=10)

    def add(self, report: dict) -> None:
        dev = report["device"]
        with self._conn() as c:
            c.execute("INSERT INTO reports (device_id, received_at, hostname, user, report_json) VALUES (?,?,?,?,?)",
                      (dev["id"], datetime.now(timezone.utc).isoformat(timespec="seconds"), str(dev.get("hostname", ""))[:255],
                       str(dev.get("user", ""))[:255], json.dumps(report)))
            c.execute("DELETE FROM reports WHERE device_id = ? AND id NOT IN "
                      "(SELECT id FROM reports WHERE device_id = ? ORDER BY id DESC LIMIT ?)", (dev["id"], dev["id"], KEEP_PER_DEVICE))

    def latest(self) -> list[tuple[str, dict]]:
        with self._conn() as c:
            rows = c.execute("SELECT r.received_at, r.report_json FROM reports r JOIN (SELECT device_id, MAX(id) AS mid "
                             "FROM reports GROUP BY device_id) m ON r.id = m.mid ORDER BY r.hostname").fetchall()
        return [(ts, json.loads(js)) for ts, js in rows]

    def device(self, device_id: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT report_json FROM reports WHERE device_id = ? ORDER BY id DESC LIMIT 1", (device_id,)).fetchone()
        return json.loads(row[0]) if row else None


def _list_of_dicts(v) -> bool:
    return isinstance(v, list) and all(isinstance(x, dict) for x in v)


def _scalar(v) -> bool:
    return v is None or isinstance(v, (str, int, float, bool))


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def valid_report(r) -> bool:
    """Shape check, so one malformed report from one device cannot break the fleet view."""
    if not isinstance(r, dict) or r.get("schema") != "aiwarden.report/v1":
        return False
    dev = r.get("device")
    if not isinstance(dev, dict) or not _DEVICE_ID.match(str(dev.get("id", ""))):
        return False
    for key in ("apps", "mcp_servers", "findings", "guard_events", "browser_extensions"):
        if key in r and not _list_of_dicts(r[key]):
            return False
    if not all(isinstance(a.get("id"), str) for a in r.get("apps", [])):
        return False
    # Fields the aggregator hashes, sorts or renders must be scalars.
    scalar_fields = {
        "apps": ("name", "vendor", "kind"),
        "mcp_servers": ("name", "client", "scope", "package", "url", "command", "transport"),
        "findings": ("rule", "severity", "title", "subject", "detail", "location"),
        "guard_events": ("ts", "app", "session", "tool", "action", "rule", "would_be"),
    }
    for key, fields in scalar_fields.items():
        for item in r.get(key, []):
            if any(not _scalar(item.get(f)) for f in fields):
                return False
    if any(not _scalar(dev.get(f)) for f in ("hostname", "user", "os")):
        return False
    if not _scalar(r.get("generated_at")):
        return False
    summ = r.get("summary", {})
    if not isinstance(summ, dict):
        return False
    for k, v in summ.items():
        if k == "findings":
            if not (isinstance(v, dict) and all(_num(x) for x in v.values())):
                return False
        elif not (_num(v) or isinstance(v, bool)):
            return False
    usage = r.get("usage")
    if usage is not None:
        if not isinstance(usage, dict):
            return False
        for key in ("by_model", "by_day", "by_app"):
            part = usage.get(key, {})
            if not (isinstance(part, dict) and all(isinstance(t, dict) for t in part.values())):
                return False
    return True


def _int_in(v, lo: int, hi: int) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi


def _enum(v, allowed: set) -> bool:
    return isinstance(v, str) and v in allowed


def _str_match(v, pat: re.Pattern) -> bool:
    return isinstance(v, str) and bool(pat.match(v))


def _keys_ok(obj: dict, allowed: set, where: str) -> str | None:
    for k in obj:
        if not isinstance(k, str) or k not in allowed:
            if isinstance(k, str) and k.lower() in _CONTENT_KEYS:
                return f"raw content is not accepted ({where}.{k}); send metadata only"
            return f"unknown field {where}.{str(k)[:40]}"
    return None


def _valid_detectors(d) -> bool:
    return (isinstance(d, dict) and len(d) <= 40
            and all(_str_match(k, _KIND) and _int_in(v, 0, 1_000_000) for k, v in d.items()))


def _valid_browser_event(e) -> str | None:
    if not isinstance(e, dict):
        return "event must be an object"
    err = _keys_ok(e, _EVENT_KEYS, "event")
    if err:
        return err
    ok = (_str_match(e.get("event_id"), _EVENT_ID) and _str_match(e.get("ts"), _TS) and _str_match(e.get("site"), _HOST)
          and _enum(e.get("channel"), CHANNELS) and _enum(e.get("action"), ACTIONS) and _enum(e.get("decision"), DECISIONS)
          and _valid_detectors(e.get("detectors"))
          and ("file_ext" not in e or _str_match(e["file_ext"], _FILE_EXT))
          and ("file_size" not in e or _int_in(e["file_size"], 0, 10 ** 12))
          and ("file_inspected" not in e or isinstance(e["file_inspected"], bool)))
    return None if ok else "invalid event"


def valid_browser_batch(b) -> tuple[bool, str]:
    """Strict allowlist: every value is an enum, an id, a hostname, a timestamp or a bounded number. There is no
    free-text field, so a client cannot store prompt text here even by mistake."""
    if not isinstance(b, dict) or b.get("schema") != BROWSER_SCHEMA:
        return False, "not an aiwarden browser batch"
    err = _keys_ok(b, _BATCH_KEYS, "batch")
    if err:
        return False, err
    p = b.get("profile")
    if not isinstance(p, dict):
        return False, "profile missing"
    err = _keys_ok(p, _PROFILE_KEYS, "profile")
    if err:
        return False, err
    if not (_str_match(p.get("id"), _PROFILE_ID) and _enum(p.get("browser", "other"), BROWSERS)
            and _str_match(p.get("label", ""), _LABEL) and _str_match(p.get("extension_version", ""), _VERSION)
            and (p.get("device_id") is None or _str_match(p["device_id"], _DEVICE_ID))):
        return False, "invalid profile"
    events = b.get("events", [])
    if not isinstance(events, list) or len(events) > BROWSER_MAX_EVENTS:
        return False, f"events must be a list of at most {BROWSER_MAX_EVENTS}"
    for e in events:
        err = _valid_browser_event(e)
        if err:
            return False, err
    usage = b.get("usage", {})
    if not isinstance(usage, dict) or len(usage) > 62:
        return False, "invalid usage"
    for day, sites in usage.items():
        if not _str_match(day, _DAY) or not isinstance(sites, dict) or len(sites) > 200:
            return False, "invalid usage"
        for site, u in sites.items():
            if not _str_match(site, _HOST) or not isinstance(u, dict):
                return False, "invalid usage"
            err = _keys_ok(u, {"seconds", "visits"}, "usage")
            if err:
                return False, err
            if not (_int_in(u.get("seconds", 0), 0, 86400) and _int_in(u.get("visits", 0), 0, 100_000)):
                return False, "invalid usage"
    return True, ""


def aggregate_browser(rows: dict | None, hostnames: dict | None = None) -> dict:
    """Fleet view of browser AI usage and DLP decisions. Rows are re-checked here, so a row written by an older
    version or edited in the database is skipped instead of breaking /api/fleet."""
    rows = rows or {}
    hostnames = hostnames or {}
    invalid = 0
    profiles: dict[str, dict] = {}
    for r in rows.get("profiles", []):
        try:
            pid, browser, label, ver, dev, seen = r
        except (TypeError, ValueError):
            invalid += 1
            continue
        if not _str_match(pid, _PROFILE_ID):
            invalid += 1
            continue
        profiles[pid] = {"id": pid, "browser": browser if _enum(browser, BROWSERS) else "other",
                         "label": label if _str_match(label, _LABEL) else "", "extension_version": ver if _str_match(ver, _VERSION) else "",
                         "device_id": dev if _str_match(dev, _DEVICE_ID) else None,
                         "hostname": hostnames.get(dev) if isinstance(dev, str) else None,
                         "last_seen": seen if isinstance(seen, str) else None,
                         "events": 0, "blocks": 0, "warns": 0, "seconds": 0, "sites": 0}
    sites: dict[str, dict] = defaultdict(lambda: {"seconds": 0, "visits": 0, "profiles": set(), "events": 0, "blocks": 0, "warns": 0})
    by_day: dict[str, dict] = defaultdict(lambda: {"seconds": 0, "visits": 0})
    profile_sites: dict[str, set] = defaultdict(set)
    for r in rows.get("usage", []):
        try:
            pid, day, site, secs, visits = r
        except (TypeError, ValueError):
            invalid += 1
            continue
        if not (_str_match(day, _DAY) and _str_match(site, _HOST) and _int_in(secs, 0, 86400) and _int_in(visits, 0, 100_000)):
            invalid += 1
            continue
        s = sites[site]
        s["seconds"] += secs
        s["visits"] += visits
        s["profiles"].add(pid)
        by_day[day]["seconds"] += secs
        by_day[day]["visits"] += visits
        if pid in profiles:
            profiles[pid]["seconds"] += secs
            profile_sites[pid].add(site)
    detectors: dict[str, dict] = defaultdict(lambda: {"events": 0, "blocks": 0, "warns": 0, "sent_anyway": 0, "cancelled": 0})
    events = []
    for r in rows.get("events", []):
        try:
            pid, ts, site, channel, action, decision, det_json, ext, size, inspected = r
            det = json.loads(det_json)
        except (TypeError, ValueError):
            invalid += 1
            continue
        if not (_str_match(site, _HOST) and _enum(channel, CHANNELS) and _enum(action, ACTIONS) and _enum(decision, DECISIONS)
                and _valid_detectors(det)):
            invalid += 1
            continue
        s = sites[site]
        s["events"] += 1
        s["profiles"].add(pid)
        s["blocks"] += action == "block"
        s["warns"] += action == "warn"
        prof = profiles.get(pid)
        if prof:
            prof["events"] += 1
            prof["blocks"] += action == "block"
            prof["warns"] += action == "warn"
        for kind in det:
            d = detectors[kind]
            d["events"] += 1
            d["blocks"] += action == "block"
            d["warns"] += action == "warn"
            d["sent_anyway"] += decision == "sent_anyway"
            d["cancelled"] += decision == "cancelled"
        if len(events) < 500:
            events.append({"ts": ts if isinstance(ts, str) else "", "site": site, "channel": channel, "action": action,
                           "decision": decision, "detectors": det, "file_ext": ext if _str_match(ext, _FILE_EXT) else None,
                           "file_size": size if _int_in(size, 0, 10 ** 12) else None,
                           "profile_id": pid, "label": prof["label"] if prof else "", "browser": prof["browser"] if prof else "",
                           "hostname": prof["hostname"] if prof else None})
    for pid, ss in profile_sites.items():
        profiles[pid]["sites"] = len(ss)
    events.sort(key=lambda e: e["ts"], reverse=True)
    return {
        "profiles": sorted(profiles.values(), key=lambda p: p["last_seen"] or "", reverse=True),
        "sites": sorted(({"site": k, **v, "profiles": len(v["profiles"])} for k, v in sites.items()),
                        key=lambda s: (-s["seconds"], -s["events"], s["site"])),
        "by_day": dict(sorted(by_day.items())),
        "detectors": sorted(({"detector": k, **v} for k, v in detectors.items()), key=lambda d: (-d["events"], d["detector"])),
        "events": events,
        "invalid_rows": invalid,
    }


def _sum_tokens(dst: dict, src: dict) -> None:
    for k, v in (src or {}).items():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            dst[k] = dst.get(k, 0) + v


def aggregate(rows: list[tuple[str, dict]], browser_rows: dict | None = None) -> dict:
    devices, findings, guard = [], [], []
    apps: dict[str, dict] = {}
    packages: dict[str, dict] = defaultdict(lambda: {"devices": set(), "clients": set()})
    by_model: dict[str, dict] = defaultdict(dict)
    by_day: dict[str, dict] = defaultdict(dict)
    by_app: dict[str, dict] = defaultdict(dict)
    sev: Counter = Counter()
    totals: Counter = Counter()
    for received_at, r in rows:
        if not valid_report(r):  # stored before validation existed, or tampered with in the db
            totals["invalid_reports"] += 1
            continue
        dev, summ = r.get("device", {}), r.get("summary", {})
        devices.append({"id": dev.get("id"), "hostname": dev.get("hostname"), "user": dev.get("user"), "os": dev.get("os"),
                        "generated_at": r.get("generated_at"), "received_at": received_at, "summary": summ})
        totals["devices"] += 1
        for k in ("apps", "mcp_servers", "plaintext_secrets", "tokens", "risky_events", "guard_blocks"):
            totals[k] += int(summ.get(k) or 0)
        totals["guarded_devices"] += 1 if summ.get("guard_installed") else 0
        for k, v in (summ.get("findings") or {}).items():
            sev[k] += int(v or 0)
        for a in r.get("apps", []):
            e = apps.setdefault(a["id"], {"name": a.get("name"), "vendor": a.get("vendor"), "kind": a.get("kind"),
                                          "devices": 0, "running": 0})
            e["devices"] += 1
            e["running"] += 1 if a.get("running") else 0
        for s in r.get("mcp_servers", []):
            key = s.get("package") or s.get("url") or f"{s.get('command')} ({s.get('name')})"
            packages[key]["devices"].add(dev.get("id"))
            packages[key]["clients"].add(s.get("client"))
        for f in r.get("findings", []):
            findings.append({**f, "device_id": dev.get("id"), "hostname": dev.get("hostname")})
        u = r.get("usage") or {}
        for m, t in (u.get("by_model") or {}).items():
            _sum_tokens(by_model[m], t)
        for d, t in (u.get("by_day") or {}).items():
            _sum_tokens(by_day[d], t)
        for a, t in (u.get("by_app") or {}).items():
            _sum_tokens(by_app[a], t)
        for ev in r.get("guard_events", [])[-200:]:
            guard.append({**ev, "hostname": dev.get("hostname")})
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    findings.sort(key=lambda f: (order.get(f.get("severity"), 9), f.get("rule", "")))
    guard.sort(key=lambda e: e.get("ts") or "", reverse=True)
    browser = aggregate_browser(browser_rows, {d["id"]: d["hostname"] for d in devices if isinstance(d.get("id"), str)})
    totals["browser_profiles"] = len(browser["profiles"])
    totals["browser_events"] = sum(p["events"] for p in browser["profiles"])
    totals["browser_blocks"] = sum(p["blocks"] for p in browser["profiles"])
    totals["browser_warns"] = sum(p["warns"] for p in browser["profiles"])
    totals["invalid_browser_rows"] = browser.pop("invalid_rows")
    return {
        "browser": browser,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "totals": {**totals, "findings": dict(sev)},
        "devices": devices,
        "apps": dict(sorted(apps.items(), key=lambda kv: -kv[1]["devices"])),
        "mcp_packages": sorted(({"package": k, "devices": len(v["devices"]), "clients": sorted(filter(None, v["clients"]))}
                                for k, v in packages.items()), key=lambda p: -p["devices"]),
        "findings": findings,
        "usage": {"by_model": dict(by_model), "by_day": dict(sorted(by_day.items())), "by_app": dict(by_app)},
        "guard_events": guard[:500],
    }


_CTYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
           ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
           ".json": "application/json", ".txt": "text/plain; charset=utf-8"}
_NO_UI = b"<!doctype html><title>aiwarden</title><p>The web console is not built. Run <code>npm run build</code> in web/."
API_MAX_BODY = 64 * 1024
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; "
       "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


def ui_files() -> dict[str, tuple[bytes, str]]:
    """URL path -> (body, content type) for the built console in static/app (web/ builds into it).
    The server only ever serves paths from this map, so a request path is never joined onto the filesystem."""
    root = resources.files("aiwarden").joinpath("static/app")
    out: dict[str, tuple[bytes, str]] = {}

    def walk(node, prefix):
        for child in node.iterdir():
            if child.is_dir():
                walk(child, f"{prefix}{child.name}/")
            elif child.is_file():
                ext = "." + child.name.rsplit(".", 1)[-1].lower() if "." in child.name else ""
                if ext in _CTYPES:
                    out[f"/{prefix}{child.name}"] = (child.read_bytes(), _CTYPES[ext])

    if root.is_dir():
        walk(root, "")
    index = out.pop("/index.html", None)
    out["/"] = index or (_NO_UI, _CTYPES[".html"])
    return out


def _reports(store: "Store") -> list[dict]:
    return [r for _, r in store.latest() if valid_report(r)]


def _as_of(query: str) -> str | None:
    from urllib.parse import parse_qs
    v = (parse_qs(query).get("as_of") or [None])[0]
    if v is not None and not _DAY.match(v):
        raise ValueError("as_of must be YYYY-MM-DD")
    return v


def api_rules() -> dict:
    from .mcpscan import RULES as MCPX
    from .policy import RULES as GRD
    return {"guard": [{"id": k, "action": a, "description": d} for k, (a, d) in GRD.items()],
            "mcp_scan": [{"id": k, "severity": s, "description": d} for k, (s, d) in MCPX.items()]}


def api_check(body) -> dict:
    """Dry-run one tool call against the built-in policy (the console's rule tester). Raises ValueError on bad input."""
    from .agents import AGENTS, evaluate_agent
    if not isinstance(body, dict):
        raise ValueError("expected a JSON object")
    agent, tool, inp = body.get("agent", "claude-code"), body.get("tool"), body.get("input")
    if agent not in AGENTS:
        raise ValueError(f"agent must be one of {', '.join(AGENTS)}")
    if not isinstance(tool, str) or not 0 < len(tool) <= 200:
        raise ValueError("tool must be a tool name")
    if not isinstance(inp, dict):
        raise ValueError("input must be a JSON object (the tool's arguments)")
    return evaluate_agent(agent, tool, inp).to_dict()


def api_ask(body, reports: list[dict], config: dict) -> dict:
    """Question or structured query over the fleet. The parser runs locally; LLM translation only when the
    collector was started with AIWARDEN_ASK_LLM=1 (the question text, never fleet data, goes to the API)."""
    from datetime import date
    from .fleetdata import build_facts
    from .query import run_query, translate, validate_query
    if not isinstance(body, dict):
        raise ValueError("expected a JSON object")
    as_of = body.get("as_of") or date.today().isoformat()
    if not isinstance(as_of, str) or not _DAY.match(as_of):
        raise ValueError("as_of must be YYYY-MM-DD")
    if "query" in body:
        query, how = validate_query(body["query"]), "structured"
    else:
        q = body.get("question")
        if not isinstance(q, str) or not q.strip() or len(q) > 500:
            raise ValueError("question must be 1-500 characters")
        mode = "auto" if os.environ.get("AIWARDEN_ASK_LLM") == "1" else "parser"
        query, how = translate(q.strip(), as_of, mode)
        if query is None:
            raise ValueError("could not understand the question; try one of the suggested forms")
    return {"query": query, "translated_by": how, "result": run_query(query, build_facts(reports, config), as_of)}


def make_server(host: str, port: int, db_path: Path, token: str, extension_ids=None,
                config: dict | None = None) -> ThreadingHTTPServer:
    """extension_ids: optional allowlist of Chrome/Edge extension ids that may call /api/browser-events from a
    browser (CORS). Defaults to $AIWARDEN_EXTENSION_IDS (comma separated); empty means any chrome-extension:// origin.
    config: team mapping / prices / alert thresholds used by ask, weekly and alerts (see config.py)."""
    handler = make_handler(Store(db_path), token, extension_ids, config, ui_files())
    return ThreadingHTTPServer((host, port), handler)


def make_handler(store: Store, token: str, extension_ids=None, config: dict | None = None,
                 files: dict[str, tuple[bytes, str]] | None = None, read_only: bool = False) -> type[BaseHTTPRequestHandler]:
    """The collector's request handler. files: the console to serve (none where a host serves it statically).
    read_only: refuse uploads (reports, browser events), for the public demo."""
    files = files if files is not None else {}
    config = config or {}
    if extension_ids is None:
        extension_ids = [x.strip() for x in os.environ.get("AIWARDEN_EXTENSION_IDS", "").split(",") if x.strip()]
    allowed_ext = frozenset(extension_ids)

    def ext_origin_ok(origin: str) -> bool:
        m = _EXT_ORIGIN.match(origin or "")
        return bool(m) and (not allowed_ext or m.group(1) in allowed_ext)

    class Handler(BaseHTTPRequestHandler):
        server_version = "aiwarden"
        sys_version = ""
        timeout = 30  # a client that sends less body than it announced cannot hold a thread forever

        def log_message(self, fmt, *args):  # keep test and server output quiet
            pass

        def do_HEAD(self):
            path = self.path.split("?", 1)[0]
            path = "/" if path == "/index.html" else path
            hit = files.get(path)
            self._send(200 if hit or path == "/healthz" else 404, b"", hit[1] if hit else "text/html; charset=utf-8")

        def _send(self, code: int, body: bytes, ctype: str = "application/json", extra: dict | None = None) -> None:
            self.send_response(code)
            for k, v in (extra or getattr(self, "_extra_headers", None) or {}).items():
                self.send_header(k, v)
            self._extra_headers = None  # per-response; never carried into a later request on this connection
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, code: int, obj) -> None:
            self._send(code, json.dumps(obj).encode())

        def _authed(self) -> bool:
            got = self.headers.get("Authorization", "")
            ok = got.startswith("Bearer ") and hmac.compare_digest(got[7:].encode(), token.encode())
            if not ok:
                self._json(401, {"error": "unauthorized"})
            return ok

        def do_GET(self):
            path, _, query = self.path.partition("?")
            path = "/" if path == "/index.html" else path
            if path in files:
                body, ctype = files[path]
                return self._send(200, body, ctype)
            if path == "/healthz":
                return self._json(200, {"ok": True})
            if not path.startswith("/api/"):
                return self._json(404, {"error": "not found"})
            if not self._authed():
                return
            if path == "/api/fleet":
                return self._json(200, aggregate(store.latest(), store.browser_rows()))
            if path == "/api/rules":
                return self._json(200, api_rules())
            if path in ("/api/weekly", "/api/alerts"):
                try:
                    as_of = _as_of(query)
                except ValueError as e:
                    return self._json(422, {"error": str(e)})
                if path == "/api/weekly":
                    from .weekly import build_weekly
                    return self._json(200, build_weekly(_reports(store), config, as_of))
                from .alerts import evaluate_alerts
                # Preview: everything currently true, with no saved state. The `aiwarden alerts` job owns delivery.
                alerts, _ = evaluate_alerts(_reports(store), config, None, as_of, alert_existing=True)
                return self._json(200, {"alerts": alerts})
            m = re.fullmatch(r"/api/devices/([A-Za-z0-9_\-]{1,64})", path)
            if m:
                rep = store.device(m.group(1))
                return self._json(200, rep) if rep else self._json(404, {"error": "not found"})
            self._json(404, {"error": "not found"})

        def _cors(self) -> bool | None:
            """None: not a cross-origin request. True: allowed extension origin. False: some other origin."""
            origin = self.headers.get("Origin")
            if origin is None:
                return None
            if not ext_origin_ok(origin):
                return False
            self._extra_headers = {"Access-Control-Allow-Origin": origin, "Vary": "Origin"}
            return True

        def do_OPTIONS(self):
            # CORS exists for exactly one route, and only for extension origins. Preflights carry no token.
            if self.path.split("?", 1)[0] != BROWSER_PATH or self._cors() is not True:
                return self._send(403, b"", "text/plain", {"Vary": "Origin"})
            self._extra_headers.update({"Access-Control-Allow-Methods": "POST, OPTIONS",
                                        "Access-Control-Allow-Headers": "authorization, content-type",
                                        "Access-Control-Max-Age": "600"})
            self._send(204, b"", "text/plain")

        def _read_json(self, limit: int):
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length <= 0 or length > limit:
                self._json(413 if length > limit else 400, {"error": "bad length"})
                return None, False
            try:
                return json.loads(self.rfile.read(length)), True
            except ValueError:
                self._json(400, {"error": "invalid json"})
                return None, False

        def _post_browser(self):
            if self._cors() is False:
                return self._send(403, b'{"error": "origin not allowed"}', extra={"Vary": "Origin"})
            if not self._authed():
                return
            batch, ok = self._read_json(BROWSER_MAX_BODY)
            if not ok:
                return
            valid, why = valid_browser_batch(batch)
            if not valid:
                return self._json(422, {"error": why})
            self._json(200, {"ok": True, "accepted": store.add_browser(batch)})

        def _post_api(self, fn):
            if not self._authed():
                return
            body, ok = self._read_json(API_MAX_BODY)
            if not ok:
                return
            try:
                return self._json(200, fn(body))
            except (ValueError, TypeError, KeyError) as e:  # malformed input deep in a query is still bad input
                return self._json(422, {"error": str(e)[:300]})

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if read_only and path in (BROWSER_PATH, "/api/reports"):
                return self._json(403, {"error": "this collector is read-only"})
            if path == BROWSER_PATH:
                return self._post_browser()
            if path == "/api/check":
                return self._post_api(api_check)
            if path == "/api/ask":
                return self._post_api(lambda b: api_ask(b, _reports(store), config))
            if path != "/api/reports":
                return self._json(404, {"error": "not found"})
            if not self._authed():
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length <= 0 or length > MAX_BODY:
                return self._json(413 if length > MAX_BODY else 400, {"error": "bad length"})
            try:
                report = json.loads(self.rfile.read(length))
            except ValueError:
                return self._json(400, {"error": "invalid json"})
            if not valid_report(report):
                return self._json(422, {"error": "not an aiwarden report"})
            store.add(report)
            self._json(200, {"ok": True, "device_id": report["device"]["id"]})

    return Handler


def push_report(server_url: str, token: str, report: dict, timeout: float = 30) -> dict:
    req = urllib.request.Request(server_url.rstrip("/") + "/api/reports", data=json.dumps(report).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())
