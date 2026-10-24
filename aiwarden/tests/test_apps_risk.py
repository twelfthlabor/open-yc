import json

from aiwarden.apps import (ProcInfo, discover_apps, discover_browser_extensions, discover_claude_config,
                           match_processes)
from aiwarden.mcp import build_server, discover_mcp_servers
from aiwarden.risk import assess

from conftest import _w


def test_installed_apps_detected_from_footprints(fake_home):
    (fake_home.home / ".vscode" / "extensions" / "github.copilot-chat-0.30.1").mkdir(parents=True)
    (fake_home.home / ".ollama").mkdir()
    ids = {a.id for a in discover_apps(fake_home, processes=[])}
    assert {"claude-code", "claude-desktop", "cursor", "windsurf", "vscode", "cline", "gemini-cli",
            "codex", "zed", "github-copilot", "ollama"} <= ids


def test_running_processes_matched():
    procs = [
        ProcInfo(pid=10, name="node.exe", exe="C:/Program Files/nodejs/node.exe",
                 cmdline=["node", "C:/Users/u/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/cli.js"]),
        ProcInfo(pid=11, name="ollama.exe", exe="C:/Users/u/AppData/Local/Programs/Ollama/ollama.exe", cmdline=["ollama", "serve"]),
        ProcInfo(pid=12, name="Cursor.exe", exe="C:/Users/u/AppData/Local/Programs/cursor/Cursor.exe", cmdline=[]),
        ProcInfo(pid=13, name="notepad.exe", exe="C:/Windows/notepad.exe", cmdline=[]),
        ProcInfo(pid=14, name="codex", exe="/usr/local/bin/codex", cmdline=["codex"]),
    ]
    assert match_processes(procs) == {"claude-code": [10], "ollama": [11], "cursor": [12], "codex": [14]}


def test_running_flag_on_apps(fake_home):
    procs = [ProcInfo(pid=5, name="claude.exe", exe=str(fake_home.home / ".local/bin/claude.exe"), cmdline=["claude"])]
    apps = {a.id: a for a in discover_apps(fake_home, processes=procs)}
    assert apps["claude-code"].running and apps["claude-code"].pids == [5]
    assert not apps["cursor"].running


def test_browser_extensions(fake_home):
    base = fake_home.localappdata / "Google" / "Chrome" / "User Data" / "Default" / "Extensions"
    _w(base / "abcdefghijklmnopabcdefghijklmnop" / "1.2.0_0" / "manifest.json",
       {"name": "__MSG_appName__", "version": "1.2.0", "permissions": ["tabs", "storage"], "host_permissions": ["<all_urls>"]})
    _w(base / "abcdefghijklmnopabcdefghijklmnop" / "1.2.0_0" / "_locales" / "en" / "messages.json",
       {"appName": {"message": "ChatGPT Sidebar - AI Assistant"}})
    _w(base / "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" / "3.0" / "manifest.json", {"name": "uBlock Origin", "version": "3.0"})
    exts = discover_browser_extensions(fake_home)
    assert [(e.browser, e.name, e.broad_access) for e in exts] == [("chrome", "ChatGPT Sidebar - AI Assistant", True)]


def test_claude_config(fake_home):
    cfg = discover_claude_config(fake_home)
    assert [s["name"] for s in cfg["skills"]] == ["deploy"]
    assert cfg["permissions"]["defaultMode"] == "bypassPermissions"
    assert cfg["guard_installed"] is False


def _rules(findings):
    return {(f.rule, f.subject) for f in findings}


def test_risk_findings(fake_home):
    (fake_home.home / ".codex" / "config.toml").write_text(
        'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n\n'
        '[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n', encoding="utf-8")
    servers = discover_mcp_servers(fake_home)
    findings = assess(fake_home, servers, extensions=[], claude=discover_claude_config(fake_home))
    r = _rules(findings)
    assert ("MCP001", "mcp:claude-code:user:github") in r           # plaintext token
    assert ("MCP001", "mcp:claude-code:local:postgres") in r        # creds in connection string
    assert ("MCP002", "mcp:cursor:user:remote-tools") in r          # remote over plain http
    assert ("MCP003", "mcp:claude-code:user:github") in r           # unpinned npx package
    assert ("MCP003", "mcp:cursor:user:shell") not in r             # pinned
    assert ("MCP004", "mcp:claude-desktop:user:filesystem") in r    # whole C:\ drive
    assert ("MCP005", "mcp:cursor:user:shell") in r                 # shell exec server
    assert ("AGT001", "app:claude-code") in r                       # Bash(*)
    assert ("AGT002", "app:claude-code") in r                       # bypassPermissions
    assert ("AGT003", "app:codex") in r                             # never ask + full access
    assert ("AGT004", "app:claude-code") in r                       # no guard
    sev = {f.rule: f.severity for f in findings}
    assert sev["MCP001"] == "high" and sev["MCP003"] == "low"
    dump = json.dumps([f.to_dict() for f in findings])
    assert "hunter22" not in dump and ("Q" * 36) not in dump


def test_localhost_http_is_not_flagged(fake_home):
    s = build_server("cursor", "local", {"url": "http://127.0.0.1:3000/mcp"}, "user", fake_home.home / "x.json")
    assert not [f for f in assess(fake_home, [s], [], None) if f.rule == "MCP002"]
