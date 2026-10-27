"""aiwarden command line."""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets as pysecrets
import sys
from datetime import date, timedelta
from pathlib import Path

from . import __version__
from .env import Env
from .risk import SEVERITY_ORDER

POLICY_TEMPLATE = """\
# aiwarden guard policy. Built-in rules: run `aiwarden rules`.
# mode = "enforce" blocks/asks; "monitor" only logs what would have happened.
mode = "enforce"

# Commands matching any of these regexes skip the built-in shell rules.
allow_commands = []

# Gemini CLI and Codex hooks cannot ask the user, so an "ask" becomes this: "deny" or "allow".
ask_fallback = "deny"

[rules]
# Override any built-in rule: "deny", "ask", "allow" or "off".
# GRD011 = "deny"   # destructive SQL: always block instead of asking
# GRD041 = "off"    # stop asking before agents read .env files

# Custom rules: regex over the shell command (shell tools), the file path (file tools)
# or the JSON input (MCP tools).
# [[custom]]
# id = "CUS001"
# action = "deny"
# tools = ["Bash", "PowerShell"]
# pattern = "kubectl\\\\s+delete"
# reason = "kubectl delete is not allowed from agents"
"""


def _env(args) -> Env:
    if args.home:
        return Env.for_home(Path(args.home), platform=args.platform, cwd=Path(args.cwd) if args.cwd else None)
    env = Env.current()
    if args.cwd:
        env = Env(env.home, env.platform, env.appdata, env.localappdata, Path(args.cwd))
    return env


def _processes(args):
    """Scanning another home (--home) must not mix in this machine's running processes."""
    return [] if args.home else None


def _since(args) -> str | None:
    if getattr(args, "since", None):
        return args.since
    if getattr(args, "days", None):
        return (date.today() - timedelta(days=args.days)).isoformat()
    return None


def _fmt_n(n: int) -> str:
    for unit, div in (("B", 1e9), ("M", 1e6), ("k", 1e3)):
        if n >= div:
            return f"{n / div:.1f}{unit}"
    return str(n)


def _table(rows: list[list], header: list[str]) -> str:
    rows = [[str(c) for c in r] for r in rows]
    widths = [max([len(h)] + [len(r[i]) for r in rows]) for i, h in enumerate(header)]

    def line(r):
        return "  ".join(c.ljust(w) for c, w in zip(r, widths)).rstrip()

    return "\n".join([line(header), line(["-" * w for w in widths])] + [line(r) for r in rows])


def _fmt_usd(v) -> str:
    return "" if v is None else f"${v:,.2f}"


def _print_cost_note(u: dict) -> None:
    c = u.get("cost") or {}
    if not c:
        return
    note = f"Estimated cost: ${c.get('total_usd', 0):,.2f} at list prices as of {c.get('prices_as_of')}"
    if c.get("unpriced_models"):
        note += f"; no price for {', '.join(c['unpriced_models'])}"
    if c.get("unverified_price_models"):
        note += f"; unverified prices for {', '.join(c['unverified_price_models'])}"
    print(note + " (override in ~/.aiwarden/config.toml [prices])")


def _print_report(r: dict) -> None:
    d, s = r["device"], r["summary"]
    team = f", team {d['team']}" if d.get("team") else ""
    print(f"aiwarden {r['aiwarden_version']} - {d['hostname']} ({d['user']}{team}, {d['os']})\n")
    print(f"AI apps: {s['apps']} ({s['running']} running)   MCP servers: {s['mcp_servers']} ({s['remote_mcp_servers']} remote)   "
          f"plaintext secrets: {s['plaintext_secrets']}   guard: {'on' if s['guard_installed'] else 'off'}\n")
    if r["apps"]:
        print(_table([[a["name"], a["kind"], "yes" if a["running"] else "", a["vendor"]] for a in r["apps"]],
                     ["APP", "KIND", "RUNNING", "VENDOR"]))
        print()
    if r["mcp_servers"]:
        print(_table([[m["client"], m["scope"], m["name"], m["transport"],
                       m.get("package") or m.get("url") or m.get("command") or "", len(m["secrets"]) or ""]
                      for m in r["mcp_servers"]],
                     ["CLIENT", "SCOPE", "MCP SERVER", "TRANSPORT", "PACKAGE / URL", "SECRETS"]))
        print()
    if r["browser_extensions"]:
        print(_table([[e["browser"], e["name"], e["version"], "all sites" if e["broad_access"] else ""]
                      for e in r["browser_extensions"]], ["BROWSER", "AI EXTENSION", "VERSION", "ACCESS"]))
        print()
    u = r.get("usage")
    if u and u["by_app"]:
        print(_table([[app, v["sessions"], _fmt_n(v["input_tokens"]), _fmt_n(v["output_tokens"]),
                       _fmt_n(v["cache_read_tokens"]), v["tool_calls"], _fmt_usd(v.get("cost_usd"))] for app, v in u["by_app"].items()],
                     ["AGENT", "SESSIONS", "INPUT", "OUTPUT", "CACHE READ", "TOOL CALLS", "EST. COST"]))
        _print_cost_note(u)
        if u["mcp_calls"]:
            print("MCP calls: " + ", ".join(f"{srv} ({sum(t.values())})" for srv, t in u["mcp_calls"].items()))
        if u["risky_events"]:
            print(f"Risky actions in transcripts: {len(u['risky_events'])} "
                  f"({', '.join(sorted({e['rule'] for e in u['risky_events']}))})")
        print()
    counts = ", ".join(f"{v} {k}" for k, v in s["findings"].items() if v)
    print(f"Findings: {counts or 'none'}")
    for x in r["findings"]:
        print(f"  [{x['severity'].upper():6}] {x['rule']}  {x['title']}")
        if x["detail"]:
            print(f"           {x['detail']}")
        if x["location"]:
            print(f"           at {x['location']}")


def cmd_scan(args) -> int:
    from .report import build_report
    r = build_report(_env(args), processes=_processes(args), include_usage=not args.no_usage, since=_since(args),
                     include_content=args.include_content)
    text = json.dumps(r, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    if args.json:
        print(text)
    elif not args.out or args.verbose:
        _print_report(r)
    if args.fail_on:
        limit = SEVERITY_ORDER[args.fail_on]
        if any(SEVERITY_ORDER[x["severity"]] <= limit for x in r["findings"]):
            return 1
    return 0


def cmd_mcp(args) -> int:
    from .mcp import discover_mcp_servers
    servers = [s.to_dict() for s in discover_mcp_servers(_env(args))]
    if args.json:
        print(json.dumps(servers, indent=2))
    else:
        print(_table([[s["client"], s["scope"], s["name"], s["transport"], s.get("package") or s.get("url") or s.get("command") or "",
                       s["config_path"]] for s in servers], ["CLIENT", "SCOPE", "NAME", "TRANSPORT", "PACKAGE / URL", "CONFIG"]))
    return 0


def cmd_mcp_scan(args) -> int:
    from .mcp import discover_mcp_servers
    from .mcpscan import run_scan
    servers = discover_mcp_servers(_env(args))
    connect = []
    if args.connect:
        if args.all and not args.yes:
            print("--all starts every configured MCP server (stdio servers run as local programs). "
                  "Re-run with --all --yes to confirm, or name servers with --name.", file=sys.stderr)
            return 2
        if not args.all and not args.name:
            print("--connect needs --name NAME (repeatable) or --all --yes", file=sys.stderr)
            return 2
        connect = [s for s in servers if not s.disabled] if args.all else [s for s in servers if s.name in set(args.name)]
        missing = set(args.name or []) - {s.name for s in servers}
        if missing:
            print(f"no configured MCP server named: {', '.join(sorted(missing))}", file=sys.stderr)
            return 2
    offline = None
    if args.tools_file:
        try:
            data = json.loads(Path(args.tools_file).read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            print(f"--tools-file: {e}", file=sys.stderr)
            return 2
        tools = data.get("tools", data.get("result", {}).get("tools", [])) if isinstance(data, dict) else data
        offline = {Path(args.tools_file).stem: tools if isinstance(tools, list) else []}
    result = run_scan(servers, connect, timeout=args.timeout, offline_tools=offline)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for s in result["servers"]:
            if s["connected"]:
                print(f"connected {s['name']} ({s['client']}): {len(s['tools'])} tools")
            elif "error" in s:
                print(f"could not list tools for {s['name']} ({s['client']}): {s['error']}")
        if not connect and not offline:
            print("static checks only; add --connect --name NAME to fetch and analyse tool definitions")
        print(f"\nFindings: {len(result['findings']) or 'none'}")
        for f in result["findings"]:
            where = f"{f['server']}" + (f".{f['tool']}" if f.get("tool") else "")
            print(f"  [{f['severity'].upper():8}] {f['rule']}  {where}: {f['title']}")
            print(f"             {f['detail']}")
            if f.get("source"):
                print(f"             source: {f['source']}")
    if args.fail_on:
        limit = SEVERITY_ORDER[args.fail_on]
        if any(SEVERITY_ORDER[f["severity"]] <= limit for f in result["findings"]):
            return 1
    return 0


def _fleet_source(args) -> tuple[list[dict], dict]:
    """Reports to analyse (--server collector, --report files, or this device) plus the team/price config."""
    from .config import config_path, load_config, merge_teams
    from .fleetdata import fetch_collector_reports, load_report_files
    env = _env(args)
    config = merge_teams(load_config(config_path(env)), load_config(Path(args.teams)) if args.teams else None)
    if args.server:
        token = args.token or os.environ.get("AIWARDEN_TOKEN")
        if not token:
            raise SystemExit("missing --token (or AIWARDEN_TOKEN) for --server")
        return fetch_collector_reports(args.server, token), config
    if args.report:
        return load_report_files(args.report), config
    from .report import build_report
    return [build_report(env, processes=_processes(args))], config


def _print_rows(rows: list[dict], value_label: str = "VALUE") -> None:
    if not rows:
        print("(no results)")
        return
    keys = list(dict.fromkeys(k for r in rows for k in r))

    def fmt(v):
        if isinstance(v, float):
            return f"{v:,.4f}".rstrip("0").rstrip(".")
        if isinstance(v, list):
            return ",".join(map(str, v))
        return "-" if v is None else str(v)

    print(_table([[fmt(r.get(k)) for k in keys] for r in rows], [value_label if k == "value" else k.upper() for k in keys]))


def cmd_ask(args) -> int:
    from .fleetdata import build_facts
    from .query import run_query, translate, validate_query
    as_of = args.as_of or date.today().isoformat()
    if args.query:
        try:
            query, how = validate_query(json.loads(args.query)), "structured"
        except ValueError as e:
            print(f"--query: {e}", file=sys.stderr)
            return 2
    elif args.question:
        query, how = translate(" ".join(args.question), as_of, "llm" if args.llm else "parser" if args.no_llm else "auto")
        if query is None:
            print(f"could not understand the question ({how}). Supported patterns: see `aiwarden ask --help`, "
                  "pass a structured --query, or set ANTHROPIC_API_KEY for LLM translation.", file=sys.stderr)
            return 2
    else:
        print("give a question or --query JSON", file=sys.stderr)
        return 2
    reports, config = _fleet_source(args)
    res = run_query(query, build_facts(reports, config), as_of)
    res["translated_by"] = how
    if args.json:
        print(json.dumps(res, indent=2))
        return 0
    print(f"query ({how}): {json.dumps(query)}")
    if res.get("window"):
        span = f"{res['window']['since']}..{res['window']['until']}"
        if res.get("previous_window"):
            span += f" vs {res['previous_window']['since']}..{res['previous_window']['until']}"
        print(f"window: {span}")
    for n in res["notes"]:
        print(f"note: {n}")
    print()
    _print_rows(res["rows"], query["metric"].upper())
    return 0


def cmd_alerts(args) -> int:
    from .alerts import evaluate_alerts, load_state, post_webhook, save_state, slack_payload
    env = _env(args)
    reports, config = _fleet_source(args)
    webhook = args.webhook or ((config.get("alerts") or {}).get("webhook") if isinstance(config.get("alerts"), dict) else None)
    if webhook and not str(webhook).lower().startswith(("https://", "http://")):
        print("--webhook must be an http(s) URL", file=sys.stderr)
        return 2
    state_path = Path(args.state) if args.state else env.state_dir / "alerts_state.json"
    alerts, state = evaluate_alerts(reports, config, load_state(state_path), args.as_of, alert_existing=args.alert_existing)
    if args.json:
        print(json.dumps({"alerts": alerts, "state": str(state_path)}, indent=2))
    elif alerts:
        for a in alerts:
            print(f"[{a['severity'].upper():6}] {a['rule']}  {a['title']}\n         {a['detail']}")
    else:
        print("no new alerts")
    code = 0
    if alerts and webhook and not args.dry_run:
        try:
            post_webhook(str(webhook), slack_payload(alerts))
        except (OSError, ValueError) as e:
            print(f"webhook failed: {e}; these alerts will be retried on the next run", file=sys.stderr)
            for a in alerts:  # not delivered: forget them so the next run raises them again
                state.get("seen", {}).pop(a["id"], None)
            code = 1
    if not args.dry_run:
        save_state(state_path, state)
    return code


def cmd_report(args) -> int:
    from .weekly import build_weekly, render_html, render_markdown
    reports, config = _fleet_source(args)
    w = build_weekly(reports, config, args.as_of)
    text = json.dumps(w, indent=2) if args.format == "json" else render_html(w) if args.format == "html" else render_markdown(w)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        print(text)
    return 0


def cmd_usage(args) -> int:
    from .usage import collect_usage
    from .config import config_path, load_config
    from .pricing import load_prices
    env = _env(args)
    u = collect_usage(env, since=_since(args), include_content=args.include_content,
                      prices=load_prices(load_config(config_path(env))))
    if args.json:
        print(json.dumps(u, indent=2))
        return 0
    print(_table([[m, v["messages"], _fmt_n(v["input_tokens"]), _fmt_n(v["output_tokens"]), _fmt_n(v["cache_read_tokens"]),
                   _fmt_usd(v.get("cost_usd"))]
                  for m, v in sorted(u["by_model"].items(), key=lambda kv: -kv[1]["output_tokens"])],
                 ["MODEL", "MESSAGES", "INPUT", "OUTPUT", "CACHE READ", "EST. COST"]))
    _print_cost_note(u)
    print()
    print(_table([[t, n] for t, n in list(u["tools"].items())[:15]], ["TOOL", "CALLS"]))
    if u["risky_events"]:
        print()
        print(_table([[e["timestamp"] or "", e["app"], e["tool"], e["rule"], e["action"], e.get("subject", "")]
                      for e in u["risky_events"][-30:]], ["WHEN", "AGENT", "TOOL", "RULE", "WOULD", "SUBJECT"]))
    return 0


def cmd_graph(args) -> int:
    from .report import build_report
    text = json.dumps(build_report(_env(args), processes=_processes(args), since=_since(args))["graph"], indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    else:
        print(text)
    return 0


def cmd_guard(args) -> int:
    from .guard import main as guard_main
    return guard_main(_env(args), agent=args.agent)


_PROJECT_HOOK_FILE = {"claude-code": (".claude", "settings.json"), "gemini-cli": (".gemini", "settings.json"),
                      "codex": (".codex", "hooks.json")}


def _settings_target(args, env: Env, agent: str = "claude-code") -> Path | None:
    if args.settings:
        return Path(args.settings)
    if args.project:
        return Path(args.project).joinpath(*_PROJECT_HOOK_FILE[agent])
    return None


def cmd_hooks(args) -> int:
    from .hooks import AGENT_HOOKS, POST_INSTALL, agent_hook_status, install_agent_hook, uninstall_agent_hook
    env = _env(args)
    if args.action == "status":
        status = agent_hook_status(env)
        if not any(status.values()):
            print("guard not installed")
        for agent, paths in status.items():
            if paths:
                print(f"{agent}: guard installed in:\n  " + "\n  ".join(paths))
            elif any(status.values()):
                print(f"{agent}: not installed")
        return 0
    agents = list(AGENT_HOOKS) if args.agent == "all" else [args.agent]
    if args.settings and len(agents) > 1:
        print("--settings needs a single --agent", file=sys.stderr)
        return 2
    code = 0
    for agent in agents:
        target = _settings_target(args, env, agent)
        try:
            if args.action == "install":
                added, target = install_agent_hook(agent, env, args.command, target)
                print(f"{agent}: {'installed' if added else 'already installed'}: {target}")
                if added and agent in POST_INSTALL:
                    print(f"  note: {POST_INSTALL[agent]}")
            else:
                removed, target = uninstall_agent_hook(agent, env, target)
                print(f"{agent}: {'removed' if removed else 'not present'}: {target}")
        except ValueError as e:  # json.JSONDecodeError is a ValueError
            print(f"{target or agent} is not valid JSON or not a {agent} settings file ({e}); left unchanged", file=sys.stderr)
            code = 1
    return code


def cmd_policy(args) -> int:
    p = _env(args).state_dir / "policy.toml"
    if args.action == "path":
        print(p)
        return 0
    if p.exists() and not args.force:
        print(f"exists: {p} (use --force to overwrite)")
        return 1
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(POLICY_TEMPLATE, encoding="utf-8")
    print(f"wrote {p}")
    return 0


def cmd_rules(args) -> int:
    from .policy import RULES
    print(_table([[k, a, d] for k, (a, d) in RULES.items()], ["RULE", "DEFAULT", "DESCRIPTION"]))
    return 0


def cmd_check(args) -> int:
    """Evaluate one tool call against the policy (handy for testing rules)."""
    from .agents import evaluate_agent
    from .policy import Policy
    try:
        inp = json.loads(args.input) if args.input else {"command": args.command}
    except ValueError as e:
        print(f"--input is invalid JSON: {e}", file=sys.stderr)
        return 2
    policy_path = _env(args).state_dir / "policy.toml"
    try:
        policy = Policy.load(policy_path)
    except (ValueError, OSError, re.error) as e:
        print(f"{policy_path} is invalid ({e}); using built-in defaults", file=sys.stderr)
        policy = Policy()
    d = evaluate_agent(args.agent, args.tool, inp, policy)
    print(json.dumps(d.to_dict()))
    return 2 if d.action == "deny" else 0


def cmd_serve(args) -> int:
    from .config import config_path, load_config, merge_teams
    from .server import Store, make_server
    env = _env(args)
    given = args.token or os.environ.get("AIWARDEN_TOKEN")
    token = given or pysecrets.token_urlsafe(24)
    db = Path(args.db) if args.db else env.state_dir / "fleet.db"
    if args.local:
        from .report import build_report
        Store(db).add(build_report(env, processes=_processes(args)))
    config = merge_teams(load_config(config_path(env)), load_config(Path(args.teams)) if args.teams else None)
    srv = make_server(args.host, args.port, db, token, config=config)
    url = f"http://{args.host}:{srv.server_address[1]}/"
    print(f"aiwarden collector on {url}  db={db}", flush=True)
    if not given:
        print(f"token: {token}", flush=True)
        # the console reads the token from the fragment, which browsers never send to the server
        print(f"open:  {url}#token={token}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


def cmd_push(args) -> int:
    from .report import build_report
    from .server import push_report
    token = args.token or os.environ.get("AIWARDEN_TOKEN")
    if not token:
        print("missing --token (or AIWARDEN_TOKEN)", file=sys.stderr)
        return 2
    print(json.dumps(push_report(args.server, token, build_report(_env(args), processes=_processes(args), since=_since(args)))))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="aiwarden", description="Endpoint visibility and guardrails for AI apps, agents and MCP servers.")
    p.add_argument("--version", action="version", version=f"aiwarden {__version__}")
    p.add_argument("--home", help="scan this home directory instead of the current user's")
    p.add_argument("--platform", choices=["windows", "darwin", "linux"], help="platform layout to assume with --home")
    p.add_argument("--cwd", help="project directory to treat as current")
    sub = p.add_subparsers(dest="cmd", required=True)

    def window(sp):
        sp.add_argument("--days", type=int, help="only activity from the last N days")
        sp.add_argument("--since", help="only activity on/after YYYY-MM-DD")

    s = sub.add_parser("scan", help="inventory + findings + usage for this device")
    s.add_argument("--json", action="store_true")
    s.add_argument("--out", help="also write the JSON report here")
    s.add_argument("--no-usage", action="store_true", help="skip transcript analysis")
    s.add_argument("--include-content", action="store_true", help="keep scrubbed command text for risky events")
    s.add_argument("--fail-on", choices=list(SEVERITY_ORDER), help="exit 1 if a finding at this severity or worse exists")
    s.add_argument("-v", "--verbose", action="store_true")
    window(s)
    s.set_defaults(fn=cmd_scan)

    s = sub.add_parser("mcp", help="list MCP servers configured on this device")
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_mcp)

    s = sub.add_parser("mcp-scan", help="scan MCP servers for tool poisoning, risky capabilities and risky packages",
                       description="Without --connect only configs are checked (known-risky packages). With --connect, "
                                   "aiwarden starts the named stdio servers (or calls remote HTTP ones) and sends only "
                                   "initialize + tools/list, never tools/call, then analyses the tool definitions.")
    s.add_argument("--connect", action="store_true", help="fetch tool definitions (starts stdio servers!)")
    s.add_argument("--name", action="append", help="server name to connect to (repeatable)")
    s.add_argument("--all", action="store_true", help="connect to every enabled server (needs --yes)")
    s.add_argument("--yes", action="store_true", help="confirm --all")
    s.add_argument("--timeout", type=float, default=15.0, help="seconds per server (default 15)")
    s.add_argument("--tools-file", help="analyse a saved tools/list JSON instead of connecting")
    s.add_argument("--fail-on", choices=list(SEVERITY_ORDER), help="exit 1 if a finding at this severity or worse exists")
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_mcp_scan)

    def source(sp):
        sp.add_argument("--server", help="collector URL (reads /api/fleet and /api/devices/<id>)")
        sp.add_argument("--token", help="collector token (or AIWARDEN_TOKEN)")
        sp.add_argument("--report", action="append", help="saved report JSON (repeatable; a file may hold a list)")
        sp.add_argument("--teams", help="TOML file with a [teams] mapping, layered over ~/.aiwarden/config.toml")
        sp.add_argument("--as-of", help="evaluate time windows as of YYYY-MM-DD (default today)")

    from .query import __doc__ as query_doc
    s = sub.add_parser("ask", help="ask a question over usage, sessions, MCP calls, findings and apps",
                       description=query_doc, formatter_class=argparse.RawDescriptionHelpFormatter)
    s.add_argument("question", nargs="*")
    s.add_argument("--query", help="structured query JSON instead of a question")
    s.add_argument("--llm", action="store_true", help="translate with Claude first (needs ANTHROPIC_API_KEY)")
    s.add_argument("--no-llm", action="store_true", help="never call the LLM, even if ANTHROPIC_API_KEY is set")
    s.add_argument("--json", action="store_true")
    source(s)
    s.set_defaults(fn=cmd_ask)

    from .alerts import __doc__ as alerts_doc
    s = sub.add_parser("alerts", help="evaluate alert rules (spend spikes, new MCP servers/secrets/apps, guard blocks)",
                       description=alerts_doc + "\nSchedule it: cron `*/30 * * * * aiwarden alerts --server URL --token T`; "
                                   "Windows: schtasks /create /sc minute /mo 30 /tn aiwarden-alerts /tr \"aiwarden alerts ...\"",
                       formatter_class=argparse.RawDescriptionHelpFormatter)
    s.add_argument("--webhook", help="POST new alerts as Slack-compatible JSON here (or [alerts] webhook in config.toml)")
    s.add_argument("--state", help="state file (default ~/.aiwarden/alerts_state.json)")
    s.add_argument("--dry-run", action="store_true", help="print alerts but do not post or remember them")
    s.add_argument("--alert-existing", action="store_true", help="on the first run, alert on existing inventory instead of baselining it")
    s.add_argument("--json", action="store_true")
    source(s)
    s.set_defaults(fn=cmd_alerts)

    s = sub.add_parser("report", help="periodic reports (weekly usage + risk)")
    s.add_argument("period", choices=["weekly"])
    s.add_argument("--format", choices=["md", "html", "json"], default="md")
    s.add_argument("--out", help="write to this file instead of stdout")
    source(s)
    s.set_defaults(fn=cmd_report)

    s = sub.add_parser("usage", help="tokens, cost, tools and MCP calls from agent transcripts")
    s.add_argument("--json", action="store_true")
    s.add_argument("--include-content", action="store_true")
    window(s)
    s.set_defaults(fn=cmd_usage)

    s = sub.add_parser("graph", help="emit the user/app/MCP/model graph as JSON")
    s.add_argument("--out")
    window(s)
    s.set_defaults(fn=cmd_graph)

    s = sub.add_parser("guard", help="pre-tool hook for Claude Code, Gemini CLI or Codex (reads hook JSON on stdin)")
    s.add_argument("--agent", choices=["claude-code", "gemini-cli", "codex"], default="claude-code",
                   help="hook protocol to speak (default: claude-code)")
    s.set_defaults(fn=cmd_guard)

    s = sub.add_parser("hooks", help="install/remove the guard hook in Claude Code, Gemini CLI or Codex",
                       description="Claude Code: ~/.claude/settings.json PreToolUse. Gemini CLI: ~/.gemini/settings.json "
                                   "BeforeTool. Codex: ~/.codex/hooks.json PreToolUse (trust it with /hooks in Codex).")
    s.add_argument("action", choices=["install", "uninstall", "status"])
    s.add_argument("--agent", choices=["claude-code", "gemini-cli", "codex", "all"], default="claude-code")
    s.add_argument("--project", help="use the project-level file (<project>/.claude/settings.json, .gemini/settings.json, .codex/hooks.json)")
    s.add_argument("--settings", help="explicit settings file path (single --agent only)")
    s.add_argument("--command", help="hook command (default: this Python running `-m aiwarden guard [--agent X]`)")
    s.set_defaults(fn=cmd_hooks)

    s = sub.add_parser("policy", help="create the guard policy file")
    s.add_argument("action", choices=["init", "path"])
    s.add_argument("--force", action="store_true")
    s.set_defaults(fn=cmd_policy)

    s = sub.add_parser("rules", help="list built-in guard rules")
    s.set_defaults(fn=cmd_rules)

    s = sub.add_parser("check", help="evaluate a tool call against the policy")
    s.add_argument("tool")
    s.add_argument("command", nargs="?", default="")
    s.add_argument("--input", help="tool_input as JSON (instead of a shell command)")
    s.add_argument("--agent", choices=["claude-code", "gemini-cli", "codex"], default="claude-code",
                   help="interpret TOOL in this agent's vocabulary (e.g. run_shell_command, apply_patch)")
    s.set_defaults(fn=cmd_check)

    s = sub.add_parser("serve", help="run the fleet collector + dashboard")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--db")
    s.add_argument("--token")
    s.add_argument("--local", action="store_true", help="ingest this device's report at startup")
    s.add_argument("--teams", help="TOML file with a [teams] mapping, layered over ~/.aiwarden/config.toml")
    s.set_defaults(fn=cmd_serve)

    s = sub.add_parser("push", help="send this device's report to a collector")
    s.add_argument("--server", required=True)
    s.add_argument("--token")
    window(s)
    s.set_defaults(fn=cmd_push)
    return p


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            # Redirected output is UTF-8 (not the Windows ANSI code page); consoles keep their encoding.
            if stream.isatty():
                stream.reconfigure(errors="replace")
            else:
                stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            pass
    args = build_parser().parse_args(argv)
    return args.fn(args)
