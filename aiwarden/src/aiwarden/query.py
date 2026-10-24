"""Questions over the fleet graph: a deterministic query engine, a small intent parser and an
optional LLM translator.

Structured query (JSON), validated by validate_query():

    {"entity":   "usage" | "sessions" | "mcp_calls" | "findings" | "apps" | "mcp_servers"
                 | "guard_events" | "risky_events" | "devices",
     "metric":   "tokens" | "cost_usd" | "input_tokens" | "output_tokens" | "count" | "calls" | "tool_calls",
     "filters":  {"team": "platform", "app": "claude-code", "mcp_server": ["github", "linear"], ...},
     "group_by": ["team"],
     "window":   {"preset": "this_month"} | {"preset": "last_n_days", "days": 7} | {"since": "2026-10-01", "until": "2026-10-23"},
     "compare":  {"to": "previous_period", "direction": "increase" | "decrease" | "any", "change_pct": 100},
     "order": "desc", "limit": 50}

Fields usable in filters and group_by: see FIELDS. Time windows apply to entities with a day
(usage, sessions, guard_events, risky_events); inventory entities (apps, findings, ...) are the
latest snapshot. "compare" contrasts the window with the period just before it (month-to-date
against the same days of the previous month for this_month).

Questions the parser understands (case-insensitive; windows like "this month", "last week",
"in the last 30 days", "since 2026-10-01" and filters like "for team X", "for user X",
"on device X" can be added to any of them):

    which teams'|users'|apps'|devices'|projects' token usage|cost doubled|tripled|halved|increased|dropped [by N%] <window>
    which <app> sessions called|used the <server> mcp
    top N teams|users|apps|devices|projects|mcp servers by tokens|cost|sessions
    token usage|cost|sessions by team|user|app|device|project|day
    how many tokens | how much did we spend [by X]
    [critical|high|medium|low] findings [by X]
    which devices|users|teams have plaintext secrets
    which devices|users|teams have <app> [installed]
    most called mcp servers | mcp calls by X | which mcp servers are configured [by X]
    guard blocks [by X] | risky actions [by X]

LLM mode (ANTHROPIC_API_KEY set): the question, today's date and this schema go to the Claude
Messages API, which returns a structured query. No report content (names, hosts, numbers) is
sent; the query runs locally.
"""
from __future__ import annotations

import calendar
import json
import os
import re
import urllib.request
from collections import defaultdict
from datetime import date, timedelta

LLM_MODEL = "claude-sonnet-5-5"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2026-10-21"  # no temperature/top_p/top_k on this version

ENTITIES = {
    "usage": {"time": True, "metrics": {"tokens", "cost_usd", "input_tokens", "output_tokens"}, "default": "tokens"},
    "model_usage": {"time": True, "metrics": {"tokens", "cost_usd", "input_tokens", "output_tokens"}, "default": "tokens"},
    "sessions": {"time": True, "metrics": {"count", "tokens", "cost_usd", "tool_calls"}, "default": "count"},
    "mcp_calls": {"time": False, "metrics": {"calls", "count"}, "default": "calls"},
    "findings": {"time": False, "metrics": {"count"}, "default": "count"},
    "apps": {"time": False, "metrics": {"count"}, "default": "count"},
    "mcp_servers": {"time": False, "metrics": {"count", "secrets"}, "default": "count"},
    "guard_events": {"time": True, "metrics": {"count"}, "default": "count"},
    "risky_events": {"time": True, "metrics": {"count"}, "default": "count"},
    "devices": {"time": False, "metrics": {"count"}, "default": "count"},
}
FIELDS = {"team", "user", "device", "hostname", "app", "model", "mcp_server", "severity", "rule", "action", "project",
          "client", "tool", "day", "transport", "running", "package"}
PRESETS = {"today", "yesterday", "this_week", "last_week", "this_month", "last_month", "last_n_days", "all"}
_LIST_FIELDS = {"model": "models", "mcp_server": "mcp_servers"}  # session record fields holding lists
_SESSION_COLS = ("id", "app", "hostname", "user", "team", "project", "start", "mcp_servers", "tokens", "cost_usd")


# ---------- validation ----------

def validate_query(q) -> dict:
    if not isinstance(q, dict):
        raise ValueError("query must be a JSON object")
    entity = q.get("entity")
    if entity not in ENTITIES:
        raise ValueError(f"entity must be one of {sorted(ENTITIES)}")
    spec = ENTITIES[entity]
    metric = q.get("metric") or spec["default"]
    if metric not in spec["metrics"]:
        raise ValueError(f"metric for {entity} must be one of {sorted(spec['metrics'])}")
    filters = q.get("filters") or {}
    if not isinstance(filters, dict) or any(k not in FIELDS for k in filters):
        raise ValueError(f"filter fields must be in {sorted(FIELDS)}")
    for v in filters.values():
        if not (isinstance(v, (str, int, float, bool)) or (isinstance(v, list) and all(isinstance(x, (str, int, float)) for x in v))):
            raise ValueError("filter values must be scalars or lists of scalars")
    group_by = q.get("group_by") or []
    if isinstance(group_by, str):
        group_by = [group_by]
    if not isinstance(group_by, list) or any(g not in FIELDS for g in group_by) or len(group_by) > 4:
        raise ValueError(f"group_by must be up to 4 of {sorted(FIELDS)}")
    window = q.get("window")
    if window is not None:
        if not isinstance(window, dict):
            raise ValueError("window must be an object")
        if "preset" in window and window["preset"] not in PRESETS:
            raise ValueError(f"window.preset must be one of {sorted(PRESETS)}")
        for k in ("since", "until"):
            if k in window and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(window[k])):
                raise ValueError(f"window.{k} must be YYYY-MM-DD")
        if window.get("preset") == "last_n_days" and not (isinstance(window.get("days"), int) and 0 < window["days"] <= 3660):
            raise ValueError("window.days must be a positive integer")
    compare = q.get("compare")
    if compare is not None:
        if not isinstance(compare, dict) or compare.get("direction", "any") not in {"increase", "decrease", "any"}:
            raise ValueError("compare.direction must be increase, decrease or any")
        if not isinstance(compare.get("change_pct", 0), (int, float)):
            raise ValueError("compare.change_pct must be a number")
        if not spec["time"]:
            raise ValueError(f"{entity} has no time dimension to compare")
    order = q.get("order", "desc")
    if order not in {"asc", "desc"}:
        raise ValueError("order must be asc or desc")
    limit = q.get("limit", 50)
    if not isinstance(limit, int) or not 0 < limit <= 1000:
        raise ValueError("limit must be 1..1000")
    out = {"entity": entity, "metric": metric, "filters": filters, "group_by": group_by, "order": order, "limit": limit}
    if window is not None:
        out["window"] = window
    if compare is not None:
        out["compare"] = {"to": "previous_period", "direction": compare.get("direction", "any"),
                          "change_pct": float(compare.get("change_pct", 0))}
        out.setdefault("window", {"preset": "this_month"})
    return out


# ---------- time windows ----------

def _d(s: str) -> date:
    return date.fromisoformat(s)


def resolve_window(window: dict | None, as_of: date) -> tuple[date, date] | None:
    if not window or window.get("preset") == "all":
        return None
    p = window.get("preset")
    if p == "today":
        return as_of, as_of
    if p == "yesterday":
        y = as_of - timedelta(days=1)
        return y, y
    if p == "this_week":
        return as_of - timedelta(days=as_of.weekday()), as_of
    if p == "last_week":
        start = as_of - timedelta(days=as_of.weekday() + 7)
        return start, start + timedelta(days=6)
    if p == "this_month":
        return as_of.replace(day=1), as_of
    if p == "last_month":
        end = as_of.replace(day=1) - timedelta(days=1)
        return end.replace(day=1), end
    if p == "last_n_days":
        return as_of - timedelta(days=int(window["days"]) - 1), as_of
    since = _d(window["since"]) if window.get("since") else date(1970, 1, 1)
    until = _d(window["until"]) if window.get("until") else as_of
    return since, until


def previous_window(window: dict | None, span: tuple[date, date]) -> tuple[date, date]:
    start, end = span
    preset = (window or {}).get("preset")
    if preset in {"this_month", "last_month"}:
        prev_end_month = start - timedelta(days=1)
        first = prev_end_month.replace(day=1)
        days = (end - start).days
        last_day = calendar.monthrange(first.year, first.month)[1]
        return first, first.replace(day=min(last_day, 1 + days))
    length = (end - start).days + 1
    return start - timedelta(days=length), start - timedelta(days=1)


# ---------- engine ----------

def _match(rec: dict, field: str, want) -> bool:
    wants = [str(w).lower() for w in (want if isinstance(want, list) else [want])]
    if field in _LIST_FIELDS and _LIST_FIELDS[field] in rec:
        return any(str(v).lower() in wants for v in rec[_LIST_FIELDS[field]])
    v = rec.get(field)
    return str(v).lower() in wants if v is not None else "none" in wants


def _in(rec: dict, span) -> bool:
    if span is None:
        return True
    d = rec.get("day")
    return bool(d) and span[0].isoformat() <= d <= span[1].isoformat()


def _value(recs: list[dict], metric: str):
    if metric == "count":
        return len(recs)
    total = sum(r.get(metric) or 0 for r in recs)
    return round(total, 4) if metric == "cost_usd" else total


def _groups(recs, group_by):
    out = defaultdict(list)
    for r in recs:
        if any(g in _LIST_FIELDS and _LIST_FIELDS[g] in r for g in group_by):
            keys = [[]]
            for g in group_by:
                vals = r.get(_LIST_FIELDS[g]) if g in _LIST_FIELDS and _LIST_FIELDS[g] in r else [r.get(g)]
                keys = [k + [v] for k in keys for v in (vals or [None])]
            for k in keys:
                out[tuple(k)].append(r)
        else:
            out[tuple(r.get(g) for g in group_by)].append(r)
    return out


def _reroute(query) -> dict:
    """Usage rows are per day and app; project lives on sessions and model on per-model rows."""
    if not isinstance(query, dict) or query.get("entity") != "usage":
        return query
    keys = set(query.get("group_by") or []) | set((query.get("filters") or {}).keys())
    if "project" in keys:
        metric = query.get("metric") or "tokens"
        return {**query, "entity": "sessions", "metric": metric if metric in {"tokens", "cost_usd"} else "tokens"}
    if "model" in keys:
        return {**query, "entity": "model_usage"}
    return query


def run_query(query: dict, facts: dict[str, list[dict]], as_of: str | date | None = None) -> dict:
    q = validate_query(_reroute(query))
    today = _d(as_of) if isinstance(as_of, str) else (as_of or date.today())
    spec = ENTITIES[q["entity"]]
    notes = []
    recs = [r for r in facts.get(q["entity"], []) if all(_match(r, f, v) for f, v in q["filters"].items())]
    span = resolve_window(q.get("window"), today) if spec["time"] else None
    if q.get("window") and not spec["time"]:
        notes.append(f"{q['entity']} is a current snapshot; the time window was ignored")
    cur = [r for r in recs if _in(r, span)]
    res = {"query": q, "as_of": today.isoformat(),
           "window": {"since": span[0].isoformat(), "until": span[1].isoformat()} if span else None, "notes": notes}
    reverse = q["order"] == "desc"

    if not q["group_by"]:
        if q["entity"] in {"usage", "model_usage"}:
            res["rows"] = [{"value": _value(cur, q["metric"])}]
        else:
            items = sorted(cur, key=lambda r: r.get("start") or r.get("day") or "", reverse=True)
            if q["entity"] == "sessions":
                items = [{k: r.get(k) for k in _SESSION_COLS} for r in items]
            res["rows"] = items[: q["limit"]]
        res["total"] = _value(cur, q["metric"])
        return res

    groups = _groups(cur, q["group_by"])
    rows = []
    if q.get("compare"):
        prev_span = previous_window(q.get("window"), span)
        res["previous_window"] = {"since": prev_span[0].isoformat(), "until": prev_span[1].isoformat()}
        prev_groups = _groups([r for r in recs if _in(r, prev_span)], q["group_by"])
        c = q["compare"]
        factor = c["change_pct"] / 100.0
        for key in set(groups) | set(prev_groups):
            v, p = _value(groups.get(key, []), q["metric"]), _value(prev_groups.get(key, []), q["metric"])
            if c["direction"] == "increase":
                ok = v > p if factor == 0 else (v > 0 if p == 0 else v >= p * (1 + factor))
            elif c["direction"] == "decrease":
                ok = p > 0 and (v < p if factor == 0 else v <= p * (1 - factor))
            else:
                ok = True
            if ok:
                rows.append({**dict(zip(q["group_by"], key)), "value": v, "previous": p,
                             "change_pct": round((v - p) / p * 100, 1) if p else None})
    else:
        rows = [{**dict(zip(q["group_by"], key)), "value": _value(rs, q["metric"])} for key, rs in groups.items()]
    rows.sort(key=lambda r: (r["value"], str([r.get(g) for g in q["group_by"]])), reverse=reverse)
    res["rows"] = rows[: q["limit"]]
    res["total"] = _value(cur, q["metric"])
    return res


# ---------- intent parser ----------

_GROUP_WORDS = {"team": "team", "teams": "team", "user": "user", "users": "user", "people": "user", "who": "user",
                "developer": "user", "developers": "user", "device": "hostname", "devices": "hostname",
                "machine": "hostname", "machines": "hostname", "laptop": "hostname", "laptops": "hostname",
                "host": "hostname", "hosts": "hostname", "app": "app", "apps": "app", "agent": "app", "agents": "app",
                "model": "model", "models": "model", "project": "project", "projects": "project", "day": "day",
                "days": "day", "rule": "rule", "rules": "rule", "severity": "severity", "client": "client",
                "clients": "client", "server": "mcp_server", "servers": "mcp_server", "mcp": "mcp_server",
                "tool": "tool", "tools": "tool"}
_APP_ALIASES = {"claude code": "claude-code", "claude-code": "claude-code", "claude desktop": "claude-desktop",
                "codex cli": "codex", "codex": "codex", "gemini cli": "gemini-cli", "gemini-cli": "gemini-cli",
                "gemini": "gemini-cli", "cursor": "cursor", "windsurf": "windsurf", "vs code": "vscode", "vscode": "vscode",
                "copilot": "github-copilot", "github copilot": "github-copilot", "cline": "cline", "roo code": "roo-code",
                "continue": "continue", "zed": "zed", "ollama": "ollama", "lm studio": "lm-studio", "opencode": "opencode",
                "aider": "aider", "goose": "goose", "chatgpt": "chatgpt-desktop", "antigravity": "antigravity"}
_CHANGE = {"doubled": ("increase", 100), "tripled": ("increase", 200), "quadrupled": ("increase", 300),
           "halved": ("decrease", 50), "increased": ("increase", 0), "grew": ("increase", 0), "rose": ("increase", 0),
           "jumped": ("increase", 0), "spiked": ("increase", 0), "went up": ("increase", 0),
           "dropped": ("decrease", 0), "fell": ("decrease", 0), "decreased": ("decrease", 0), "declined": ("decrease", 0),
           "went down": ("decrease", 0), "changed": ("any", 0)}
_METRIC_WORDS = {"tokens": "tokens", "token": "tokens", "token usage": "tokens", "usage": "tokens", "token use": "tokens",
                 "cost": "cost_usd", "costs": "cost_usd", "spend": "cost_usd", "spending": "cost_usd", "dollars": "cost_usd",
                 "sessions": "sessions"}


def _app_in(text: str) -> str | None:
    for alias in sorted(_APP_ALIASES, key=len, reverse=True):
        if re.search(rf"(?<![\w-]){re.escape(alias)}(?![\w-])", text):
            return _APP_ALIASES[alias]
    return None


def _window_in(text: str) -> dict | None:
    if m := re.search(r"\b(?:in\s+)?(?:the\s+)?(?:last|past)\s+(\d+)\s+days?\b", text):
        return {"preset": "last_n_days", "days": int(m.group(1))}
    if m := re.search(r"\bsince\s+(\d{4}-\d{2}-\d{2})", text):
        return {"since": m.group(1)}
    for phrase, preset in (("this month", "this_month"), ("last month", "last_month"), ("this week", "this_week"),
                           ("last week", "last_week"), ("past week", "last_n_days7"), ("yesterday", "yesterday"),
                           ("today", "today"), ("month to date", "this_month"), ("all time", "all")):
        if re.search(rf"\b{phrase}\b", text):
            return {"preset": "last_n_days", "days": 7} if preset == "last_n_days7" else {"preset": preset}
    return None


def _filters_in(text: str) -> dict:
    f = {}
    for m in re.finditer(r"\b(?:for|in|on|from|of)\s+(?:the\s+)?(team|user|device|host|machine)\s+([\w.@-]+)", text):
        f[{"team": "team", "user": "user"}.get(m.group(1), "hostname")] = m.group(2)
    if m := re.search(r"\b(?:for|in|on)\s+(?:the\s+)?([\w.@-]+)\s+team\b", text):
        f.setdefault("team", m.group(1))
    return f


def _group_after_by(text: str) -> list[str]:
    m = re.search(r"\b(?:by|per)\s+(mcp\s+servers?|[a-z]+)\b", text)
    if not m:
        return []
    w = m.group(1)
    return ["mcp_server"] if w.startswith("mcp") else ([_GROUP_WORDS[w]] if w in _GROUP_WORDS else [])


def parse_question(question: str, as_of: str | date | None = None) -> dict | None:
    """Deterministic intent parser for the documented question patterns; None if no pattern matches."""
    t = re.sub(r"[?!.]+$", "", question.strip().lower()).replace("’", "'")
    t = re.sub(r"\s+", " ", t)
    window, filters = _window_in(t), _filters_in(t)
    q: dict | None = None

    # 1) which teams' token usage doubled this month
    m = re.search(r"\bwhich (\w+?)(?:'s|s'|')?\s+(?:total\s+)?(token usage|token use|tokens|usage|spend|spending|cost|costs)\s+"
                  r"(?:have\s+|has\s+)?(" + "|".join(sorted(_CHANGE, key=len, reverse=True)) + r")(?:\s+by\s+(\d+(?:\.\d+)?)\s*%)?", t)
    if m:
        word = m.group(1)
        group = _GROUP_WORDS.get(word) or _GROUP_WORDS.get(word + "s")
        if group:
            direction, pct = _CHANGE[m.group(3)]
            if m.group(4):
                pct = float(m.group(4))
            q = {"entity": "usage", "metric": _METRIC_WORDS[m.group(2)], "group_by": [group],
                 "compare": {"to": "previous_period", "direction": direction, "change_pct": pct},
                 "window": window or {"preset": "this_month"}}

    # 2) which claude code sessions called the github mcp
    if q is None and (m := re.search(r"sessions?\s+(?:that\s+|which\s+)?(?:have\s+)?(?:called|used|use|touched|invoked|hit|"
                                     r"talked to|with|using)\s+(?:the\s+)?([\w.@/-]+)\s+mcp\b", t)):
        f = {**filters}
        app = _app_in(t[: m.start()])
        if app:
            f["app"] = app
        f["mcp_server"] = m.group(1)
        q = {"entity": "sessions", "filters": f, "group_by": _group_after_by(t[m.end():])}
        if window:
            q["window"] = window

    # 3) top N users by cost
    if q is None and (m := re.search(r"\btop\s+(?:(\d+)\s+)?(mcp servers?|\w+)\s+by\s+(token usage|tokens|cost|spend|sessions|calls)", t)):
        noun = m.group(2)
        group = "mcp_server" if noun.startswith("mcp") else _GROUP_WORDS.get(noun)
        if group:
            metric_word = m.group(3)
            if group == "mcp_server":
                q = {"entity": "mcp_calls", "metric": "calls", "group_by": [group]}
            elif metric_word == "sessions":
                q = {"entity": "sessions", "metric": "count", "group_by": [group]}
            else:
                q = {"entity": "usage", "metric": _METRIC_WORDS[metric_word], "group_by": [group]}
            if m.group(1):
                q["limit"] = int(m.group(1))

    # 4) token usage by app / how many tokens / how much did we spend
    if q is None and (m := re.search(r"\b(token usage|tokens|token use|cost|costs|spend|spending|sessions)\s+(?:by|per)\s+", t)):
        group = _group_after_by(t[m.start():])
        if group:
            entity = "sessions" if m.group(1) == "sessions" else "usage"
            q = {"entity": entity, "metric": "count" if entity == "sessions" else _METRIC_WORDS[m.group(1)], "group_by": group}
    if q is None and re.search(r"\bhow many tokens\b|\btotal tokens\b|\bhow much\b.*\b(spen[dt]|cost)", t):
        q = {"entity": "usage", "metric": "tokens" if "token" in t else "cost_usd", "group_by": _group_after_by(t)}

    # 5) plaintext secrets
    if q is None and re.search(r"\b(plaintext|plain-text|exposed|leaked)?\s*secrets?\b", t) and "finding" not in t:
        noun = re.search(r"\bwhich (\w+)", t)
        group = _GROUP_WORDS.get(noun.group(1)) if noun else None
        q = {"entity": "findings", "filters": {**filters, "rule": "MCP001"}, "group_by": [group or "hostname"]}

    # 6) findings
    if q is None and (m := re.search(r"\b(critical|high|medium|low|info)?\s*(?:severity\s+)?(findings|risks|issues)\b", t)):
        f = {**filters}
        if m.group(1):
            f["severity"] = m.group(1)
        q = {"entity": "findings", "filters": f, "group_by": _group_after_by(t)}

    # 7) which users have gemini cli installed
    if q is None and (m := re.search(r"\b(?:which|what|who)\s+(\w+)?\s*(?:have|has|run|runs|use|uses|are using|installed)\s+(.+)", t)):
        app = _app_in(m.group(2))
        if app:
            group = _GROUP_WORDS.get(m.group(1) or "who") or "hostname"
            q = {"entity": "apps", "filters": {**filters, "app": app}, "group_by": [group]}

    # 8) mcp
    if q is None and re.search(r"\bmcp\b", t):
        if re.search(r"\b(called|calls|used|busiest|popular)\b", t):
            q = {"entity": "mcp_calls", "metric": "calls", "group_by": _group_after_by(t) or ["mcp_server"]}
        else:
            q = {"entity": "mcp_servers", "group_by": _group_after_by(t) or ["mcp_server"]}
            if re.search(r"\bremote\b", t):
                q["filters"] = {"transport": ["http", "sse"]}

    # 9) guard blocks / risky actions
    if q is None and re.search(r"\bguard\b.*\b(block|blocks|blocked|denials|denied|denies)\b|\bblocked\b", t):
        q = {"entity": "guard_events", "filters": {**filters, "action": "deny"}, "group_by": _group_after_by(t)}
    if q is None and re.search(r"\brisky\s+(actions|commands|events|calls)\b", t):
        q = {"entity": "risky_events", "group_by": _group_after_by(t)}

    if q is None:
        return None
    if q["entity"] not in {"findings", "apps", "mcp_servers"}:
        q.setdefault("filters", {})
        for k, v in filters.items():
            q["filters"].setdefault(k, v)
    if window and "window" not in q and ENTITIES[q["entity"]]["time"]:
        q["window"] = window
    if "app" not in q.get("filters", {}) and q["entity"] in {"usage", "sessions", "guard_events", "risky_events"}:
        app = _app_in(t)
        if app and not re.search(r"\bby (app|agent)s?\b", t):
            q.setdefault("filters", {})["app"] = app
    try:
        return validate_query(q)
    except ValueError:
        return None


# ---------- LLM translation ----------

def _system_prompt(today: str) -> str:
    return (
        "You translate questions about AI-agent usage on a fleet of developer machines into ONE JSON query for a "
        "local query engine. Reply with only the JSON object, no prose.\n"
        f"Today is {today}.\n"
        "Schema:\n"
        '{"entity": one of ' + json.dumps(sorted(ENTITIES)) + ",\n"
        ' "metric": usage: tokens|cost_usd|input_tokens|output_tokens; sessions: count|tokens|cost_usd|tool_calls; '
        "mcp_calls: calls|count; others: count,\n"
        ' "filters": {field: value or [values]}, "group_by": [up to 3 fields], fields: ' + json.dumps(sorted(FIELDS)) + ",\n"
        ' "window": {"preset": ' + json.dumps(sorted(PRESETS)) + '} or {"preset": "last_n_days", "days": N} or '
        '{"since": "YYYY-MM-DD", "until": "YYYY-MM-DD"},\n'
        ' "compare": {"to": "previous_period", "direction": "increase"|"decrease"|"any", "change_pct": number} '
        '(e.g. "doubled" = increase 100),\n'
        ' "order": "desc"|"asc", "limit": 1..1000}\n'
        "App ids: claude-code, codex, gemini-cli, cursor, windsurf, vscode, github-copilot, cline, claude-desktop. "
        "Use mcp_server for MCP server names, team/user/hostname for people and machines. "
        "usage has a day per row; sessions have app, mcp_servers (list), models (list), project; findings have "
        "severity (critical|high|medium|low|info) and rule (MCP001 = plaintext secret in MCP config); "
        "guard_events have action (deny|ask|allow)."
    )


def llm_query(question: str, as_of: str, api_key: str, timeout: float = 30) -> dict:
    """Ask Claude for a structured query. Sends the question and the schema only, never report data."""
    body = {"model": LLM_MODEL, "max_tokens": 1024, "system": _system_prompt(as_of),
            "messages": [{"role": "user", "content": question}]}
    req = urllib.request.Request(ANTHROPIC_URL, data=json.dumps(body).encode(), method="POST", headers={
        "content-type": "application/json", "x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        resp = json.loads(r.read())
    if resp.get("stop_reason") == "refusal":
        raise ValueError("the model declined the request")
    text = "".join(b.get("text", "") for b in resp.get("content") or [] if isinstance(b, dict) and b.get("type") == "text")
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("the model did not return JSON")
    return validate_query(json.loads(text[start:end + 1]))


def translate(question: str, as_of: str | None = None, mode: str = "auto") -> tuple[dict | None, str]:
    """mode: auto (parser, then LLM if a key is set), llm (LLM first, parser fallback), parser."""
    as_of = as_of or date.today().isoformat()
    key = os.environ.get("ANTHROPIC_API_KEY")
    parsed = parse_question(question, as_of) if mode != "llm" else None
    if parsed is not None:
        return parsed, "parser"
    if mode == "parser":
        return None, "unparsed"
    if not key:
        return (parse_question(question, as_of), "parser") if mode == "llm" and parse_question(question, as_of) else (None, "unparsed")
    try:
        return llm_query(question, as_of, key), "llm"
    except (OSError, ValueError, KeyError, TypeError) as e:
        fallback = parse_question(question, as_of) if mode == "llm" else None
        if fallback is not None:
            return fallback, "parser"
        return None, f"llm failed: {str(e)[:200]}"
