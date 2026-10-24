"""Hand-built multi-device reports (aiwarden.report/v1 shape) for ask / alerts / weekly tests."""
from __future__ import annotations


def _tok(inp, out, cost):
    return {"input_tokens": inp, "output_tokens": out, "cache_read_tokens": 0, "cache_write_tokens": 0, "cost_usd": cost}


def mk_report(dev_id, user, host, team=None, days=None, sessions=None, findings=None, apps=None, servers=None,
              guard=None, mcp_calls=None, generated_at="2026-10-23T12:00:00+00:00"):
    days = days or {}
    by_app: dict = {}
    by_day: dict = {}
    for day, apps_ in days.items():
        for app, t in apps_.items():
            a = by_app.setdefault(app, {**_tok(0, 0, 0.0), "sessions": 0, "tool_calls": 0})
            d = by_day.setdefault(day, _tok(0, 0, 0.0))
            for k in ("input_tokens", "output_tokens", "cost_usd"):
                a[k] += t[k]
                d[k] += t[k]
    device = {"id": dev_id, "hostname": host, "user": user, "os": "Linux 6", "arch": "x86_64"}
    if team:
        device["team"] = team
    findings = findings or []
    return {
        "schema": "aiwarden.report/v1", "aiwarden_version": "0.1.0", "generated_at": generated_at, "device": device,
        "apps": apps or [], "mcp_servers": servers or [], "browser_extensions": [], "claude": None,
        "usage": {"by_app": by_app, "by_model": {}, "by_day": by_day, "by_project": {}, "tools": {},
                  "mcp_calls": mcp_calls or {}, "risky_events": [], "sessions": sessions or [],
                  "by_day_app": days, "by_day_model": {}, "cost": {"total_usd": sum(d["cost_usd"] for d in by_day.values())}},
        "guard_events": guard or [], "findings": findings, "graph": {"nodes": [], "edges": []},
        "summary": {"apps": len(apps or []), "running": 0, "mcp_servers": len(servers or []), "remote_mcp_servers": 0,
                    "plaintext_secrets": sum(1 for f in findings if f["rule"] == "MCP001"), "findings": {},
                    "tokens": 0, "cost_usd": 0.0, "risky_events": 0, "guard_blocks": sum(1 for g in guard or [] if g["action"] == "deny"),
                    "guard_installed": True},
    }


def _sess(sid, app, start, servers, tokens=1000, cost=0.01, project="/w/app"):
    return {"app": app, "id": sid, "project": project, "start": start, "end": start, "models": ["claude-sonnet-4-5"],
            "model_tokens": {}, "input_tokens": tokens, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0,
            "cost_usd": cost, "tool_calls": 3, "mcp_servers": servers}


def _finding(rule, sev, subject="mcp:x", title="t"):
    return {"rule": rule, "severity": sev, "title": title, "subject": subject, "detail": "", "location": ""}


def fleet():
    """Platform team (alice): tokens tripled Oct vs Sep. Data team (bob): flat. carol: no team in report."""
    alice = mk_report(
        "dev-alice", "alice", "alice-mbp", team="platform",
        days={"2026-09-05": {"claude-code": _tok(1000, 0, 1.0)},
              "2026-09-12": {"claude-code": _tok(1000, 0, 1.0)},
              "2026-10-05": {"claude-code": _tok(3000, 0, 3.0)},
              "2026-10-12": {"claude-code": _tok(2000, 0, 2.0), "codex": _tok(1000, 0, 1.0)},
              "2026-10-22": {"claude-code": _tok(400, 0, 0.4)},
              "2026-10-23": {"claude-code": _tok(4000, 0, 4.0)}},
        sessions=[_sess("s-a1", "claude-code", "2026-10-12T09:00:00Z", ["github", "linear"]),
                  _sess("s-a2", "claude-code", "2026-10-05T09:00:00Z", ["postgres"]),
                  _sess("s-a3", "codex", "2026-10-12T10:00:00Z", ["github"])],
        findings=[_finding("MCP001", "high", "mcp:claude-code:user:github", "Plaintext github token in MCP config 'github'")],
        apps=[{"id": "claude-code", "name": "Claude Code", "vendor": "Anthropic", "kind": "cli", "running": False},
              {"id": "codex", "name": "Codex CLI", "vendor": "OpenAI", "kind": "cli", "running": False}],
        servers=[{"id": "mcp:claude-code:user:github", "client": "claude-code", "scope": "user", "name": "github",
                  "transport": "stdio", "package": "@modelcontextprotocol/server-github", "url": None, "command": "npx",
                  "secrets": [{"field": "env.GITHUB_TOKEN", "kind": "github_token", "redacted": "ghp_QQ…(40 chars)"}]}],
        guard=[{"ts": "2026-10-22T10:00:00+00:00", "app": "claude-code", "session": "s", "tool": "Bash", "action": "deny",
                "rule": "GRD001", "would_be": None}] * 3,
        mcp_calls={"github": {"create_issue": 4, "get_pr": 2}, "postgres": {"query": 1}})
    bob = mk_report(
        "dev-bob", "bob", "bob-laptop", team="data",
        days={"2026-09-10": {"claude-code": _tok(5000, 0, 5.0)},
              "2026-10-10": {"claude-code": _tok(5000, 0, 5.0)},
              "2026-10-22": {"gemini-cli": _tok(500, 0, 0.5)},
              "2026-10-23": {"gemini-cli": _tok(500, 0, 0.5)}},
        sessions=[_sess("s-b1", "claude-code", "2026-10-10T09:00:00Z", ["sentry"])],
        findings=[_finding("MCP002", "medium"), _finding("AGT001", "high", "app:claude-code")],
        apps=[{"id": "claude-code", "name": "Claude Code", "vendor": "Anthropic", "kind": "cli", "running": True},
              {"id": "gemini-cli", "name": "Gemini CLI", "vendor": "Google", "kind": "cli", "running": False}],
        servers=[{"id": "mcp:gemini-cli:user:search", "client": "gemini-cli", "scope": "user", "name": "search",
                  "transport": "http", "package": None, "url": "https://search.example.com/mcp", "command": None, "secrets": []}],
        mcp_calls={"sentry": {"get_issue": 2}})
    carol = mk_report("dev-carol", "carol", "carol-pc",
                      days={"2026-10-15": {"claude-code": _tok(100, 0, 0.1)}},
                      sessions=[_sess("s-c1", "claude-code", "2026-10-15T09:00:00Z", ["github"])])
    return [alice, bob, carol]
