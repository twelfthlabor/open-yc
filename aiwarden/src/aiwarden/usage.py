"""Activity from local agent transcripts: tokens, tool calls, MCP calls, risky actions.

Metadata only by default. With include_content=True, risky events carry the (secret-scrubbed,
truncated) command or path that triggered them.
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterator

from .agents import evaluate_agent, split_mcp
from .env import Env
from .policy import Policy, subject_of
from .pricing import PRICES_AS_OF, cost_of, input_includes_cache, price_for
from .secrets import scrub

TOKEN_KEYS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens")


def _tokens() -> dict:
    return dict.fromkeys(TOKEN_KEYS, 0)


def _add(dst: dict, src: dict, cost: float | None = None) -> None:
    for k in TOKEN_KEYS:
        dst[k] += int(src.get(k) or 0)
    if cost is not None:
        dst["cost_usd"] = dst.get("cost_usd", 0.0) + cost


def _round_costs(obj):
    if isinstance(obj, dict):
        return {k: (round(v, 6) if k in ("cost_usd", "total_usd") and isinstance(v, float) else _round_costs(v))
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [_round_costs(v) for v in obj]
    return obj


def _lines(path: Path, must_contain: str | None = None) -> Iterator[dict]:
    try:
        with path.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line or (must_contain and must_contain not in line):
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue
                if isinstance(obj, dict):
                    yield obj
    except OSError:
        return


def _safe_glob(base: Path, pattern: str) -> list[Path]:
    try:
        return sorted(base.glob(pattern)) if base.is_dir() else []
    except OSError:
        return []


class _Acc:
    def __init__(self, policy: Policy, include_content: bool, prices: dict | None = None):
        self.policy = policy
        self.include_content = include_content
        self.prices = prices
        self.unpriced: set[str] = set()
        self.by_day_app: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(_tokens))
        self.by_day_model: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(_tokens))
        self.by_app: dict[str, dict] = defaultdict(lambda: {**_tokens(), "sessions": 0, "tool_calls": 0})
        self.by_model: dict[str, dict] = defaultdict(lambda: {**_tokens(), "messages": 0})
        self.by_day: dict[str, dict] = defaultdict(_tokens)
        self.by_project: dict[str, dict] = defaultdict(_tokens)
        self.tools: Counter = Counter()
        self.mcp_calls: dict[str, Counter] = defaultdict(Counter)
        self.risky: list[dict] = []
        self.sessions: dict[tuple[str, str], dict] = {}

    def session(self, app: str, sid: str, project: str | None) -> dict:
        key = (app, sid)
        if key not in self.sessions:
            self.sessions[key] = {"app": app, "id": sid, "project": project, "start": None, "end": None,
                                  "models": [], "model_tokens": {}, **_tokens(), "tool_calls": 0, "mcp_servers": []}
            self.by_app[app]["sessions"] += 1
        s = self.sessions[key]
        if project and not s["project"]:
            s["project"] = project
        return s

    @staticmethod
    def touch(s: dict, ts: str | None) -> None:
        if ts:
            s["start"] = min(filter(None, [s["start"], ts]))
            s["end"] = max(filter(None, [s["end"], ts]))

    def tokens(self, app: str, s: dict, model: str | None, ts: str | None, t: dict) -> None:
        cost = cost_of(model, t, input_includes_cache(app), self.prices)
        if cost is None and any(t.get(k) for k in TOKEN_KEYS):
            self.unpriced.add(model or "(unknown model)")
        _add(self.by_app[app], t, cost)
        _add(s, t, cost)
        if model:
            _add(self.by_model[model], t, cost)
            self.by_model[model]["messages"] += 1
            if model not in s["models"]:
                s["models"].append(model)
            s["model_tokens"][model] = s["model_tokens"].get(model, 0) + int(t.get("input_tokens") or 0) + int(t.get("output_tokens") or 0)
        if ts:
            _add(self.by_day[ts[:10]], t, cost)
            _add(self.by_day_app[ts[:10]][app], t, cost)
            _add(self.by_day_model[ts[:10]][model or "(unknown model)"], t, cost)
        if s["project"]:
            _add(self.by_project[s["project"]], t, cost)

    def tool(self, app: str, s: dict, name: str, inp: dict, ts: str | None) -> None:
        self.by_app[app]["tool_calls"] += 1
        s["tool_calls"] += 1
        self.tools[name] += 1
        mcp = split_mcp(name, inp)
        if mcp is None and app == "gemini-cli" and "__" in name:  # server__tool spelling
            server, _, rest = name.partition("__")
            mcp = (server, rest)
        if mcp:
            server, tool = mcp
            self.mcp_calls[server][tool] += 1
            if server not in s["mcp_servers"]:
                s["mcp_servers"].append(server)
        d = evaluate_agent(app, name, inp, self.policy)
        if d.rule:
            ev = {"app": app, "session": s["id"], "project": s["project"], "timestamp": ts, "tool": name,
                  "rule": d.rule, "action": d.would_be or d.action, "reason": d.reason}
            if self.include_content:
                ev["subject"] = scrub(subject_of(name, inp))[:300]
            self.risky.append(ev)

    def result(self) -> dict:
        unverified = sorted(m for m in self.by_model if (p := price_for(m, self.prices)) and not p.get("verified"))
        return _round_costs({
            "by_app": dict(self.by_app),
            "by_model": dict(self.by_model),
            "by_day": dict(sorted(self.by_day.items())),
            "by_project": dict(self.by_project),
            "tools": dict(self.tools.most_common()),
            "mcp_calls": {k: dict(v) for k, v in self.mcp_calls.items()},
            "risky_events": sorted(self.risky, key=lambda e: e["timestamp"] or ""),
            "sessions": sorted(self.sessions.values(), key=lambda s: s["start"] or "", reverse=True),
            "by_day_app": {d: dict(v) for d, v in sorted(self.by_day_app.items())},
            "by_day_model": {d: dict(v) for d, v in sorted(self.by_day_model.items())},
            "cost": {"total_usd": sum(v.get("cost_usd", 0.0) for v in self.by_model.values()),
                     "prices_as_of": PRICES_AS_OF, "unpriced_models": sorted(self.unpriced),
                     "unverified_price_models": unverified},
        })


def _before(ts: str | None, since: str | None) -> bool:
    return bool(since) and (not ts or ts[:10] < since)


def _claude_code(env: Env, acc: _Acc, since: str | None) -> None:
    seen_msgs: set[str] = set()
    seen_tools: set[str] = set()
    for path in _safe_glob(env.home / ".claude" / "projects", "**/*.jsonl"):
        for obj in _lines(path, must_contain='"assistant"'):
            ts = obj.get("timestamp")
            msg = obj.get("message")
            if _before(ts, since) or obj.get("type") != "assistant" or not isinstance(msg, dict):
                continue
            if msg.get("model") == "<synthetic>":  # locally generated placeholder, not an API call
                continue
            s = acc.session("claude-code", str(obj.get("sessionId") or path.stem), obj.get("cwd"))
            acc.touch(s, ts)
            mid = msg.get("id") or obj.get("uuid")
            usage = msg.get("usage")
            if isinstance(usage, dict) and mid and mid not in seen_msgs:
                seen_msgs.add(mid)
                acc.tokens("claude-code", s, msg.get("model"), ts, {
                    "input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens"),
                    "cache_read_tokens": usage.get("cache_read_input_tokens"),
                    "cache_write_tokens": usage.get("cache_creation_input_tokens")})
            content = msg.get("content")
            for block in content if isinstance(content, list) else []:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    bid = block.get("id") or f"{mid}:{block.get('name')}"
                    if bid in seen_tools:
                        continue
                    seen_tools.add(bid)
                    inp = block.get("input") if isinstance(block.get("input"), dict) else {}
                    acc.tool("claude-code", s, str(block.get("name") or "?"), inp, ts)


def _codex_args(p: dict) -> tuple[str, dict]:
    if p.get("type") == "local_shell_call":
        action = p.get("action") if isinstance(p.get("action"), dict) else {}
        return "shell", action
    raw = p.get("arguments") if p.get("arguments") is not None else p.get("input")
    try:
        args = json.loads(raw) if isinstance(raw, str) else (raw or {})
    except ValueError:
        args = {"input": raw}
    return str(p.get("name") or "?"), args if isinstance(args, dict) else {"input": args}


def _codex(env: Env, acc: _Acc, since: str | None) -> None:
    for path in _safe_glob(env.home / ".codex" / "sessions", "**/*.jsonl"):
        sid, cwd, model, last_total, last_ts = path.stem, None, None, None, None
        calls: list[tuple[str, dict, str | None]] = []
        for obj in _lines(path):
            ts = obj.get("timestamp")
            p = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
            kind = obj.get("type")
            if kind in {"session_meta", "turn_context"}:
                sid = str(p.get("id") or sid) if kind == "session_meta" else sid
                cwd = p.get("cwd") or cwd
                model = p.get("model") or model
            elif kind == "event_msg" and p.get("type") == "token_count":
                info = p.get("info") if isinstance(p.get("info"), dict) else {}
                if isinstance(info.get("total_token_usage"), dict):
                    last_total, last_ts = info["total_token_usage"], ts
            elif kind == "response_item" and p.get("type") in {"function_call", "local_shell_call", "custom_tool_call"}:
                if not _before(ts, since):
                    calls.append((*_codex_args(p), ts))
        count_tokens = bool(last_total) and not _before(last_ts, since)
        if not calls and not count_tokens:
            continue
        s = acc.session("codex", sid, cwd)
        for name, args, ts in calls:
            acc.touch(s, ts)
            acc.tool("codex", s, name, args, ts)
        if count_tokens:
            acc.touch(s, last_ts)
            acc.tokens("codex", s, model, last_ts, {
                "input_tokens": last_total.get("input_tokens"), "output_tokens": last_total.get("output_tokens"),
                "cache_read_tokens": last_total.get("cached_input_tokens"), "cache_write_tokens": 0})


def _gemini_messages(path: Path) -> tuple[dict, list[dict]]:
    """A Gemini CLI chat file: legacy session-*.json (one ConversationRecord with "messages") or
    newer .jsonl (one record per line; a message re-recorded with the same id replaces the earlier copy)."""
    meta: dict = {}
    by_id: dict[str, dict] = {}
    if path.suffix == ".json":
        try:
            doc = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):
            return meta, []
        records = [doc] if isinstance(doc, dict) else []
    else:
        records = list(_lines(path))
    for rec in records:
        for k in ("sessionId", "projectHash", "directories"):
            if rec.get(k) and k not in meta:
                meta[k] = rec[k]
        msgs = rec["messages"] if isinstance(rec.get("messages"), list) else ([rec] if rec.get("type") else [])
        for i, m in enumerate(msgs):
            if isinstance(m, dict):
                by_id[str(m.get("id") or f"{path.name}:{len(by_id)}:{i}")] = m
    return meta, list(by_id.values())


def _gemini(env: Env, acc: _Acc, since: str | None) -> None:
    # Gemini CLI records chats under ~/.gemini/tmp/<project hash>/chats/ (ChatRecordingService).
    # Field names (type "gemini", tokens.{input,output,cached,thoughts}, toolCalls[].{name,args}) follow
    # the on-disk schema described at https://docs.rs/toolpath-gemini; the fixtures are synthetic.
    base = env.home / ".gemini" / "tmp"
    seen: set[tuple[str, str]] = set()
    for path in _safe_glob(base, "*/chats/**/*.json") + _safe_glob(base, "*/chats/**/*.jsonl"):
        meta, msgs = _gemini_messages(path)
        dirs = meta.get("directories")
        project = dirs[0] if isinstance(dirs, list) and dirs and isinstance(dirs[0], str) else (
            f"gemini:{str(meta['projectHash'])[:12]}" if meta.get("projectHash") else None)
        sid = str(meta.get("sessionId") or path.stem)
        for m in msgs:
            ts = m.get("timestamp") if isinstance(m.get("timestamp"), str) else None
            if m.get("type") != "gemini" or _before(ts, since):
                continue
            key = (sid, str(m.get("id")))
            if m.get("id") and key in seen:
                continue
            seen.add(key)
            s = acc.session("gemini-cli", sid, project)
            acc.touch(s, ts)
            tok = m.get("tokens") if isinstance(m.get("tokens"), dict) else None
            if tok:
                # tokens.input includes cached prompt tokens; thoughts are billed as output.
                model = m.get("model") if isinstance(m.get("model"), str) else None
                acc.tokens("gemini-cli", s, model, ts, {
                    "input_tokens": tok.get("input"),
                    "output_tokens": int(tok.get("output") or 0) + int(tok.get("thoughts") or 0),
                    "cache_read_tokens": tok.get("cached"), "cache_write_tokens": 0})
            for call in m.get("toolCalls") or []:
                if isinstance(call, dict) and call.get("name"):
                    args = call.get("args") if isinstance(call.get("args"), dict) else {}
                    acc.tool("gemini-cli", s, str(call["name"]), args, call.get("timestamp") or ts)


def collect_usage(env: Env, since: str | None = None, include_content: bool = False, policy: Policy | None = None,
                  prices: dict | None = None) -> dict:
    """since: ISO date (YYYY-MM-DD); activity before it is ignored. prices: a pricing.load_prices() table."""
    acc = _Acc(policy or Policy(), include_content, prices)
    _claude_code(env, acc, since)
    _codex(env, acc, since)
    _gemini(env, acc, since)
    return acc.result()
