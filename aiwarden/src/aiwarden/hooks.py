"""Install / remove the aiwarden guard as a pre-tool hook in Claude Code, Gemini CLI and Codex.

- Claude Code: ~/.claude/settings.json hooks.PreToolUse (timeout in seconds).
- Gemini CLI: ~/.gemini/settings.json hooks.BeforeTool (timeout in milliseconds; hooks are on
  by default from v0.26.0, https://geminicli.com/docs/hooks/).
- Codex: ~/.codex/hooks.json hooks.PreToolUse (timeout in seconds). Codex also accepts inline
  [hooks] tables in config.toml; we never rewrite config.toml (no stdlib TOML writer), we only
  read it to avoid a second install. Codex runs a non-managed hook only after the user trusts
  it with /hooks, and again after any change to it (https://learn.chatgpt.com/docs/hooks).
"""
from __future__ import annotations

import json
import shutil
import sys
import tomllib
from pathlib import Path

from .apps import is_guard_command
from .env import Env

# agent -> (event name, matcher, timeout, unit)
AGENT_HOOKS = {
    "claude-code": ("PreToolUse", "*", 10),
    "gemini-cli": ("BeforeTool", ".*", 10_000),
    "codex": ("PreToolUse", "*", 10),
}
POST_INSTALL = {
    "codex": "Codex runs this hook only after you trust it: open Codex and run /hooks (again after any change).",
    "gemini-cli": "Gemini CLI enables hooks by default from v0.26.0; older versions ignore them.",
}


def default_command(agent: str = "claude-code", platform: str | None = None) -> str:
    """A command line that parses in every shell the agents use to run hooks: Claude Code uses Git
    Bash on Windows, while Gemini CLI and Codex use `powershell -Command`, where a quoted path
    followed by arguments is a parse error unless prefixed with the call operator `&`."""
    exe = sys.executable.replace("\\", "/")
    platform = platform or sys.platform
    if " " not in exe:
        quoted = exe
    elif platform.startswith("win") and agent in {"gemini-cli", "codex"}:
        quoted = f'& "{exe}"'
    else:
        quoted = f'"{exe}"'
    return with_agent(f"{quoted} -m aiwarden guard", agent)


def with_agent(command: str, agent: str) -> str:
    if agent == "claude-code" or "--agent" in command:
        return command
    return f"{command} --agent {agent}"


def agent_settings_path(agent: str, env: Env) -> Path:
    return {"claude-code": env.home / ".claude" / "settings.json",
            "gemini-cli": env.home / ".gemini" / "settings.json",
            "codex": env.home / ".codex" / "hooks.json"}[agent]


def _load(path: Path, event: str = "PreToolUse") -> dict:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8-sig").strip()
    data = json.loads(text) if text else {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} is not a JSON object")
    hooks = data.get("hooks", {})
    if not isinstance(hooks, dict) or not isinstance(hooks.get(event, []), list):
        raise ValueError(f"{path}: unexpected shape for hooks / hooks.{event}")
    return data


def _save(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        shutil.copy2(path, path.with_name(path.name + ".aiwarden.bak"))
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _is_guard(h) -> bool:
    return isinstance(h, dict) and is_guard_command(str(h.get("command", "")))


def _groups_have_guard(groups) -> bool:
    return any(_is_guard(h) for g in groups if isinstance(g, dict) for h in (g.get("hooks") or []))


def install_hook(settings_path: Path, command: str | None = None, matcher: str = "*", timeout: int = 10,
                 event: str = "PreToolUse", name: str | None = None) -> bool:
    """Returns True if the hook was added, False if it was already present."""
    settings_path = Path(settings_path)
    data = _load(settings_path, event)
    groups = data.setdefault("hooks", {}).setdefault(event, [])
    if _groups_have_guard(groups):
        return False
    h = {"type": "command", "command": command or default_command(), "timeout": timeout}
    if name:
        h["name"] = name
    groups.append({"matcher": matcher, "hooks": [h]})
    _save(settings_path, data)
    return True


def uninstall_hook(settings_path: Path, event: str = "PreToolUse") -> bool:
    settings_path = Path(settings_path)
    data = _load(settings_path, event)
    groups = (data.get("hooks") or {}).get(event) or []
    kept_groups, changed = [], False
    for g in groups:
        if not isinstance(g, dict):
            kept_groups.append(g)
            continue
        kept = [h for h in g.get("hooks", []) if not _is_guard(h)]
        changed |= len(kept) != len(g.get("hooks", []))
        if kept:
            kept_groups.append({**g, "hooks": kept})
    if not changed:
        return False
    if kept_groups:
        data["hooks"][event] = kept_groups
    else:
        del data["hooks"][event]
    _save(settings_path, data)
    return True


def _codex_toml_has_guard(env: Env) -> bool:
    try:
        cfg = tomllib.loads((env.home / ".codex" / "config.toml").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    hooks = cfg.get("hooks") if isinstance(cfg.get("hooks"), dict) else {}
    return _groups_have_guard(hooks.get("PreToolUse") or [])


def install_agent_hook(agent: str, env: Env, command: str | None = None, path: Path | None = None) -> tuple[bool, Path]:
    event, matcher, timeout = AGENT_HOOKS[agent]
    target = Path(path) if path else agent_settings_path(agent, env)
    if agent == "codex" and _codex_toml_has_guard(env):
        return False, env.home / ".codex" / "config.toml"
    cmd = with_agent(command, agent) if command else default_command(agent)
    added = install_hook(target, cmd, matcher=matcher, timeout=timeout, event=event,
                         name="aiwarden-guard" if agent == "gemini-cli" else None)
    return added, target


def uninstall_agent_hook(agent: str, env: Env, path: Path | None = None) -> tuple[bool, Path]:
    event = AGENT_HOOKS[agent][0]
    target = Path(path) if path else agent_settings_path(agent, env)
    return uninstall_hook(target, event), target


def agent_hook_status(env: Env) -> dict[str, list[str]]:
    """agent -> settings files that contain the guard."""
    from .apps import discover_claude_config
    cfg = discover_claude_config(env) or {"hooks": []}
    out = {"claude-code": sorted({h["path"] for h in cfg["hooks"]
                                  if h["event"] == "PreToolUse" and is_guard_command(h["command"])})}
    for agent in ("gemini-cli", "codex"):
        event = AGENT_HOOKS[agent][0]
        paths = [agent_settings_path(agent, env)]
        if agent == "gemini-cli":
            paths.append(env.cwd / ".gemini" / "settings.json")
        else:
            paths.append(env.cwd / ".codex" / "hooks.json")
        found = []
        for p in paths:
            try:
                data = _load(p, event)
            except (OSError, ValueError):
                continue
            if _groups_have_guard((data.get("hooks") or {}).get(event) or []):
                found.append(str(p))
        if agent == "codex" and _codex_toml_has_guard(env):
            found.append(str(env.home / ".codex" / "config.toml"))
        out[agent] = sorted(set(found))
    return out
