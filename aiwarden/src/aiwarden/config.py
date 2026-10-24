"""~/.aiwarden/config.toml: team mapping, price overrides and alert settings.

    team = "platform"                 # this device's team (written into the report)

    [teams]                           # collector-side or shared mapping; first match wins
    platform = ["alice", "host:build-01", "device:3f2a9c..."]
    data = ["bob"]

    [prices."claude-sonnet-4-5"]      # see pricing.py
    input = 3.0
    output = 15.0

    [alerts]                          # see alerts.py
    webhook = "https://hooks.slack.com/services/..."
    token_spike_pct = 100

A missing or broken file yields {} so a typo never stops a scan.
"""
from __future__ import annotations

import tomllib
from pathlib import Path

from .env import Env


def config_path(env: Env) -> Path:
    return env.state_dir / "config.toml"


def load_config(path: Path | None) -> dict:
    try:
        data = tomllib.loads(Path(path).read_text(encoding="utf-8")) if path and Path(path).is_file() else {}
    except (OSError, ValueError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def merge_teams(config: dict, extra: dict | None) -> dict:
    """Layer a collector-side mapping file ([teams] table) over the device config."""
    if not extra:
        return config
    teams = {**(config.get("teams") or {}), **(extra.get("teams") or {})}
    return {**config, "teams": teams}


def resolve_team(device: dict, config: dict | None) -> str | None:
    """Team for a report's device block: [teams] mapping (device id, host, user) > report's own team > config team."""
    config = config or {}
    keys = {f"device:{device.get('id')}", f"host:{device.get('hostname')}", str(device.get("user") or ""),
            f"user:{device.get('user')}"}
    teams = config.get("teams") if isinstance(config.get("teams"), dict) else {}
    for team, members in teams.items():
        if isinstance(members, list) and keys & {str(m) for m in members}:
            return str(team)
    if isinstance(device.get("team"), str) and device["team"]:
        return device["team"]
    team = config.get("team")
    return str(team) if isinstance(team, str) and team else None
