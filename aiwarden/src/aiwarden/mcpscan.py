"""MCP security scan: tool-poisoning / prompt-injection analysis of MCP tool definitions, plus
known-risky packages in MCP configs.

Getting tool definitions means starting the server (stdio) or calling it (HTTP). That only
happens when the user asks (--connect plus named servers, or --all --yes). The client sends
`initialize`, `notifications/initialized` and `tools/list` and nothing else: `_check_method`
refuses every other method, so no tool is ever called.

Launch values (env, args, headers) are re-read from the config file in memory because the
inventory keeps only redacted copies. They are passed to the child process and never printed,
logged or returned.

Checks are heuristics over text the server controls. A clean result means none of the
patterns matched, not that the server is safe.
"""
from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import tomllib
import unicodedata
import urllib.request
from pathlib import Path

from .mcp import MCPServer, load_jsonc
from .risk import SEVERITY_ORDER
from .secrets import scrub

PROTOCOL_VERSION = "2025-06-18"
_ALLOWED_METHODS = {"initialize", "notifications/initialized", "tools/list"}

# UPDATE ME (reviewed 2026-10-23). package -> (versions affected, severity, advisory, source)
# "versions affected": None = every version; otherwise the first fixed version.
RISKY_PACKAGES: dict[str, tuple[str | None, str, str, str]] = {
    "postmark-mcp": (None, "critical",
                     "Malicious npm package impersonating Postmark: from 1.0.16 it BCCs every email sent through it "
                     "to the attacker. Remove it and rotate anything it handled.",
                     "https://thehackernews.com/2025/09/first-malicious-mcp-server-found.html"),
    "mcp-remote": ("0.1.16", "high",
                   "CVE-2025-6514: OS command injection when connecting to an untrusted MCP server (>=0.0.5, <0.1.16).",
                   "https://advisories.gitlab.com/pkg/npm/mcp-remote/CVE-2025-6514/"),
    "@modelcontextprotocol/inspector": ("0.14.1", "high",
                                        "CVE-2025-49596: unauthenticated RCE via the Inspector proxy (<0.14.1).",
                                        "https://advisories.gitlab.com/pkg/npm/@modelcontextprotocol/inspector/CVE-2025-49596/"),
}

RULES = {
    "MCPX001": ("high", "Hidden instructions in a tool definition"),
    "MCPX002": ("high", "Tool definition points the agent at sensitive files"),
    "MCPX003": ("medium", "URL in a tool definition (possible exfiltration target)"),
    "MCPX004": ("high", "Invisible or direction-changing Unicode in a tool definition"),
    "MCPX005": ("medium", "Tool definition tries to change how other tools behave (shadowing)"),
    "MCPX006": ("medium", "Tool grants a broad capability"),
    "MCPX007": ("low", "Unusually long tool description"),
    "MCPX008": ("high", "Server combines sensitive access, code execution and network egress"),
    "MCPX010": ("high", "Known-risky MCP package"),
}

_HIDDEN = re.compile(
    r"(?i)<\s*(important|system|instructions?|secret|hidden|admin)\s*>|\[\s*(inst|system)\s*\]|"
    r"\bignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules)|"
    r"\b(do\s+not|don'?t|never)\s+(tell|mention|inform|reveal|notify|show)\b[^.]{0,40}\buser\b|"
    r"\bwithout\s+(telling|informing|notifying)\b|\bsecretly\b|\bbefore\s+using\s+this\s+tool\b|"
    r"\byou\s+must\s+(first|always)\b|\bthis\s+is\s+(very\s+)?important\b|\bsystem\s+prompt\b")
_SENSITIVE = re.compile(
    r"(?i)~?/?\.ssh\b|\bid_(rsa|ed25519|ecdsa|dsa)\b|\.aws/credentials|(^|[\s/'\"`(])\.env\b|\.netrc|"
    r"\.git-credentials|mcp\.json|claude_desktop_config|\.cursor/|\.claude\.json|\.codex/(auth|config)|"
    r"\bprivate[\s_-]?key\b|\bapi[\s_-]?keys?\b|\bpasswords?\b|\bcredentials?\b|\bcookies?\b|/etc/(passwd|shadow)")
_URL = re.compile(r"(?i)\bhttps?://[^\s\"'<>)]+")
_EXFIL_HOST = re.compile(r"(?i)ngrok|webhook|requestbin|pipedream|pastebin|interact\.sh|oast\.|burpcollaborator|"
                         r"trycloudflare|\.workers\.dev|discord(app)?\.com/api/webhooks|transfer\.sh")
_SHADOW = re.compile(r"(?i)\bwhen\s+(the\s+)?[\w.-]+\s+tool\s+is\s+(used|called|invoked)|"
                     r"\b(instead\s+of|rather\s+than)\s+(using\s+)?(the\s+)?[\w.-]+\s+tool|"
                     r"\b(always|also)\s+(bcc|cc|send\s+a\s+copy|forward)\b|\boverride\s+(the\s+)?(behavio|instructions)")
_CAPS = {
    "exec": re.compile(r"(?i)\b(exec(ute)?|run|shell|terminal|bash|powershell|cmd|eval|spawn|subprocess)\b.{0,40}"
                       r"\b(command|shell|code|script|process)s?\b|\b(run_command|execute_command|shell_exec|run_shell|eval_code)\b"),
    "network": re.compile(r"(?i)\b(fetch|download|http\s+request|post\s+to|upload|send\s+(an?\s+)?(email|message|request)|"
                          r"webhook|any\s+url)\b|\bfetch_url\b"),
    "fs_write": re.compile(r"(?i)\b(write|delete|remove|overwrite|move)\b.{0,30}\b(files?|director(y|ies)|paths?)\b"),
    "sensitive_read": _SENSITIVE,
}
_INVISIBLE = {0x200B, 0x200C, 0x200D, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xFEFF, 0x00AD, 0x180E}
_BIDI = set(range(0x202A, 0x202F)) | set(range(0x2066, 0x206A)) | {0x200E, 0x200F, 0x061C}


class MCPClientError(Exception):
    pass


def _check_method(method: str) -> None:
    if method not in _ALLOWED_METHODS:
        raise MCPClientError(f"aiwarden's MCP client only sends {sorted(_ALLOWED_METHODS)}; refusing {method!r}")


def _snippet(text: str, m: re.Match | None = None, width: int = 120) -> str:
    if m is None:
        s = text[:width]
    else:
        start = max(0, m.start() - 30)
        s = text[start:start + width]
    s = "".join(c if c.isprintable() else f"\\u{ord(c):04x}" for c in s)
    return scrub(s)[:width + 40]


def _finding(rule: str, server: str, tool: str | None, detail: str, severity: str | None = None, **extra) -> dict:
    sev, title = RULES[rule]
    return {"rule": rule, "severity": severity or sev, "title": title, "server": server, "tool": tool,
            "detail": detail[:380], **extra}


def _texts(tool: dict) -> list[tuple[str, str]]:
    """(where, text) for the tool's description and every schema description / title / default."""
    out = [("description", str(tool.get("description") or ""))]
    if tool.get("title"):
        out.append(("title", str(tool["title"])))

    def walk(node, path, depth=0):
        if depth > 6 or not isinstance(node, dict):
            return
        for key in ("description", "title", "default"):
            if isinstance(node.get(key), str):
                out.append((f"{path}.{key}", node[key]))
        for name, sub in (node.get("properties") or {}).items() if isinstance(node.get("properties"), dict) else []:
            walk(sub, f"{path}.{name}", depth + 1)
        if isinstance(node.get("items"), dict):
            walk(node["items"], f"{path}[]", depth + 1)

    walk(tool.get("inputSchema") or tool.get("input_schema") or {}, "inputSchema")
    return [(w, t) for w, t in out if t]


def _unicode_tricks(text: str) -> list[str]:
    hits = set()
    for c in text:
        o = ord(c)
        if o in _INVISIBLE:
            hits.add("zero-width/invisible")
        elif o in _BIDI:
            hits.add("bidi override")
        elif 0xE0000 <= o <= 0xE007F:
            hits.add("Unicode tag characters (invisible text)")
        elif unicodedata.category(c) == "Co":
            hits.add("private-use characters")
    return sorted(hits)


def _confusable_name(name: str) -> bool:
    """A tool name with non-ASCII letters (e.g. Cyrillic 'а' in 'reаd_file') can impersonate another tool."""
    return any(ord(c) > 127 and c.isalpha() for c in name)


def scan_tools(server: str, tools: list[dict], other_tools: dict[str, list[str]] | None = None) -> list[dict]:
    """Findings for one server's tools/list result. other_tools: {server: [tool names]} for shadowing checks."""
    findings: list[dict] = []
    foreign = {t.lower(): s for s, names in (other_tools or {}).items() if s != server for t in names if len(t) >= 4}
    caps: dict[str, list[str]] = {}
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        name = str(tool.get("name") or "?")
        texts = _texts(tool)
        rules_hit: set[str] = set()

        def add(rule, detail, **kw):
            if rule not in rules_hit:
                rules_hit.add(rule)
                findings.append(_finding(rule, server, name, detail, **kw))
                return
            # one finding per rule per tool, but a later, worse hit (e.g. an exfil host) raises its severity
            new = _finding(rule, server, name, detail, **kw)
            for i, f in enumerate(findings):
                if (f["rule"] == rule and f["tool"] == name
                        and SEVERITY_ORDER.get(new["severity"], 9) < SEVERITY_ORDER.get(f["severity"], 9)):
                    findings[i] = new

        for where, text in texts:
            if m := _HIDDEN.search(text):
                add("MCPX001", f"{where}: \"{_snippet(text, m)}\"")
            if (m := _SENSITIVE.search(text)) and (_HIDDEN.search(text) or re.search(r"(?i)\b(read|pass|send|include|upload|attach|content)", text)):
                add("MCPX002", f"{where}: \"{_snippet(text, m)}\"")
            for url in _URL.findall(text):
                host = re.sub(r"(?i)^https?://", "", url).split("/")[0]
                add("MCPX003", f"{where}: links to {scrub(host)[:80]}", severity="high" if _EXFIL_HOST.search(url) else None)
            if tricks := _unicode_tricks(text):
                add("MCPX004", f"{where}: {', '.join(tricks)}")
            if m := _SHADOW.search(text):
                add("MCPX005", f"{where}: \"{_snippet(text, m)}\"")
            low = text.lower()
            for fname, fserver in foreign.items():
                if re.search(rf"(?<![\w-]){re.escape(fname)}(?![\w-])", low):
                    add("MCPX005", f"{where}: mentions tool '{fname}' of server '{fserver}'")
                    break
        if _confusable_name(name):
            add("MCPX004", f"tool name {name.encode('ascii', 'backslashreplace').decode()} contains non-ASCII letters")
        desc = str(tool.get("description") or "")
        if len(desc) > 1500:
            add("MCPX007", f"description is {len(desc)} characters; long descriptions can hide instructions")
        joined = " ".join([name.replace("_", " "), name] + [t for _, t in texts])
        for cap, rx in _CAPS.items():
            if rx.search(joined):
                caps.setdefault(cap, []).append(name)
        if _CAPS["exec"].search(joined):
            add("MCPX006", "can execute commands or code on the host")
    if caps.get("exec") and caps.get("network") and caps.get("sensitive_read"):
        findings.append(_finding("MCPX008", server, None,
                                 f"exec: {', '.join(caps['exec'][:5])}; network: {', '.join(caps['network'][:5])}; "
                                 f"sensitive: {', '.join(caps['sensitive_read'][:5])}"))
    findings.sort(key=lambda f: (SEVERITY_ORDER.get(f["severity"], 9), f["rule"], f["tool"] or ""))
    return findings


def _split_pkg(pkg: str) -> tuple[str, str | None]:
    body = pkg[1:] if pkg.startswith("@") else pkg
    if "@" in body:
        name, ver = body.rsplit("@", 1)
        return ("@" if pkg.startswith("@") else "") + name, ver
    return pkg, None


def _ver_tuple(v: str) -> tuple[int, ...] | None:
    m = re.match(r"^v?(\d+(?:\.\d+)*)", v or "")
    return tuple(int(x) for x in m.group(1).split(".")) if m else None


def scan_config(servers: list[MCPServer]) -> list[dict]:
    """Static: known-risky packages referenced by MCP configs. Launches nothing."""
    out = []
    for s in servers:
        cands = [s.package] if s.package else []
        cands += [a for a in s.args if any(a == k or a.startswith(k + "@") for k in RISKY_PACKAGES)]
        for pkg in dict.fromkeys(c for c in cands if c):
            name, ver = _split_pkg(pkg)
            if name not in RISKY_PACKAGES:
                continue
            fixed, sev, advisory, source = RISKY_PACKAGES[name]
            if fixed:
                v, f = _ver_tuple(ver or ""), _ver_tuple(fixed)
                if v is not None and f is not None and v >= f:
                    continue
                if v is None:
                    sev = "medium"
                    advisory += f" The config does not pin a version; pin {name}@{fixed} or later."
            out.append(_finding("MCPX010", s.name, None, f"{pkg} ({s.client}, {s.scope}): {advisory}",
                                severity=sev, source=source, client=s.client, location=s.config_path))
    return out


# ---------- raw launch config ----------

def _load_doc(path: Path):
    text_path = Path(path)
    if text_path.suffix == ".toml":
        return tomllib.loads(text_path.read_text(encoding="utf-8"))
    return load_jsonc(text_path)


def raw_server_config(server: MCPServer) -> dict | None:
    """Unredacted launch values for a discovered server, re-read from its config file. Keep in memory only."""
    try:
        doc = _load_doc(Path(server.config_path))
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    if not isinstance(doc, dict):
        return None
    maps = []
    if server.scope == "local" and server.project and isinstance(doc.get("projects"), dict):
        maps.append(((doc["projects"].get(server.project) or {}).get("mcpServers")))
    maps += [doc.get("mcpServers"), doc.get("servers"), doc.get("mcp_servers"), doc.get("context_servers"),
             (doc.get("mcp") or {}).get("servers") if isinstance(doc.get("mcp"), dict) else None]
    cfg = next((m[server.name] for m in maps if isinstance(m, dict) and isinstance(m.get(server.name), dict)), None)
    if cfg is None:
        return None
    command, args, env = cfg.get("command"), cfg.get("args") or [], cfg.get("env") or {}
    if isinstance(command, dict):  # Zed legacy
        args, env, command = command.get("args") or args, command.get("env") or env, command.get("path")
    if isinstance(command, list):
        command, args = (command[0] if command else None), list(command[1:]) + list(args)
    url = next((cfg[k] for k in ("url", "serverUrl", "httpUrl") if isinstance(cfg.get(k), str)), None)
    headers = cfg.get("headers") or cfg.get("http_headers") or {}
    return {"command": command if isinstance(command, str) else None,
            "args": [os.path.expandvars(str(a)) for a in args] if isinstance(args, list) else [],
            "env": {str(k): os.path.expandvars(str(v)) for k, v in env.items()} if isinstance(env, dict) else {},
            "url": url, "headers": {str(k): os.path.expandvars(str(v)) for k, v in headers.items()} if isinstance(headers, dict) else {},
            "cwd": cfg.get("cwd") if isinstance(cfg.get("cwd"), str) else None,
            "transport": server.transport}


# ---------- stdio client ----------

def _kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if sys.platform.startswith("win"):  # npx -> node: proc.kill() would orphan the grandchild
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, timeout=10)
        else:
            os.killpg(proc.pid, 9)
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        proc.kill()
        proc.wait(timeout=5)
    except (OSError, subprocess.SubprocessError):
        pass


def _initialize_params() -> dict:
    return {"protocolVersion": PROTOCOL_VERSION, "capabilities": {},
            "clientInfo": {"name": "aiwarden-mcp-scan", "version": "0.1"}}


def list_tools_stdio(command: str, args: list[str], env: dict | None = None, cwd: str | None = None,
                     timeout: float = 15.0, max_pages: int = 20) -> list[dict]:
    """Start a stdio MCP server, run initialize + tools/list (following nextCursor), then kill it."""
    if not command:
        raise MCPClientError("server has no command")
    exe = shutil.which(command) or command
    kwargs = {"start_new_session": True} if not sys.platform.startswith("win") else {}
    try:
        proc = subprocess.Popen([exe, *args], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                env={**os.environ, **(env or {})}, cwd=cwd or None, **kwargs)
    except OSError as e:
        raise MCPClientError(f"could not start {Path(command).name}: {e.strerror or e}") from None
    lines: queue.Queue = queue.Queue()

    def reader():
        for raw in iter(proc.stdout.readline, b""):
            lines.put(raw)
        lines.put(None)

    threading.Thread(target=reader, daemon=True).start()
    deadline = time.monotonic() + timeout

    def send(method, params=None, mid=None):
        _check_method(method)
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        if mid is not None:
            msg["id"] = mid
        try:
            proc.stdin.write((json.dumps(msg) + "\n").encode())
            proc.stdin.flush()
        except OSError:
            raise MCPClientError("server closed its input") from None

    def wait(mid):
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise MCPClientError(f"timed out after {timeout:g}s")
            try:
                raw = lines.get(timeout=left)
            except queue.Empty:
                raise MCPClientError(f"timed out after {timeout:g}s") from None
            if raw is None:
                raise MCPClientError("server exited before answering")
            try:
                msg = json.loads(raw)
            except ValueError:
                continue  # log output on stdout
            if isinstance(msg, dict) and msg.get("id") == mid and "method" not in msg:
                if "error" in msg:
                    raise MCPClientError(f"server error: {scrub(str(msg['error']))[:200]}")
                return msg.get("result") or {}

    try:
        send("initialize", _initialize_params(), 1)
        wait(1)
        send("notifications/initialized")
        return _paginate(lambda mid, params: (send("tools/list", params, mid), wait(mid))[1], max_pages)
    finally:
        _kill_tree(proc)


def _paginate(call, max_pages: int) -> list[dict]:
    tools: list[dict] = []
    cursor = None
    for page in range(max_pages):
        res = call(2 + page, {"cursor": cursor} if cursor else {})
        tools += [t for t in res.get("tools") or [] if isinstance(t, dict)]
        cursor = res.get("nextCursor")
        if not cursor:
            break
    return tools


# ---------- streamable HTTP client ----------

def list_tools_http(url: str, headers: dict | None = None, timeout: float = 15.0, max_pages: int = 20) -> list[dict]:
    """initialize + tools/list against a Streamable HTTP MCP endpoint (JSON or SSE responses).
    The legacy HTTP+SSE transport (GET /sse, then POST to an announced endpoint) is not supported."""
    state = {"session": None, "proto": None}

    def post(method, params=None, mid=None):
        _check_method(method)
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        if mid is not None:
            msg["id"] = mid
        h = {**(headers or {}), "Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        if state["session"]:
            h["Mcp-Session-Id"] = state["session"]
        if state["proto"]:
            h["MCP-Protocol-Version"] = state["proto"]
        req = urllib.request.Request(url, data=json.dumps(msg).encode(), method="POST", headers=h)
        try:
            resp = urllib.request.urlopen(req, timeout=timeout)
        except OSError as e:
            raise MCPClientError(f"HTTP request failed: {scrub(str(getattr(e, 'reason', e)))[:200]}") from None
        with resp:
            state["session"] = resp.headers.get("Mcp-Session-Id") or state["session"]
            if mid is None:
                return None
            if "text/event-stream" in (resp.headers.get("Content-Type") or ""):
                data: list[str] = []
                for raw in resp:
                    line = raw.decode("utf-8", "replace").rstrip("\r\n")
                    if line.startswith("data:"):
                        data.append(line[5:].lstrip())
                    elif not line and data:
                        got = _match(json.loads("\n".join(data)), mid)
                        data = []
                        if got is not None:
                            return got
                if data:
                    got = _match(json.loads("\n".join(data)), mid)
                    if got is not None:
                        return got
                raise MCPClientError("SSE stream ended without a response")
            got = _match(json.loads(resp.read() or b"{}"), mid)
            if got is None:
                raise MCPClientError("no response with the expected id")
            return got

    res = post("initialize", _initialize_params(), 1)
    state["proto"] = res.get("protocolVersion") or PROTOCOL_VERSION
    post("notifications/initialized")
    return _paginate(lambda mid, params: post("tools/list", params, mid), max_pages)


def _match(msg, mid):
    for m in msg if isinstance(msg, list) else [msg]:
        if isinstance(m, dict) and m.get("id") == mid:
            if "error" in m:
                raise MCPClientError(f"server error: {scrub(str(m['error']))[:200]}")
            return m.get("result") or {}
    return None


# ---------- orchestration ----------

def fetch_tools(server: MCPServer, timeout: float = 15.0) -> list[dict]:
    raw = raw_server_config(server)
    if raw is None:
        raise MCPClientError("could not re-read the server's config entry")
    if raw["url"]:
        return list_tools_http(raw["url"], raw["headers"], timeout)
    return list_tools_stdio(raw["command"], raw["args"], raw["env"], raw["cwd"], timeout)


def run_scan(servers: list[MCPServer], connect: list[MCPServer] | None = None, timeout: float = 15.0,
             offline_tools: dict[str, list[dict]] | None = None) -> dict:
    """servers: inventory (static checks). connect: subset to launch/call for tools/list."""
    results, tool_sets = [], dict(offline_tools or {})
    for s in connect or []:
        entry = {"id": s.id, "name": s.name, "client": s.client, "transport": s.transport, "connected": False}
        try:
            tools = fetch_tools(s, timeout)
            entry.update(connected=True, tools=[str(t.get("name")) for t in tools])
            tool_sets[s.name] = tools
        except MCPClientError as e:
            entry["error"] = str(e)
        results.append(entry)
    findings = scan_config(servers)
    names = {srv: [str(t.get("name")) for t in tools] for srv, tools in tool_sets.items()}
    for srv, tools in tool_sets.items():
        findings += scan_tools(srv, tools, names)
    connected = {r["name"] for r in results}
    results += [{"id": s.id, "name": s.name, "client": s.client, "transport": s.transport, "connected": False}
                for s in servers if s.name not in connected]
    findings.sort(key=lambda f: (SEVERITY_ORDER.get(f["severity"], 9), f["rule"], f["server"], f.get("tool") or ""))
    return {"servers": results, "findings": findings}
