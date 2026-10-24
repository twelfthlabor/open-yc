"""Weekly usage + risk report (Markdown, HTML or JSON) over fleet or local reports.

The week is the 7 days ending on --as-of (default today), compared with the 7 days before.
Inventory sections (findings, MCP servers, apps) describe the latest report per device.
"""
from __future__ import annotations

import html
from datetime import date, timedelta

from .fleetdata import build_facts
from .query import run_query


def _pct(cur, prev):
    return round((cur - prev) / prev * 100, 1) if prev else None


def build_weekly(reports: list[dict], config: dict | None = None, as_of: str | date | None = None, top: int = 10) -> dict:
    as_of_d = date.fromisoformat(as_of) if isinstance(as_of, str) else (as_of or date.today())
    cur = {"since": (as_of_d - timedelta(days=6)).isoformat(), "until": as_of_d.isoformat()}
    prev = {"since": (as_of_d - timedelta(days=13)).isoformat(), "until": (as_of_d - timedelta(days=7)).isoformat()}
    facts = build_facts(reports, config)

    def q(entity, metric=None, group_by=(), window=None, filters=None, limit=top):
        query = {"entity": entity, "group_by": list(group_by), "filters": filters or {}, "limit": limit}
        if metric:
            query["metric"] = metric
        if window:
            query["window"] = window
        return run_query(query, facts, as_of_d)

    totals = {}
    for name, entity, metric in (("tokens", "usage", "tokens"), ("cost_usd", "usage", "cost_usd"), ("sessions", "sessions", "count")):
        c, p = q(entity, metric, window=cur)["total"], q(entity, metric, window=prev)["total"]
        totals[name] = {"current": c, "previous": p, "change_pct": _pct(c, p)}

    def breakdown(dim):
        tok = q("usage", "tokens", [dim], cur, limit=top)["rows"]
        cost = {r[dim]: r["value"] for r in q("usage", "cost_usd", [dim], cur, limit=1000)["rows"]}
        before = {r[dim]: r["value"] for r in q("usage", "tokens", [dim], prev, limit=1000)["rows"]}
        return [{dim: r[dim], "tokens": r["value"], "cost_usd": cost.get(r[dim], 0.0), "previous_tokens": before.get(r[dim], 0),
                 "change_pct": _pct(r["value"], before.get(r[dim], 0))} for r in tok]

    sev = {r["severity"]: r["value"] for r in q("findings", group_by=["severity"], limit=100)["rows"]}
    serious = [f for f in facts["findings"] if f["severity"] in ("critical", "high")][:25]
    guard = q("guard_events", window=cur, filters={"action": "deny"}, group_by=["rule"], limit=100)
    return {
        "as_of": as_of_d.isoformat(), "period": cur, "previous_period": prev,
        "devices": len(facts["devices"]),
        "totals": totals,
        "by_team": breakdown("team"), "by_user": breakdown("user"), "by_app": breakdown("app"),
        "mcp_calls": q("mcp_calls", "calls", ["mcp_server"])["rows"],
        "mcp_servers_configured": len(facts["mcp_servers"]),
        "findings": {"by_severity": sev, "serious": [{k: f.get(k) for k in ("severity", "rule", "title", "hostname", "user", "team")}
                                                     for f in serious]},
        "guard_blocks": {"total": guard["total"], "by_rule": guard["rows"],
                         "by_user": q("guard_events", window=cur, filters={"action": "deny"}, group_by=["user"])["rows"]},
        "risky_events": q("risky_events", window=cur, group_by=["rule"])["rows"],
        "apps": q("apps", group_by=["app"], limit=50)["rows"],
    }


def _fmt(v) -> str:
    if v is None:
        return "-"
    if isinstance(v, float):
        return f"{v:,.2f}"
    if isinstance(v, int):
        return f"{v:,}"
    return str(v)


def _change(p) -> str:
    return "new" if p is None else f"{p:+.1f}%"


def _sections(w: dict) -> list[tuple[str, list[str], list[list]]]:
    t = w["totals"]
    out = [("Totals", ["Metric", "This week", "Previous week", "Change"],
            [["Tokens", _fmt(t["tokens"]["current"]), _fmt(t["tokens"]["previous"]), _change(t["tokens"]["change_pct"])],
             ["Estimated cost (USD)", _fmt(float(t["cost_usd"]["current"])), _fmt(float(t["cost_usd"]["previous"])),
              _change(t["cost_usd"]["change_pct"])],
             ["Sessions", _fmt(t["sessions"]["current"]), _fmt(t["sessions"]["previous"]), _change(t["sessions"]["change_pct"])]])]
    for dim, title in (("team", "By team"), ("user", "By user"), ("app", "By app")):
        rows = w[f"by_{dim}"]
        out.append((title, [dim.capitalize(), "Tokens", "Cost (USD)", "Previous tokens", "Change"],
                    [[_fmt(r[dim] if r[dim] is not None else "(unassigned)"), _fmt(r["tokens"]), _fmt(float(r["cost_usd"])),
                      _fmt(r["previous_tokens"]), _change(r["change_pct"])] for r in rows]))
    out.append(("MCP calls by server", ["Server", "Calls"], [[_fmt(r["mcp_server"]), _fmt(r["value"])] for r in w["mcp_calls"]]))
    sev = w["findings"]["by_severity"]
    out.append(("Findings by severity", ["Severity", "Count"],
                [[s, _fmt(sev[s])] for s in ("critical", "high", "medium", "low", "info") if sev.get(s)]))
    out.append(("Critical and high findings", ["Severity", "Rule", "Title", "Device", "User", "Team"],
                [[f["severity"], f["rule"], f["title"], f["hostname"], f["user"], _fmt(f["team"])] for f in w["findings"]["serious"]]))
    out.append(("Guard blocks this week", ["Rule", "Blocks"], [[_fmt(r["rule"]), _fmt(r["value"])] for r in w["guard_blocks"]["by_rule"]]))
    out.append(("Risky actions seen in transcripts", ["Rule", "Count"], [[_fmt(r["rule"]), _fmt(r["value"])] for r in w["risky_events"]]))
    return out


def _cell_md(v) -> str:
    # Markdown renderers pass raw HTML through, and names come from endpoint reports.
    return html.escape(str(v), quote=False).replace("|", "\\|").replace("\n", " ")


def render_markdown(w: dict) -> str:
    lines = [f"# aiwarden weekly report", "",
             f"Week {w['period']['since']} to {w['period']['until']} (compared with {w['previous_period']['since']} to "
             f"{w['previous_period']['until']}). {w['devices']} devices, {w['mcp_servers_configured']} MCP server configs.",
             "", "Cost is an estimate from list prices (see `aiwarden usage`).", ""]
    for title, header, rows in _sections(w):
        lines += [f"## {title}", ""]
        if not rows:
            lines += ["None.", ""]
            continue
        lines.append("| " + " | ".join(header) + " |")
        lines.append("|" + "|".join("---" for _ in header) + "|")
        lines += ["| " + " | ".join(_cell_md(c) for c in r) + " |" for r in rows]
        lines.append("")
    return "\n".join(lines)


def render_html(w: dict) -> str:
    e = html.escape
    parts = ["<!doctype html><html><head><meta charset='utf-8'><title>aiwarden weekly report</title>",
             "<style>body{font:14px system-ui,sans-serif;margin:2em;max-width:1000px}table{border-collapse:collapse;margin:.5em 0 1.5em}"
             "td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f3f3f3}</style></head><body>",
             "<h1>aiwarden weekly report</h1>",
             f"<p>Week {e(w['period']['since'])} to {e(w['period']['until'])} (compared with {e(w['previous_period']['since'])} to "
             f"{e(w['previous_period']['until'])}). {w['devices']} devices. Cost is an estimate from list prices.</p>"]
    for title, header, rows in _sections(w):
        parts.append(f"<h2>{e(title)}</h2>")
        if not rows:
            parts.append("<p>None.</p>")
            continue
        parts.append("<table><tr>" + "".join(f"<th>{e(h)}</th>" for h in header) + "</tr>")
        parts += ["<tr>" + "".join(f"<td>{e(str(c))}</td>" for c in r) + "</tr>" for r in rows]
        parts.append("</table>")
    parts.append("</body></html>")
    return "\n".join(parts)
