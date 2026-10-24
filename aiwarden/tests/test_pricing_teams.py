import json

import pytest

from aiwarden.config import load_config, resolve_team
from aiwarden.pricing import cost_of, load_prices, price_for
from aiwarden.report import build_report
from aiwarden.usage import collect_usage

from conftest import _w
from test_usage_guard import _claude_transcript, _codex_session


def test_price_lookup_matches_family_and_strips_date_suffix():
    p = price_for("claude-sonnet-4-5-20250929")
    assert p and p["input"] == 3.0 and p["output"] == 15.0
    assert price_for("claude-opus-5-5")["input"] == 4.0
    assert price_for("totally-unknown-model") is None


def test_claude_cost_counts_cache_reads_and_writes():
    t = {"input_tokens": 1_000_000, "output_tokens": 1_000_000, "cache_read_tokens": 1_000_000, "cache_write_tokens": 1_000_000}
    # sonnet 4.5: 3 in, 15 out, 0.30 cache read, 3.75 cache write (1.25x)
    assert cost_of("claude-sonnet-4-5", t, provider_input_includes_cache=False) == pytest.approx(3 + 15 + 0.30 + 3.75)


def test_openai_input_includes_cached_tokens():
    t = {"input_tokens": 1_000_000, "output_tokens": 0, "cache_read_tokens": 400_000, "cache_write_tokens": 0}
    p = price_for("gpt-5-codex")
    expected = 0.6 * p["input"] + 0.4 * p["cache_read"]
    assert cost_of("gpt-5-codex", t, provider_input_includes_cache=True) == pytest.approx(expected)


def test_price_override_from_config(tmp_path):
    cfg = tmp_path / "config.toml"
    cfg.write_text('[prices."my-local-model"]\ninput = 1.0\noutput = 2.0\n\n[prices."claude-sonnet-4-5"]\ninput = 10.0\noutput = 20.0\n',
                   encoding="utf-8")
    prices = load_prices(load_config(cfg))
    assert price_for("my-local-model", prices)["output"] == 2.0
    assert price_for("claude-sonnet-4-5", prices)["input"] == 10.0
    # cache prices default from input when not overridden
    assert price_for("claude-sonnet-4-5", prices)["cache_read"] == pytest.approx(1.0)


def test_usage_carries_cost(fake_home):
    _claude_transcript(fake_home)
    _codex_session(fake_home)
    u = collect_usage(fake_home)
    assert u["by_model"]["claude-sonnet-4-5"]["cost_usd"] > 0
    assert u["by_app"]["codex"]["cost_usd"] > 0
    assert u["cost"]["total_usd"] == pytest.approx(sum(m.get("cost_usd", 0) for m in u["by_model"].values()), abs=1e-5)
    assert u["cost"]["prices_as_of"]
    day = u["by_day_app"]["2026-10-20"]["claude-code"]
    assert day["output_tokens"] == 50 and day["cost_usd"] > 0


def test_unpriced_model_is_reported_not_guessed(fake_home):
    line = json.dumps({"type": "assistant", "sessionId": "s9", "timestamp": "2026-10-22T10:00:00Z",
                       "message": {"id": "m9", "model": "mystery-model-9", "usage": {"input_tokens": 10, "output_tokens": 5}, "content": []}})
    _w(fake_home.home / ".claude" / "projects" / "p" / "s9.jsonl", line + "\n")
    u = collect_usage(fake_home)
    assert "cost_usd" not in u["by_model"]["mystery-model-9"]
    assert u["cost"]["unpriced_models"] == ["mystery-model-9"]


# ---------- teams ----------

def test_resolve_team_mapping_order(tmp_path):
    cfg = tmp_path / "c.toml"
    cfg.write_text('team = "fallback-team"\n\n[teams]\nplatform = ["alice", "host:build-01"]\ndata = ["device:abc123"]\n',
                   encoding="utf-8")
    c = load_config(cfg)
    assert resolve_team({"id": "x", "hostname": "lap", "user": "alice"}, c) == "platform"
    assert resolve_team({"id": "x", "hostname": "build-01", "user": "bob"}, c) == "platform"
    assert resolve_team({"id": "abc123", "hostname": "h", "user": "bob"}, c) == "data"
    assert resolve_team({"id": "x", "hostname": "h", "user": "bob"}, c) == "fallback-team"
    assert resolve_team({"id": "x", "hostname": "h", "user": "bob", "team": "from-report"}, {}) == "from-report"
    assert resolve_team({"id": "x", "hostname": "h", "user": "bob"}, {}) is None


def test_report_device_has_team_and_cost(fake_home):
    _claude_transcript(fake_home)
    _w(fake_home.state_dir / "config.toml", 'team = "platform"\n')
    r = build_report(fake_home, processes=[])
    assert r["device"]["team"] == "platform"
    assert isinstance(r["summary"]["cost_usd"], float) and r["summary"]["cost_usd"] > 0


def test_report_with_cost_still_passes_collector_validation(fake_home):
    from aiwarden.server import valid_report
    _claude_transcript(fake_home)
    _w(fake_home.state_dir / "config.toml", 'team = "platform"\n')
    assert valid_report(build_report(fake_home, processes=[]))


def test_broken_config_is_ignored(fake_home):
    _w(fake_home.state_dir / "config.toml", "this is = = not toml")
    r = build_report(fake_home, processes=[], include_usage=False)
    assert r["device"].get("team") is None
