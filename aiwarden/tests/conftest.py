"""Synthetic endpoint: a fake home directory populated with the config/log layouts of
common AI tools. No real user data is read by the test suite."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from aiwarden.env import Env

GH_TOKEN = "ghp_" + "Q" * 36
ANTH_KEY = "sk-ant-api03-" + "k" * 60


def _w(path: Path, data) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data if isinstance(data, str) else json.dumps(data, indent=2), encoding="utf-8")
    return path


@pytest.fixture(autouse=True)
def _no_real_llm(monkeypatch):
    """A key on the developer's machine must never make the suite call the real API."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


@pytest.fixture
def fake_home(tmp_path: Path) -> Env:
    home = tmp_path / "home"
    project = tmp_path / "work" / "webapp"
    project.mkdir(parents=True)
    env = Env.for_home(home, platform="windows", cwd=project)

    # Claude Code: user-scope + local-scope servers in ~/.claude.json, project .mcp.json
    _w(home / ".claude.json", {
        "numStartups": 3,
        "mcpServers": {
            "github": {"type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
                       "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": GH_TOKEN}},
        },
        "projects": {
            str(project): {"mcpServers": {"postgres": {"command": "uvx", "args": ["mcp-server-postgres", "postgresql://admin:hunter22@db.internal:5432/prod"]}}},
        },
    })
    _w(project / ".mcp.json", {"mcpServers": {"docs": {"type": "http", "url": "https://mcp.example.com/mcp"}}})
    _w(home / ".claude" / "settings.json", {"permissions": {"allow": ["Bash(*)"], "defaultMode": "bypassPermissions"}})
    _w(home / ".claude" / "skills" / "deploy" / "SKILL.md", "---\nname: deploy\ndescription: Deploy the app\n---\nRun ./deploy.sh\n")

    # Claude Desktop (Windows: %APPDATA%\Claude)
    _w(env.appdata / "Claude" / "claude_desktop_config.json", {"mcpServers": {
        "filesystem": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\"]},
    }})
    # Cursor
    _w(home / ".cursor" / "mcp.json", {"mcpServers": {
        "remote-tools": {"url": "http://tools.corp.example.com:8080/sse"},
        "shell": {"command": "npx", "args": ["-y", "mcp-shell-server@1.2.0"]},
    }})
    # Windsurf
    _w(home / ".codeium" / "windsurf" / "mcp_config.json", {"mcpServers": {
        "brave": {"command": "npx", "args": ["-y", "@brave/brave-search-mcp-server"], "env": {"BRAVE_API_KEY": "${BRAVE_API_KEY}"}},
    }})
    # VS Code: mcp.json uses "servers"; settings.json is JSONC
    _w(env.appdata / "Code" / "User" / "mcp.json", {"servers": {
        "playwright": {"command": "npx", "args": ["@playwright/mcp@0.0.41"]},
    }, "inputs": []})
    _w(env.appdata / "Code" / "User" / "settings.json",
       '{\n  // editor prefs\n  "editor.fontSize": 14,\n  "mcp": {"servers": {"memory": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"],},},},\n}\n')
    # Cline (VS Code extension global storage)
    _w(env.appdata / "Code" / "User" / "globalStorage" / "saoudrizwan.claude-dev" / "settings" / "cline_mcp_settings.json",
       {"mcpServers": {"sqlite": {"command": "uvx", "args": ["mcp-server-sqlite", "--db-path", "test.db"], "disabled": True}}})
    # Gemini CLI
    _w(home / ".gemini" / "settings.json", {"mcpServers": {"search": {"httpUrl": "https://search.example.com/mcp", "headers": {"Authorization": "Bearer " + "t" * 32}}}})
    # Codex CLI (TOML)
    _w(home / ".codex" / "config.toml",
       'model = "gpt-5-codex"\n\n[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n\n'
       '[mcp_servers.linear]\nurl = "https://mcp.linear.app/mcp"\n')
    # Zed (Windows: %APPDATA%\Zed\settings.json)
    _w(env.appdata / "Zed" / "settings.json", '{"context_servers": {"git": {"command": {"path": "uvx", "args": ["mcp-server-git"]}}}}')
    return env
