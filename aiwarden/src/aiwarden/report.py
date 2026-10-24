"""One JSON report per device: inventory, activity, findings and the relationship graph."""
from __future__ import annotations

import getpass
import hashlib
import json
import platform
import socket
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import urlsplit

from . import __version__
from .apps import ProcInfo, app_label, discover_apps, discover_browser_extensions, discover_claude_config
from .config import config_path, load_config, resolve_team
from .env import Env
from .mcp import discover_mcp_servers
from .pricing import load_prices
from .risk import SEVERITY_ORDER, assess
from .usage import collect_usage

SCHEMA = "aiwarden.report/v1"
CLIENT_APP = {"vscode-insiders": "vscode", "vscodium": "vscode"}


def device_identity() -> dict:
    host = socket.gethostname()
    try:
        user = getpass.getuser()
    except Exception:
        user = "unknown"
    release = platform.release()
    if platform.system() == "Windows" and release == "10":
        try:  # Windows 11 still reports release "10"; builds >= 22000 are 11
            if int(platform.version().split(".")[2]) >= 22000:
                release = "11"
        except (IndexError, ValueError):
            pass
    return {"id": hashlib.sha256(f"{host}|{user}".encode()).hexdigest()[:16], "hostname": host, "user": user,
            "os": f"{platform.system()} {release}", "arch": platform.machine()}


def read_guard_events(env: Env, limit: int = 500) -> list[dict]:
    p = env.state_dir / "events.jsonl"
    try:
        lines = p.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:]
    except OSError:
        return []
    out = []
    for line in lines:
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if isinstance(ev, dict):
            out.append({k: ev.get(k) for k in ("ts", "app", "session", "tool", "action", "rule", "would_be")})
    return out


class _Graph:
    def __init__(self):
        self.nodes: dict[str, dict] = {}
        self.edges: dict[tuple[str, str, str], dict] = {}

    def node(self, nid: str, ntype: str, label: str, **meta) -> str:
        n = self.nodes.setdefault(nid, {"id": nid, "type": ntype, "label": label, "meta": {}})
        n["meta"].update({k: v for k, v in meta.items() if v is not None})
        return nid

    def edge(self, src: str, dst: str, etype: str, **meta) -> dict:
        e = self.edges.setdefault((src, dst, etype), {"source": src, "target": dst, "type": etype, "meta": {}})
        e["meta"].update(meta)
        return e

    def ensure_app(self, dev: str, app_id: str) -> str:
        nid = f"app:{app_id}"
        if nid not in self.nodes:
            self.node(nid, "app", app_label(app_id))
            self.edge(dev, nid, "has_app")
        return nid

    def to_dict(self) -> dict:
        return {"nodes": list(self.nodes.values()), "edges": list(self.edges.values())}


def build_graph(device: dict, apps, servers, extensions, claude, usage, findings) -> dict:
    g = _Graph()
    dev = g.node(f"device:{device['id']}", "device", device["hostname"], os=device.get("os"))
    user = g.node(f"user:{device['user']}", "user", device["user"])
    g.edge(user, dev, "uses")
    for a in apps:
        g.node(f"app:{a.id}", "app", a.name, vendor=a.vendor, kind=a.kind, running=a.running)
        g.edge(dev, f"app:{a.id}", "has_app")

    mcp_calls = (usage or {}).get("mcp_calls", {})
    for s in servers:
        app_id = CLIENT_APP.get(s.client, s.client)
        app = g.ensure_app(dev, app_id)
        g.node(s.id, "mcp", s.name, transport=s.transport, scope=s.scope, client=s.client, disabled=s.disabled,
               secrets=len(s.secrets))
        # Transcripts name MCP tools mcp__<server>__<tool>; attribute calls to that app's server of the same name.
        calls = sum(mcp_calls.get(s.name, {}).values()) if app_id == "claude-code" else 0
        g.edge(app, s.id, "configures", scope=s.scope, calls=calls)
        if s.package:
            g.node(f"pkg:{s.package}", "package", s.package)
            g.edge(s.id, f"pkg:{s.package}", "runs")
        if s.url:
            host = urlsplit(s.url).hostname or s.url
            g.node(f"host:{host}", "host", host)
            g.edge(s.id, f"host:{host}", "connects_to", transport=s.transport)

    if claude:
        cc = g.ensure_app(dev, "claude-code")
        for sk in claude.get("skills", []):
            g.edge(cc, g.node(f"skill:{sk['name']}", "skill", sk["name"], scope=sk.get("scope")), "has_skill")

    for sess in (usage or {}).get("sessions", []):
        app = g.ensure_app(dev, sess["app"])
        for m in sess.get("models", []):
            g.node(f"model:{m}", "model", m)
            e = g.edge(app, f"model:{m}", "uses_model")
            e["meta"]["tokens"] = e["meta"].get("tokens", 0) + sess.get("model_tokens", {}).get(m, 0)
            e["meta"]["sessions"] = e["meta"].get("sessions", 0) + 1

    for e in extensions:
        b = g.node(f"browser:{e.browser}", "browser", e.browser)
        g.edge(dev, b, "has_browser")
        g.node(f"ext:{e.browser}:{e.id}", "extension", e.name, broad_access=e.broad_access)
        g.edge(b, f"ext:{e.browser}:{e.id}", "has_extension")

    for f in findings:
        n = g.nodes.get(f.subject)
        if n:
            cur = n["meta"].get("max_severity")
            if cur is None or SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[cur]:
                n["meta"]["max_severity"] = f.severity
            n["meta"]["findings"] = n["meta"].get("findings", 0) + 1
    return g.to_dict()


def build_report(env: Env, processes: list[ProcInfo] | None = None, include_usage: bool = True,
                 since: str | None = None, include_content: bool = False, max_sessions: int = 200) -> dict:
    config = load_config(config_path(env))
    device = device_identity()
    team = resolve_team(device, config)
    if team:
        device["team"] = team
    apps = discover_apps(env, processes)
    servers = discover_mcp_servers(env)
    extensions = discover_browser_extensions(env)
    claude = discover_claude_config(env)
    findings = assess(env, servers, extensions, claude)
    usage = (collect_usage(env, since=since, include_content=include_content, prices=load_prices(config))
             if include_usage else None)
    if usage:
        usage["sessions"] = usage["sessions"][:max_sessions]
    guard_events = read_guard_events(env)
    sev = Counter(f.severity for f in findings)
    tokens = sum(a.get("input_tokens", 0) + a.get("output_tokens", 0) for a in (usage or {}).get("by_app", {}).values())
    return {
        "schema": SCHEMA,
        "aiwarden_version": __version__,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "device": device,
        "apps": [a.to_dict() for a in apps],
        "mcp_servers": [s.to_dict() for s in servers],
        "browser_extensions": [e.to_dict() for e in extensions],
        "claude": claude,
        "usage": usage,
        "guard_events": guard_events,
        "findings": [f.to_dict() for f in findings],
        "graph": build_graph(device, apps, servers, extensions, claude, usage, findings),
        "summary": {
            "apps": len(apps),
            "running": sum(a.running for a in apps),
            "mcp_servers": len(servers),
            "remote_mcp_servers": sum(1 for s in servers if s.url),
            "plaintext_secrets": sum(len(s.secrets) for s in servers),
            "findings": {k: sev.get(k, 0) for k in SEVERITY_ORDER},
            "tokens": tokens,
            "cost_usd": float(((usage or {}).get("cost") or {}).get("total_usd") or 0.0),
            "risky_events": len((usage or {}).get("risky_events", [])),
            "guard_blocks": sum(1 for e in guard_events if e.get("action") == "deny"),
            "guard_installed": bool(claude and claude.get("guard_installed")),
        },
    }
