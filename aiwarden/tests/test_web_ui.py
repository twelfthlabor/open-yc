"""The web console: packaged assets, strict CSP, and the read-only API it uses (ask, weekly, alerts, rules, check)."""
import json
import threading
import urllib.error
import urllib.request

import pytest

from aiwarden.server import make_server, push_report, ui_files

from fleet_fixtures import fleet

TOKEN = "s3cret-token"


@pytest.fixture
def server(tmp_path):
    srv = make_server("127.0.0.1", 0, tmp_path / "fleet.db", token=TOKEN, config={"teams": {"data": ["carol"]}})
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    url = f"http://127.0.0.1:{srv.server_address[1]}"
    for r in fleet():
        push_report(url, TOKEN, r)
    yield url
    srv.shutdown()


def _req(url, method="GET", body=None, token=TOKEN, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def test_ui_is_packaged_with_its_assets():
    files = ui_files()
    assert "/" in files and b'<div id="root">' in files["/"][0]
    assets = [p for p in files if p.startswith("/assets/")]
    assert any(p.endswith(".js") for p in assets) and any(p.endswith(".css") for p in assets)
    for p, (_, ctype) in files.items():
        assert ctype != "application/octet-stream", p


def test_index_and_assets_are_served_with_strict_csp(server):
    status, headers, body = _req(server + "/", token=None)
    assert status == 200 and b'<div id="root">' in body
    csp = headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "unsafe-inline" not in csp and "frame-ancestors 'none'" in csp
    asset = next(p for p in ui_files() if p.endswith(".js"))
    status, headers, body = _req(server + asset, token=None)
    assert status == 200 and headers["Content-Type"].startswith("text/javascript") and body
    assert headers["X-Content-Type-Options"] == "nosniff"


@pytest.mark.parametrize("path", ["/assets/../server.py", "/assets/%2e%2e/server.py", "/assets/nope.js",
                                  "/static/app/index.html", "/assets/", "/server.py", "/..%2fserver.py"])
def test_only_packaged_files_are_served(server, path):
    status, _, body = _req(server + path, token=None)
    assert status == 404 and b"import" not in body


def test_head_matches_get(server):
    asset = next(p for p in ui_files() if p.endswith(".css"))
    assert _req(server + asset, method="HEAD", token=None)[0] == 200
    assert _req(server + "/assets/missing.css", method="HEAD", token=None)[0] == 404


@pytest.mark.parametrize("method,path,body", [("GET", "/api/rules", None), ("GET", "/api/weekly", None),
                                               ("GET", "/api/alerts", None), ("POST", "/api/ask", {"question": "guard blocks"}),
                                               ("POST", "/api/check", {"tool": "Bash", "input": {"command": "ls"}})])
def test_new_endpoints_need_the_token(server, method, path, body):
    assert _req(server + path, method, body, token=None)[0] == 401
    assert _req(server + path, method, body, token="wrong")[0] == 401


def test_rules_lists_guard_and_mcp_rules(server):
    status, _, body = _req(server + "/api/rules")
    data = json.loads(body)
    assert status == 200
    guard = {r["id"]: r for r in data["guard"]}
    assert guard["GRD001"]["action"] == "deny" and guard["GRD001"]["description"]
    assert any(r["id"] == "MCPX001" for r in data["mcp_scan"])


def test_check_evaluates_with_builtin_policy(server):
    status, _, body = _req(server + "/api/check", "POST", {"agent": "claude-code", "tool": "Bash",
                                                            "input": {"command": "git push --force origin main"}})
    d = json.loads(body)
    assert status == 200 and d["action"] == "deny" and d["rule"] == "GRD020"
    d = json.loads(_req(server + "/api/check", "POST", {"tool": "Bash", "input": {"command": "git status"}})[2])
    assert d["action"] == "allow"
    d = json.loads(_req(server + "/api/check", "POST", {"agent": "codex", "tool": "shell",
                                                         "input": {"command": ["bash", "-lc", "rm -rf ~"]}})[2])
    assert d["action"] == "deny"


@pytest.mark.parametrize("body", [{"tool": "Bash"}, {"tool": 3, "input": {}}, {"agent": "evil", "tool": "Bash", "input": {}},
                                  {"tool": "Bash", "input": "rm -rf /"}, [], {"tool": "x" * 300, "input": {}}])
def test_check_rejects_bad_input(server, body):
    assert _req(server + "/api/check", "POST", body)[0] == 422


def test_check_and_ask_reject_bad_json_and_huge_bodies(server):
    assert _req(server + "/api/check", "POST", raw=b"{nope")[0] == 400
    assert _req(server + "/api/ask", "POST", raw=b"x" * (70 * 1024))[0] == 413


def test_ask_parses_and_runs_over_the_fleet(server):
    status, _, body = _req(server + "/api/ask", "POST", {"question": "guard blocks by user", "as_of": "2026-10-23"})
    d = json.loads(body)
    assert status == 200 and d["translated_by"] == "parser"
    assert d["query"]["entity"] == "guard_events"
    assert {r["user"]: r["value"] for r in d["result"]["rows"]} == {"alice": 3}


def test_ask_uses_server_team_config(server):
    d = json.loads(_req(server + "/api/ask", "POST", {"query": {"entity": "devices", "group_by": ["team"]}})[2])
    assert {r["team"] for r in d["result"]["rows"]} == {"platform", "data"}


def test_ask_never_calls_an_llm_by_default(server, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setattr("aiwarden.query.llm_query", lambda *a, **k: pytest.fail("LLM called"))
    status, _, body = _req(server + "/api/ask", "POST", {"question": "what is the meaning of life"})
    assert status == 422 and "understand" in json.loads(body)["error"]


@pytest.mark.parametrize("body", [{}, {"question": ""}, {"question": 5}, {"query": {"entity": "nope"}}, {"question": "x" * 600}])
def test_ask_rejects_bad_input(server, body):
    assert _req(server + "/api/ask", "POST", body)[0] == 422


def test_weekly_and_alerts(server):
    w = json.loads(_req(server + "/api/weekly?as_of=2026-10-23")[2])
    assert w["devices"] == 3 and w["as_of"] == "2026-10-23" and w["totals"]["tokens"]["current"] > 0
    assert _req(server + "/api/weekly?as_of=bad")[0] == 422
    a = json.loads(_req(server + "/api/alerts?as_of=2026-10-23")[2])
    rules = {x["rule"] for x in a["alerts"]}
    assert "ALR004" in rules and "ALR003" in rules  # current state, not a baseline


def test_fleet_api_contract_unchanged(server):
    f = json.loads(_req(server + "/api/fleet")[2])
    assert {"devices", "totals", "findings", "usage", "guard_events", "browser", "apps", "mcp_packages"} <= set(f)
    dev = f["devices"][0]["id"]
    assert json.loads(_req(f"{server}/api/devices/{dev}")[2])["device"]["id"] == dev


def test_hosted_demo_is_read_only_and_serves_the_fleet(tmp_path):
    from http.server import ThreadingHTTPServer
    from aiwarden.demo import DEMO_CONFIG, populate
    from aiwarden.server import Store, make_handler
    store = Store(tmp_path / "demo.db")
    populate(store)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(store, TOKEN, config=DEMO_CONFIG, read_only=True))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        fleet = json.loads(_req(url + "/api/fleet")[2])
        assert fleet["totals"]["devices"] == 6 and fleet["totals"]["browser_events"] > 0
        assert _req(url + "/api/reports", "POST", {"schema": "aiwarden.report/v1", "device": {"id": "x"}})[0] == 403
        assert _req(url + "/api/browser-events", "POST", {"schema": "aiwarden.browser-events/v1"})[0] == 403
        assert json.loads(_req(url + "/api/check", "POST", {"tool": "Bash", "input": {"command": "rm -rf ~"}})[2])["action"] == "deny"
        assert _req(url + "/api/fleet", token="wrong")[0] == 401
        assert _req(url + "/", token=None)[0] == 404  # the host serves the console statically
    finally:
        srv.shutdown()
