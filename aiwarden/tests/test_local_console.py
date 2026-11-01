"""The local console: `aiwarden serve --local` needs no token on loopback, refuses requests that did not come
from the console itself, can rescan this device, and serves the insights the console's Insights page reads.
The hosted demo serves the same endpoints read-only."""
import json
import threading
import time
import urllib.error
import urllib.request

import pytest

from aiwarden.apps import discover_claude_config
from aiwarden.server import Store, insights, make_handler, make_server

from fleet_fixtures import fleet


def _req(url, method="GET", body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _serve(srv):
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


@pytest.fixture
def local(tmp_path):
    scans = []

    def rescan():
        scans.append(1)
        r = fleet()[0]
        r["generated_at"] = "2026-10-26T12:00:00+00:00"
        return r

    srv = make_server("127.0.0.1", 0, tmp_path / "fleet.db", token=None, mode="local", rescan=rescan)
    for r in fleet():
        Store(tmp_path / "fleet.db").add(r)
    port = _serve(srv)
    yield f"http://127.0.0.1:{port}", port, scans
    srv.shutdown()


def test_local_console_needs_no_token(local):
    url, _, _ = local
    code, body = _req(url + "/api/fleet")
    assert code == 200 and json.loads(body)["totals"]["devices"] == 3
    meta = json.loads(_req(url + "/api/meta")[1])
    assert meta["mode"] == "local" and meta["auth"] == "none" and meta["rescan"]["available"] is True


def test_local_console_refuses_other_hosts_and_origins(local):
    url, port, _ = local
    # DNS rebinding: a page on evil.example resolved to 127.0.0.1 still sends its own Host header
    assert _req(url + "/api/fleet", headers={"Host": f"evil.example:{port}"})[0] == 403
    assert _req(url + "/api/fleet", headers={"Origin": "http://evil.example"})[0] == 403
    assert _req(url + "/api/fleet", headers={"Host": f"localhost:{port}", "Origin": f"http://localhost:{port}"})[0] == 200
    assert _req(url + "/api/ask", "POST", {"question": "top 5 users by cost"}, headers={"Origin": "http://evil.example"})[0] == 403


def test_local_console_refuses_uploads(local):
    url, _, _ = local
    assert _req(url + "/api/reports", "POST", {"schema": "aiwarden.report/v1", "device": {"id": "x"}})[0] == 403
    assert _req(url + "/api/browser-events", "POST", {"schema": "aiwarden.browser-events/v1"})[0] == 403


def test_rescan_runs_in_the_background(local):
    url, _, scans = local
    code, body = _req(url + "/api/rescan", "POST", {})
    assert code == 202
    for _ in range(100):
        meta = json.loads(_req(url + "/api/meta")[1])
        if not meta["rescan"]["running"] and meta["rescan"]["last"]:
            break
        time.sleep(0.05)
    assert scans == [1] and meta["rescan"]["error"] is None


def test_tokenless_mode_is_loopback_only(tmp_path):
    with pytest.raises(ValueError):
        make_server("0.0.0.0", 0, tmp_path / "f.db", token=None, mode="local")


def test_token_mode_still_needs_the_token(tmp_path):
    srv = make_server("127.0.0.1", 0, tmp_path / "f.db", token="t0ken-abc")
    port = _serve(srv)
    try:
        assert _req(f"http://127.0.0.1:{port}/api/fleet")[0] == 401
        assert _req(f"http://127.0.0.1:{port}/api/meta")[0] == 401
        meta = json.loads(_req(f"http://127.0.0.1:{port}/api/meta", headers={"Authorization": "Bearer t0ken-abc"})[1])
        assert meta == {"mode": "collector", "auth": "token", "read_only": False, "rescan": {"available": False, "running": False, "last": None, "error": None}}
        assert _req(f"http://127.0.0.1:{port}/api/rescan", "POST", {}, headers={"Authorization": "Bearer t0ken-abc"})[0] == 404
    finally:
        srv.shutdown()


def test_insights_group_projects_per_device_and_cap_lists():
    ins = insights(fleet())
    assert {"sessions", "projects", "tools", "mcp_calls", "risky_events", "agents", "tokens", "pricing"} <= set(ins)
    assert ins["sessions"] and all("hostname" in s and "start" in s for s in ins["sessions"])
    assert len(ins["sessions"]) <= 500 and len(ins["risky_events"]) <= 300
    keys = [(p["device_id"], p["project"]) for p in ins["projects"]]
    assert len(keys) == len(set(keys))  # the same path on two laptops stays two rows
    assert ins["tokens"]["cache_read_tokens"] >= 0


def test_hosted_demo_serves_meta_and_full_insights(tmp_path):
    from http.server import ThreadingHTTPServer
    from aiwarden.demo import DEMO_CONFIG, populate
    store = Store(tmp_path / "demo.db")
    populate(store)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(store, "tok", config=DEMO_CONFIG, read_only=True, mode="demo"))
    port = _serve(srv)
    auth = {"Authorization": "Bearer tok"}
    try:
        meta = json.loads(_req(f"http://127.0.0.1:{port}/api/meta", headers=auth)[1])
        assert meta["mode"] == "demo" and meta["read_only"] is True and meta["rescan"]["available"] is False
        assert _req(f"http://127.0.0.1:{port}/api/rescan", "POST", {}, headers=auth)[0] in (403, 404)
        ins = json.loads(_req(f"http://127.0.0.1:{port}/api/insights", headers=auth)[1])
        # every section the Insights page draws has data in the demo, so it looks the way a real fleet does
        assert ins["projects"] and ins["tools"] and ins["mcp_calls"] and ins["risky_events"] and ins["sessions"]
        assert any(a["hooks"] for a in ins["agents"]) and ins["pricing"]["unpriced_models"]
        report = json.loads(_req(f"http://127.0.0.1:{port}/api/devices/dev-maya", headers=auth)[1])
        assert any((e.get("meta") or {}).get("calls") for e in report["graph"]["edges"])
    finally:
        srv.shutdown()


def test_claude_settings_are_read_once_when_home_is_a_project(fake_home):
    home = fake_home.home
    cfg = json.loads((home / ".claude.json").read_text(encoding="utf-8"))
    cfg["projects"][str(home)] = {}
    (home / ".claude.json").write_text(json.dumps(cfg), encoding="utf-8")
    s = json.loads((home / ".claude" / "settings.json").read_text(encoding="utf-8"))
    s["hooks"] = {"Stop": [{"hooks": [{"type": "command", "command": "notify"}]}]}
    (home / ".claude" / "settings.json").write_text(json.dumps(s), encoding="utf-8")
    c = discover_claude_config(fake_home)
    assert len(c["settings_files"]) == len(set(c["settings_files"]))
    assert [h["command"] for h in c["hooks"]] == ["notify"]
    assert c["permissions"]["allow"].count("Bash(*)") == 1
