import json

from aiwarden.mcp import discover_mcp_servers, load_jsonc

from conftest import ANTH_KEY, GH_TOKEN


def _by(servers):
    return {(s.client, s.name): s for s in servers}


def test_discovers_servers_from_every_client(fake_home):
    got = _by(discover_mcp_servers(fake_home))
    expected = {
        ("claude-code", "github"), ("claude-code", "postgres"), ("claude-code", "docs"),
        ("claude-desktop", "filesystem"), ("cursor", "remote-tools"), ("cursor", "shell"),
        ("windsurf", "brave"), ("vscode", "playwright"), ("vscode", "memory"),
        ("cline", "sqlite"), ("gemini-cli", "search"), ("codex", "context7"), ("codex", "linear"),
        ("zed", "git"),
    }
    assert expected <= set(got), expected - set(got)


def test_scopes_and_transport(fake_home):
    got = _by(discover_mcp_servers(fake_home))
    assert got[("claude-code", "github")].scope == "user"
    assert got[("claude-code", "postgres")].scope == "local"
    assert got[("claude-code", "docs")].scope == "project"
    assert got[("claude-code", "docs")].transport == "http"
    assert got[("cursor", "remote-tools")].transport == "sse"
    assert got[("gemini-cli", "search")].transport == "http"
    assert got[("codex", "linear")].url == "https://mcp.linear.app/mcp"
    assert got[("zed", "git")].command == "uvx"
    assert got[("cline", "sqlite")].disabled is True


def test_secrets_are_flagged_and_never_stored(fake_home):
    servers = discover_mcp_servers(fake_home)
    dump = json.dumps([s.to_dict() for s in servers])
    assert GH_TOKEN not in dump
    assert "hunter22" not in dump
    assert ANTH_KEY not in dump
    got = _by(servers)
    gh = got[("claude-code", "github")]
    assert [(x["field"], x["kind"]) for x in gh.secrets] == [("env.GITHUB_PERSONAL_ACCESS_TOKEN", "github_token")]
    pg = got[("claude-code", "postgres")]
    assert any(x["kind"] == "url_credentials" for x in pg.secrets)
    assert any(x["field"] == "headers.Authorization" for x in got[("gemini-cli", "search")].secrets)
    # env var references are not secrets
    assert got[("windsurf", "brave")].secrets == []
    assert got[("windsurf", "brave")].env_keys == ["BRAVE_API_KEY"]


def test_package_identity(fake_home):
    got = _by(discover_mcp_servers(fake_home))
    assert got[("claude-code", "github")].package == "@modelcontextprotocol/server-github"
    assert got[("cursor", "shell")].package == "mcp-shell-server@1.2.0"
    assert got[("vscode", "playwright")].package == "@playwright/mcp@0.0.41"


def test_jsonc_loader(tmp_path):
    p = tmp_path / "s.json"
    p.write_text('{\n // c\n "a": "http://x//y", /* block */ "b": [1,2,],\n}', encoding="utf-8")
    assert load_jsonc(p) == {"a": "http://x//y", "b": [1, 2]}


def test_missing_or_corrupt_configs_do_not_crash(tmp_path):
    from aiwarden.env import Env
    env = Env.for_home(tmp_path / "h", platform="linux", cwd=tmp_path)
    (tmp_path / "h" / ".cursor").mkdir(parents=True)
    (tmp_path / "h" / ".cursor" / "mcp.json").write_text("{not json", encoding="utf-8")
    assert discover_mcp_servers(env) == []


def test_home_as_cwd_does_not_duplicate_user_config(tmp_path):
    from aiwarden.env import Env
    from conftest import _w
    env = Env.for_home(tmp_path, platform="linux")  # cwd defaults to home
    _w(tmp_path / ".gemini" / "settings.json", {"mcpServers": {"s": {"command": "npx", "args": ["-y", "x"]}}})
    assert [(s.client, s.scope) for s in discover_mcp_servers(env)] == [("gemini-cli", "user")]
