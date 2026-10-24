"""Where things live on this endpoint. Everything else resolves paths through Env, so the
test suite can point it at a synthetic home directory."""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


def _detect_platform() -> str:
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform == "darwin":
        return "darwin"
    return "linux"


@dataclass(frozen=True)
class Env:
    home: Path
    platform: str  # windows | darwin | linux
    appdata: Path  # per-user app config root: %APPDATA%, ~/Library/Application Support, ~/.config
    localappdata: Path  # %LOCALAPPDATA%, ~/Library/Application Support, ~/.local/share
    cwd: Path

    @classmethod
    def for_home(cls, home: Path, platform: str | None = None, cwd: Path | None = None) -> "Env":
        home = Path(home)
        platform = platform or _detect_platform()
        if platform == "windows":
            appdata, local = home / "AppData" / "Roaming", home / "AppData" / "Local"
        elif platform == "darwin":
            appdata = local = home / "Library" / "Application Support"
        else:
            appdata, local = home / ".config", home / ".local" / "share"
        return cls(home, platform, appdata, local, Path(cwd) if cwd else home)

    @classmethod
    def current(cls) -> "Env":
        env = cls.for_home(Path.home(), cwd=Path.cwd())
        if env.platform == "windows":
            appdata = os.environ.get("APPDATA")
            local = os.environ.get("LOCALAPPDATA")
            env = cls(env.home, env.platform, Path(appdata) if appdata else env.appdata,
                      Path(local) if local else env.localappdata, env.cwd)
        elif env.platform == "linux" and os.environ.get("XDG_CONFIG_HOME"):
            env = cls(env.home, env.platform, Path(os.environ["XDG_CONFIG_HOME"]), env.localappdata, env.cwd)
        return env

    @property
    def zed_settings(self) -> Path:
        if self.platform == "windows":
            return self.appdata / "Zed" / "settings.json"
        return self.home / ".config" / "zed" / "settings.json"

    def vscode_user_dirs(self) -> list[tuple[str, Path]]:
        """(client, User dir) for VS Code-family editors that keep settings under appdata."""
        return [
            ("vscode", self.appdata / "Code" / "User"),
            ("vscode-insiders", self.appdata / "Code - Insiders" / "User"),
            ("vscodium", self.appdata / "VSCodium" / "User"),
            ("cursor", self.appdata / "Cursor" / "User"),
            ("windsurf", self.appdata / "Windsurf" / "User"),
        ]

    @property
    def state_dir(self) -> Path:
        return self.home / ".aiwarden"
