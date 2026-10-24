"""Load reports (this device, saved JSON files or a collector) and flatten them into records
that ask / alerts / weekly can filter and group.

Collector: /api/fleet only carries fleet-wide totals, so per-device reports come from
/api/devices/<id>. Each report keeps at most 200 sessions (report.build_report max_sessions),
so session questions over long windows can undercount; daily token/cost series are complete.
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from .config import resolve_team


def fetch_collector_reports(server: str, token: str, timeout: float = 30) -> list[dict]:
    def get(path):
        req = urllib.request.Request(server.rstrip("/") + path, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())

    fleet = get("/api/fleet")
    out = []
    for d in fleet.get("devices") or []:
        did = str(d.get("id") or "")
        if did:
            rep = get(f"/api/devices/{urllib.request.quote(did, safe='')}")
            if isinstance(rep, dict):
                out.append(rep)
    return out


def load_report_files(paths: list[str]) -> list[dict]:
    out = []
    for p in paths:
        data = json.loads(Path(p).read_text(encoding="utf-8"))
        out += [r for r in (data if isinstance(data, list) else [data]) if isinstance(r, dict) and r.get("device")]
    return out


def _num(v) -> float:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


def _tokens(t: dict) -> int:
    return int(_num(t.get("input_tokens")) + _num(t.get("output_tokens")))


def build_facts(reports: list[dict], config: dict | None = None) -> dict[str, list[dict]]:
    """One flat record list per entity. Every record carries device/hostname/user/team."""
    facts: dict[str, list[dict]] = {k: [] for k in ("devices", "usage", "model_usage", "sessions", "mcp_calls", "findings", "apps",
                                                    "mcp_servers", "guard_events", "risky_events")}
    for r in reports:
        dev = r.get("device") if isinstance(r.get("device"), dict) else {}
        base = {"device": dev.get("id"), "hostname": dev.get("hostname"), "user": dev.get("user"),
                "team": resolve_team(dev, config)}
        facts["devices"].append({**base, "os": dev.get("os"), "generated_at": r.get("generated_at")})
        u = r.get("usage") if isinstance(r.get("usage"), dict) else {}
        day_app = u.get("by_day_app")
        if isinstance(day_app, dict) and day_app:
            for day, apps in day_app.items():
                for app, t in (apps or {}).items():
                    if isinstance(t, dict):
                        facts["usage"].append({**base, "day": day, "app": app, "tokens": _tokens(t),
                                               "input_tokens": int(_num(t.get("input_tokens"))),
                                               "output_tokens": int(_num(t.get("output_tokens"))),
                                               "cost_usd": float(_num(t.get("cost_usd")))})
        else:  # reports from before by_day_app existed
            for day, t in (u.get("by_day") or {}).items():
                if isinstance(t, dict):
                    facts["usage"].append({**base, "day": day, "app": "(all)", "tokens": _tokens(t),
                                           "input_tokens": int(_num(t.get("input_tokens"))),
                                           "output_tokens": int(_num(t.get("output_tokens"))),
                                           "cost_usd": float(_num(t.get("cost_usd")))})
        for day, models in (u.get("by_day_model") or {}).items():
            for model, t in (models or {}).items() if isinstance(models, dict) else []:
                if isinstance(t, dict):
                    facts["model_usage"].append({**base, "day": day, "model": model, "tokens": _tokens(t),
                                                 "input_tokens": int(_num(t.get("input_tokens"))),
                                                 "output_tokens": int(_num(t.get("output_tokens"))),
                                                 "cost_usd": float(_num(t.get("cost_usd")))})
        for s in u.get("sessions") or []:
            if isinstance(s, dict):
                facts["sessions"].append({**base, "id": s.get("id"), "app": s.get("app"), "project": s.get("project"),
                                          "start": s.get("start"), "end": s.get("end"),
                                          "day": (s.get("start") or "")[:10] or None,
                                          "models": list(s.get("models") or []), "mcp_servers": list(s.get("mcp_servers") or []),
                                          "tokens": _tokens(s), "cost_usd": float(_num(s.get("cost_usd"))),
                                          "tool_calls": int(_num(s.get("tool_calls")))})
        for server, tools in (u.get("mcp_calls") or {}).items():
            for tool, n in (tools or {}).items() if isinstance(tools, dict) else []:
                facts["mcp_calls"].append({**base, "mcp_server": server, "tool": tool, "calls": int(_num(n))})
        for e in u.get("risky_events") or []:
            if isinstance(e, dict):
                facts["risky_events"].append({**base, "app": e.get("app"), "rule": e.get("rule"), "action": e.get("action"),
                                              "tool": e.get("tool"), "day": (e.get("timestamp") or "")[:10] or None})
        for f in r.get("findings") or []:
            if isinstance(f, dict):
                facts["findings"].append({**base, "rule": f.get("rule"), "severity": f.get("severity"),
                                          "title": f.get("title"), "subject": f.get("subject")})
        for a in r.get("apps") or []:
            if isinstance(a, dict):
                facts["apps"].append({**base, "app": a.get("id"), "name": a.get("name"), "running": bool(a.get("running"))})
        for s in r.get("mcp_servers") or []:
            if isinstance(s, dict):
                facts["mcp_servers"].append({**base, "client": s.get("client"), "mcp_server": s.get("name"),
                                             "transport": s.get("transport"), "package": s.get("package"),
                                             "url": s.get("url"), "secrets": len(s.get("secrets") or [])})
        for g in r.get("guard_events") or []:
            if isinstance(g, dict):
                facts["guard_events"].append({**base, "app": g.get("app"), "tool": g.get("tool"), "action": g.get("action"),
                                              "rule": g.get("rule"), "day": (g.get("ts") or "")[:10] or None})
    return facts
