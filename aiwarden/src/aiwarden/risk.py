"""Posture findings over the discovered inventory."""
from __future__ import annotations

import re
import tomllib
from dataclasses import asdict, dataclass
from urllib.parse import urlsplit

from .apps import BrowserExtension
from .env import Env
from .mcp import MCPServer

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}
_SHELL_RE = re.compile(r"(?i)shell|terminal|exec|command|desktop-commander|\bssh\b|powershell|\bbash\b|\bcmd\b")
_DRIVE_ROOT = re.compile(r"^[A-Za-z]:[\\/]?$")


@dataclass
class Finding:
    rule: str
    severity: str
    title: str
    subject: str  # graph node id
    detail: str = ""
    location: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _exe(command: str | None) -> str:
    exe = (command or "").replace("\\", "/").rsplit("/", 1)[-1].lower()
    for suffix in (".exe", ".cmd", ".bat"):
        exe = exe.removesuffix(suffix)
    return exe


def is_pinned(command: str | None, package: str) -> bool:
    exe = _exe(command)
    if exe == "docker":
        last = package.rsplit("/", 1)[-1]
        return "@sha256:" in package or (":" in last and not last.endswith(":latest"))
    if exe in {"uvx", "pipx"}:
        return "==" in package or bool(re.search(r"@\d", package))
    body = package[1:] if package.startswith("@") else package
    if "@" not in body:
        return False
    return body.rsplit("@", 1)[1] not in {"", "latest", "next"}


def _is_local_path(pkg: str) -> bool:
    return (pkg.startswith((".", "/", "~")) or "\\" in pkg or bool(re.match(r"^[A-Za-z]:", pkg))
            or pkg.endswith((".js", ".py", ".ts", ".mjs", ".cjs")))


def _mcp_findings(env: Env, s: MCPServer) -> list[Finding]:
    out = []
    where = f"{s.client} ({s.scope}) — {s.config_path}"
    for sec in s.secrets:
        out.append(Finding("MCP001", "high", f"Plaintext {sec['kind'].replace('_', ' ')} in MCP config '{s.name}'",
                           s.id, f"{sec['field']} = {sec['redacted']}. Move it to an env var or secret store.", where))
    if s.url:
        parts = urlsplit(s.url)
        if parts.scheme == "http" and (parts.hostname or "") not in _LOCAL_HOSTS:
            out.append(Finding("MCP002", "medium", f"Remote MCP server '{s.name}' uses unencrypted HTTP", s.id,
                               f"{parts.hostname}: tool calls, results and auth headers travel in clear text.", where))
    if s.package and not _is_local_path(s.package) and not is_pinned(s.command, s.package):
        out.append(Finding("MCP003", "low", f"MCP server '{s.name}' runs an unpinned package", s.id,
                           f"`{s.command} {s.package}` fetches whatever version is latest at launch (supply-chain risk). Pin a version.",
                           where))
    home = str(env.home).rstrip("\\/").lower()
    broad = [a for a in s.args if a in {"/", "~", "~/", "$HOME", "%USERPROFILE%"} or _DRIVE_ROOT.match(a)
             or a.rstrip("\\/").lower() == home]
    if broad:
        out.append(Finding("MCP004", "medium", f"MCP server '{s.name}' is given a very broad filesystem root", s.id,
                           f"Root(s): {', '.join(broad)}. Scope it to the directories it needs.", where))
    if _SHELL_RE.search(f"{s.name} {s.package or ''}"):
        out.append(Finding("MCP005", "medium", f"MCP server '{s.name}' can execute shell commands", s.id,
                           "Agents using this server can run arbitrary commands; pair it with a pre-execution guard.", where))
    return out


def _codex_findings(env: Env) -> list[Finding]:
    p = env.home / ".codex" / "config.toml"
    try:
        cfg = tomllib.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if cfg.get("approval_policy") == "never" and cfg.get("sandbox_mode") == "danger-full-access":
        return [Finding("AGT003", "high", "Codex runs with no approvals and no sandbox", "app:codex",
                        "approval_policy=never and sandbox_mode=danger-full-access: every command runs unreviewed.", str(p))]
    return []


def assess(env: Env, servers: list[MCPServer], extensions: list[BrowserExtension], claude: dict | None) -> list[Finding]:
    findings: list[Finding] = []
    for s in servers:
        findings += _mcp_findings(env, s)
    if claude:
        loc = ", ".join(claude.get("settings_files", []))
        wide = [a for a in claude["permissions"]["allow"] if a in {"Bash", "Bash(*)", "Bash(:*)", "Bash(**)"}]
        if wide:
            findings.append(Finding("AGT001", "high", "Claude Code may run any shell command without asking", "app:claude-code",
                                    f"permissions.allow contains {sorted(set(wide))}.", loc))
        if claude["permissions"].get("defaultMode") == "bypassPermissions":
            findings.append(Finding("AGT002", "high", "Claude Code defaults to bypassPermissions", "app:claude-code",
                                    "All tool calls run without confirmation.", loc))
        if not claude.get("guard_installed"):
            findings.append(Finding("AGT004", "info", "No pre-execution guard on Claude Code", "app:claude-code",
                                    "Run `aiwarden hooks install` to block destructive commands and secret leaks before they run.", loc))
    findings += _codex_findings(env)
    for e in extensions:
        if e.broad_access:
            findings.append(Finding("EXT001", "medium", f"AI browser extension '{e.name}' can read every site", f"ext:{e.browser}:{e.id}",
                                    "It has <all_urls>-style access: page contents, including internal apps, can reach a third-party AI.",
                                    f"{e.browser}/{e.profile}"))
    findings.sort(key=lambda f: (SEVERITY_ORDER.get(f.severity, 9), f.rule, f.subject))
    return findings
