"""Stateful alert rules over fleet or local reports, for cron / Task Scheduler.

Rules:
  ALR001  token spike: day-over-day (today vs yesterday) and week-over-week (last 7 days vs the
          7 before), per user / team / app, above token_spike_pct and spike_min_tokens
  ALR002  cost spike: same, on estimated $ (cost_spike_pct, spike_min_cost_usd)
  ALR003  new MCP server configured on a device
  ALR004  new plaintext secret in an MCP config (redacted fingerprint only)
  ALR005  guard blocks on a device reached guard_blocks_threshold within guard_blocks_window_days
  ALR006  AI app newly installed on a device

State (~/.aiwarden/alerts_state.json) remembers every alert key already raised and the inventory
seen per device. The first run, and the first time a device is seen, record a baseline without
raising ALR003/4/6, so existing setups do not flood the channel.

Thresholds come from [alerts] in ~/.aiwarden/config.toml.
"""
from __future__ import annotations

import json
import urllib.request
from datetime import date, timedelta
from pathlib import Path

from .fleetdata import build_facts
from .query import run_query

DEFAULTS = {
    "token_spike_pct": 100.0,
    "spike_min_tokens": 100_000,
    "cost_spike_pct": 100.0,
    "spike_min_cost_usd": 5.0,
    "spike_group_by": ["user", "team", "app"],
    "spike_windows": ["day", "week"],
    "guard_blocks_threshold": 5,
    "guard_blocks_window_days": 1,
}
SEVERITY = {"ALR001": "medium", "ALR002": "medium", "ALR003": "medium", "ALR004": "high", "ALR005": "high", "ALR006": "low"}
_MAX_SEEN = 20_000


def settings(config: dict | None) -> dict:
    s = dict(DEFAULTS)
    for k, v in ((config or {}).get("alerts") or {}).items():
        d = DEFAULTS.get(k)
        if isinstance(d, list) and isinstance(v, list):
            s[k] = [str(x) for x in v]
        elif isinstance(d, (int, float)) and isinstance(v, (int, float)) and not isinstance(v, bool):
            s[k] = v
    return s


def load_state(path: Path) -> dict:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_state(path: Path, state: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def _alert(rule: str, key: str, title: str, detail: str, **extra) -> dict:
    return {"id": key, "rule": rule, "severity": SEVERITY[rule], "title": title, "detail": detail, **extra}


def _who(rec: dict) -> dict:
    return {k: rec.get(k) for k in ("device", "hostname", "user", "team")}


def _spikes(facts, s, as_of: date) -> list[dict]:
    out = []
    windows = {"day": {"since": as_of.isoformat(), "until": as_of.isoformat()},
               "week": {"since": (as_of - timedelta(days=6)).isoformat(), "until": as_of.isoformat()}}
    for metric, rule, pct, floor in (("tokens", "ALR001", s["token_spike_pct"], s["spike_min_tokens"]),
                                     ("cost_usd", "ALR002", s["cost_spike_pct"], s["spike_min_cost_usd"])):
        for wname in s["spike_windows"]:
            if wname not in windows:
                continue
            for dim in s["spike_group_by"]:
                res = run_query({"entity": "usage", "metric": metric, "group_by": [dim], "window": windows[wname],
                                 "compare": {"direction": "increase", "change_pct": pct}, "limit": 1000}, facts, as_of)
                for row in res["rows"]:
                    if row.get(dim) is None or row["value"] < floor:
                        continue
                    label = "day-over-day" if wname == "day" else "week-over-week"
                    unit = "tokens" if metric == "tokens" else "USD"
                    prev = row["previous"]
                    change = f"+{row['change_pct']}%" if row["change_pct"] is not None else "new"
                    # day spikes alert once per day; week spikes once per ISO week
                    y, w, _ = as_of.isocalendar()
                    key = f"{rule}:{wname}:{dim}={row[dim]}:" + (res["window"]["until"] if wname == "day" else f"{y}-W{w:02d}")
                    out.append(_alert(rule, key, f"{'Token' if metric == 'tokens' else 'Cost'} spike for {dim} {row[dim]} ({label})",
                                      f"{row['value']:,} {unit} in {res['window']['since']}..{res['window']['until']}, previous {prev:,} ({change})",
                                      group={dim: row[dim]}, window=wname, value=row["value"], previous=prev))
    return out


def evaluate_alerts(reports: list[dict], config: dict | None, state: dict | None, as_of: str | date | None = None,
                    alert_existing: bool = False) -> tuple[list[dict], dict]:
    """Returns (new alerts, updated state). Pure: the caller saves state and sends notifications."""
    as_of_d = date.fromisoformat(as_of) if isinstance(as_of, str) else (as_of or date.today())
    s = settings(config)
    state = json.loads(json.dumps(state or {}))
    seen: dict[str, str] = state.setdefault("seen", {})
    devices: dict[str, dict] = state.setdefault("devices", {})
    first_run = not state.get("initialized")
    facts = build_facts(reports, config)
    candidates = _spikes(facts, s, as_of_d)

    # inventory alerts, keyed per device
    inv: dict[str, list[tuple[str, dict]]] = {}
    for m in facts["mcp_servers"]:
        key = f"ALR003:{m['device']}:{m['client']}:{m['mcp_server']}"
        inv.setdefault(m["device"], []).append((key, _alert(
            "ALR003", key, f"New MCP server '{m['mcp_server']}' in {m['client']} on {m['hostname']}",
            f"transport {m['transport']}, {m.get('package') or m.get('url') or 'local command'}", **_who(m))))
    raw = {r.get("device", {}).get("id"): r for r in reports}
    for f in facts["findings"]:
        if f["rule"] != "MCP001":
            continue
        detail = next((x.get("detail", "") for x in raw.get(f["device"], {}).get("findings", [])
                       if x.get("subject") == f["subject"] and x.get("title") == f["title"]), "")
        key = f"ALR004:{f['device']}:{f['subject']}:{f['title']}"
        inv.setdefault(f["device"], []).append((key, _alert(
            "ALR004", key, f"New plaintext secret on {f['hostname']}: {f['title']}", detail[:300], **_who(f))))
    for a in facts["apps"]:
        key = f"ALR006:{a['device']}:{a['app']}"
        inv.setdefault(a["device"], []).append((key, _alert(
            "ALR006", key, f"AI app {a['name']} newly installed on {a['hostname']}", f"user {a['user']}", **_who(a))))
    for d in facts["devices"]:
        known = d["device"] in devices
        baseline = (first_run or not known) and not alert_existing
        for key, alert in inv.get(d["device"], []):
            if baseline:
                seen.setdefault(key, as_of_d.isoformat())
            else:
                candidates.append(alert)
        devices[d["device"]] = {"hostname": d["hostname"], "user": d["user"], "last_seen": as_of_d.isoformat()}

    # guard blocks
    since = (as_of_d - timedelta(days=int(s["guard_blocks_window_days"]) - 1)).isoformat()
    res = run_query({"entity": "guard_events", "filters": {"action": "deny"}, "group_by": ["device", "hostname", "user", "team"],
                     "window": {"since": since, "until": as_of_d.isoformat()}, "limit": 1000}, facts, as_of_d)
    for row in res["rows"]:
        if row["value"] >= s["guard_blocks_threshold"]:
            key = f"ALR005:{row['device']}:{as_of_d.isoformat()}"
            candidates.append(_alert("ALR005", key, f"{row['value']} guard blocks on {row['hostname']} since {since}",
                                     f"threshold {s['guard_blocks_threshold']}; user {row['user']}", value=row["value"],
                                     **{k: row.get(k) for k in ("device", "hostname", "user", "team")}))

    new = []
    for a in candidates:
        if a["id"] in seen:
            continue
        seen[a["id"]] = as_of_d.isoformat()
        new.append(a)
    if len(seen) > _MAX_SEEN:  # keep the most recent keys
        state["seen"] = dict(sorted(seen.items(), key=lambda kv: kv[1])[-_MAX_SEEN:])
    state["initialized"] = True
    state["last_run"] = as_of_d.isoformat()
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    new.sort(key=lambda a: (order.get(a["severity"], 9), a["rule"], a["id"]))
    return new, state


def slack_payload(alerts: list[dict]) -> dict:
    """Slack incoming-webhook JSON (also accepted by Mattermost / Rocket.Chat / Teams workflows that take `text`)."""
    lines = [f"*[{a['severity'].upper()}] {a['rule']}* {a['title']}\n{a['detail']}" for a in alerts[:40]]
    if len(alerts) > 40:
        lines.append(f"... and {len(alerts) - 40} more")
    text = f"aiwarden: {len(alerts)} new alert{'s' if len(alerts) != 1 else ''}"
    return {"text": text, "blocks": [{"type": "section", "text": {"type": "mrkdwn", "text": text}}] +
            [{"type": "section", "text": {"type": "mrkdwn", "text": line[:2900]}} for line in lines]}


def post_webhook(url: str, payload: dict, timeout: float = 15) -> int:
    if not url.lower().startswith(("https://", "http://")):
        raise ValueError("webhook must be an http(s) URL")
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        r.read()
        return getattr(r, "status", 200)
