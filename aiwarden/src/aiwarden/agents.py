"""Per-agent tool vocabularies, mapped onto the guard policy's canonical tools.

The policy (policy.py) speaks Claude Code's tool names (Bash, Write, Edit, Read, Grep, Glob,
mcp__<server>__<tool>). Gemini CLI and Codex name and shape their tools differently, so a hook
call or a transcript entry is first translated into one or more canonical calls.

Gemini CLI file tools, per https://www.geminicli.com/docs/tools/file-system (fetched 2026-10-24):
list_directory {dir_path}, read_file {file_path}, write_file {file_path, content},
glob {pattern, path}, grep_search {pattern, path, include} (legacy alias search_file_content),
replace {file_path, old_string, new_string}. Not verified against a doc: run_shell_command
{command}, read_many_files {paths}, and older read_file {absolute_path}; all are accepted.
Hooks reference (https://geminicli.com/docs/hooks/reference/): BeforeTool input carries
tool_name, tool_input and, for MCP tools, `mcp_context`. The MCP tool-name format is not
documented, so we accept mcp__server__tool, server__tool and mcp_context.

Codex CLI (https://learn.chatgpt.com/docs/hooks, redirected from developers.openai.com/codex/hooks):
PreToolUse sees tool_name "Bash" with
tool_input.command for shell (including exec_command), "apply_patch" with the patch text in
tool_input.command, and MCP tools as mcp__<server>__<tool>. Transcripts name the shell tool
"shell"/"local_shell"/"exec_command" and carry apply_patch input as raw text.
"""
from __future__ import annotations

import re

from .policy import ACTION_RANK, Decision, Policy, evaluate

AGENTS = ("claude-code", "gemini-cli", "codex")

_PATCH_FILE = re.compile(r"^\*\*\* (Add|Update|Delete) File:\s*(.+?)\s*$", re.M)
_MOVE_TO = re.compile(r"^\*\*\* Move to:\s*(.+?)\s*$", re.M)


def _str(v) -> str:
    return v if isinstance(v, str) else ""


def parse_patch(text: str) -> list[tuple[str, str, str]]:
    """Codex apply_patch envelope -> [(op, path, added text)]. Unknown formats yield []."""
    out = []
    matches = list(_PATCH_FILE.finditer(text))
    for i, m in enumerate(matches):
        body = text[m.end(): matches[i + 1].start() if i + 1 < len(matches) else len(text)]
        added = "\n".join(line[1:] for line in body.splitlines() if line.startswith("+"))
        out.append((m.group(1).lower(), m.group(2), added))
        mv = _MOVE_TO.search(body)
        if mv:
            out.append(("add", mv.group(1), added))
    return out


def _patch_calls(text: str) -> list[tuple[str, dict]]:
    files = parse_patch(text)
    if not files:  # not a recognisable envelope: still scan it for secrets as a write
        return [("Write", {"file_path": "", "content": text})] if text else []
    return [("Write", {"file_path": path, "content": added}) for _, path, added in files]


def split_mcp(tool: str, inp: dict | None = None) -> tuple[str, str] | None:
    """(server, tool) for an MCP tool name in any of the agents' spellings."""
    ctx = (inp or {}).get("mcp_context") if isinstance(inp, dict) else None
    if isinstance(ctx, dict):
        server = ctx.get("server_name") or ctx.get("serverName") or ctx.get("server")
        if isinstance(server, str) and server:
            name = ctx.get("tool_name") or ctx.get("toolName") or tool
            return server, str(name).removeprefix(f"mcp__{server}__").removeprefix(f"{server}__")
    if tool.startswith("mcp__"):
        parts = tool.split("__")
        return (parts[1], "__".join(parts[2:])) if len(parts) >= 3 else (tool, "")
    return None


def canonical_calls(agent: str, tool: str, inp: dict | None) -> list[tuple[str, dict]]:
    inp = inp if isinstance(inp, dict) else {}
    if agent == "claude-code":
        return [(tool, inp)]
    t = tool.lower()
    if agent == "codex":
        if t in {"bash", "shell", "local_shell", "exec_command", "container.exec", "unified_exec"}:
            cmd = inp.get("command", inp.get("cmd"))
            return [("Bash", {"command": cmd})]
        if t == "apply_patch":
            return _patch_calls(_str(inp.get("command")) or _str(inp.get("input")) or _str(inp.get("patch")))
        return [(tool, inp)]
    if agent == "gemini-cli":
        mcp = split_mcp(tool, inp)
        if mcp:
            args = {k: v for k, v in inp.items() if k != "mcp_context"}
            return [(f"mcp__{mcp[0]}__{mcp[1]}", args)]
        path = _str(inp.get("file_path")) or _str(inp.get("absolute_path")) or _str(inp.get("path"))
        if t == "run_shell_command":
            return [("Bash", {"command": inp.get("command")})]
        if t == "write_file":
            return [("Write", {"file_path": path, "content": inp.get("content")})]
        if t == "replace":
            return [("Edit", {"file_path": path, "new_string": inp.get("new_string")})]
        if t == "read_file":
            return [("Read", {"file_path": path})]
        if t == "read_many_files":
            paths = [p for p in (inp.get("paths") or []) if isinstance(p, str)]
            return [("Read", {"file_path": p}) for p in paths] or [(tool, inp)]
        if t == "glob":
            return [("Glob", {"pattern": inp.get("pattern"), "path": inp.get("path")})]
        if t in {"search_file_content", "grep_search", "grep"}:
            return [("Grep", {"path": inp.get("path"), "glob": inp.get("include")})]
        if t in {"list_directory", "ls"}:
            return [("LS", {"path": inp.get("dir_path") or inp.get("path")})]
        if "__" in tool:  # server__tool, the MCP-qualified spelling without the mcp__ prefix
            server, _, rest = tool.partition("__")
            return [(f"mcp__{server}__{rest}", inp)]
        return [(tool, inp)]
    return [(tool, inp)]


def evaluate_agent(agent: str, tool: str, inp: dict | None, policy: Policy | None = None) -> Decision:
    """Evaluate every canonical call and keep the strictest decision."""
    policy = policy or Policy()
    best: Decision | None = None
    for name, args in canonical_calls(agent, tool, inp) or [(tool, inp or {})]:
        d = evaluate(name, args, policy)
        if not d.rule:
            continue
        if best is None or ACTION_RANK[d.would_be or d.action] > ACTION_RANK[best.would_be or best.action]:
            best = d
    return best or Decision()
