import json

import pytest

from aiwarden.agents import canonical_calls, evaluate_agent, parse_patch
from aiwarden.cli import main as cli_main
from aiwarden.guard import run_hook
from aiwarden.hooks import agent_hook_status, install_agent_hook, uninstall_agent_hook
from aiwarden.usage import collect_usage

from conftest import _w

SECRET = "ghp_" + "Z" * 36
PATCH = (f"*** Begin Patch\n*** Add File: src/config.py\n+API = '{SECRET}'\n*** End Patch\n")


def _hook(tool, inp, event="PreToolUse", **extra):
    return json.dumps({"session_id": "s1", "cwd": "/w", "hook_event_name": event, "tool_name": tool, "tool_input": inp, **extra})


# ---------- tool mapping ----------

@pytest.mark.parametrize("tool,inp,rule", [
    ("run_shell_command", {"command": "rm -rf ~"}, "GRD001"),
    ("write_file", {"file_path": "app.py", "content": f"K='{SECRET}'"}, "GRD050"),
    ("replace", {"file_path": "app.py", "old_string": "x", "new_string": f"K='{SECRET}'"}, "GRD050"),
    ("read_file", {"absolute_path": "/home/u/.ssh/id_rsa"}, "GRD040"),
    ("read_file", {"file_path": "/home/u/.aws/credentials"}, "GRD040"),
    ("read_many_files", {"paths": ["README.md", "/home/u/.ssh/id_ed25519"]}, "GRD040"),
    ("search_file_content", {"pattern": "KEY", "path": "/home/u/.ssh"}, "GRD040"),
    ("write_file", {"file_path": "/home/u/.gemini/settings.json", "content": "{}"}, "GRD070"),
])
def test_gemini_tools_map_to_policy(tool, inp, rule):
    assert evaluate_agent("gemini-cli", tool, inp).rule == rule


def test_gemini_mcp_tool_via_mcp_context():
    calls = canonical_calls("gemini-cli", "query", {"sql": "DROP DATABASE prod", "mcp_context": {"server_name": "postgres"}})
    assert calls == [("mcp__postgres__query", {"sql": "DROP DATABASE prod"})]
    assert evaluate_agent("gemini-cli", "query", {"sql": "DROP DATABASE prod", "mcp_context": {"server_name": "postgres"}}).rule == "GRD010"
    assert evaluate_agent("gemini-cli", "postgres__query", {"sql": "DROP DATABASE prod"}).rule == "GRD010"


def test_codex_apply_patch_is_scanned():
    assert parse_patch(PATCH) == [("add", "src/config.py", f"API = '{SECRET}'")]
    assert evaluate_agent("codex", "apply_patch", {"command": PATCH}).rule == "GRD050"
    selfcfg = "*** Begin Patch\n*** Update File: /home/u/.codex/config.toml\n@@\n+approval_policy = \"never\"\n*** End Patch\n"
    assert evaluate_agent("codex", "apply_patch", {"command": selfcfg}).rule == "GRD070"
    assert evaluate_agent("codex", "Bash", {"command": "git push --force origin main"}).rule == "GRD020"


def test_benign_calls_allowed_for_every_agent():
    assert evaluate_agent("gemini-cli", "run_shell_command", {"command": "ls -la"}).action == "allow"
    assert evaluate_agent("codex", "Bash", {"command": "pytest -q"}).action == "allow"
    assert evaluate_agent("codex", "apply_patch", {"command": "*** Begin Patch\n*** Add File: a.py\n+print(1)\n*** End Patch"}).action == "allow"


# ---------- hook protocols ----------

def test_gemini_deny_is_json_on_stdout_exit_0(fake_home):
    code, out, err = run_hook(_hook("run_shell_command", {"command": "rm -rf ~"}, event="BeforeTool"), fake_home, agent="gemini-cli")
    assert code == 0 and err == ""
    o = json.loads(out)
    assert o["decision"] == "deny" and "GRD001" in o["reason"]


def test_gemini_allow_prints_nothing(fake_home):
    assert run_hook(_hook("run_shell_command", {"command": "ls"}, event="BeforeTool"), fake_home, agent="gemini-cli") == (0, "", "")


def test_gemini_ask_falls_back_to_deny(fake_home):
    code, out, err = run_hook(_hook("read_file", {"absolute_path": "/w/.env"}, event="BeforeTool"), fake_home, agent="gemini-cli")
    o = json.loads(out)
    assert o["decision"] == "deny" and "GRD041" in o["reason"] and "approval" in o["reason"]


def _codex_decision(out: str) -> dict:
    return json.loads(out)["hookSpecificOutput"]


def test_codex_deny_is_json(fake_home):
    code, out, err = run_hook(_hook("apply_patch", {"command": PATCH}), fake_home, agent="codex")
    d = _codex_decision(out)
    assert code == 0 and d["permissionDecision"] == "deny" and "GRD050" in d["permissionDecisionReason"]


def test_codex_ask_actually_blocks(fake_home):
    # Codex treats permissionDecision "ask" as an unsupported output and runs the tool anyway.
    code, out, err = run_hook(_hook("Bash", {"command": "cat .env"}), fake_home, agent="codex")
    d = _codex_decision(out)
    assert code == 0 and d["permissionDecision"] == "deny" and "GRD041" in d["permissionDecisionReason"]


def test_ask_fallback_allow_is_configurable(fake_home):
    _w(fake_home.state_dir / "policy.toml", 'ask_fallback = "allow"\n')
    assert run_hook(_hook("Bash", {"command": "cat .env"}), fake_home, agent="codex")[0] == 0
    ev = json.loads((fake_home.state_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()[-1])
    assert ev["app"] == "codex" and ev["rule"] == "GRD041"


def test_claude_code_ask_unchanged(fake_home):
    code, out, err = run_hook(_hook("Read", {"file_path": "/w/.env"}), fake_home)
    assert json.loads(out)["hookSpecificOutput"]["permissionDecision"] == "ask"


def test_events_tagged_with_agent(fake_home):
    run_hook(_hook("run_shell_command", {"command": "rm -rf ~"}), fake_home, agent="gemini-cli")
    ev = json.loads((fake_home.state_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()[-1])
    assert ev["app"] == "gemini-cli" and ev["tool"] == "run_shell_command" and "rm -rf" not in json.dumps(ev)


def test_cli_guard_agent_flag(fake_home, monkeypatch, capsys):
    import io
    hook = _hook("run_shell_command", {"command": "rm -rf ~"}, event="BeforeTool")
    monkeypatch.setattr("sys.stdin", io.TextIOWrapper(io.BytesIO(hook.encode())))
    assert cli_main(["--home", str(fake_home.home), "guard", "--agent", "gemini-cli"]) == 0
    assert json.loads(capsys.readouterr().out)["decision"] == "deny"


# ---------- installation ----------

def test_install_gemini_hook_preserves_settings(fake_home):
    p = fake_home.home / ".gemini" / "settings.json"
    before = json.loads(p.read_text(encoding="utf-8"))
    assert install_agent_hook("gemini-cli", fake_home, command="aiwarden guard --agent gemini-cli") == (True, p)
    assert install_agent_hook("gemini-cli", fake_home, command="aiwarden guard --agent gemini-cli")[0] is False
    d = json.loads(p.read_text(encoding="utf-8"))
    assert d["mcpServers"] == before["mcpServers"]
    h = d["hooks"]["BeforeTool"][0]["hooks"][0]
    assert h["type"] == "command" and "--agent gemini-cli" in h["command"] and h["timeout"] == 10000  # ms
    assert agent_hook_status(fake_home)["gemini-cli"] == [str(p)]
    assert uninstall_agent_hook("gemini-cli", fake_home)[0] is True
    assert "BeforeTool" not in json.loads(p.read_text(encoding="utf-8")).get("hooks", {})


def test_install_codex_hook_writes_hooks_json(fake_home):
    ok, p = install_agent_hook("codex", fake_home, command="aiwarden guard --agent codex")
    assert ok and p == fake_home.home / ".codex" / "hooks.json"
    d = json.loads(p.read_text(encoding="utf-8"))
    g = d["hooks"]["PreToolUse"][0]
    assert g["matcher"] == "*" and g["hooks"][0]["timeout"] == 10  # seconds
    # config.toml untouched
    assert "[mcp_servers.context7]" in (fake_home.home / ".codex" / "config.toml").read_text(encoding="utf-8")
    assert agent_hook_status(fake_home)["codex"] == [str(p)]


def test_codex_inline_toml_hook_counts_as_installed(fake_home):
    cfg = fake_home.home / ".codex" / "config.toml"
    cfg.write_text(cfg.read_text(encoding="utf-8") + '\n[[hooks.PreToolUse]]\nmatcher = "*"\n\n[[hooks.PreToolUse.hooks]]\n'
                   'type = "command"\ncommand = "python -m aiwarden guard --agent codex"\n', encoding="utf-8")
    assert install_agent_hook("codex", fake_home)[0] is False
    assert str(cfg) in agent_hook_status(fake_home)["codex"]


def test_cli_hooks_install_all(fake_home, capsys):
    assert cli_main(["--home", str(fake_home.home), "hooks", "install", "--agent", "all", "--command", "aiwarden guard"]) == 0
    out = capsys.readouterr().out
    assert "claude-code" in out and "gemini-cli" in out and "codex" in out and "/hooks" in out
    cc = json.loads((fake_home.home / ".claude" / "settings.json").read_text(encoding="utf-8"))
    assert cc["hooks"]["PreToolUse"][0]["hooks"][0]["command"] == "aiwarden guard"
    gem = json.loads((fake_home.home / ".gemini" / "settings.json").read_text(encoding="utf-8"))
    assert gem["hooks"]["BeforeTool"][0]["hooks"][0]["command"] == "aiwarden guard --agent gemini-cli"
    assert cli_main(["--home", str(fake_home.home), "hooks", "status"]) == 0
    status = capsys.readouterr().out
    assert "gemini-cli" in status and "codex" in status


# ---------- Gemini usage ----------

def _gemini_chat(env, fmt="json"):
    msgs = [
        {"id": "u1", "timestamp": "2026-10-21T08:00:00Z", "type": "user", "content": "drop the prod db please"},
        {"id": "g1", "timestamp": "2026-10-21T08:00:05Z", "type": "gemini", "model": "gemini-2.5-pro", "content": "ok",
         "tokens": {"input": 1000, "output": 100, "cached": 400, "thoughts": 50, "tool": 0, "total": 1150},
         "toolCalls": [{"id": "c1", "name": "run_shell_command", "args": {"command": "rm -rf ~"}, "status": "error"},
                       {"id": "c2", "name": "github__create_issue", "args": {"title": "x"}}]},
        {"id": "g2", "timestamp": "2026-10-22T08:00:05Z", "type": "gemini", "model": "gemini-2.5-flash",
         "tokens": {"input": 10, "output": 5, "cached": 0}},
    ]
    chats = env.home / ".gemini" / "tmp" / "abc123hash" / "chats"
    if fmt == "json":
        _w(chats / "session-2026-10-21T08-00-gem1.json", {"sessionId": "gem-1", "projectHash": "abc123hash",
                                                           "startTime": "2026-10-21T08:00:00Z", "messages": msgs})
    else:
        lines = [{"sessionId": "gem-1", "projectHash": "abc123hash", "startTime": "2026-10-21T08:00:00Z"}] + msgs + [msgs[1]]
        _w(chats / "gem-1.jsonl", "\n".join(json.dumps(l) for l in lines))


@pytest.mark.parametrize("fmt", ["json", "jsonl"])
def test_gemini_usage(fake_home, fmt):
    _gemini_chat(fake_home, fmt)
    u = collect_usage(fake_home)
    g = u["by_app"]["gemini-cli"]
    assert (g["input_tokens"], g["output_tokens"], g["cache_read_tokens"]) == (1010, 155, 400)
    assert g["sessions"] == 1 and g["tool_calls"] == 2
    assert u["mcp_calls"]["github"] == {"create_issue": 1}
    assert any(e["rule"] == "GRD001" and e["app"] == "gemini-cli" for e in u["risky_events"])
    assert "drop the prod" not in json.dumps(u) and "rm -rf" not in json.dumps(u)
    assert u["by_model"]["gemini-2.5-pro"]["cost_usd"] > 0


def test_cli_check_agent_vocabulary(tmp_path, capsys):
    assert cli_main(["--home", str(tmp_path), "check", "run_shell_command", "rm -rf ~", "--agent", "gemini-cli"]) == 2
    assert json.loads(capsys.readouterr().out)["rule"] == "GRD001"


def test_cli_usage_and_scan_show_cost_and_team(fake_home, capsys):
    from test_usage_guard import _claude_transcript
    _claude_transcript(fake_home)
    _w(fake_home.state_dir / "config.toml", 'team = "platform"\n')
    assert cli_main(["--home", str(fake_home.home), "--platform", "windows", "usage"]) == 0
    out = capsys.readouterr().out
    assert "EST. COST" in out and "Estimated cost: $" in out
    assert cli_main(["--home", str(fake_home.home), "--platform", "windows", "--cwd", str(fake_home.cwd), "scan"]) == 0
    out = capsys.readouterr().out
    assert "team platform" in out and "EST. COST" in out


@pytest.mark.parametrize("agent,tool,inp", [
    ("codex", "apply_patch", {"command": "*** Begin Patch\n*** Delete File: /home/u/.codex/hooks.json\n*** End Patch"}),
    ("codex", "Bash", {"command": "echo {} > ~/.codex/hooks.json"}),
    ("gemini-cli", "write_file", {"file_path": "/repo/.codex/hooks.json", "content": "{}"}),
    ("claude-code", "Write", {"file_path": "/home/u/.aiwarden/config.toml", "content": "[alerts]\n"}),
])
def test_agent_cannot_edit_its_own_guard_files(agent, tool, inp):
    assert evaluate_agent(agent, tool, inp).rule == "GRD070"


def test_gemini_list_directory_dir_path():
    assert evaluate_agent("gemini-cli", "list_directory", {"dir_path": "/home/u/.ssh"}).rule == "GRD040"
