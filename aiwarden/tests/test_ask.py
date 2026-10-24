import io
import json
import threading
import urllib.request

import pytest

from aiwarden import query as q
from aiwarden.cli import main as cli_main
from aiwarden.fleetdata import build_facts
from aiwarden.server import Store, make_server

from fleet_fixtures import fleet

AS_OF = "2026-10-23"
TEAMS = {"teams": {"design": ["carol"]}}


def _facts():
    return build_facts(fleet(), TEAMS)


def _ask(text):
    query = q.parse_question(text, as_of=AS_OF)
    assert query is not None, text
    return query, q.run_query(query, _facts(), as_of=AS_OF)


def test_facts_resolve_teams():
    f = _facts()
    assert {d["team"] for d in f["devices"]} == {"platform", "data", "design"}
    assert any(r["app"] == "codex" and r["team"] == "platform" for r in f["usage"])


def test_which_teams_token_usage_doubled_this_month():
    query, res = _ask("which teams' token usage doubled this month?")
    assert query["entity"] == "usage" and query["group_by"] == ["team"] and query["compare"]["change_pct"] == 100
    teams = {r["team"]: r for r in res["rows"]}
    assert "platform" in teams and "data" not in teams
    assert teams["platform"]["value"] == 10400 and teams["platform"]["previous"] == 2000
    assert teams["design"]["previous"] == 0  # new usage counts as more than doubled


def test_increased_by_percent_and_decrease():
    _, res = _ask("which users' tokens increased by 15% this month")
    assert {r["user"] for r in res["rows"]} >= {"alice", "bob"}
    _, res = _ask("which apps' token usage dropped by 50% this week")
    assert all(r["value"] <= 0.5 * r["previous"] for r in res["rows"])


def test_which_claude_code_sessions_called_github_mcp():
    query, res = _ask("which Claude Code sessions called the github MCP?")
    assert query["entity"] == "sessions" and query["filters"] == {"app": "claude-code", "mcp_server": "github"}
    assert {r["id"] for r in res["rows"]} == {"s-a1", "s-c1"}  # s-a3 is codex
    assert all("hostname" in r for r in res["rows"])


def test_top_users_by_cost_last_30_days():
    query, res = _ask("top 2 users by cost in the last 30 days")
    assert query["metric"] == "cost_usd" and query["limit"] == 2
    assert [r["user"] for r in res["rows"]] == ["alice", "bob"]


def test_token_usage_by_app_for_team():
    _, res = _ask("token usage by app for team platform this month")
    assert {r["app"]: r["value"] for r in res["rows"]} == {"claude-code": 9400, "codex": 1000}


def test_findings_and_secrets_and_apps():
    _, res = _ask("show high findings by team")
    assert {r["team"]: r["value"] for r in res["rows"]} == {"platform": 1, "data": 1}
    _, res = _ask("which devices have plaintext secrets?")
    assert [r["hostname"] for r in res["rows"]] == ["alice-mbp"]
    _, res = _ask("which users have gemini cli installed")
    assert [r["user"] for r in res["rows"]] == ["bob"]


def test_mcp_calls_and_guard_blocks():
    _, res = _ask("most called mcp servers")
    assert res["rows"][0] == {"mcp_server": "github", "value": 6}
    _, res = _ask("guard blocks by user this week")
    assert res["rows"] == [{"user": "alice", "value": 3}]


def test_unknown_question_returns_none():
    assert q.parse_question("what is the meaning of life", as_of=AS_OF) is None


def test_validate_query_rejects_bad_fields():
    with pytest.raises(ValueError):
        q.validate_query({"entity": "usage", "group_by": ["password"]})
    with pytest.raises(ValueError):
        q.validate_query({"entity": "nope"})
    ok = q.validate_query({"entity": "sessions", "filters": {"mcp_server": "github"}})
    assert ok["metric"] == "count"


def test_structured_query_json_via_cli(tmp_path, capsys):
    p = tmp_path / "r.json"
    p.write_text(json.dumps(fleet()), encoding="utf-8")
    query = json.dumps({"entity": "usage", "metric": "tokens", "group_by": ["team"], "window": {"preset": "this_month"}})
    assert cli_main(["--home", str(tmp_path / "h"), "ask", "--report", str(p), "--query", query, "--as-of", AS_OF, "--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert {r["team"] for r in out["rows"]} == {"platform", "data", None}


# ---------- LLM mode ----------

class _FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_llm_mode_sends_schema_only(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    sent = {}

    def fake_urlopen(req, timeout=None):
        sent["url"], sent["headers"], sent["body"] = req.full_url, dict(req.header_items()), json.loads(req.data)
        answer = {"entity": "sessions", "filters": {"mcp_server": "sentry"}, "group_by": [], "metric": "count"}
        return _FakeResp(json.dumps({"stop_reason": "end_turn", "content": [{"type": "text", "text": json.dumps(answer)}]}).encode())

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    query, how = q.translate("list the sessions that touched sentry", as_of=AS_OF, mode="llm")
    assert how == "llm" and query["filters"] == {"mcp_server": "sentry"}
    body = sent["body"]
    assert body["model"] == "claude-sonnet-5-5" and "temperature" not in body
    assert sent["url"] == "https://api.anthropic.com/v1/messages"
    hdrs = {k.lower(): v for k, v in sent["headers"].items()}
    assert hdrs["x-api-key"] == "sk-ant-test" and hdrs["anthropic-version"]
    dump = json.dumps(body)
    for leak in ("alice", "bob-laptop", "dev-alice", "linear", "postgres", "platform", "s-a1", "10400"):
        assert leak not in dump


def test_llm_failure_falls_back_to_parser(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    def boom(req, timeout=None):
        return _FakeResp(json.dumps({"stop_reason": "end_turn", "content": [{"type": "text", "text": "not json"}]}).encode())

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    query, how = q.translate("which teams' token usage doubled this month?", as_of=AS_OF, mode="auto")
    assert how == "parser" and query["group_by"] == ["team"]
    query, how = q.translate("something the parser cannot read", as_of=AS_OF, mode="auto")
    assert query is None and how.startswith("llm failed")


def test_no_key_never_calls_network(monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: pytest.fail("network call"))
    query, how = q.translate("something the parser cannot read", as_of=AS_OF, mode="auto")
    assert query is None and how == "unparsed"


# ---------- collector source ----------

def test_ask_against_collector(tmp_path, capsys):
    db = tmp_path / "fleet.db"
    store = Store(db)
    for r in fleet():
        store.add(r)
    srv = make_server("127.0.0.1", 0, db, token="tok-123")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{srv.server_address[1]}"
        code = cli_main(["--home", str(tmp_path / "h"), "ask", "which Claude Code sessions called the github MCP?",
                         "--server", url, "--token", "tok-123", "--as-of", AS_OF])
    finally:
        srv.shutdown()
    out = capsys.readouterr().out
    assert code == 0 and "s-a1" in out and "s-c1" in out and "s-a3" not in out
