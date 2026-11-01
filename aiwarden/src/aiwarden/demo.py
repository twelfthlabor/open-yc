"""A synthetic six-device fleet for the console demo (web/scripts/demo.py and the hosted demo in api/).

Every host, user, token, finding and number here is made up; nothing on this machine is read.
Dates are relative to today, so the demo always looks current.
"""
from __future__ import annotations

import random
from datetime import date, datetime, timedelta, timezone

from .risk import is_pinned

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
    ("internal-tools", "http", None, "http://tools.corp.example.com/mcp"),
    ("slack", "stdio", "slack-mcp-server@latest", None),
]
PROJECTS = ["~/code/api", "~/code/web-app", "~/code/infra", "~/code/data-pipeline", "~/code/mobile"]
FLEET = [
    ("dev-maya", "maya", "maya-mbp", "platform", "macOS 16.1", ["claude-code", "cursor", "claude-desktop"], [0, 1, 3, 6], 1.6, True),
    ("dev-omar", "omar", "omar-xps", "platform", "Ubuntu 26.04", ["claude-code", "codex"], [0, 2, 4], 1.1, True),
    ("dev-lena", "lena", "lena-thinkpad", "data", "Windows 11", ["claude-code", "gemini-cli", "vscode"], [1, 2, 7], 0.9, True),
    ("dev-ravi", "ravi", "ravi-mbp", "data", "macOS 16.1", ["codex", "cursor"], [0, 5], 0.5, False),
    ("dev-june", "june", "june-air", "design", "macOS 15.6", ["claude-desktop", "cursor"], [5], 0.25, True),
    ("dev-theo", "theo", "build-01", None, "Ubuntu 24.04", ["claude-code"], [0, 2], 0.7, False),
]
MCP_TOOLS = {"github": ["create_issue", "search_code", "get_pull_request", "list_commits"], "postgres": ["query", "list_tables"],
             "filesystem": ["read_file", "write_file", "list_directory"], "linear": ["list_issues", "create_issue", "update_issue"],
             "sentry": ["get_issue", "search_events"], "browser": ["browser_navigate", "browser_click", "browser_snapshot"],
             "internal-tools": ["deploy", "get_status", "rollback"], "slack": ["post_message", "search_messages"]}
RISKY = [("GRD020", "deny", "Bash", "Force-push to, or deletion of, a protected branch"),
         ("GRD041", "ask", "Read", "Reading a .env file"),
         ("GRD011", "ask", "mcp__postgres__query", "Destructive SQL (DROP TABLE, TRUNCATE, DELETE without WHERE)"),
         ("GRD051", "ask", "Bash", "Secret in a command or tool call that leaves the machine"),
         ("GRD070", "ask", "Edit", "Agent modifying its own permission or guard config"),
         ("GRD001", "deny", "Bash", "Recursive delete of a root, home or wildcard path"),
         ("GRD030", "deny", "Bash", "Piping a downloaded script into a shell")]
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
                             "subject": f"mcp:{client}:user:{name}", "detail": f"{secrets[0]['field']} = {secrets[0]['redacted']}. Move it to an env var or secret store.",
                             "location": f"~/.claude.json > mcpServers.{name}.env"})
        if pkg and not is_pinned("npx", pkg):
            findings.append({"rule": "MCP003", "severity": "low", "title": f"MCP server '{name}' runs an unpinned package",
                             "subject": f"mcp:{client}:user:{name}",
                             "detail": f"`npx {pkg}` fetches whatever version is latest at launch (supply-chain risk). Pin a version.",
                             "location": "~/.claude.json"})
        if url and url.startswith("http://"):
            host_ = url.split("/")[2]
            findings.append({"rule": "MCP002", "severity": "medium", "title": f"Remote MCP server '{name}' uses unencrypted HTTP",
                             "subject": f"mcp:{client}:user:{name}",
                             "detail": f"{host_}: tool calls, results and auth headers travel in clear text.", "location": "~/.claude.json"})
        servers.append({"id": f"mcp:{client}:user:{name}", "client": client, "scope": "user", "name": name, "transport": transport,
                        "package": pkg, "url": url, "command": "npx" if pkg else None, "secrets": secrets})
    if "claude-code" in apps and dev_id in ("dev-omar", "dev-theo"):
        findings.append({"rule": "AGT001", "severity": "high", "title": "Claude Code may run any shell command without asking",
                         "subject": "app:claude-code", "detail": "permissions.allow contains ['Bash(*)'].", "location": "~/.claude/settings.json"})
    # the same rules, severities and wording src/aiwarden/risk.py produces, so the demo shows what a real scan shows
    if dev_id == "dev-theo":
        findings.append({"rule": "AGT002", "severity": "high", "title": "Claude Code defaults to bypassPermissions",
                         "subject": "app:claude-code", "detail": "All tool calls run without confirmation.", "location": "~/.claude/settings.json"})
    if not guard_on and "claude-code" in apps:
        findings.append({"rule": "AGT004", "severity": "info", "title": "No pre-execution guard on Claude Code", "subject": "app:claude-code",
                         "detail": "Run `aiwarden hooks install` to block destructive commands and secret leaks before they run.",
                         "location": "~/.claude/settings.json"})
    findings.append({"rule": "EXT001", "severity": "medium", "title": "AI browser extension 'Monica - Your AI Copilot' can read every site",
                     "subject": "ext:chrome:monica",
                     "detail": "It has <all_urls>-style access: page contents, including internal apps, can reach a third-party AI.",
                     "location": "chrome/Default"})

    guard = []
    if guard_on:
        for _ in range(rng.randint(3, 14)):
            rule, action, tool = rng.choice(GUARD_RULES)
            ts = (NOW - timedelta(hours=rng.uniform(1, 24 * 12))).isoformat()
            guard.append({"ts": ts, "app": rng.choice(agent_apps or ["claude-code"]), "session": "s", "tool": tool, "action": action,
                          "rule": rule, "would_be": None})
    risky = [{"timestamp": (NOW - timedelta(days=rng.uniform(0, 20))).isoformat(), "app": "claude-code", "tool": "Bash", "rule": "GRD020",
              "action": "deny", "subject": "git push --force origin main"}] if "claude-code" in apps else []

    # Everything below draws from its own generator, so adding detail here never shifts the numbers above.
    xr = random.Random(f"{dev_id}-detail")
    if risky:
        risky[0].update(reason=RISKY[0][3], project="~/code/api", session=f"{dev_id}-r0")
    for k in range(xr.randint(2, 9) if agent_apps else 0):
        rule, action, tool, reason = xr.choice(RISKY[1:])
        risky.append({"timestamp": (NOW - timedelta(days=xr.uniform(0, 28), hours=xr.uniform(0, 9))).isoformat(),
                      "app": xr.choice(agent_apps), "tool": tool, "rule": rule, "action": action, "reason": reason,
                      "project": xr.choice(PROJECTS), "session": f"{dev_id}-r{k + 1}"})
    for sess in sessions:
        sess["project"] = xr.choice(PROJECTS)
        hour = xr.choice([9, 10, 10, 11, 11, 13, 14, 14, 15, 16, 16, 17, 20, 22])
        sess["start"] = f"{sess['start'][:10]}T{hour:02d}:{xr.randint(0, 59):02d}:00Z"
        sess["end"] = f"{sess['start'][:10]}T{min(23, hour + xr.randint(0, 3)):02d}:{xr.randint(0, 59):02d}:00Z"
    by_project: dict = {}
    for sess in sessions:
        b = by_project.setdefault(sess["project"], {"input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "cost_usd": 0.0})
        for k in ("input_tokens", "output_tokens", "cache_read_tokens"):
            b[k] += sess[k]
        b["cost_usd"] = round(b["cost_usd"] + sess["cost_usd"], 4)
    tools = {t: int(n * scale * xr.uniform(0.6, 1.4)) for t, n in (("Bash", 900), ("Read", 1400), ("Edit", 600), ("Grep", 520), ("Glob", 260),
                                                                   ("Write", 180), ("TodoWrite", 140), ("Task", 60), ("WebFetch", 45))} if agent_apps else {}
    mcp_calls = {}
    for i in server_idx:
        name = SERVERS[i][0]
        if agent_apps and xr.random() < 0.8:
            mcp_calls[name] = {t: xr.randint(2, int(60 * scale) + 3) for t in xr.sample(MCP_TOOLS[name], xr.randint(1, len(MCP_TOOLS[name])))}
            for t, n in mcp_calls[name].items():
                tools[f"mcp__{name}__{t}"] = n
    unpriced = []
    if "gemini-cli" in apps:  # a preview model with no list price, as real Gemini users often have
        by_model["gemini-3-flash-preview"] = {"input_tokens": int(400_000 * scale), "output_tokens": int(30_000 * scale), "cache_read_tokens": 0,
                                              "cache_write_tokens": 0, "cost_usd": 0.0, "messages": xr.randint(40, 300)}
        unpriced = ["gemini-3-flash-preview"]
    claude = None
    if "claude-code" in apps:
        hooks = [{"event": "Stop", "matcher": "", "command": "notify-send 'Claude finished'", "scope": "user", "path": "~/.claude/settings.json"}]
        if guard_on:
            hooks.insert(0, {"event": "PreToolUse", "matcher": "*", "command": "aiwarden guard", "scope": "user", "path": "~/.claude/settings.json"})
        if dev_id == "dev-maya":
            hooks.append({"event": "SessionStart", "matcher": "", "command": "./scripts/context.sh", "scope": "project", "path": "~/code/api/.claude/settings.json"})
        claude = {"settings_files": ["~/.claude/settings.json"],
                  "permissions": {"allow": ["Bash(*)"] if dev_id in ("dev-omar", "dev-theo") else ["Bash(npm test:*)", "Read"],
                                  "defaultMode": "bypassPermissions" if dev_id == "dev-theo" else "default"},
                  "hooks": hooks,
                  "skills": [{"name": sk, "description": "", "scope": "user", "path": f"~/.claude/skills/{sk}"} for sk in ("deploy", "review-pr")[: 1 + (dev_id == "dev-maya")]],
                  "agents": ["code-reviewer"] + (["db-migrator"] if dev_id == "dev-maya" else []),
                  "plugins": sorted(xr.sample(["github@claude-plugins", "vercel@claude-plugins", "linear@claude-plugins", "sentry@claude-plugins"], 2)),
                  "guard_installed": guard_on}

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
        app = next((a for a in agent_apps if m in MODELS[a]), "gemini-cli")
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
        edges[-1]["meta"] = {"scope": "user", "calls": sum((mcp_calls.get(s["name"]) or {}).values())}
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
    node("ext:chrome:monica", "extension", "Monica - Your AI Copilot", max_severity="medium", findings=1)
    edge("browser:chrome", "ext:chrome:monica", "has_extension")
    for k in ("app:claude-code",):
        if k in nodes and k in sev_by_subject:
            nodes[k]["meta"].update(max_severity=min(sev_by_subject[k], key=order.index), findings=len(sev_by_subject[k]))

    sev_counts = {s: sum(1 for f in findings if f["severity"] == s) for s in order}
    total_tokens = sum(v["input_tokens"] + v["output_tokens"] for v in by_app.values())
    device = {"id": dev_id, "hostname": host, "user": user, "os": os_, "arch": "arm64" if "macOS" in os_ else "x86_64"}
    if team:
        device["team"] = team
    generated_at = (NOW - timedelta(minutes=rng.randint(3, 400))).isoformat()
    app_rows = [{"id": a, "name": APPS[a][0], "vendor": APPS[a][1], "kind": APPS[a][2], "running": rng.random() < 0.5} for a in apps]
    _ = [rng.randint(2, 80) for _s in servers if rng.random() < 0.7]  # the draws an older version used, so later devices keep their numbers
    return {
        "schema": "aiwarden.report/v1", "aiwarden_version": "0.1.0",
        "generated_at": generated_at, "device": device,
        "apps": app_rows,
        "mcp_servers": servers,
        "browser_extensions": [{"browser": "chrome", "name": "Monica - Your AI Copilot", "version": "6.4.1", "broad_access": True}],
        "claude": claude,
        "usage": {"by_app": by_app, "by_model": by_model, "by_day": dict(sorted(by_day.items())), "by_project": by_project,
                  "tools": tools, "mcp_calls": mcp_calls,
                  "risky_events": risky, "sessions": sessions[:200], "by_day_app": by_day_app, "by_day_model": by_day_model,
                  "cost": {"total_usd": round(sum(v["cost_usd"] for v in by_app.values()), 2), "prices_as_of": "2026-10-06",
                           "unpriced_models": unpriced}},
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
