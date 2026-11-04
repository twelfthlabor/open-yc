"""`aiwarden setup`: scan, offer guard hooks for the agents found, write a monitor-mode policy, print the console link."""
import json

from aiwarden.cli import main as cli_main
from aiwarden.env import Env
from aiwarden.hooks import agent_hook_status


def _setup(fake_home, *extra, inp=None, monkeypatch=None):
    if monkeypatch is not None and inp is not None:
        monkeypatch.setattr("builtins.input", lambda prompt="": inp)
    return cli_main(["--home", str(fake_home.home), "--platform", "windows", "setup", "--command", "aiwarden guard", *extra])


def test_setup_yes_installs_hooks_for_detected_agents_and_writes_monitor_policy(fake_home, capsys):
    assert _setup(fake_home, "--yes") == 0
    out = capsys.readouterr().out
    # the synthetic home has Claude Code, Codex and Gemini CLI configured
    for name in ("Claude Code", "Codex CLI", "Gemini CLI"):
        assert name in out
    status = agent_hook_status(fake_home)
    assert all(status[a] for a in ("claude-code", "codex", "gemini-cli")), status
    policy = (fake_home.state_dir / "policy.toml").read_text(encoding="utf-8")
    assert '\nmode = "monitor"\n' in policy
    assert '\nmode = "enforce"\n' not in policy
    from aiwarden.policy import Policy
    assert Policy.load(fake_home.state_dir / "policy.toml").mode == "monitor"
    assert "aiwarden serve --local" in out
    assert "http://127.0.0.1:8765" in out


def test_setup_no_hooks_skips_install_but_still_writes_policy(fake_home, capsys):
    assert _setup(fake_home, "--no-hooks") == 0
    assert not any(agent_hook_status(fake_home).values())
    assert (fake_home.state_dir / "policy.toml").exists()
    assert "skipped" in capsys.readouterr().out.lower()


def test_setup_keeps_an_existing_policy(fake_home, capsys):
    p = fake_home.state_dir / "policy.toml"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text('mode = "enforce"\n', encoding="utf-8")
    assert _setup(fake_home, "--no-hooks") == 0
    assert p.read_text(encoding="utf-8") == 'mode = "enforce"\n'
    assert "kept" in capsys.readouterr().out.lower()


def test_setup_prompt_no_leaves_hooks_alone(fake_home, monkeypatch, capsys):
    assert _setup(fake_home, inp="n", monkeypatch=monkeypatch) == 0
    assert not any(agent_hook_status(fake_home).values())


def test_setup_prompt_yes_installs(fake_home, monkeypatch, capsys):
    assert _setup(fake_home, inp="y", monkeypatch=monkeypatch) == 0
    assert agent_hook_status(fake_home)["claude-code"]


def test_setup_without_a_terminal_does_not_install_unasked(fake_home, monkeypatch, capsys):
    def eof(prompt=""):
        raise EOFError

    monkeypatch.setattr("builtins.input", eof)
    assert _setup(fake_home) == 0
    assert not any(agent_hook_status(fake_home).values())
    assert "--yes" in capsys.readouterr().out


def test_setup_with_no_supported_agents(tmp_path, capsys):
    assert cli_main(["--home", str(tmp_path), "--platform", "linux", "setup", "--yes", "--command", "aiwarden guard"]) == 0
    out = capsys.readouterr().out
    assert "No Claude Code, Codex or Gemini CLI" in out
    assert not any(agent_hook_status(Env.for_home(tmp_path, platform="linux")).values())


def test_setup_json_summary(fake_home, capsys):
    assert _setup(fake_home, "--yes", "--json") == 0
    data = json.loads(capsys.readouterr().out)
    assert sorted(data["agents"]) == ["claude-code", "codex", "gemini-cli"]
    assert sorted(data["hooks_installed"]) == ["claude-code", "codex", "gemini-cli"]
    assert data["policy"]["written"] is True
    assert data["console"] == "http://127.0.0.1:8765/"


def test_setup_reports_an_agent_whose_settings_cannot_be_read_and_exits_nonzero(fake_home, capsys):
    from aiwarden.hooks import agent_settings_path
    bad = agent_settings_path("claude-code", fake_home)
    bad.parent.mkdir(parents=True, exist_ok=True)
    bad.write_text('{"hooks": []}', encoding="utf-8")
    assert _setup(fake_home, "--yes", "--json") == 1
    data = json.loads(capsys.readouterr().out)
    assert sorted(data["hooks_installed"]) == ["codex", "gemini-cli"]
    assert "claude-code" in data["errors"] and "not a JSON object" not in data["errors"]["claude-code"]
    assert "unexpected shape" in data["errors"]["claude-code"]
    assert data["policy"]["written"] is True
    assert bad.read_text(encoding="utf-8") == '{"hooks": []}'


def test_setup_keeps_going_when_a_settings_file_cannot_be_opened(fake_home, capsys):
    from aiwarden.hooks import agent_settings_path
    bad = agent_settings_path("claude-code", fake_home)
    if bad.exists():
        bad.unlink()
    bad.mkdir(parents=True)  # a directory where the settings file should be
    assert _setup(fake_home, "--yes") == 1
    captured = capsys.readouterr()
    assert "Traceback" not in captured.err
    assert "Claude Code" in captured.err and "NOT installed" in captured.err
    status = agent_hook_status(fake_home)
    assert status["codex"] and status["gemini-cli"]
    assert (fake_home.state_dir / "policy.toml").exists()


def test_a_failed_settings_write_leaves_no_temp_copy(tmp_path, monkeypatch):
    import pathlib

    import pytest

    from aiwarden import hooks
    target = tmp_path / "settings.json"
    target.write_text("{}", encoding="utf-8")

    def deny(self, other):
        raise PermissionError("read-only")

    monkeypatch.setattr(pathlib.Path, "replace", deny)
    with pytest.raises(PermissionError):
        hooks._save(target, {"hooks": {}})
    assert not (tmp_path / "settings.json.tmp").exists()
    assert target.read_text(encoding="utf-8") == "{}"


def test_setup_json_never_prompts_on_stdout(fake_home, monkeypatch, capsys):
    def asked(prompt=""):
        raise AssertionError("prompted in --json mode")

    monkeypatch.setattr("builtins.input", asked)
    assert _setup(fake_home, "--json") == 0
    data = json.loads(capsys.readouterr().out)
    assert data["hooks_installed"] == []
    assert not any(agent_hook_status(fake_home).values())


def test_setup_takes_home_after_the_subcommand_too(fake_home, capsys):
    assert cli_main(["setup", "--home", str(fake_home.home), "--platform", "windows", "--no-hooks", "--json", "--command", "aiwarden guard"]) == 0
    assert json.loads(capsys.readouterr().out)["policy"]["written"] is True
