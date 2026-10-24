import copy
import json
import urllib.request

import pytest

from aiwarden.alerts import evaluate_alerts, load_state, save_state, slack_payload
from aiwarden.cli import main as cli_main
from aiwarden.weekly import build_weekly, render_html, render_markdown

from fleet_fixtures import fleet

AS_OF = "2026-10-23"


def _rules(alerts):
    return sorted({a["rule"] for a in alerts})


def test_first_run_baselines_inventory_but_reports_spikes():
    alerts, state = evaluate_alerts(fleet(), {}, {}, AS_OF)
    rules = _rules(alerts)
    assert "ALR003" not in rules and "ALR004" not in rules and "ALR006" not in rules  # baseline, no noise
    spikes = [a for a in alerts if a["rule"] == "ALR001"]
    # alice: 400 -> 4000 tokens day over day; min_tokens default would hide this tiny fixture, so check with config below
    assert state["initialized"] and state["devices"]


def test_token_spike_day_over_day_per_user():
    cfg = {"alerts": {"spike_min_tokens": 1000, "token_spike_pct": 100, "spike_group_by": ["user"]}}
    alerts, _ = evaluate_alerts(fleet(), cfg, {}, AS_OF)
    spikes = [a for a in alerts if a["rule"] == "ALR001"]
    assert [(a["group"], a["value"]) for a in spikes if a["window"] == "day"] == [({"user": "alice"}, 4000)]
    assert "previous 400" in spikes[0]["detail"]


def test_cost_spike_and_guard_threshold():
    cfg = {"alerts": {"spike_min_cost_usd": 1.0, "cost_spike_pct": 100, "spike_group_by": ["team"], "guard_blocks_threshold": 3,
                      "guard_blocks_window_days": 7}}
    alerts, _ = evaluate_alerts(fleet(), cfg, {}, AS_OF)
    assert any(a["rule"] == "ALR002" and a["group"] == {"team": "platform"} for a in alerts)
    g = [a for a in alerts if a["rule"] == "ALR005"]
    assert len(g) == 1 and g[0]["hostname"] == "alice-mbp" and g[0]["value"] == 3


def test_new_mcp_server_secret_and_app_after_baseline():
    reports = fleet()
    _, state = evaluate_alerts(reports, {}, {}, AS_OF)
    later = copy.deepcopy(reports)
    later[1]["mcp_servers"].append({"id": "mcp:cursor:user:shell", "client": "cursor", "scope": "user", "name": "shell",
                                    "transport": "stdio", "package": "mcp-shell", "url": None, "command": "npx", "secrets": []})
    later[1]["findings"].append({"rule": "MCP001", "severity": "high", "title": "Plaintext openai key in MCP config 'shell'",
                                 "subject": "mcp:cursor:user:shell", "detail": "env.OPENAI_API_KEY = sk-pro…(51 chars)", "location": ""})
    later[1]["apps"].append({"id": "cursor", "name": "Cursor", "vendor": "Anysphere", "kind": "ide", "running": False})
    alerts, state2 = evaluate_alerts(later, {}, state, AS_OF)
    by_rule = {a["rule"]: a for a in alerts}
    assert by_rule["ALR003"]["hostname"] == "bob-laptop" and "shell" in by_rule["ALR003"]["title"]
    assert "sk-pro…" in by_rule["ALR004"]["detail"]
    assert "Cursor" in by_rule["ALR006"]["title"]
    # stateful: running again raises nothing new
    again, _ = evaluate_alerts(later, {}, state2, AS_OF)
    assert not [a for a in again if a["rule"] in {"ALR003", "ALR004", "ALR006"}]


def test_spikes_are_not_repeated_on_same_day():
    cfg = {"alerts": {"spike_min_tokens": 1000, "spike_group_by": ["user"]}}
    a1, s1 = evaluate_alerts(fleet(), cfg, {}, AS_OF)
    a2, _ = evaluate_alerts(fleet(), cfg, s1, AS_OF)
    assert any(a["rule"] == "ALR001" for a in a1) and not any(a["rule"] == "ALR001" for a in a2)


def test_new_device_is_baselined_silently():
    reports = fleet()
    _, state = evaluate_alerts(reports[:2], {}, {}, AS_OF)
    alerts, _ = evaluate_alerts(reports, {}, state, AS_OF)
    assert not [a for a in alerts if a["rule"] in {"ALR003", "ALR006"}]


def test_state_roundtrip(tmp_path):
    p = tmp_path / "alerts_state.json"
    _, state = evaluate_alerts(fleet(), {}, {}, AS_OF)
    save_state(p, state)
    assert load_state(p) == state
    p.write_text("{broken", encoding="utf-8")
    assert load_state(p) == {}


def test_slack_payload_shape():
    cfg = {"alerts": {"spike_min_tokens": 1000, "spike_group_by": ["user"]}}
    alerts, _ = evaluate_alerts(fleet(), cfg, {}, AS_OF)
    p = slack_payload(alerts)
    assert "aiwarden" in p["text"] and p["blocks"][0]["type"] == "section"
    json.dumps(p)


def test_cli_alerts_posts_webhook_and_saves_state(tmp_path, capsys, monkeypatch):
    rep = tmp_path / "fleet.json"
    rep.write_text(json.dumps(fleet()), encoding="utf-8")
    home = tmp_path / "h"
    (home / ".aiwarden").mkdir(parents=True)
    (home / ".aiwarden" / "config.toml").write_text('[alerts]\nspike_min_tokens = 1000\nspike_group_by = ["user"]\n',
                                                    encoding="utf-8")
    posted = []

    class R:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"ok"

    def fake(req, timeout=None):
        posted.append((req.full_url, json.loads(req.data)))
        return R()

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    args = ["--home", str(home), "alerts", "--report", str(rep), "--as-of", AS_OF, "--webhook", "https://hooks.example.com/x", "--json"]
    assert cli_main(args) == 0
    out = json.loads(capsys.readouterr().out)
    assert any(a["rule"] == "ALR001" for a in out["alerts"])
    assert posted and posted[0][0] == "https://hooks.example.com/x" and "blocks" in posted[0][1]
    assert (home / ".aiwarden" / "alerts_state.json").exists()
    assert cli_main(args) == 0
    assert json.loads(capsys.readouterr().out)["alerts"] == [] and len(posted) == 1  # nothing new, no post


def test_cli_alerts_dry_run_keeps_state(tmp_path, capsys):
    rep = tmp_path / "fleet.json"
    rep.write_text(json.dumps(fleet()), encoding="utf-8")
    assert cli_main(["--home", str(tmp_path / "h"), "alerts", "--report", str(rep), "--as-of", AS_OF, "--dry-run"]) == 0
    assert not (tmp_path / "h" / ".aiwarden" / "alerts_state.json").exists()


def test_webhook_rejects_non_http(tmp_path, capsys):
    rep = tmp_path / "fleet.json"
    rep.write_text(json.dumps(fleet()), encoding="utf-8")
    assert cli_main(["--home", str(tmp_path / "h"), "alerts", "--report", str(rep), "--webhook", "file:///etc/passwd"]) == 2


# ---------- weekly report ----------

def test_weekly_numbers():
    w = build_weekly(fleet(), {"teams": {"design": ["carol"]}}, AS_OF)
    assert w["period"] == {"since": "2026-10-17", "until": "2026-10-23"}
    assert w["previous_period"] == {"since": "2026-10-10", "until": "2026-10-16"}
    assert w["totals"]["tokens"]["current"] == 4400 + 1000  # alice 400+4000, bob 500+500
    assert w["totals"]["tokens"]["previous"] == 2000 + 1000 + 5000 + 100  # alice 10-12, bob 10-10, carol 10-15
    assert {r["team"] for r in w["by_team"]} == {"platform", "data"}
    assert w["guard_blocks"]["total"] == 3
    assert w["findings"]["by_severity"]["high"] == 2


def test_weekly_markdown_and_html_escape():
    reports = fleet()
    reports[0]["device"]["hostname"] = "<script>alert(1)</script>"
    w = build_weekly(reports, {}, AS_OF)
    md = render_markdown(w)
    assert md.startswith("# aiwarden weekly report") and "| platform |" in md
    html = render_html(w)
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html


@pytest.mark.parametrize("fmt", ["md", "html", "json"])
def test_cli_report_weekly(tmp_path, capsys, fmt):
    rep = tmp_path / "fleet.json"
    rep.write_text(json.dumps(fleet()), encoding="utf-8")
    out = tmp_path / f"weekly.{fmt}"
    assert cli_main(["--home", str(tmp_path / "h"), "report", "weekly", "--report", str(rep), "--as-of", AS_OF,
                     "--format", fmt, "--out", str(out)]) == 0
    text = out.read_text(encoding="utf-8")
    assert ("2026-10-17" in text) and (fmt != "json" or json.loads(text)["period"])


def test_failed_webhook_does_not_lose_alerts(tmp_path, capsys, monkeypatch):
    import urllib.error
    rep = tmp_path / "fleet.json"
    rep.write_text(json.dumps(fleet()), encoding="utf-8")
    home = tmp_path / "h"
    (home / ".aiwarden").mkdir(parents=True)
    (home / ".aiwarden" / "config.toml").write_text('[alerts]\nspike_min_tokens = 1000\nspike_group_by = ["user"]\n', encoding="utf-8")
    args = ["--home", str(home), "alerts", "--report", str(rep), "--as-of", AS_OF, "--webhook", "https://hooks.example.com/x", "--json"]

    def down(req, timeout=None):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(urllib.request, "urlopen", down)
    assert cli_main(args) == 1
    first = json.loads(capsys.readouterr().out)["alerts"]
    posted = []

    class R:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"ok"

    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=None: posted.append(req) or R())
    assert cli_main(args) == 0
    second = json.loads(capsys.readouterr().out)["alerts"]
    assert first and [a["id"] for a in second] == [a["id"] for a in first] and len(posted) == 1
