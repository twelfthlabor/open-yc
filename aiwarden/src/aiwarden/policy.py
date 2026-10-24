"""Pre-execution policy for agent tool calls.

This is a guardrail, not a sandbox: it catches the common, high-blast-radius mistakes an agent
makes (wiping a directory tree, dropping a database, force-pushing main, leaking a key) using
static analysis of the tool input. A determined adversary can obfuscate around it.
"""
from __future__ import annotations

import fnmatch
import functools
import json
import re
import shlex
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

from .secrets import find_secrets, value_is_secret

MAX_SCAN = 64 * 1024  # analyse at most this much of a command; keeps the hook fast on huge heredocs
ACTION_RANK = {"allow": 0, "ask": 1, "deny": 2}
SHELL_TOOLS = {"bash", "powershell", "shell", "local_shell", "exec_command", "run_shell_command", "run_terminal_cmd"}
FILE_WRITE_TOOLS = {"write", "edit", "multiedit", "notebookedit", "write_file", "replace", "apply_patch"}
FILE_PATH_TOOLS = FILE_WRITE_TOOLS | {"read", "notebookread", "read_file", "view"}

RULES = {
    "GRD001": ("deny", "Recursive delete of a root, home or wildcard path"),
    "GRD002": ("deny", "Disk wipe or filesystem format"),
    "GRD003": ("ask", "Recursive delete of a path built only from a variable (if it is empty, the target is /)"),
    "GRD010": ("deny", "DROP DATABASE / DROP SCHEMA"),
    "GRD011": ("ask", "Destructive SQL (DROP TABLE, TRUNCATE, DELETE without WHERE)"),
    "GRD020": ("deny", "Force-push to, or deletion of, a protected branch"),
    "GRD021": ("ask", "Force or mirror push without an explicit, unprotected branch"),
    "GRD030": ("deny", "Piping a downloaded script into a shell"),
    "GRD040": ("deny", "Access to a credential file (SSH keys, cloud credentials, tokens)"),
    "GRD041": ("ask", "Reading a .env file"),
    "GRD050": ("deny", "Writing a plaintext secret into a file"),
    "GRD051": ("ask", "Secret in a command or tool call that leaves the machine"),
    "GRD060": ("ask", "Uploading a local file to a remote host"),
    "GRD070": ("ask", "Agent modifying its own permission or guard config"),
}

PROTECTED_BRANCHES = {"main", "master", "production", "prod", "trunk"}
_WRAPPERS = {"sudo", "doas", "env", "nohup", "time", "nice", "command", "exec", "builtin", "xargs", "stdbuf", "timeout"}
_WRAPPER_FLAGS = {"sudo", "doas", "env", "nice", "timeout", "xargs", "stdbuf"}
# Wrapper options that consume the next token (`sudo -u root rm ...`).
_WRAPPER_VALUE_FLAGS = {
    "sudo": {"-u", "-g", "-C", "-h", "-p", "-r", "-t", "-U", "-D", "--user", "--group", "--chdir", "--host", "--prompt"},
    "doas": {"-u", "-C"},
    "env": {"-u", "-C", "--unset", "--chdir"},
    "nice": {"-n", "--adjustment"},
    "timeout": {"-s", "-k", "--signal", "--kill-after"},
    "xargs": {"-I", "-n", "-P", "-L", "-d", "-s", "-a", "-E"},
    "stdbuf": {"-i", "-o", "-e"},
}
_SHELLS = {"bash", "sh", "zsh", "dash", "ksh", "fish"}
_DB_CLIENTS = re.compile(r"(?i)(^|[\s/\\\"'])(psql|mysql|mariadb|sqlite3|sqlcmd|duckdb|clickhouse(-client)?|snowsql|bq|"
                         r"cockroach|mongosh|mongo|redis-cli|turso|supabase|prisma|wrangler\s+d1|pgcli|mycli|litecli)(\.exe)?\b")
_SQL_HARD = re.compile(r"(?i)\bdrop\s+(database|schema)\b|\bdropdb\b|\.dropDatabase\s*\(")
_SQL_SOFT = re.compile(r"(?i)\bdrop\s+table\b|\btruncate\s+(table\s+)?[\w.\"`\[\]]+|"
                       r"\bdelete\s+from\s+[\w.\"`\[\]]+\s*(;|$|\)|'|\")|\bflushall\b|\bflushdb\b")
_ORM_DESTRUCTIVE = re.compile(
    r"(?i)\bprisma\s+(migrate\s+reset|db\s+push\b[^;&|]*--force-reset)|\b(rails|rake)\s+db:(drop|reset|purge|schema:load)\b|"
    r"\bmanage\.py\s+(flush|reset_db)\b|\bdjango-admin\s+flush\b|\bsupabase\s+db\s+reset\b|\bsequelize(-cli)?\s+db:drop\b|"
    r"\btypeorm\s+schema:drop\b|\bdrizzle-kit\s+drop\b")
_DB_TOOL = re.compile(r"(?i)sql|postgres|(^|_|\b)pg($|_|\b)|mysql|maria|sqlite|(^|_)db($|_)|database|supabase|neon|bigquery|snowflake|"
                      r"clickhouse|duckdb|mongo|redis|turso|planetscale|cockroach|dynamo|firestore")
# Download-and-execute forms that are not a plain `downloader | interpreter` pipeline (matched per segment).
_PIPE_SHELL = re.compile(
    r"(?i)\b(iex|invoke-expression)\b.*\b(downloadstring|iwr|irm|invoke-webrequest|invoke-restmethod)\b"
    r"|\b(bash|sh|zsh)\s+(-c\s+)?[\"']?\$?[<(]\(?\s*(curl|wget)\b"
    r"|(^|[\s(])(source|\.|eval)\s+[\"']?(<\(|\$\(|`)\s*(curl|wget|iwr|irm)\b"
    r"|\[scriptblock\]::create\(.{0,200}?\b(irm|iwr|invoke-restmethod|invoke-webrequest|downloadstring)\b")
_DOWNLOADERS = {"curl", "wget", "iwr", "irm", "invoke-webrequest", "invoke-restmethod"}
_SCRIPT_INTERPRETERS = {"python", "python2", "python3", "perl", "ruby", "node", "deno", "bun", "php"}
_INLINE_FLAGS = {"-c", "-e", "-m", "-p", "-r", "--eval", "--print", "-command"}
# Commands that only look at a path (existence, metadata, ignore rules) without reading its contents.
_META_CMDS = {"ls", "dir", "stat", "test", "[", "[[", "file", "git", "chmod", "chown", "touch", "du", "echo", "printf",
              "realpath", "readlink", "basename", "dirname", "get-item", "test-path", "get-childitem", "gci", "which",
              # these take a key/config path as an argument and use it, rather than printing it
              "ssh", "ssh-add", "ssh-keygen", "scp", "sftp", "kubectl", "helm", "export", "gcloud", "aws", "az"}
_LOCAL_URL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"}
_REDIRECT_TARGET = re.compile(r">>?\s*['\"]?([^\s'\";|&<>]+)")
_CRED_DIR = re.compile(r"(^|/)(\.ssh|\.aws|\.gnupg|\.kube|\.config/gcloud|\.azure|\.docker)/?$", re.I)
_URL_CRED_HOST = re.compile(r"(?i)\b[a-z][a-z0-9+.\-]{0,30}://[^/\s:@]{1,256}:[^/\s@]{3,256}@([^/\s:?#'\"]+)")
# Bounded quantifiers on both sides of the keyword: unbounded ones make this quadratic on long identifier runs.
_NAMED_ASSIGN = re.compile(
    r"""(?i)([A-Za-z0-9_.\-]{0,40}(?:secret|password|passwd|api[_\-]?key|token|private[_\-]?key|access[_\-]?key)"""
    r"""[A-Za-z0-9_.\-]{0,40})["']?[ \t]{0,8}[:=][ \t]{0,8}["']([^"'\s]{8,200})["']""")
# YAML / INI / .properties values are usually unquoted.
_NAMED_ASSIGN_BARE = re.compile(
    r"""(?im)^[ \t\-]{0,16}([A-Za-z0-9_.\-]{0,40}(?:secret|password|passwd|api[_\-]?key|token|private[_\-]?key|access[_\-]?key)"""
    r"""[A-Za-z0-9_.\-]{0,40})[ \t]{0,8}[:=][ \t]{0,8}([^"'\s#]{8,200})[ \t]*$""")
_CONFIG_FILE = re.compile(r"\.(ya?ml|ini|properties|conf|cfg|toml)$|(^|/)docker-compose[^/]*$", re.I)
_SELF_CONFIG_ANY = re.compile(r"\.claude/settings(\.local)?\.json|\.claude\.json|\.codex/config\.toml|\.codex/hooks\.json|"
                              r"\.aiwarden/policy\.toml|\.aiwarden/config\.toml|"
                              r"\.gemini/settings\.json|\.claude/hooks/", re.I)
_INLINE_WRITE = re.compile(r"""(?i)writeFile|appendFile|write_text|write_bytes|\.write\(|json\.dump\(|"""
                           r"""open\([^)]*,\s*['"][wax]\+?b?['"]|set-content|out-file|add-content|unlink|rmSync|os\.remove""")
_READ_ONLY_CMDS = {"cat", "less", "more", "head", "tail", "jq", "grep", "rg", "egrep", "type", "get-content", "gc", "bat",
                   "diff", "wc", "code", "vim", "nano", "open"}
_TEST_PATH = re.compile(r"(^|/)(tests?|__tests__|spec|specs|fixtures?|__fixtures__|testdata)/|\.(test|spec)\.[a-z0-9]+$|"
                        r"(^|/)test_[^/]*\.py$|_test\.(go|py|rs)$", re.I)
_DISK = re.compile(r"(?i)\bdd\b[^|;&]*\bof=/dev/(sd|nvme|hd|disk|xvd|vd|mmcblk)|\bmkfs(\.\w+)?\b|\bwipefs\b|"
                   r"\bformat(\.com)?\s+[a-z]:|\bdiskpart\b|\bformat-volume\b|\bclear-disk\b|>\s*/dev/(sd|nvme|disk)[a-z0-9]*\b|"
                   r"\bdiskutil\s+(erase\w*|partitionDisk|zeroDisk|secureErase)\b|\bshred\b[^|;&]*/dev/")
# matched per pipeline segment, so `.*` cannot run across a whole script
_UPLOAD = re.compile(r"(?i)\bcurl\b.*(\s-d\s*@|--data(-binary|-raw|-urlencode)?[\s=]+@|\s-F\s*\S*=@|--form\s+\S*=@|\s-T\s|--upload-file)"
                     r"|\bwget\b.*--post-file|\binvoke-(webrequest|restmethod)\b.*-infile\b")
_CRED_PATHS = [re.compile(p, re.I) for p in (
    r"(^|/)\.ssh/(?!.*\.pub$)(id_[^/]*|[^/]*\.pem|[^/]*_key)$",
    r"(^|/)\.aws/credentials$", r"(^|/)\.git-credentials$", r"(^|/)\.netrc$", r"(^|/)_netrc$",
    r"(^|/)\.docker/config\.json$", r"(^|/)\.kube/config$",
    r"(^|/)\.config/gcloud/(credentials\.db|application_default_credentials\.json|access_tokens\.db)$",
    r"(^|/)\.azure/(accesstokens\.json|msal_token_cache\.(json|bin))$",
    r"(^|/)\.claude/\.credentials\.json$", r"(^|/)\.codex/auth\.json$", r"(^|/)\.config/gh/hosts\.yml$",
    r"(^|/)(login data|cookies)$", r"\.(p12|pfx)$", r"(^|/)[^/]*private[^/]*\.(pem|key)$",
)]
_DOTENV = re.compile(r"(^|/)\.env(\.[\w-]+)?$", re.I)
_DOTENV_SAFE = re.compile(r"\.(example|sample|template|dist|defaults)$", re.I)
_SELF_CONFIG = re.compile(r"(^|/)\.claude/settings(\.local)?\.json$|(^|/)\.codex/(config\.toml|hooks\.json)$|"
                          r"(^|/)\.aiwarden/(policy|config)\.toml$"
                          r"|(^|/)\.gemini/settings\.json$|(^|/)\.claude\.json$|(^|/)\.claude/hooks/", re.I)
_SELF_EDITORS = {"sed", "rm", "mv", "cp", "tee", "set-content", "out-file", "remove-item", "add-content", "perl", "truncate"}


@dataclass
class Decision:
    action: str = "allow"
    rule: str | None = None
    reason: str = ""
    would_be: str | None = None

    def to_dict(self) -> dict:
        return {"action": self.action, "rule": self.rule, "reason": self.reason, "would_be": self.would_be}


@dataclass
class CustomRule:
    id: str
    action: str
    pattern: re.Pattern
    tools: list[str] = field(default_factory=list)
    reason: str = ""


@dataclass
class Policy:
    mode: str = "enforce"  # enforce | monitor
    overrides: dict[str, str] = field(default_factory=dict)
    custom: list[CustomRule] = field(default_factory=list)
    allow_commands: list[re.Pattern] = field(default_factory=list)
    # Agents whose hooks cannot ask the user (Gemini CLI, Codex) turn an "ask" into this.
    ask_fallback: str = "deny"

    @classmethod
    def load(cls, path: Path | None) -> "Policy":
        if not path or not Path(path).is_file():
            return cls()
        data = tomllib.loads(Path(path).read_text(encoding="utf-8"))
        custom = []
        for c in data.get("custom") or []:
            if c.get("id") and c.get("pattern") and c.get("action") in ACTION_RANK:
                custom.append(CustomRule(str(c["id"]), c["action"], re.compile(c["pattern"], re.I),
                                         list(c.get("tools") or []), str(c.get("reason") or c["id"])))
        return cls(mode=data.get("mode", "enforce"),
                   overrides={k: str(v) for k, v in (data.get("rules") or {}).items()},
                   custom=custom, allow_commands=[re.compile(p) for p in data.get("allow_commands") or []],
                   ask_fallback="allow" if data.get("ask_fallback") == "allow" else "deny")


# ---------- shell parsing ----------

def _split_segments(cmd: str) -> list[str]:
    """Split on ; && || | & and newlines outside quotes."""
    segs, cur, quote = [], [], None
    for c in cmd:
        if quote:
            cur.append(c)
            if c == quote:
                quote = None
        elif c in "'\"":
            quote = c
            cur.append(c)
        elif c in ";|&\n":
            segs.append("".join(cur))
            cur = []
        else:
            cur.append(c)
    segs.append("".join(cur))
    return [s.strip() for s in segs if s.strip()]


_WORD = re.compile(r"""(?:'[^']*'|"(?:\\.|[^"\\])*"|[^\s'"])+""")
_QUOTED = re.compile(r"""'([^']*)'|"((?:\\.|[^"\\])*)\"""")


@functools.lru_cache(maxsize=8192)
def _tokens(seg: str) -> tuple[str, ...]:
    """Shell words with quotes removed. Backslashes are kept (Windows paths); a stray
    unbalanced quote character is dropped rather than failing the parse."""
    return tuple(_QUOTED.sub(lambda m: m.group(1) if m.group(1) is not None else m.group(2), w) for w in _WORD.findall(seg))


def _base(tok: str) -> str:
    b = tok.replace("\\", "/").rsplit("/", 1)[-1].lower()
    for s in (".exe", ".cmd", ".bat"):
        b = b.removesuffix(s)
    return b


def _strip_wrappers(toks: list[str]) -> list[str]:
    i = 0
    while i < len(toks):
        t = toks[i]
        base = _base(t)
        if base in _WRAPPERS or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t):
            i += 1
            if base in _WRAPPER_FLAGS:
                while i < len(toks) and toks[i].startswith("-"):
                    i += 2 if toks[i] in _WRAPPER_VALUE_FLAGS.get(base, ()) else 1
            if base == "timeout" and i < len(toks) and re.match(r"^\d", toks[i]):
                i += 1
            continue
        break
    return toks[i:]


def _pipelines(cmd: str) -> list[list[str]]:
    """Statements (split on ; && || & newline) as lists of pipeline stages (split on single |)."""
    statements, stages, cur, quote, i = [], [], [], None, 0
    while i < len(cmd):
        c = cmd[i]
        nxt = cmd[i + 1] if i + 1 < len(cmd) else ""
        if quote:
            cur.append(c)
            if c == quote:
                quote = None
        elif c in "'\"":
            quote = c
            cur.append(c)
        elif c == "|" and nxt != "|":
            stages.append("".join(cur))
            cur = []
        elif c in ";\n&" or (c == "|" and nxt == "|"):
            stages.append("".join(cur))
            statements.append([s.strip() for s in stages if s.strip()])
            stages, cur = [], []
            if nxt == c:
                i += 1
        else:
            cur.append(c)
        i += 1
    stages.append("".join(cur))
    statements.append([s.strip() for s in stages if s.strip()])
    return [s for s in statements if s]


def _reads_program_from_stdin(toks: list[str]) -> bool:
    b = re.sub(r"(\d+(\.\d+)*)$", "", _base(toks[0])) or _base(toks[0])
    args = toks[1:]
    if b in {"iex", "invoke-expression"}:
        return True
    if b in _SHELLS or b in {"pwsh", "powershell"}:
        flags = [a for a in args if a.startswith("-")]
        if any(f.lower() in _INLINE_FLAGS or re.fullmatch(r"-[a-z]*c[a-z]*", f) for f in flags):
            return False
        if b in _SHELLS:
            # bash [-flags] with no script file reads stdin; `bash -s -- args` too
            first = next((a for a in args if not a.startswith("-")), None)
            return first is None or "-s" in flags or any(re.fullmatch(r"-[a-z]*s[a-z]*", f) for f in flags)
        return not args or args[0] == "-"
    if b in _SCRIPT_INTERPRETERS:
        if any(a.lower() in _INLINE_FLAGS for a in args):
            return False
        positional = [a for a in args if not a.startswith("-") or a == "-"]
        return not positional or positional[0] == "-"
    return False


def _pipe_to_interpreter(cmd: str) -> bool:
    for statement in _pipelines(cmd):
        downloaded = False
        for stage in statement:
            toks = _strip_wrappers(_tokens(stage))
            if not toks:
                continue
            if downloaded and _reads_program_from_stdin(toks):
                return True
            if _base(toks[0]) in _DOWNLOADERS:
                downloaded = True
    return False


def _download_outputs(toks) -> list[str]:
    """Basenames of files a curl/wget/iwr invocation writes."""
    b, args = _base(toks[0]), list(toks[1:])
    urls = [a for a in args if re.match(r"(?i)https?://", a)]
    url_name = urls[-1].split("?")[0].rstrip("/").rsplit("/", 1)[-1] if urls else ""
    out = []
    for i, a in enumerate(args):
        nxt = args[i + 1] if i + 1 < len(args) else ""
        if b == "curl":
            if a in {"-o", "--output"} or re.fullmatch(r"-[a-zA-Z]*o", a):
                out.append(nxt)
            elif a in {"-O", "--remote-name"} or re.fullmatch(r"-[a-zA-Z]*O", a):
                out.append(url_name)
        elif b == "wget":
            if a in {"-O", "--output-document"}:
                out.append(nxt)
            elif a.startswith("--output-document="):
                out.append(a.split("=", 1)[1])
        elif b in {"iwr", "invoke-webrequest", "irm", "invoke-restmethod"} and a.lower() == "-outfile":
            out.append(nxt)
    if b == "wget" and not out and url_name:
        out.append(url_name)
    return [Path(o.replace("\\", "/")).name.lower() for o in out if o and o != "-"]


def _download_then_run(cmds: list) -> bool:
    downloaded: set[str] = set()
    for toks in cmds:
        b = _base(toks[0])
        if b in _DOWNLOADERS:
            downloaded |= set(_download_outputs(toks))
            continue
        if not downloaded:
            continue
        if Path(toks[0].replace("\\", "/")).name.lower() in downloaded:  # ./install.sh
            return True
        interp = re.sub(r"(\d+(\.\d+)*)$", "", b)
        if interp in _SHELLS | _SCRIPT_INTERPRETERS | {"source", ".", "pwsh", "powershell"}:
            first = next((a for a in toks[1:] if not a.startswith("-")), None)
            if first and Path(first.replace("\\", "/")).name.lower() in downloaded:
                return True
    return False


def _pipeline_delete(cmd: str) -> bool:
    """`echo / | xargs rm -rf`, `Get-ChildItem C:\\ | Remove-Item -Recurse`: targets come from an earlier stage."""
    for statement in _pipelines(cmd):
        seen_danger = False
        for stage in statement:
            toks = _strip_wrappers(_tokens(stage))
            if not toks:
                continue
            if seen_danger and _delete_targets(toks) == []:
                return True
            b = _base(toks[0])
            lister = b in {"echo", "printf", "ls", "dir", "get-childitem", "gci", "get-item"} or (
                b == "find" and not any(a in _FIND_FILTERS for a in toks[1:]))
            if lister and any(_dangerous_target(a) for a in toks[1:] if not a.startswith("-")):
                seen_danger = True
    return False


def _inner_scripts(cmd: str, depth: int = 0) -> list[str]:
    """cmd plus every script nested via bash -c / cmd /c / powershell -Command / eval."""
    out = [cmd]
    if depth >= 4:
        return out
    for seg in _split_segments(cmd):
        toks = _strip_wrappers(_tokens(seg))
        if not toks:
            continue
        inner = _inner_of(toks)
        if inner is not None:
            out += _inner_scripts(inner, depth + 1)
    return out


def _inner_of(toks: list[str]) -> str | None:
    b = _base(toks[0])
    if b in _SHELLS:
        for j, t in enumerate(toks[1:], 1):
            if re.fullmatch(r"-[a-z]*c[a-z]*", t) and j + 1 < len(toks):
                return toks[j + 1]
    elif b == "cmd" and len(toks) > 2 and toks[1].lower() in {"/c", "/k"}:
        return " ".join(toks[2:])
    elif b in {"powershell", "pwsh"}:
        for j, t in enumerate(toks[1:], 1):
            if t.lower() in {"-command", "-c"} and j + 1 < len(toks):
                return " ".join(toks[j + 1:])
    elif b == "eval" and len(toks) > 1:
        return " ".join(toks[1:])
    return None


def iter_commands(cmd: str, depth: int = 0) -> list[list[str]]:
    """All simple commands in a shell string, descending into bash -c / cmd /c / powershell -Command."""
    out = []
    for seg in _split_segments(cmd):
        toks = _strip_wrappers(_tokens(seg))
        if not toks:
            continue
        inner = _inner_of(toks)
        if inner is not None and depth < 4:
            out += iter_commands(inner, depth + 1)
        else:
            out.append(toks)
    return out


_DANGER_NAMES = {"", "~", "$home", "${home}", "%userprofile%", "$env:userprofile", "*", ".", "..", "/home", "/users",
                 "/etc", "/usr", "/var", "/bin", "/sbin", "/boot", "/lib", "/lib64", "/opt", "/root", "/system",
                 "/library", "/applications", "/private", "/srv", "/mnt", "/dev",
                 "$(pwd)", "`pwd`", "$pwd", "${pwd}"}
_ONLY_VAR = re.compile(r"\$\{?[a-z_][a-z0-9_]*\}?")
_FIND_FILTERS = {"-name", "-iname", "-path", "-ipath", "-regex", "-iregex", "-wholename", "-iwholename"}


def _strip_tail(n: str) -> str:
    """Drop trailing '/', '/*' and '/.' (linear; a regex here backtracks quadratically)."""
    i = len(n)
    while i > 0:
        if n[i - 1] == "/":
            i -= 1
        elif i >= 2 and n[i - 2] == "/" and n[i - 1] in "*.":
            i -= 2
        else:
            break
    return n[:i]


def _norm_target(t: str) -> tuple[str, bool]:
    """(normalized path, had a trailing / or /*)."""
    n = t.strip("'\"").replace("\\", "/").lower()
    n = re.sub(r"^/mnt/([a-z])(?=/|$)", r"\1:", n)  # WSL drive mounts
    n = re.sub(r"^/([a-z])(?=/|$)", r"\1:", n)       # Git Bash / MSYS drive paths
    stripped = _strip_tail(n)
    return stripped, stripped != n


def _dangerous_target(t: str) -> bool:
    n, _ = _norm_target(t)
    if n in _DANGER_NAMES:
        return True
    if re.fullmatch(r"[a-z]:", n) or re.fullmatch(r"[a-z]:/(windows|users|program files( \(x86\))?|programdata)", n):
        return True
    if re.fullmatch(r"(/home|/users|[a-z]:/users)/[^/*]+", n):
        return True
    return _HOME_SUBDIR.fullmatch(n) is not None


_HOME_SUBDIR = re.compile(r"(~|\$home|\$\{home\}|%userprofile%|/home/[^/]+|/users/[^/]+|[a-z]:/users/[^/]+)/"
                          r"(documents|desktop|downloads|pictures|music|videos|movies|library|onedrive|appdata|"
                          r"\.ssh|\.config|\.aws|\.gnupg|\.kube|\.local)")


def _var_only_target(t: str) -> bool:
    n, had_tail = _norm_target(t)
    return had_tail and _ONLY_VAR.fullmatch(n) is not None


def _delete_targets(toks) -> list[str] | None:
    """Targets of a recursive delete command, or None if it is not one."""
    b = _base(toks[0])
    args = list(toks[1:])
    if b == "rm":
        flags = [a for a in args if a.startswith("-") and a != "--"]
        recursive = any(f in ("--recursive", "-r", "-R") or f.lower().startswith("-rec")
                        or (not f.startswith("--") and ("r" in f or "R" in f)) for f in flags)
        return [a for a in args if not a.startswith("-")] if recursive else None
    if b in {"remove-item", "ri", "rmdir", "rd", "del", "erase"}:
        low = [a.lower() for a in args]
        if not any(a.startswith("-rec") or a in {"-r", "/s"} for a in low):
            return None
        return [a for a in args if not a.startswith("-") and a.lower() not in {"/s", "/q", "/f", "/a"}]
    if b == "find" and ("-delete" in args or ("-exec" in args and "rm" in args)):
        if any(a in _FIND_FILTERS for a in args):  # `find . -name '*.pyc' -delete` is targeted cleanup
            return None
        return [a for a in args if not a.startswith("-")][:1]
    return None


def _delete_rule(toks) -> str | None:
    targets = _delete_targets(toks)
    if not targets:
        return None
    if any(_dangerous_target(t) for t in targets):
        return "GRD001"
    if any(_var_only_target(t) for t in targets):
        return "GRD003"
    return None


def _git_push(toks: list[str]) -> str | None:
    if _base(toks[0]) != "git" or "push" not in toks:
        return None
    rest = toks[toks.index("push") + 1:]
    flags = [a for a in rest if a.startswith("-")]
    refspecs = [a for a in rest if not a.startswith("-")][1:]
    hard_force = any(f == "--force" or (f.startswith("--force=") and f.lower() not in {"--force=false", "--force=0"})
                     or re.fullmatch(r"-[a-z]*f[a-z]*", f) is not None for f in flags)
    lease = any(f.startswith(("--force-with-lease", "--force-if-includes")) for f in flags)
    force = hard_force or any(r.startswith("+") for r in refspecs)
    delete = any(f in {"--delete", "-d"} for f in flags) or any(r.startswith(":") for r in refspecs)
    protected = any(r.lstrip("+").split(":")[-1].removeprefix("refs/heads/") in PROTECTED_BRANCHES for r in refspecs)
    if (force or delete) and protected:
        return "GRD020"
    if "--mirror" in flags:
        return "GRD021"
    if (force or lease) and not refspecs:
        return "GRD021"
    if lease and protected:
        return "GRD021"
    return None


def _norm_path(p: str) -> str:
    return str(p).strip("'\"").replace("\\", "/")


def _cred_rule(path: str) -> str | None:
    n = _norm_path(path)
    if any(rx.search(n) for rx in _CRED_PATHS):
        return "GRD040"
    if _DOTENV.search(n) and not _DOTENV_SAFE.search(n):
        return "GRD041"
    return None


def _text_of(value) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


def _is_remote_spec(a: str) -> bool:
    return (re.match(r"^[^/\s:]+:", a) is not None and not re.match(r"^[A-Za-z]:[\\/]", a)
            and not a.startswith(("localhost:", "127.0.0.1:")))


def _shell_hits(cmd: str) -> list[str]:
    hits: list[str] = []
    cmds = iter_commands(cmd)
    hits += [r for t in cmds if (r := _delete_rule(t))]
    if _DISK.search(cmd):
        hits.append("GRD002")
    if _DB_CLIENTS.search(cmd) or re.search(r"(?i)\bdropdb\b", cmd):
        if _SQL_HARD.search(cmd):
            hits.append("GRD010")
        if _SQL_SOFT.search(cmd):
            hits.append("GRD011")
    if _ORM_DESTRUCTIVE.search(cmd):
        hits.append("GRD011")
    hits += [r for t in cmds if (r := _git_push(t))]
    scripts = _inner_scripts(cmd)
    segments = [seg for s in scripts for seg in _split_segments(s)]
    if (any(_PIPE_SHELL.search(seg) for seg in segments) or any(_pipe_to_interpreter(s) for s in scripts)
            or _download_then_run(cmds)):
        hits.append("GRD030")
    if any(_pipeline_delete(s) for s in scripts):
        hits.append("GRD001")
    for t in cmds:
        b = _base(t[0])
        if b not in _META_CMDS:
            # `cp .env.example .env` writes .env, it does not read it
            args = t[1:-1] if b in {"cp", "copy", "copy-item", "install"} and len(t) > 2 else t[1:]
            hits += [r for tok in args if (r := _cred_rule(tok.lstrip("<>@")))]
            if b in {"cp", "copy", "copy-item"} and len(t) > 2 and _cred_rule(t[-1]) == "GRD040":
                hits.append("GRD040")
        if _edits_self_config(t):
            hits.append("GRD070")
    for s in scripts:
        if any(_SELF_CONFIG.search(_norm_path(m.group(1))) for m in _REDIRECT_TARGET.finditer(s)):
            hits.append("GRD070")
            break
    if find_secrets(cmd):
        hits.append("GRD051")
    remote_copy = any(_base(t[0]) in {"scp", "rsync"} and any(_is_remote_spec(a) for a in t[1:]) for t in cmds)
    upload = any(_UPLOAD.search(seg) and not _all_local_urls(seg) for seg in segments)
    if upload or remote_copy:
        hits.append("GRD060")
    return hits


def _all_local_urls(cmd: str) -> bool:
    hosts = re.findall(r"(?i)\bhttps?://(\[[^\]]+\]|[^/\s:'\"]+)", cmd)
    return bool(hosts) and all(h.lower() in _LOCAL_URL_HOSTS for h in hosts)


def _edits_self_config(t: list[str]) -> bool:
    b, args = _base(t[0]), t[1:]
    hits = [i for i, a in enumerate(args) if _SELF_CONFIG_ANY.search(_norm_path(a))]
    if not hits:
        return False
    if b in {"sed", "perl"}:
        return any(a.startswith("-i") or a.startswith("--in-place") for a in args)
    if b in {"cp", "mv", "copy", "move", "copy-item", "move-item"}:
        return hits[-1] == len(args) - 1  # config file is the destination
    interp = re.sub(r"(\d+(\.\d+)*)$", "", b)
    if interp in _SCRIPT_INTERPRETERS or interp in {"pwsh", "powershell"}:
        # `python -c "open('.claude/settings.json','w')..."` writes; `node -e "readFileSync(...)"` only reads
        return _INLINE_WRITE.search(" ".join(args)) is not None
    return b in _SELF_EDITORS


def _file_hits(tool: str, inp: dict) -> list[str | tuple[str, str]]:
    hits: list[str | tuple[str, str]] = []
    raw_path = inp.get("file_path") or inp.get("path") or inp.get("notebook_path") or ""
    path = raw_path if isinstance(raw_path, str) else ""
    writing = tool in FILE_WRITE_TOOLS
    if path:
        r = _cred_rule(path)
        if r and not (writing and r == "GRD041"):  # writing a .env file is where secrets belong
            hits.append(r)
        if writing and _SELF_CONFIG.search(_norm_path(path)):
            hits.append("GRD070")
    if writing:
        chunks = [inp.get("content"), inp.get("new_string"), inp.get("new_source"), inp.get("patch"), inp.get("input")]
        edits = inp.get("edits")
        if isinstance(edits, list):
            chunks += [e.get("new_string") for e in edits if isinstance(e, dict)]
        text = "\n".join(c for c in chunks if isinstance(c, str))[: 4 * MAX_SCAN]
        norm = _norm_path(path)
        dotenv = bool(_DOTENV.search(norm)) and not _DOTENV_SAFE.search(norm)  # .env.example is committed: still scan it
        if text and not dotenv:
            test_file = bool(_TEST_PATH.search(norm))
            if _real_secrets(text):
                # Test fixtures legitimately carry fake keys: ask rather than block.
                hits.append(("GRD050", "ask") if test_file else "GRD050")
            elif not test_file and _named_secret(text, norm):
                hits.append(("GRD050", "ask"))
    return hits


def _real_secrets(text: str) -> bool:
    """Known-format secrets, ignoring dev-default connection strings (user:pass@localhost, @db)."""
    kinds = [m.kind for m in find_secrets(text)]
    if any(k != "url_credentials" for k in kinds):
        return True
    if not kinds:
        return False
    hosts = [h.lower() for h in _URL_CRED_HOST.findall(text)]
    return any(h not in _LOCAL_URL_HOSTS and "." in h for h in hosts)


def _named_secret(text: str, path: str = "") -> bool:
    """`password = "literal"` style assignments the format detectors cannot recognize."""
    text = text[:MAX_SCAN]
    pairs = _NAMED_ASSIGN.findall(text)
    if _CONFIG_FILE.search(path):
        pairs += _NAMED_ASSIGN_BARE.findall(text)
    return any(value_is_secret(k, v) and _looks_random(v) for k, v in pairs)


def _looks_random(v: str) -> bool:
    """Credentials mix character classes; `"current-password"` (an autocomplete hint) does not."""
    return bool(re.search(r"\d", v)) or (bool(re.search(r"[A-Z]", v)) and bool(re.search(r"[a-z]", v)))


def _string_leaves(value, depth: int = 0):
    if isinstance(value, str):
        yield value
    elif depth < 6 and isinstance(value, dict):
        for v in value.values():
            yield from _string_leaves(v, depth + 1)
    elif depth < 6 and isinstance(value, list):
        for v in value:
            yield from _string_leaves(v, depth + 1)


def _mcp_hits(tool: str, inp: dict) -> list[str]:
    hits = []
    # SQL rules only for tools that execute SQL; docs/chat tools legitimately mention "drop table".
    if _DB_TOOL.search(tool.removeprefix("mcp__")):
        for leaf in _string_leaves(inp):
            leaf = leaf[:MAX_SCAN]
            if _SQL_HARD.search(leaf):
                hits.append("GRD010")
            if _SQL_SOFT.search(leaf):
                hits.append("GRD011")
    if find_secrets(_text_of(inp)[: 4 * MAX_SCAN]):
        hits.append("GRD051")
    return hits


def _search_hits(tool: str, inp: dict) -> list[str]:
    hits = []
    # Grep's "pattern" is a content regex, not a path; Glob's "pattern" is a path glob.
    keys = ("path", "pattern") if tool == "glob" else ("path", "glob")
    for key in keys:
        v = inp.get(key)
        if not isinstance(v, str) or not v:
            continue
        n = _norm_path(v)
        if key == "path" and _CRED_DIR.search(n):
            hits.append("GRD040")
        r = _cred_rule(n)
        if r:
            hits.append(r)
        elif key != "path" and re.search(r"(^|/)\.env(\*|\.\*|$)", n):
            hits.append("GRD041")  # Grep glob ".env*" reads every env file
    return hits


def subject_of(tool: str, inp: dict) -> str:
    t = tool.lower()
    if t in SHELL_TOOLS:
        c = inp.get("command")
        return shlex.join(map(str, c)) if isinstance(c, list) else str(c or "")
    if t in FILE_PATH_TOOLS:
        return str(inp.get("file_path") or inp.get("path") or "")
    return _text_of(inp)


def evaluate(tool: str, inp: dict | None, policy: Policy | None = None) -> Decision:
    policy = policy or Policy()
    inp = inp if isinstance(inp, dict) else {}
    tool = tool if isinstance(tool, str) else ("" if tool is None else str(tool))
    t = tool.lower()
    subject = subject_of(tool, inp)[:MAX_SCAN]

    hits: list[str | tuple[str, str]] = []  # rule id, or (rule id, contextual default action)
    allowlisted = t in SHELL_TOOLS and any(rx.search(subject) for rx in policy.allow_commands)
    if not allowlisted:
        if t in SHELL_TOOLS:
            hits += _shell_hits(subject)
        elif t in FILE_PATH_TOOLS:
            hits += _file_hits(t, inp)
        elif t.startswith("mcp__"):
            hits += _mcp_hits(tool, inp)
        elif t in {"grep", "glob", "ls", "list_directory", "search_file_content"}:
            hits += _search_hits(t, inp)

    candidates: list[tuple[str, str, str]] = []  # (action, rule, reason)
    for hit in dict.fromkeys(hits):
        rule, contextual = hit if isinstance(hit, tuple) else (hit, None)
        default, desc = RULES[rule]
        action = policy.overrides.get(rule, contextual or default)
        if action in {"ask", "deny"}:
            candidates.append((action, rule, desc))
    for c in policy.custom:
        if c.tools and not any(fnmatch.fnmatch(tool, pat) for pat in c.tools):
            continue
        if c.pattern.search(subject) and c.action in {"ask", "deny"}:
            candidates.append((c.action, c.id, c.reason))
    if not candidates:
        return Decision()
    action, rule, reason = max(candidates, key=lambda c: ACTION_RANK[c[0]])
    if policy.mode == "monitor":
        return Decision("allow", rule, reason, would_be=action)
    return Decision(action, rule, reason)
