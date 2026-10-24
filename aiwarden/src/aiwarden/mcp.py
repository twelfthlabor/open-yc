"""Discover MCP servers configured in AI clients on this endpoint.

Every reader is best-effort: a missing or corrupt file yields nothing rather than an error.
Secret values are redacted at parse time and never kept on the MCPServer object.
"""
from __future__ import annotations

import json
import re
import tomllib
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit

from .env import Env
from .secrets import find_secrets, redact, value_is_secret

RUNNERS = {"npx", "uvx", "bunx", "pipx", "deno", "npm", "pnpm", "yarn", "bun"}
_TRAILING_COMMA = re.compile(r",(\s*[}\]])")


@dataclass
class MCPServer:
    client: str
    name: str
    scope: str  # user | project | local
    config_path: str
    transport: str  # stdio | http | sse
    command: str | None = None
    args: list[str] = field(default_factory=list)
    url: str | None = None
    package: str | None = None
    project: str | None = None
    env_keys: list[str] = field(default_factory=list)
    header_keys: list[str] = field(default_factory=list)
    secrets: list[dict] = field(default_factory=list)
    disabled: bool = False

    @property
    def id(self) -> str:
        return f"mcp:{self.client}:{self.scope}:{self.name}"

    def to_dict(self) -> dict:
        d = asdict(self)
        d["id"] = self.id
        return d


def _strip_comments(text: str) -> str:
    out: list[str] = []
    i, n, in_str = 0, len(text), False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == '"':
                in_str = False
            i += 1
        elif c == '"':
            in_str = True
            out.append(c)
            i += 1
        elif text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def load_jsonc(path: Path) -> Any:
    """Parse JSON with // and /* */ comments and trailing commas (VS Code, Zed settings)."""
    text = path.read_text(encoding="utf-8-sig")
    try:
        return json.loads(text)
    except ValueError:
        return json.loads(_TRAILING_COMMA.sub(r"\1", _strip_comments(text)))


def read_json(path: Path) -> Any:
    try:
        return load_jsonc(path) if path.is_file() else None
    except (OSError, ValueError, UnicodeDecodeError):
        return None


def _read_toml(path: Path) -> Any:
    try:
        return tomllib.loads(path.read_text(encoding="utf-8")) if path.is_file() else None
    except (OSError, ValueError, UnicodeDecodeError):
        return None


def _exe_name(command: str) -> str:
    exe = Path(command.replace("\\", "/")).name.lower()
    for suffix in (".exe", ".cmd", ".bat", ".ps1"):
        if exe.endswith(suffix):
            return exe[: -len(suffix)]
    return exe


def package_of(command: str | None, args: list[str]) -> str | None:
    """The package a runner (npx/uvx/docker...) will fetch and execute, if any."""
    if not command:
        return None
    exe = _exe_name(command)
    if exe in RUNNERS:
        skip = False
        for a in args:
            if skip:
                skip = False
                continue
            if a in {"exec", "dlx", "x", "run", "--", "tool"}:
                continue
            if a in {"--with", "--python", "--index-url", "--registry"}:
                skip = True
                continue
            if a.startswith("-"):
                continue
            return a
        return None
    if exe == "docker":
        value_flags = {"-e", "--env", "-v", "--volume", "--name", "-p", "--publish", "--network",
                       "-w", "--workdir", "--env-file", "--mount", "-u", "--user", "--entrypoint"}
        seen_run, skip = False, False
        for a in args:
            if not seen_run:
                seen_run = a == "run"
                continue
            if skip:
                skip = False
                continue
            if a in value_flags:
                skip = True
                continue
            if a.startswith("-"):
                continue
            return a
    return None


def _transport(cfg: dict, url: str | None, url_key: str | None) -> str:
    t = str(cfg.get("type") or cfg.get("transport") or "").lower()
    if t in {"http", "streamable-http", "streamablehttp", "streamable_http"}:
        return "http"
    if t in {"sse", "stdio"}:
        return t
    if url:
        if url_key == "httpUrl":
            return "http"
        return "sse" if urlsplit(url).path.rstrip("/").endswith("/sse") else "http"
    return "stdio"


def _secret_fields(prefix: str, mapping: Any) -> list[dict]:
    out = []
    if isinstance(mapping, dict):
        for k, v in mapping.items():
            hit = value_is_secret(str(k), v) if isinstance(v, str) else None
            if hit:
                out.append({"field": f"{prefix}.{k}", "kind": hit.kind, "redacted": hit.redacted})
    return out


def build_server(client: str, name: str, cfg: Any, scope: str, path: Path, project: str | None = None) -> MCPServer | None:
    if not isinstance(cfg, dict):
        return None
    command = cfg.get("command")
    args = cfg.get("args") or []
    env = cfg.get("env") or {}
    if isinstance(command, dict):  # Zed legacy: {"command": {"path", "args", "env"}}
        args = command.get("args") or args
        env = command.get("env") or env
        command = command.get("path")
    if isinstance(command, list):
        command, args = (command[0] if command else None), list(command[1:]) + list(args)
    if not isinstance(command, str):
        command = None
    args = [str(a) for a in args] if isinstance(args, list) else []
    url_key = next((k for k in ("url", "serverUrl", "httpUrl") if isinstance(cfg.get(k), str)), None)
    url = cfg.get(url_key) if url_key else None
    headers = cfg.get("headers") or cfg.get("http_headers") or {}

    secrets = _secret_fields("env", env) + _secret_fields("headers", headers)
    safe_args: list[str] = []
    for i, a in enumerate(args):
        hits = find_secrets(a)
        prev = args[i - 1] if i else ""
        if not hits and prev.startswith("--"):
            named = value_is_secret(prev.lstrip("-"), a)
            hits = [named] if named else []
        if not hits and a.startswith("--") and "=" in a:
            k, v = a[2:].split("=", 1)
            named = value_is_secret(k, v)
            hits = [named] if named else []
        if hits:
            secrets.append({"field": f"args[{i}]", "kind": hits[0].kind, "redacted": hits[0].redacted})
            safe_args.append(f"<redacted:{hits[0].kind}>")
        else:
            safe_args.append(a)

    safe_url = url
    if url:
        parts = urlsplit(url)
        hits = find_secrets(url)
        q_hit = next((value_is_secret(*kv.split("=", 1)) for kv in parts.query.split("&") if "=" in kv
                      and value_is_secret(*kv.split("=", 1))), None)
        if hits or q_hit:
            secrets.append({"field": "url", "kind": (hits[0] if hits else q_hit).kind, "redacted": redact(url)})
        if hits or q_hit or parts.username:
            port = f":{parts.port}" if parts.port else ""
            safe_url = f"{parts.scheme}://{parts.hostname or ''}{port}{parts.path}"

    return MCPServer(
        client=client, name=str(name), scope=scope, config_path=str(path),
        transport=_transport(cfg, url, url_key), command=command, args=safe_args, url=safe_url,
        package=package_of(command, args), project=project,
        env_keys=sorted(map(str, env)) if isinstance(env, dict) else [],
        header_keys=sorted(map(str, headers)) if isinstance(headers, dict) else [],
        secrets=secrets, disabled=bool(cfg.get("disabled") or cfg.get("enabled") is False),
    )


def _from_map(client: str, servers: Any, scope: str, path: Path, project: str | None = None) -> list[MCPServer]:
    if not isinstance(servers, dict):
        return []
    return [s for name, cfg in servers.items() if (s := build_server(client, name, cfg, scope, path, project))]


def _key(env: Env, p: Path | str) -> str:
    return str(p).lower() if env.platform == "windows" else str(p)


def known_projects(env: Env) -> list[Path]:
    """Project directories Claude Code knows about, plus the current directory."""
    data = read_json(env.home / ".claude.json")
    dirs = [Path(p) for p in ((data or {}).get("projects") or {}) if isinstance(p, str)] if isinstance(data, dict) else []
    dirs.append(env.cwd)
    seen: set[str] = set()
    out = []
    for d in dirs:
        if _key(env, d) not in seen:
            seen.add(_key(env, d))
            out.append(d)
    return out


def _map_at(path: Path, key: str) -> Any:
    d = read_json(path)
    return d.get(key) if isinstance(d, dict) else None


def discover_mcp_servers(env: Env) -> list[MCPServer]:
    home = env.home
    projects = known_projects(env)
    found: list[MCPServer] = []

    # Claude Code: ~/.claude.json (user + per-project "local" scope) and <project>/.mcp.json
    cc_path = home / ".claude.json"
    cc = read_json(cc_path)
    if isinstance(cc, dict):
        found += _from_map("claude-code", cc.get("mcpServers"), "user", cc_path)
        for proj, pcfg in (cc.get("projects") or {}).items():
            if isinstance(pcfg, dict):
                found += _from_map("claude-code", pcfg.get("mcpServers"), "local", cc_path, proj)
    for proj in projects:
        p = proj / ".mcp.json"
        found += _from_map("claude-code", _map_at(p, "mcpServers"), "project", p, str(proj))

    p = env.appdata / "Claude" / "claude_desktop_config.json"
    found += _from_map("claude-desktop", _map_at(p, "mcpServers"), "user", p)

    p = home / ".cursor" / "mcp.json"
    found += _from_map("cursor", _map_at(p, "mcpServers"), "user", p)
    for proj in projects:
        p = proj / ".cursor" / "mcp.json"
        found += _from_map("cursor", _map_at(p, "mcpServers"), "project", p, str(proj))

    p = home / ".codeium" / "windsurf" / "mcp_config.json"
    found += _from_map("windsurf", _map_at(p, "mcpServers"), "user", p)

    for client, user_dir in env.vscode_user_dirs():
        p = user_dir / "mcp.json"
        found += _from_map(client, _map_at(p, "servers"), "user", p)
        p = user_dir / "settings.json"
        mcp = _map_at(p, "mcp")
        if isinstance(mcp, dict):
            found += _from_map(client, mcp.get("servers"), "user", p)
        for ext, fname, cname in [
            ("saoudrizwan.claude-dev", "cline_mcp_settings.json", "cline"),
            ("rooveterinaryinc.roo-cline", "mcp_settings.json", "roo-code"),
        ]:
            p = user_dir / "globalStorage" / ext / "settings" / fname
            found += _from_map(cname, _map_at(p, "mcpServers"), "user", p)
    for proj in projects:
        p = proj / ".vscode" / "mcp.json"
        found += _from_map("vscode", _map_at(p, "servers"), "project", p, str(proj))

    p = home / ".gemini" / "settings.json"
    found += _from_map("gemini-cli", _map_at(p, "mcpServers"), "user", p)
    for proj in projects:
        p = proj / ".gemini" / "settings.json"
        found += _from_map("gemini-cli", _map_at(p, "mcpServers"), "project", p, str(proj))

    p = home / ".codex" / "config.toml"
    d = _read_toml(p)
    if isinstance(d, dict):
        found += _from_map("codex", d.get("mcp_servers"), "user", p)

    p = env.zed_settings
    found += _from_map("zed", _map_at(p, "context_servers"), "user", p)

    seen: set[tuple] = set()
    out = []
    for s in found:
        # Same file read twice (cwd == home makes ~/.gemini/settings.json both "user" and "project"): keep the first.
        # Claude Code's local scope shares ~/.claude.json across projects, so the project is part of its key.
        k = (s.client, s.name, _key(env, s.config_path), s.project if s.scope == "local" else None)
        if k not in seen:
            seen.add(k)
            out.append(s)
    return out
