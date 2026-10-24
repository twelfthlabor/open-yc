"""Inventory of AI apps, agents, editor extensions, browser extensions and Claude Code config."""
from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

from .env import Env
from .mcp import known_projects, read_json


@dataclass
class ProcInfo:
    pid: int
    name: str
    exe: str = ""
    cmdline: list[str] = field(default_factory=list)


@dataclass
class AppInfo:
    id: str
    name: str
    vendor: str
    kind: str  # cli | desktop | ide | ide-extension | local-model
    installed: bool = False
    evidence: list[str] = field(default_factory=list)
    running: bool = False
    pids: list[int] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class BrowserExtension:
    browser: str
    profile: str
    id: str
    name: str
    version: str
    permissions: list[str]
    broad_access: bool

    def to_dict(self) -> dict:
        return asdict(self)


def _ext_dirs(env: Env) -> list[Path]:
    h = env.home
    return [h / ".vscode" / "extensions", h / ".vscode-insiders" / "extensions", h / ".vscode-oss" / "extensions",
            h / ".cursor" / "extensions", h / ".windsurf" / "extensions", h / ".antigravity" / "extensions"]


def _has_ext(env: Env, *prefixes: str) -> list[Path]:
    hits = []
    for d in _ext_dirs(env):
        try:
            for child in d.iterdir():
                low = child.name.lower()
                if any(low == p or low.startswith(p + "-") for p in prefixes):
                    hits.append(child)
        except OSError:
            continue
    return hits


def _global_storage(env: Env, ext_id: str) -> list[Path]:
    return [p for _, u in env.vscode_user_dirs() if (p := u / "globalStorage" / ext_id).exists()]


def _existing(*paths: Path) -> list[Path]:
    return [p for p in paths if p.exists()]


def _claude_desktop(e: Env) -> list[Path]:
    paths = [e.appdata / "Claude" / "claude_desktop_config.json", e.localappdata / "AnthropicClaude"]
    if e.platform == "darwin":
        paths.append(Path("/Applications/Claude.app"))
    return _existing(*paths)


def _chatgpt_desktop(e: Env) -> list[Path]:
    paths = [Path("/Applications/ChatGPT.app")] if e.platform == "darwin" else []
    try:
        paths += list((e.localappdata / "Packages").glob("OpenAI.ChatGPT*"))
    except OSError:
        pass
    return _existing(*paths)


# (id, name, vendor, kind, footprint finder)
CATALOG: list[tuple[str, str, str, str, Callable[[Env], list[Path]]]] = [
    ("claude-code", "Claude Code", "Anthropic", "cli", lambda e: _existing(e.home / ".claude.json", e.home / ".claude")),
    ("claude-desktop", "Claude Desktop", "Anthropic", "desktop", _claude_desktop),
    ("chatgpt-desktop", "ChatGPT Desktop", "OpenAI", "desktop", _chatgpt_desktop),
    ("cursor", "Cursor", "Anysphere", "ide", lambda e: _existing(e.home / ".cursor", e.appdata / "Cursor")),
    ("windsurf", "Windsurf", "Codeium", "ide", lambda e: _existing(e.home / ".codeium" / "windsurf", e.appdata / "Windsurf")),
    ("antigravity", "Antigravity", "Google", "ide",
     lambda e: _existing(e.home / ".antigravity", e.localappdata / "Programs" / "Antigravity")),
    ("vscode", "Visual Studio Code", "Microsoft", "ide", lambda e: _existing(e.appdata / "Code", e.home / ".vscode")),
    ("zed", "Zed", "Zed Industries", "ide", lambda e: _existing(e.zed_settings, e.localappdata / "Zed")),
    ("github-copilot", "GitHub Copilot", "GitHub", "ide-extension", lambda e: _has_ext(e, "github.copilot", "github.copilot-chat")),
    ("cline", "Cline", "Cline", "ide-extension",
     lambda e: _has_ext(e, "saoudrizwan.claude-dev") + _global_storage(e, "saoudrizwan.claude-dev")),
    ("roo-code", "Roo Code", "Roo", "ide-extension",
     lambda e: _has_ext(e, "rooveterinaryinc.roo-cline") + _global_storage(e, "rooveterinaryinc.roo-cline")),
    ("continue", "Continue", "Continue", "ide-extension", lambda e: _has_ext(e, "continue.continue") + _existing(e.home / ".continue")),
    ("claude-code-ide", "Claude Code for IDEs", "Anthropic", "ide-extension", lambda e: _has_ext(e, "anthropic.claude-code")),
    ("codex-ide", "Codex IDE extension", "OpenAI", "ide-extension", lambda e: _has_ext(e, "openai.chatgpt")),
    ("gemini-code-assist", "Gemini Code Assist", "Google", "ide-extension", lambda e: _has_ext(e, "google.geminicodeassist")),
    ("amazon-q", "Amazon Q", "AWS", "ide-extension", lambda e: _has_ext(e, "amazonwebservices.amazon-q-vscode")),
    ("codeium", "Codeium", "Codeium", "ide-extension", lambda e: _has_ext(e, "codeium.codeium")),
    ("tabnine", "Tabnine", "Tabnine", "ide-extension", lambda e: _has_ext(e, "tabnine.tabnine-vscode")),
    ("cody", "Sourcegraph Cody", "Sourcegraph", "ide-extension", lambda e: _has_ext(e, "sourcegraph.cody-ai")),
    ("kilo-code", "Kilo Code", "Kilo", "ide-extension", lambda e: _has_ext(e, "kilocode.kilo-code")),
    ("codex", "Codex CLI", "OpenAI", "cli", lambda e: _existing(e.home / ".codex")),
    ("gemini-cli", "Gemini CLI", "Google", "cli", lambda e: _existing(e.home / ".gemini")),
    ("opencode", "opencode", "SST", "cli",
     lambda e: _existing(e.home / ".config" / "opencode", e.home / ".local" / "share" / "opencode")),
    ("goose", "Goose", "Block", "cli", lambda e: _existing(e.home / ".config" / "goose")),
    ("aider", "Aider", "Aider", "cli", lambda e: _existing(e.home / ".aider.conf.yml")),
    ("ollama", "Ollama", "Ollama", "local-model", lambda e: _existing(e.home / ".ollama")),
    ("lm-studio", "LM Studio", "LM Studio", "local-model", lambda e: _existing(e.home / ".lmstudio", e.home / ".cache" / "lm-studio")),
]
_NAMES = {c[0]: c[1] for c in CATALOG}

_PROC_TABLE = {"ollama": "ollama", "ollama app": "ollama", "cursor": "cursor", "windsurf": "windsurf",
               "code": "vscode", "code - insiders": "vscode", "zed": "zed", "chatgpt": "chatgpt-desktop",
               "lm studio": "lm-studio", "lms": "lm-studio", "antigravity": "antigravity", "opencode": "opencode",
               "goose": "goose", "aider": "aider"}


def _stem(name: str) -> str:
    n = Path(name.replace("\\", "/")).name.lower()
    return n[:-4] if n.endswith(".exe") else n


def classify_process(p: ProcInfo) -> str | None:
    stem = _stem(p.name or p.exe)
    exe = (p.exe or "").replace("\\", "/").lower()
    cmd = " ".join(p.cmdline).replace("\\", "/").lower()
    if stem == "claude" and ("anthropicclaude" in exe or "claude.app/" in exe or "/windowsapps/" in exe):
        return "claude-desktop"
    if stem == "claude" or "@anthropic-ai/claude-code" in cmd:
        return "claude-code"
    if stem == "codex" or "@openai/codex" in cmd:
        return "codex"
    if stem == "gemini" or "@google/gemini-cli" in cmd:
        return "gemini-cli"
    return _PROC_TABLE.get(stem)


def match_processes(procs: list[ProcInfo]) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {}
    for p in procs:
        app = classify_process(p)
        if app:
            out.setdefault(app, []).append(p.pid)
    return out


def list_processes() -> list[ProcInfo]:
    try:
        import psutil  # type: ignore
    except ImportError:
        psutil = None
    if psutil is not None:
        out = []
        for pr in psutil.process_iter(["pid", "name", "exe", "cmdline"]):
            info = pr.info
            out.append(ProcInfo(info["pid"], info.get("name") or "", info.get("exe") or "", info.get("cmdline") or []))
        return out
    try:
        if sys.platform.startswith("win"):
            raw = subprocess.run(["tasklist", "/fo", "csv", "/nh"], capture_output=True, text=True, timeout=20).stdout
            out = []
            for line in raw.splitlines():
                cols = [c.strip('"') for c in line.split('","')]
                if len(cols) >= 2 and cols[1].isdigit():
                    out.append(ProcInfo(int(cols[1]), cols[0]))
            return out
        raw = subprocess.run(["ps", "-axo", "pid=,comm=,args="], capture_output=True, text=True, timeout=20).stdout
        out = []
        for line in raw.splitlines():
            parts = line.split(None, 2)
            if len(parts) >= 2 and parts[0].isdigit():
                out.append(ProcInfo(int(parts[0]), Path(parts[1]).name, parts[1], (parts[2] if len(parts) > 2 else "").split()))
        return out
    except (OSError, subprocess.SubprocessError):
        return []


def discover_apps(env: Env, processes: list[ProcInfo] | None = None) -> list[AppInfo]:
    running = match_processes(list_processes() if processes is None else processes)
    apps = []
    for app_id, name, vendor, kind, finder in CATALOG:
        try:
            ev = finder(env)
        except OSError:
            ev = []
        pids = running.get(app_id, [])
        if ev or pids:
            apps.append(AppInfo(app_id, name, vendor, kind, installed=bool(ev),
                                evidence=[str(p) for p in ev][:5], running=bool(pids), pids=pids))
    return apps


def app_label(app_id: str) -> str:
    return _NAMES.get(app_id, app_id)


# ---------- browser extensions ----------

_AI_WORDS = re.compile(
    r"(?i)\b(chat\s?gpt|gpt-?\d|openai|claude|anthropic|gemini|copilot|perplexity|deepseek|grok|mistral|"
    r"ai assistant|ai agent|ai writer|llm|sider|monica|merlin|maxai|harpa|chatbot)\b")
_AI_CAPS = re.compile(r"\bAI\b")
_BROAD = {"<all_urls>", "*://*/*", "http://*/*", "https://*/*"}


def _browser_roots(env: Env) -> list[tuple[str, Path]]:
    if env.platform == "windows":
        L = env.localappdata
        return [("chrome", L / "Google" / "Chrome" / "User Data"), ("edge", L / "Microsoft" / "Edge" / "User Data"),
                ("brave", L / "BraveSoftware" / "Brave-Browser" / "User Data"), ("chromium", L / "Chromium" / "User Data")]
    if env.platform == "darwin":
        A = env.appdata
        return [("chrome", A / "Google" / "Chrome"), ("edge", A / "Microsoft Edge"),
                ("brave", A / "BraveSoftware" / "Brave-Browser"), ("chromium", A / "Chromium")]
    C = env.home / ".config"
    return [("chrome", C / "google-chrome"), ("edge", C / "microsoft-edge"),
            ("brave", C / "BraveSoftware" / "Brave-Browser"), ("chromium", C / "chromium")]


def _resolve_msg(value: str, ext_dir: Path, default_locale: str | None) -> str:
    m = re.fullmatch(r"__MSG_(\w+)__", value or "")
    if not m:
        return value
    key = m.group(1).lower()
    for loc in [default_locale, "en", "en_US"]:
        if not loc:
            continue
        msgs = read_json(ext_dir / "_locales" / loc / "messages.json")
        if isinstance(msgs, dict):
            for k, v in msgs.items():
                if k.lower() == key and isinstance(v, dict):
                    return str(v.get("message", value))
    return value


def discover_browser_extensions(env: Env) -> list[BrowserExtension]:
    out = []
    for browser, root in _browser_roots(env):
        try:
            profiles = sorted(p for p in root.iterdir() if p.is_dir() and (p.name == "Default" or p.name.startswith("Profile ")))
        except OSError:
            continue
        for prof in profiles:
            try:
                ext_ids = sorted(d for d in (prof / "Extensions").iterdir() if d.is_dir())
            except OSError:
                continue
            for ext in ext_ids:
                try:
                    versions = sorted((v for v in ext.iterdir() if (v / "manifest.json").is_file()), key=lambda v: v.name)
                except OSError:
                    continue
                if not versions:
                    continue
                vdir = versions[-1]
                man = read_json(vdir / "manifest.json")
                if not isinstance(man, dict):
                    continue
                name = _resolve_msg(str(man.get("name", "")), vdir, man.get("default_locale"))
                desc = _resolve_msg(str(man.get("description", "")), vdir, man.get("default_locale"))
                if not (_AI_WORDS.search(name) or _AI_WORDS.search(desc) or _AI_CAPS.search(name)):
                    continue
                perms = [str(p) for p in list(man.get("permissions") or []) + list(man.get("host_permissions") or [])]
                cs = [m for c in (man.get("content_scripts") or []) if isinstance(c, dict) for m in c.get("matches", [])]
                broad = any(p in _BROAD for p in perms + cs)
                out.append(BrowserExtension(browser, prof.name, ext.name, name, str(man.get("version", "")), perms, broad))
    return out


# ---------- Claude Code configuration ----------

def _frontmatter(path: Path) -> dict:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    meta = {}
    for line in text[3:end if end > 0 else 0].splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip('"\'')
    return meta


def is_guard_command(cmd: str) -> bool:
    return "aiwarden" in cmd and "guard" in cmd


def discover_claude_config(env: Env) -> dict | None:
    claude_dir = env.home / ".claude"
    if not claude_dir.exists() and not (env.home / ".claude.json").exists():
        return None
    projects = known_projects(env)
    settings_files = [("user", claude_dir / "settings.json"), ("user", claude_dir / "settings.local.json")]
    for proj in projects:
        settings_files += [("project", proj / ".claude" / "settings.json"), ("local", proj / ".claude" / "settings.local.json")]
    hooks, allow, mode, sources = [], [], None, []
    for scope, path in settings_files:
        d = read_json(path)
        if not isinstance(d, dict):
            continue
        sources.append(str(path))
        perms = d.get("permissions") or {}
        if isinstance(perms, dict):
            allow += [str(a) for a in perms.get("allow") or []]
            if scope == "user" and perms.get("defaultMode"):
                mode = perms.get("defaultMode")
        hook_map = d.get("hooks") if isinstance(d.get("hooks"), dict) else {}
        for event, groups in hook_map.items():
            for g in groups if isinstance(groups, list) else []:
                for h in (g.get("hooks") or []) if isinstance(g, dict) else []:
                    if isinstance(h, dict) and h.get("command"):
                        hooks.append({"event": event, "matcher": g.get("matcher", ""), "command": str(h["command"])[:200],
                                      "scope": scope, "path": str(path)})
    skills = []
    for scope, base in [("user", claude_dir / "skills")] + [("project", p / ".claude" / "skills") for p in projects]:
        try:
            entries = sorted(base.iterdir())
        except OSError:
            continue
        for sk in entries:
            if (sk / "SKILL.md").is_file():
                fm = _frontmatter(sk / "SKILL.md")
                skills.append({"name": fm.get("name", sk.name), "description": fm.get("description", "")[:200],
                               "scope": scope, "path": str(sk)})
    try:
        agents = [p.stem for p in sorted((claude_dir / "agents").glob("*.md"))]
    except OSError:
        agents = []
    plugins: list[str] = []
    ip = read_json(claude_dir / "plugins" / "installed_plugins.json")
    if isinstance(ip, dict):
        plist = ip.get("plugins", ip)
        if isinstance(plist, dict):
            plugins = sorted(map(str, plist))
    return {
        "settings_files": sources,
        "permissions": {"allow": allow, "defaultMode": mode},
        "hooks": hooks,
        "skills": skills,
        "agents": agents,
        "plugins": plugins,
        "guard_installed": any(h["event"] == "PreToolUse" and is_guard_command(h["command"]) for h in hooks),
    }
