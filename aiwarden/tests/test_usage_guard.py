import json

from aiwarden.guard import run_hook
from aiwarden.hooks import install_hook, uninstall_hook
from aiwarden.usage import collect_usage

from conftest import _w

SECRET = "ghp_" + "S" * 36


def _cc_line(mid, ts, model, usage, content, cwd="/work/webapp", sid="sess-1"):
    return json.dumps({"type": "assistant", "sessionId": sid, "timestamp": ts, "cwd": cwd,
                       "message": {"id": mid, "model": model, "role": "assistant", "usage": usage, "content": content}})


def _claude_transcript(env):
    u = {"input_tokens": 100, "output_tokens": 50, "cache_creation_input_tokens": 10, "cache_read_input_tokens": 1000}
    lines = [
        json.dumps({"type": "user", "sessionId": "sess-1", "timestamp": "2026-10-20T10:00:00.000Z", "cwd": "/work/webapp",
                    "message": {"role": "user", "content": "please clean up the repo"}}),
        # One API message split over two lines (same id) -> usage counted once, both tool calls counted
        _cc_line("msg_1", "2026-10-20T10:00:05.000Z", "claude-sonnet-4-5", u,
                 [{"type": "tool_use", "id": "tu_1", "name": "Bash", "input": {"command": "rm -rf /"}}]),
        _cc_line("msg_1", "2026-10-20T10:00:05.100Z", "claude-sonnet-4-5", u,
                 [{"type": "tool_use", "id": "tu_2", "name": "mcp__github__create_issue", "input": {"title": "x"}}]),
        _cc_line("msg_2", "2026-10-21T09:00:00.000Z", "claude-opus-4-1", {"input_tokens": 7, "output_tokens": 3},
                 [{"type": "tool_use", "id": "tu_3", "name": "Write", "input": {"file_path": "a.py", "content": f"K='{SECRET}'"}},
                  {"type": "text", "text": "done"}]),
        _cc_line("msg_3", "2026-10-21T09:00:01.000Z", "<synthetic>", {"input_tokens": 0, "output_tokens": 0}, []),
        "{corrupt line",
    ]
    _w(env.home / ".claude" / "projects" / "-work-webapp" / "sess-1.jsonl", "\n".join(lines) + "\n")


def _codex_session(env):
    lines = [
        {"timestamp": "2026-10-21T12:00:00Z", "type": "session_meta", "payload": {"id": "cx-1", "cwd": "/work/api"}},
        {"timestamp": "2026-10-21T12:00:01Z", "type": "turn_context", "payload": {"model": "gpt-5-codex", "cwd": "/work/api"}},
        {"timestamp": "2026-10-21T12:00:02Z", "type": "response_item",
         "payload": {"type": "function_call", "name": "shell", "arguments": json.dumps({"command": ["bash", "-lc", "git push --force origin main"]})}},
        {"timestamp": "2026-10-21T12:00:03Z", "type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": {"input_tokens": 500, "cached_input_tokens": 200, "output_tokens": 40, "total_tokens": 540}}}},
        {"timestamp": "2026-10-21T12:00:09Z", "type": "event_msg", "payload": {"type": "token_count", "info": {
            "total_token_usage": {"input_tokens": 900, "cached_input_tokens": 300, "output_tokens": 60, "total_tokens": 960}}}},
    ]
    _w(env.home / ".codex" / "sessions" / "2026" / "10" / "21" / "rollout-cx-1.jsonl", "\n".join(json.dumps(l) for l in lines))


def test_claude_code_usage(fake_home):
    _claude_transcript(fake_home)
    u = collect_usage(fake_home)
    cc = u["by_app"]["claude-code"]
    assert cc["input_tokens"] == 107 and cc["output_tokens"] == 53
    assert cc["cache_read_tokens"] == 1000 and cc["cache_write_tokens"] == 10
    assert cc["sessions"] == 1 and cc["tool_calls"] == 3
    assert u["by_model"]["claude-sonnet-4-5"]["output_tokens"] == 50
    assert "<synthetic>" not in u["by_model"]
    assert u["by_day"]["2026-10-20"]["output_tokens"] == 50
    assert u["tools"]["Bash"] == 1
    assert u["mcp_calls"] == {"github": {"create_issue": 1}}
    rules = sorted(e["rule"] for e in u["risky_events"])
    assert rules == ["GRD001", "GRD050"]


def test_usage_is_metadata_only_by_default(fake_home):
    _claude_transcript(fake_home)
    dump = json.dumps(collect_usage(fake_home))
    assert "rm -rf" not in dump and SECRET not in dump and "clean up the repo" not in dump
    with_content = json.dumps(collect_usage(fake_home, include_content=True))
    assert "rm -rf" in with_content and SECRET not in with_content


def test_codex_usage(fake_home):
    _codex_session(fake_home)
    u = collect_usage(fake_home)
    cx = u["by_app"]["codex"]
    assert (cx["input_tokens"], cx["output_tokens"], cx["cache_read_tokens"]) == (900, 60, 300)
    assert u["by_model"]["gpt-5-codex"]["input_tokens"] == 900
    assert any(e["rule"] == "GRD020" and e["app"] == "codex" for e in u["risky_events"])


def test_days_filter(fake_home):
    _claude_transcript(fake_home)
    u = collect_usage(fake_home, since="2026-10-21")
    assert u["by_app"]["claude-code"]["output_tokens"] == 3


# ---------- guard hook ----------

def _hook(tool, inp):
    return json.dumps({"session_id": "s1", "cwd": "/w", "hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": inp})


def test_guard_denies_with_exit_2(fake_home):
    code, out, err = run_hook(_hook("Bash", {"command": "rm -rf ~"}), fake_home)
    assert code == 2 and "GRD001" in err and "aiwarden" in err


def test_guard_ask_returns_json(fake_home):
    code, out, err = run_hook(_hook("Read", {"file_path": "/w/.env"}), fake_home)
    assert code == 0
    o = json.loads(out)["hookSpecificOutput"]
    assert o["hookEventName"] == "PreToolUse" and o["permissionDecision"] == "ask" and "GRD041" in o["permissionDecisionReason"]


def test_guard_allows_silently(fake_home):
    assert run_hook(_hook("Bash", {"command": "ls -la"}), fake_home) == (0, "", "")


def test_guard_logs_metadata_only(fake_home):
    run_hook(_hook("Bash", {"command": "rm -rf ~"}), fake_home)
    run_hook(_hook("Bash", {"command": "ls"}), fake_home)
    lines = (fake_home.state_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()
    events = [json.loads(l) for l in lines]
    assert [e["action"] for e in events] == ["deny"]  # allows are not logged by default
    assert "rm -rf" not in lines[0] and events[0]["tool"] == "Bash" and events[0]["rule"] == "GRD001"


def test_guard_fails_open_on_garbage(fake_home):
    code, out, err = run_hook("not json", fake_home)
    assert code == 0


def test_guard_respects_policy_file(fake_home):
    _w(fake_home.state_dir / "policy.toml", 'mode = "monitor"\n')
    code, out, err = run_hook(_hook("Bash", {"command": "rm -rf ~"}), fake_home)
    assert code == 0 and out == ""
    ev = json.loads((fake_home.state_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()[-1])
    assert ev["action"] == "allow" and ev["would_be"] == "deny"


# ---------- hook installation ----------

def test_install_is_idempotent_and_preserves_settings(tmp_path):
    p = tmp_path / ".claude" / "settings.json"
    _w(p, {"model": "opus", "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "other-tool"}]}]}})
    assert install_hook(p, "aiwarden guard") is True
    assert install_hook(p, "aiwarden guard") is False
    d = json.loads(p.read_text(encoding="utf-8"))
    assert d["model"] == "opus"
    cmds = [h["command"] for g in d["hooks"]["PreToolUse"] for h in g["hooks"]]
    assert cmds == ["other-tool", "aiwarden guard"]
    assert (p.parent / "settings.json.aiwarden.bak").exists()
    assert uninstall_hook(p) is True
    d = json.loads(p.read_text(encoding="utf-8"))
    assert [h["command"] for g in d["hooks"]["PreToolUse"] for h in g["hooks"]] == ["other-tool"]


def test_install_creates_missing_file(tmp_path):
    p = tmp_path / "proj" / ".claude" / "settings.json"
    assert install_hook(p, "aiwarden guard")
    assert json.loads(p.read_text(encoding="utf-8"))["hooks"]["PreToolUse"][0]["matcher"] == "*"
