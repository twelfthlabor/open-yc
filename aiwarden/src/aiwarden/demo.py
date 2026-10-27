"""A synthetic six-device fleet for the console demo (web/scripts/demo.py and the hosted demo in api/).

Every host, user, token, finding and number here is made up; nothing on this machine is read.
Dates are relative to today, so the demo always looks current.
"""
from __future__ import annotations

import random
from datetime import date, datetime, timedelta, timezone

TODAY = date.today()
NOW = datetime.now(timezone.utc).replace(microsecond=0)

APPS = {
    "claude-code": ("Claude Code", "Anthropic", "cli"),
    "codex": ("Codex CLI", "OpenAI", "cli"),
    "gemini-cli": ("Gemini CLI", "Google", "cli"),
    "cursor": ("Cursor", "Anysphere", "ide"),
    "claude-desktop": ("Claude Desktop", "Anthropic", "desktop"),
    "vscode": ("VS Code + Copilot", "Microsoft", "ide"),
}
MODELS = {"claude-code": ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"], "codex": ["gpt-6"], "gemini-cli": ["gemini-3-pro"]}
PRICES = {"claude-sonnet-5-5": (3, 15), "claude-opus-5-5": (15, 75), "claude-haiku-5-5": (1, 5), "gpt-6": (2.5, 10), "gemini-3-pro": (2, 12)}
SERVERS = [
    ("github", "stdio", "@modelcontextprotocol/server-github", None),
    ("postgres", "stdio", "@modelcontextprotocol/server-postgres", None),
    ("filesystem", "stdio", "@modelcontextprotocol/server-filesystem", None),
    ("linear", "http", None, "https://mcp.linear.app/sse"),
    ("sentry", "http", None, "https://mcp.sentry.dev/mcp"),
    ("browser", "stdio", "@playwright/mcp", None),
    ("internal-tools", "http", None, "https://tools.corp.example.com/mcp"),
    ("slack", "stdio", "slack-mcp-server@latest", None),
]
FLEET = [
    ("dev-maya", "maya", "maya-mbp", "platform", "macOS 16.1", ["claude-code", "cursor", "claude-desktop"], [0, 1, 3, 6], 1.6, True),
    ("dev-omar", "omar", "omar-xps", "platform", "Ubuntu 26.04", ["claude-code", "codex"], [0, 2, 4], 1.1, True),
    ("dev-lena", "lena", "lena-thinkpad", "data", "Windows 11", ["claude-code", "gemini-cli", "vscode"], [1, 2, 7], 0.9, True),
    ("dev-ravi", "ravi", "ravi-mbp", "data", "macOS 16.1", ["codex", "cursor"], [0, 5], 0.5, False),
    ("dev-june", "june", "june-air", "design", "macOS 15.6", ["claude-desktop", "cursor"], [5], 0.25, True),
    ("dev-theo", "theo", "build-01", None, "Ubuntu 24.04", ["claude-code"], [0, 2], 0.7, False),
]
GUARD_RULES = [("GRD020", "deny", "Bash"), ("GRD001", "deny", "Bash"), ("GRD041", "ask", "Read"), ("GRD030", "deny", "Bash"),
               ("GRD011", "ask", "mcp__postgres__query"), ("GRD050", "deny", "Bash")]


def tok(rng, scale):
    i = int(rng.uniform(40_000, 900_000) * scale)
    return i, int(i * rng.uniform(0.05, 0.14)), int(i * rng.uniform(2, 6))


def report(dev_id, user, host, team, os_, apps, server_idx, scale, guard_on, rng) -> dict:
    by_day, by_app, by_model, by_day_app, by_day_model, sessions = {}, {}, {}, {}, {}, []
    agent_apps = [a for a in apps if a in MODELS]
    for back in range(75):
        d = (TODAY - timedelta(days=back)).isoformat()
        weekday = (TODAY - timedelta(days=back)).weekday() < 5
        for a in agent_apps:
            if rng.random() > (0.85 if weekday else 0.25):
                continue
            ramp = 1.0 + (2.2 if dev_id == "dev-maya" and back < 9 else 0)  # a visible spike for alerts/ask
            inp, out, cache = tok(rng, scale * ramp)
            model = rng.choice(MODELS[a])
            pin, pout = PRICES[model]
            cost = round(inp / 1e6 * pin + out / 1e6 * pout + cache / 1e6 * pin * 0.1, 4)
            t = {"input_tokens": inp, "output_tokens": out, "cache_read_tokens": cache, "cache_write_tokens": 0, "cost_usd": cost}
            for bucket, key in ((by_day, d), (by_app, a), (by_model, model)):
                b = bucket.setdefault(key, {"input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "cost_usd": 0.0})
                for k, v in t.items():
                    b[k] = round(b[k] + v, 4) if k == "cost_usd" else b[k] + v
            by_day_app.setdefault(d, {})[a] = t
            by_day_model.setdefault(d, {})[model] = t
            srv = [SERVERS[i][0] for i in server_idx if rng.random() < 0.5]
            sessions.append({"app": a, "id": f"{dev_id}-{d}-{a}", "project": rng.choice(["/work/api", "/work/web", "/work/infra"]),
                             "start": f"{d}T{rng.randint(8, 18):02d}:{rng.randint(0, 59):02d}:00Z", "end": f"{d}T19:00:00Z",
                             "models": [model], "model_tokens": {}, "input_tokens": inp, "output_tokens": out, "cache_read_tokens": cache,
                             "cache_write_tokens": 0, "cost_usd": cost, "tool_calls": rng.randint(4, 90), "mcp_servers": srv})
    for a, v in by_app.items():
        v["sessions"] = sum(1 for s in sessions if s["app"] == a)
        v["tool_calls"] = sum(s["tool_calls"] for s in sessions if s["app"] == a)
    for m, v in by_model.items():
        v["messages"] = rng.randint(200, 4000)

    servers, findings = [], []
    for i in server_idx:
        name, transport, pkg, url = SERVERS[i]
        client = rng.choice([a for a in apps if a != "vscode"] or apps)
        secrets = []
        if name in ("github", "slack") and dev_id in ("dev-maya", "dev-theo", "dev-lena"):
            secrets = [{"field": "env.GITHUB_TOKEN" if name == "github" else "env.SLACK_BOT_TOKEN", "kind": f"{name}_token",
                        "redacted": "ghp_Xq…(40 chars)" if name == "github" else "xoxb-…(57 chars)"}]
            findings.append({"rule": "MCP001", "severity": "high", "title": f"Plaintext {name} token in MCP config '{name}'",
                             "subject": f"mcp:{client}:user:{name}", "detail": "Move it to the OS keychain or an env var the agent cannot read.",
                             "location": f"~/.claude.json > mcpServers.{name}.env"})
        if pkg and pkg.endswith("@latest"):
            findings.append({"rule": "MCP004", "severity": "medium", "title": f"MCP server '{name}' runs an unpinned package",
                             "subject": f"mcp:{client}:user:{name}", "detail": f"{pkg} resolves to whatever is newest at launch.", "location": ""})
        if url and "corp.example.com" in url:
            findings.append({"rule": "MCP003", "severity": "medium", "title": f"Remote MCP server '{name}' over a non-vendor host",
                             "subject": f"mcp:{client}:user:{name}", "detail": url, "location": ""})
        servers.append({"id": f"mcp:{client}:user:{name}", "client": client, "scope": "user", "name": name, "transport": transport,
                        "package": pkg, "url": url, "command": "npx" if pkg else None, "secrets": secrets})
    if "claude-code" in apps and dev_id in ("dev-omar", "dev-theo"):
        findings.append({"rule": "AGT001", "severity": "high", "title": "Claude Code allows every Bash command without asking",
                         "subject": "app:claude-code", "detail": 'permissions.allow contains "Bash(*)"', "location": "~/.claude/settings.json"})
    if dev_id == "dev-theo":
        findings.append({"rule": "AGT003", "severity": "critical", "title": "Agent runs with --dangerously-skip-permissions in a shell alias",
                         "subject": "app:claude-code", "detail": "alias cc='claude --dangerously-skip-permissions'", "location": "~/.bashrc"})
    if not guard_on:
        findings.append({"rule": "GRD000", "severity": "low", "title": "Guard hook is not installed", "subject": "device",
                         "detail": "Run aiwarden hooks install --agent all", "location": ""})
    findings.append({"rule": "EXT002", "severity": "info", "title": "AI browser extension with access to all sites",
                     "subject": "ext:chrome:monica", "detail": "Monica - Your AI Copilot", "location": "Chrome Default profile"})

    guard = []
    if guard_on:
        for _ in range(rng.randint(3, 14)):
            rule, action, tool = rng.choice(GUARD_RULES)
            ts = (NOW - timedelta(hours=rng.uniform(1, 24 * 12))).isoformat()
            guard.append({"ts": ts, "app": rng.choice(agent_apps or ["claude-code"]), "session": "s", "tool": tool, "action": action,
                          "rule": rule, "would_be": None})
    risky = [{"timestamp": (NOW - timedelta(days=rng.uniform(0, 20))).isoformat(), "app": "claude-code", "tool": "Bash", "rule": "GRD020",
              "action": "deny", "subject": "git push --force origin main"}] if "claude-code" in apps else []

    nodes, edges = {}, []

    def node(i, t, label, **meta):
        nodes[i] = {"id": i, "type": t, "label": label, "meta": meta}

    def edge(s, t, typ):
        edges.append({"source": s, "target": t, "type": typ, "meta": {}})

    node(f"device:{dev_id}", "device", host, os=os_)
    node(f"user:{user}", "user", user)
    edge(f"user:{user}", f"device:{dev_id}", "uses")
    for a in apps:
        node(f"app:{a}", "app", APPS[a][0])
        edge(f"device:{dev_id}", f"app:{a}", "has_app")
    for m in by_model:
        app = next(a for a in agent_apps if m in MODELS[a])
        node(f"model:{m}", "model", m)
        edge(f"app:{app}", f"model:{m}", "uses_model")
    sev_by_subject = {}
    for f in findings:
        sev_by_subject.setdefault(f["subject"], []).append(f["severity"])
    order = ["critical", "high", "medium", "low", "info"]
    for s in servers:
        sev = sev_by_subject.get(s["id"])
        node(s["id"], "mcp", s["name"], **({"max_severity": min(sev, key=order.index), "findings": len(sev)} if sev else {}))
        edge(f"app:{s['client']}", s["id"], "configures")
        if s["package"]:
            node(f"pkg:{s['package']}", "package", s["package"])
            edge(s["id"], f"pkg:{s['package']}", "runs")
        else:
            h = s["url"].split("/")[2]
            node(f"host:{h}", "host", h)
            edge(s["id"], f"host:{h}", "connects_to")
    if "claude-code" in apps:
        for sk in ("deploy", "review-pr")[: 1 + (dev_id == "dev-maya")]:
            node(f"skill:{sk}", "skill", sk)
            edge("app:claude-code", f"skill:{sk}", "has_skill")
    node("browser:chrome", "browser", "Chrome")
    edge(f"device:{dev_id}", "browser:chrome", "has_browser")
    node("ext:chrome:monica", "extension", "Monica - Your AI Copilot", max_severity="info", findings=1)
    edge("browser:chrome", "ext:chrome:monica", "has_extension")
    for k in ("app:claude-code",):
        if k in nodes and k in sev_by_subject:
            nodes[k]["meta"].update(max_severity=min(sev_by_subject[k], key=order.index), findings=len(sev_by_subject[k]))

    sev_counts = {s: sum(1 for f in findings if f["severity"] == s) for s in order}
    total_tokens = sum(v["input_tokens"] + v["output_tokens"] for v in by_app.values())
    device = {"id": dev_id, "hostname": host, "user": user, "os": os_, "arch": "arm64" if "macOS" in os_ else "x86_64"}
    if team:
        device["team"] = team
    return {
        "schema": "aiwarden.report/v1", "aiwarden_version": "0.1.0",
        "generated_at": (NOW - timedelta(minutes=rng.randint(3, 400))).isoformat(), "device": device,
        "apps": [{"id": a, "name": APPS[a][0], "vendor": APPS[a][1], "kind": APPS[a][2], "running": rng.random() < 0.5} for a in apps],
        "mcp_servers": servers,
        "browser_extensions": [{"browser": "chrome", "name": "Monica - Your AI Copilot", "version": "6.4.1", "broad_access": True}],
        "claude": None,
        "usage": {"by_app": by_app, "by_model": by_model, "by_day": dict(sorted(by_day.items())), "by_project": {},
                  "tools": {"Bash": 900, "Read": 1400, "Edit": 600, "mcp__github__create_issue": 22},
                  "mcp_calls": {s["name"]: {"call": rng.randint(2, 80)} for s in servers if rng.random() < 0.7},
                  "risky_events": risky, "sessions": sessions[:200], "by_day_app": by_day_app, "by_day_model": by_day_model,
                  "cost": {"total_usd": round(sum(v["cost_usd"] for v in by_app.values()), 2), "prices_as_of": "2026-10-01"}},
        "guard_events": guard, "findings": findings, "graph": {"nodes": list(nodes.values()), "edges": edges},
        "summary": {"apps": len(apps), "running": 1, "mcp_servers": len(servers),
                    "remote_mcp_servers": sum(1 for s in servers if s["url"]),
                    "plaintext_secrets": sum(len(s["secrets"]) for s in servers), "findings": sev_counts, "tokens": total_tokens,
                    "cost_usd": round(sum(v["cost_usd"] for v in by_app.values()), 2), "risky_events": len(risky),
                    "guard_blocks": sum(1 for g in guard if g["action"] == "deny"), "guard_installed": guard_on},
    }


def browser_batch(rng) -> dict:
    sites = ["chatgpt.com", "claude.ai", "gemini.google.com", "perplexity.ai", "chat.deepseek.com"]
    usage = {}
    for back in range(21):
        d = (TODAY - timedelta(days=back)).isoformat()
        usage[d] = {s: {"seconds": rng.randint(60, 5400), "visits": rng.randint(1, 30)} for s in sites if rng.random() < 0.7}
    events = []
    for i in range(18):
        det = rng.choice([{"aws_access_key": 1}, {"credit_card": 2}, {"email_list": 40}, {"private_key": 1}, {"github_token": 1}])
        action = "block" if "private_key" in det or "aws_access_key" in det else "warn"
        decision = "blocked" if action == "block" else rng.choice(["sent_anyway", "cancelled"])
        events.append({"event_id": f"evt-{i:04d}-demo", "ts": (NOW - timedelta(hours=rng.uniform(1, 300))).isoformat(),
                       "site": rng.choice(sites[:3]), "channel": rng.choice(["paste", "submit", "file"]), "action": action,
                       "decision": decision, "detectors": det})
    return {"schema": "aiwarden.browser-events/v1",
            "profile": {"id": "prof-maya-chrome", "browser": "chrome", "label": "maya work", "extension_version": "0.1.0", "device_id": "dev-maya"},
            "events": events, "usage": usage}


def populate(store, seed: int = 7) -> None:
    """Fill a server.Store with the demo fleet and one browser profile."""
    rng = random.Random(seed)
    for row in FLEET:
        store.add(report(*row, rng))
    store.add_browser(browser_batch(rng))


DEMO_CONFIG = {"teams": {"infra": ["host:build-01"]}}
