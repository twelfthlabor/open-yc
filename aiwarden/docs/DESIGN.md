# aiwarden — design

An open-source, endpoint-side monitor for AI apps and agents. It is an open
alternative to the commercial "CrowdStrike for AI agents" category (e.g.
Traceforce, YC S26). Not affiliated with any company.

## What the category does (research summary)

From Traceforce's public launch material (YC page, Launch HN):

- Runs on each device (Go binary + browser extension), not at a gateway.
- Inventories AI apps, MCP servers and skills per device; founders say the
  hard part was "understanding the configurations and logs of each and every app".
- Builds a graph: user -> app -> MCP server -> tool, plus models and tokens.
- Token usage per user/team/app; which sessions called which MCP.
- Metadata-only by default; content inspection happens locally; prompts not stored.
- Warns on / blocks high-risk tool calls before execution (DROP TABLE,
  API keys leaking into generated code, client lists sent to chatbots).
- Finds plaintext secrets in MCP configs.
- Fleet dashboard, natural-language queries, agentic reports.

Existing OSS (SafeDep vet, mcp-audit, tanav, mcphound) covers config scanning
only. Nobody covers discovery + activity + prevention + fleet in one tool.

## Constraints

- Must run without admin rights (no kernel drivers, ETW, eBPF, TLS MITM).
  That matches Traceforce's own approach: read app configs and logs, and use
  the agents' own hook points for prevention.
- Privacy: metadata-only by default. Secret values are never stored or
  printed; only the detector type plus a short redacted fingerprint.
  Prompt/command text is not kept unless `--include-content` is set.
- Cross-platform: Windows, macOS, Linux. Every path is resolved from an
  `Env` object so tests run against a synthetic home directory.
- Small dependency footprint: stdlib only (tomllib, sqlite3, http.server).
  `psutil` is optional for process discovery.

## Scope (v0.1)

1. **Discovery** (`aiwarden scan`)
   - AI apps: installed (known install paths/config dirs) and running (processes).
   - MCP servers from: Claude Code (`~/.claude.json` user + per-project,
     project `.mcp.json`), Claude Desktop, Cursor, Windsurf, VS Code
     (`mcp.json` "servers", `settings.json` "mcp.servers"), Cline,
     Gemini CLI, Codex CLI (`config.toml` `[mcp_servers.*]`), Zed (`context_servers`).
   - Claude Code skills, plugins, and installed hooks.
   - Browser extensions (Chrome/Edge/Brave) whose manifest matches AI keywords.
2. **Risk findings**
   - Plaintext secrets in MCP env/args/headers/url.
   - Remote MCP over plain http (non-localhost).
   - Unpinned package runners (`npx -y pkg`, `uvx pkg` without version).
   - MCP servers given broad filesystem roots (`/`, `C:\`, home).
   - Shell-exec style MCP servers.
   - Agent permission configs that allow everything (e.g. `Bash(*)`, bypass mode).
3. **Activity** (`aiwarden usage`)
   - Claude Code transcripts (`~/.claude/projects/*/*.jsonl`): tokens per
     model/project/day (deduped by message id), tool-call counts, MCP calls
     per server, risky commands seen (rule id only by default).
   - Codex CLI sessions (`~/.codex/sessions/**/*.jsonl`): token_count events
     and function calls.
4. **Prevention** (`aiwarden guard`, `aiwarden hooks install`)
   - A Claude Code `PreToolUse` hook. Reads the hook JSON on stdin, evaluates
     the policy, and denies (exit 2 + JSON `permissionDecision: deny`) or
     asks (`permissionDecision: ask`).
   - Built-in rules: destructive rm, SQL DROP/TRUNCATE, force-push to main,
     curl|sh, reading credential files, secrets written into files or commands.
   - The policy can be overridden in `~/.aiwarden/policy.toml`.
   - Decisions are logged to `~/.aiwarden/events.jsonl` (metadata only).
5. **Graph + report**: one JSON report per device: device, apps, MCP servers,
   extensions, skills, usage, findings, and a node/edge graph.
6. **Fleet** (`aiwarden serve`, `aiwarden push`)
   - The collector takes `POST /api/reports` (bearer token), stores reports in
     SQLite, and serves a dashboard (`/`) and `/api/fleet`.
   - `push` sends the local report to a collector.

Added after v0.1:
- Guard hooks for Gemini CLI (BeforeTool) and Codex (PreToolUse). Their tool names are mapped
  onto the policy in `agents.py`.
- Neither Gemini CLI nor Codex hooks can ask the user, so an "ask" falls back to
  `ask_fallback`.
- Teams and cost estimates.
- `ask`: a deterministic query engine with an optional LLM translator that sees only the
  schema.
- Stateful `alerts`, and `report weekly`.
- `mcp-scan`: static tool-poisoning checks and an MCP client that sends only initialize and
  tools/list.

## Layout

```
src/aiwarden/
  env.py         platform paths
  secrets.py     secret detectors + redaction
  mcp.py         MCP config parsers -> MCPServer
  apps.py        app + process + extension + skills discovery
  risk.py        findings over inventory
  usage.py       transcript parsers -> usage summary
  policy.py      guard rules
  guard.py       hook entrypoint
  hooks.py       install/uninstall hook in settings.json
  report.py      build report + graph
  server.py      collector + dashboard
  agents.py      per-agent tool vocabularies -> canonical policy calls
  config.py      ~/.aiwarden/config.toml: team mapping, price overrides, alert settings
  pricing.py     dated per-model price table, cost estimates
  fleetdata.py   load reports (local / files / collector), flatten to records
  query.py       structured queries, intent parser, optional LLM translation
  alerts.py      stateful alert rules + Slack-compatible webhook
  weekly.py      weekly usage + risk report (md / html / json)
  mcpscan.py     MCP tool-poisoning analysis + initialize/tools/list-only client
  cli.py         argparse entrypoint
tests/           pytest, synthetic HOME fixtures
```
