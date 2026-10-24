import json
import threading
import urllib.error
import urllib.request

import pytest

from aiwarden.cli import main as cli_main
from aiwarden.report import build_report
from aiwarden.server import make_server, push_report

from conftest import ANTH_KEY, GH_TOKEN
from test_usage_guard import _claude_transcript


def _report(env):
    _claude_transcript(env)
    return build_report(env, processes=[])


def test_report_shape_and_no_leaks(fake_home):
    r = _report(fake_home)
    assert r["schema"] == "aiwarden.report/v1"
    assert r["device"]["id"] and r["summary"]["mcp_servers"] >= 14
    assert r["summary"]["plaintext_secrets"] >= 3
    assert r["summary"]["findings"]["high"] >= 3
    dump = json.dumps(r)
    for s in (GH_TOKEN, ANTH_KEY, "hunter22", "rm -rf", "clean up the repo"):
        assert s not in dump


def test_graph_connects_apps_mcp_packages_models(fake_home):
    g = _report(fake_home)["graph"]
    nodes = {n["id"]: n for n in g["nodes"]}
    edges = {(e["source"], e["target"], e["type"]) for e in g["edges"]}
    assert ("app:claude-code", "mcp:claude-code:user:github", "configures") in edges
    assert ("mcp:claude-code:user:github", "pkg:@modelcontextprotocol/server-github", "runs") in edges
    assert ("mcp:cursor:user:remote-tools", "host:tools.corp.example.com", "connects_to") in edges
    assert ("app:claude-code", "model:claude-sonnet-4-5", "uses_model") in edges
    assert ("app:claude-code", "skill:deploy", "has_skill") in edges
    assert nodes["mcp:claude-code:user:github"]["meta"]["max_severity"] == "high"
    calls = [e for e in g["edges"] if e["source"] == "app:claude-code" and e["target"] == "mcp:claude-code:user:github"]
    assert calls[0]["meta"]["calls"] == 1
    for e in g["edges"]:
        assert e["source"] in nodes and e["target"] in nodes, e


@pytest.fixture
def server(tmp_path):
    srv = make_server("127.0.0.1", 0, tmp_path / "fleet.db", token="s3cret-token")
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def _get(url, token=None):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"} if token else {})
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.status, r.read().decode()


def test_collector_roundtrip(server, fake_home):
    r = _report(fake_home)
    assert push_report(server, "s3cret-token", r)["ok"] is True
    status, body = _get(server + "/api/fleet", "s3cret-token")
    fleet = json.loads(body)
    assert status == 200 and len(fleet["devices"]) == 1
    assert fleet["totals"]["mcp_servers"] == r["summary"]["mcp_servers"]
    assert any(f["rule"] == "MCP001" for f in fleet["findings"])
    dev = fleet["devices"][0]["id"]
    status, body = _get(f"{server}/api/devices/{dev}", "s3cret-token")
    assert json.loads(body)["device"]["id"] == dev
    status, html = _get(server + "/")
    assert status == 200 and "<title>" in html


def test_collector_rejects_bad_token(server, fake_home):
    with pytest.raises(urllib.error.HTTPError) as ei:
        push_report(server, "wrong", _report(fake_home))
    assert ei.value.code == 401
    with pytest.raises(urllib.error.HTTPError) as ei:
        _get(server + "/api/fleet", "wrong")
    assert ei.value.code == 401


def test_collector_keeps_latest_per_device(server, fake_home):
    r = _report(fake_home)
    push_report(server, "s3cret-token", r)
    push_report(server, "s3cret-token", r)
    fleet = json.loads(_get(server + "/api/fleet", "s3cret-token")[1])
    assert len(fleet["devices"]) == 1


def _post_raw(server, body: dict):
    req = urllib.request.Request(server + "/api/reports", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer s3cret-token"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def test_malformed_report_cannot_break_fleet_view(server, fake_home):
    push_report(server, "s3cret-token", _report(fake_home))
    bads = [{"apps": [1]}, {"summary": {"apps": "abc"}}, {"mcp_servers": "x"}, {"findings": [None]}, {"usage": []},
            {"usage": {"by_model": {"m": "x"}}}, {"guard_events": [1]}, {"summary": []},
            {"mcp_servers": [{"name": "a", "package": {"a": 1}}]}, {"findings": [{"severity": {"x": 1}}]},
            {"apps": [{"id": "x", "name": ["n"]}]}, {"guard_events": [{"ts": {"a": 1}}]},
            {"mcp_servers": [{"client": ["c"]}]}, {"device": {"id": "poisonX", "hostname": {"h": 1}}}]
    for i, bad in enumerate(bads):
        body = {"schema": "aiwarden.report/v1", "device": {"id": f"poison{i}"}, **bad}
        assert _post_raw(server, body) in (200, 422)
    status, body = _get(server + "/api/fleet", "s3cret-token")
    assert status == 200 and len(json.loads(body)["devices"]) >= 1


def test_model_edges_split_tokens_per_model(fake_home):
    g = _report(fake_home)["graph"]
    tok = {e["target"]: e["meta"]["tokens"] for e in g["edges"] if e["type"] == "uses_model"}
    assert tok["model:claude-sonnet-4-5"] == 150 and tok["model:claude-opus-4-1"] == 10


def test_cli_home_scan_ignores_host_processes(fake_home, capsys, monkeypatch):
    import aiwarden.apps as apps
    from aiwarden.apps import ProcInfo
    monkeypatch.setattr(apps, "list_processes", lambda: [ProcInfo(1, "ollama.exe")])
    cli_main(["--home", str(fake_home.home), "--platform", "windows", "scan", "--json", "--no-usage"])
    r = json.loads(capsys.readouterr().out)
    assert "ollama" not in {a["id"] for a in r["apps"]}


def test_cli_guard_honors_home(fake_home, monkeypatch, capsys):
    import io
    from conftest import _w
    _w(fake_home.state_dir / "policy.toml", 'mode = "monitor"\n')
    hook = json.dumps({"tool_name": "Bash", "tool_input": {"command": "rm -rf ~"}})
    monkeypatch.setattr("sys.stdin", io.TextIOWrapper(io.BytesIO(hook.encode())))
    assert cli_main(["--home", str(fake_home.home), "--platform", "windows", "guard"]) == 0
    assert (fake_home.state_dir / "events.jsonl").exists()


def test_cli_check_bad_json_is_friendly(tmp_path, capsys):
    assert cli_main(["--home", str(tmp_path), "check", "Bash", "--input", "not json"]) == 2
    assert "invalid" in capsys.readouterr().err.lower()


@pytest.mark.parametrize("bad", ["{not json", '{"hooks": [1, 2]}', '{"hooks": {"PreToolUse": "x"}}', "[1]"])
def test_cli_hooks_install_on_corrupt_settings(tmp_path, capsys, bad):
    p = tmp_path / "s.json"
    p.write_text(bad, encoding="utf-8")
    assert cli_main(["--home", str(tmp_path), "hooks", "install", "--settings", str(p)]) == 1
    assert p.read_text(encoding="utf-8") == bad
    assert "left unchanged" in capsys.readouterr().err.lower()


def test_cli_scan_json(fake_home, capsys):
    code = cli_main(["--home", str(fake_home.home), "--platform", "windows", "--cwd", str(fake_home.cwd), "scan", "--json"])
    out = capsys.readouterr().out
    assert code == 0
    r = json.loads(out)
    assert r["summary"]["mcp_servers"] >= 14 and GH_TOKEN not in out


def test_cli_scan_text_exit_code(fake_home, capsys):
    code = cli_main(["--home", str(fake_home.home), "--platform", "windows", "--cwd", str(fake_home.cwd), "scan", "--fail-on", "high"])
    out = capsys.readouterr().out
    assert code == 1 and "MCP001" in out and "Plaintext" in out


def test_cli_hooks_install_project(tmp_path, capsys):
    proj = tmp_path / "p"
    proj.mkdir()
    assert cli_main(["--home", str(tmp_path / "h"), "hooks", "install", "--project", str(proj)]) == 0
    data = json.loads((proj / ".claude" / "settings.json").read_text(encoding="utf-8"))
    assert "aiwarden guard" in data["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
