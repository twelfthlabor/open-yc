"""Pre-tool-use hook for Claude Code, Gemini CLI and Codex: allow, ask or deny the pending call.

Protocols:
- Claude Code PreToolUse (https://code.claude.com/docs/en/hooks): JSON on stdin; exit 2 blocks
  and stderr goes to the model; exit 0 + hookSpecificOutput.permissionDecision="ask" asks the user.
- Gemini CLI BeforeTool (https://geminicli.com/docs/hooks/reference/): JSON on stdin with
  tool_name / tool_input / mcp_context; exit 0 with stdout holding only {"decision": "deny",
  "reason": ...} blocks and the reason is sent to the agent as a tool error. There is no
  documented "ask" decision.
- Codex PreToolUse (https://learn.chatgpt.com/docs/hooks): same stdin fields as Claude
  Code; exit 2 + stderr blocks. permissionDecision "ask" is unsupported and Codex then runs
  the tool anyway (fails open), so an "ask" must not be emitted.

For Gemini CLI and Codex an "ask" becomes policy.ask_fallback ("deny" by default).
On allow nothing is printed, so the agent's own confirmation prompts still apply.
Internal errors fail open (exit 0) so a guard bug never bricks the agent.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

from .agents import AGENTS, evaluate_agent
from .env import Env
from .policy import Policy

_NO_ASK = {"gemini-cli", "codex"}


def _log(env: Env, record: dict) -> None:
    try:
        env.state_dir.mkdir(parents=True, exist_ok=True)
        with (env.state_dir / "events.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except OSError:
        pass


def _deny(agent: str, tool: str, rule: str, reason: str) -> tuple[int, str, str]:
    msg = (f"aiwarden blocked this {tool} call [{rule}]: {reason}. "
           "Do not retry it in another form; explain to the user what you wanted to do and let them decide.")
    if agent == "gemini-cli":
        return 0, json.dumps({"decision": "deny", "reason": msg, "systemMessage": f"aiwarden blocked {tool} [{rule}]"}), ""
    if agent == "codex":
        # Codex on Windows runs hooks via `powershell -Command`, which turns exit 2 into 1 (= hook failed,
        # tool still runs). A JSON decision on stdout with exit 0 survives any shell wrapper.
        return 0, json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                                     "permissionDecisionReason": msg}}), ""
    return 2, "", msg


def run_hook(stdin_text: str, env: Env | None = None, agent: str = "claude-code") -> tuple[int, str, str]:
    env = env or Env.current()
    agent = agent if agent in AGENTS else "claude-code"
    try:
        data = json.loads(stdin_text)
        tool = str(data["tool_name"])
        inp = data.get("tool_input") if isinstance(data.get("tool_input"), dict) else {}
    except (ValueError, KeyError, TypeError):
        return 0, "", ""
    if agent == "gemini-cli" and isinstance(data.get("mcp_context"), dict):
        inp = {**inp, "mcp_context": data["mcp_context"]}
    try:
        policy = Policy.load(env.state_dir / "policy.toml")
    except Exception:  # a broken policy file must not disable the built-in rules
        policy = Policy()
    try:
        d = evaluate_agent(agent, tool, inp, policy)
    except Exception:
        return 0, "", ""
    action = d.action
    if action == "ask" and agent in _NO_ASK:
        action = policy.ask_fallback
    if d.rule:
        _log(env, {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "app": agent,
                   "session": data.get("session_id"), "cwd": data.get("cwd"), "tool": tool,
                   "action": action, "rule": d.rule, "would_be": d.would_be})
    if action == "deny":
        reason = d.reason
        if d.action == "ask":
            reason += f" (this needs human approval and {agent} hooks cannot ask; ask the user to run it themselves)"
        return _deny(agent, tool, d.rule or "", reason)
    if action == "ask":
        return 0, json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse", "permissionDecision": "ask",
            "permissionDecisionReason": f"aiwarden [{d.rule}]: {d.reason}"}}), ""
    return 0, "", ""


def main(env: Env | None = None, agent: str = "claude-code") -> int:
    raw = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    code, out, err = run_hook(raw, env, agent)
    if out:
        sys.stdout.write(out)
    if err:
        sys.stderr.write(err)
    return code
