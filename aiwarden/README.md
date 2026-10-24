# aiwarden

Open-source endpoint visibility and guardrails for AI apps, coding agents and MCP servers.

AI tools now run on every developer laptop: Claude Code, Cursor, Codex, Gemini CLI, VS Code
extensions, browser extensions and local models. Each one wires itself to MCP servers, tokens
and data. Network gateways and EDRs don't see that layer. aiwarden runs on the endpoint, reads
what each app has configured and done, and can stop a risky agent action before it executes.

It is an open alternative to the commercial "CrowdStrike for AI agents" category. It is not
affiliated with any vendor in that category.

```
git clone <this repo> && cd aiwarden
pip install .                   # not on PyPI yet; add [proc] for psutil-based process discovery
aiwarden scan                   # inventory + posture findings + usage on this machine
aiwarden hooks install --agent all   # block destructive agent actions in Claude Code, Gemini CLI and Codex
aiwarden serve --local          # dashboard at http://127.0.0.1:8765
```

## What it does

| | |
|---|---|
| **Discover** | AI apps installed or running (Claude Code/Desktop, Cursor, Windsurf, VS Code + Copilot/Cline/Roo/Continue, Codex, Gemini CLI, Zed, Antigravity, opencode, Ollama, LM Studio, ...). AI browser extensions in Chrome, Edge and Brave. Claude Code skills, plugins, hooks and permission mode. |
| **Map MCP** | Every MCP server configured in Claude Code (user, local, project `.mcp.json`), Claude Desktop, Cursor, Windsurf, VS Code (`mcp.json`, `settings.json`), Cline, Roo Code, Gemini CLI, Codex (`config.toml`) and Zed. Transport, package, remote host and env var names. |
| **Find risk** | Plaintext tokens in MCP configs, remote MCP over plain HTTP, unpinned `npx`/`uvx` packages, MCP servers given `/` or `C:\`, shell-exec servers, agents set to bypass approvals, AI extensions with access to every site. |
| **Measure use** | Tokens and estimated $ cost per agent, model, project, day, user and team, tool calls, and MCP calls per server, from Claude Code, Codex and Gemini CLI transcripts. It also replays past tool calls through the guard rules to show what *would* have been blocked. |
| **Ask** | `aiwarden ask "which teams' token usage doubled this month?"`: a deterministic query engine over one report or a whole collector, with an optional Claude translator for free-form questions. |
| **Alert and report** | `aiwarden alerts` (spend spikes, new MCP servers, new plaintext secrets, guard-block bursts, newly installed AI apps) to stdout, JSON or a Slack-compatible webhook. `aiwarden report weekly` writes Markdown or HTML. |
| **Scan MCP** | `aiwarden mcp-scan` flags known-risky MCP packages. When you let it connect, it also checks tool definitions for tool poisoning: hidden instructions, pointers at credential files, exfiltration URLs, invisible Unicode, cross-tool shadowing and broad capabilities. |
| **Prevent** | Pre-tool hooks for Claude Code (`PreToolUse`), Gemini CLI (`BeforeTool`) and Codex (`PreToolUse`) that block (Claude Code can also ask) before an agent runs `rm -rf ~`, `DROP DATABASE`, `git push --force origin main` or `curl … \| sh`, reads `~/.ssh/id_*`, or writes an API key into source. |
| **Browser DLP** | A Chrome/Edge extension (`extension/`) warns or blocks before secrets, card numbers, SSNs/SINs, bulk emails or customer lists are typed, pasted, dropped or uploaded into ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek and other AI chat sites, and records which AI sites are used and for how long. |
| **Graph** | One graph per device connects user, device, apps, MCP servers, packages, remote hosts, models, skills and extensions, with findings attached to the nodes they concern. |
| **Fleet** | `aiwarden push` sends the report to a self-hosted collector (`aiwarden serve`). The dashboard shows devices, findings, MCP packages across the fleet, token usage and guard decisions. |

## Privacy model

- Metadata only by default. Prompts, responses and command text are not stored or sent.
- Secret values are never stored. Findings carry the credential type and a short redacted
  prefix (`ghp_QQ…(40 chars)`).
- `--include-content` keeps the command or path behind each risky event, with secrets
  scrubbed. Use it locally when investigating.
- Everything runs locally. Data leaves the machine only when you run `aiwarden push` to a
  collector you host.

## Guard rules

`aiwarden rules` lists them. Default actions:

| Rule | Default | Catches |
|---|---|---|
| GRD001 | deny | recursive delete of `/`, `~`, `$HOME`, `*`, `.`, drive roots, system dirs (also through `sudo`, `bash -c`, `find -delete`, PowerShell `Remove-Item -Recurse`, `rd /s`) |
| GRD002 | deny | `dd of=/dev/sdX`, `mkfs`, `format C:`, `diskpart`, `diskutil eraseDisk`, `shred /dev/…` |
| GRD003 | ask | `rm -rf "$VAR/"` or `$VAR/*` where the path is only a variable (if it is unset, this deletes `/`) |
| GRD010 | deny | `DROP DATABASE`/`DROP SCHEMA` via a DB client or a database MCP tool |
| GRD011 | ask | `DROP TABLE`, `TRUNCATE`, `DELETE` without `WHERE`, `prisma migrate reset`, `rails db:drop`, `manage.py flush` |
| GRD020 | deny | force-push to, or deletion of, `main`/`master`/`prod`/`trunk` |
| GRD021 | ask | force or `--mirror` push with no explicit branch, or `--force-with-lease` onto a protected branch |
| GRD030 | deny | download run as code: `curl … \| sh`, `\| python -`, `iwr … \| iex`, `source <(curl …)`, `eval "$(curl …)"` |
| GRD040 | deny | reading SSH keys, cloud credentials, `.git-credentials`, `.netrc`, kube config, agent auth files (Read, Grep/Glob into `~/.ssh` / `~/.aws`, `cat`), but not `ssh -i` or `kubectl --kubeconfig` using them |
| GRD041 | ask | reading `.env` files (not `.env.example`, and not `ls`/`git check-ignore`) |
| GRD050 | deny | writing a recognized secret into a file. It asks instead for test fixtures and for `password = "…"`-style literals. `.env` files are allowed, and so are dev connection strings like `user:pass@localhost` |
| GRD051 | ask | a secret inside a shell command or MCP tool call |
| GRD060 | ask | uploading a local file to a non-local host (`curl -d @file`, `scp`, `rsync`) |
| GRD070 | ask | the agent editing its own permission or guard config |

Tune them in `~/.aiwarden/policy.toml` (`aiwarden policy init` writes a template). You can
override any rule, add regex rules, allowlist commands, or set `mode = "monitor"` to log
without blocking while you roll out.

Try a rule without running an agent:

```
aiwarden check Bash "git push --force origin main"
{"action": "deny", "rule": "GRD020", "reason": "Force-push to a protected branch", "would_be": null}
```

The guard is a guardrail, not a sandbox. It uses static analysis of the tool input to catch
the expensive mistakes agents actually make. Someone deliberately obfuscating a command can
get past it, so pair it with OS-level sandboxing when the threat is adversarial. If the guard
itself errors, it lets the call through, so a bug in aiwarden never stops your agent. Each
call is analysed in about a millisecond, and the worst case seen on a 100 KB input is about
300 ms. Python startup brings a full hook call to roughly 150 ms on Windows. Only the first
64 KB of a shell command is analysed, so a command padded past that cap is not inspected in
full.

When several PreToolUse hooks are installed, Claude Code shows the model the message from
whichever one blocks. aiwarden still blocks and logs the call, but its reason may not be the
one the model sees.

## Browser extension

`extension/` is a Manifest V3 extension for Chrome and Edge, written in plain JavaScript with no
build step. Load it with **Load unpacked** at `chrome://extensions`. On the major AI chat sites it
inspects the message before it is sent (on Enter, the send button or form submit), and also checks
pastes, drops and file uploads. It looks for:

- API keys and tokens (the same patterns as the endpoint scanner) and private keys
- credit card numbers (Luhn-checked), US SSNs, and Canadian SINs (checksum-validated)
- 5 or more email addresses
- customer-list-shaped tables: 10 or more rows with name, email, phone or company columns

Each detector can be set to allow, warn (a dialog with *Send anyway*) or block. By default secrets
are blocked and personal data gets a warning. Inspection happens in the tab. Events hold metadata
only: site, detector kinds and counts, action, decision and time. They are kept in the browser and,
if a collector is configured, posted to `POST /api/browser-events`. The collector rejects anything
that looks like raw content. The dashboard's **Browser** tab shows AI sites used, time on site, and
warnings and blocks per detector and per browser profile. See [extension/README.md](extension/README.md).

## Gemini CLI and Codex

```
aiwarden hooks install --agent gemini-cli   # ~/.gemini/settings.json  hooks.BeforeTool
aiwarden hooks install --agent codex        # ~/.codex/hooks.json      hooks.PreToolUse
aiwarden hooks install --agent all
aiwarden hooks status
aiwarden check run_shell_command "rm -rf ~" --agent gemini-cli
```

Every agent gets the same rules. aiwarden first maps each agent's tool names onto the
policy's own names (`src/aiwarden/agents.py`):
- Gemini CLI: `run_shell_command`, `write_file`, `replace`, `read_file`, `read_many_files`,
  `glob`, `search_file_content` and MCP tools.
- Codex: `Bash` and `apply_patch`. The patch is parsed, and each file it adds or changes is
  checked as a `Write`.

What differs between agents is how a hook can answer:

| Agent | Block | Ask the user | Notes |
|---|---|---|---|
| Claude Code | exit 2 + stderr | `permissionDecision: "ask"` | |
| Gemini CLI | exit 0 + `{"decision": "deny", "reason": …}` | not supported | Hooks are on by default from v0.26.0 ([hooks reference](https://geminicli.com/docs/hooks/reference/)). Timeout is in milliseconds. |
| Codex | exit 0 + `hookSpecificOutput.permissionDecision: "deny"` JSON on stdout (Codex on Windows runs hooks through `powershell -Command`, which rewrites exit 2 to 1, and 1 fails open; verified live with Codex 0.155) | not supported (Codex runs the tool anyway if a hook returns `ask`) | Hooks must be trusted with `/hooks`, again after any change ([Codex hooks](https://learn.chatgpt.com/docs/hooks)). |

For Gemini CLI and Codex, a rule whose action is `ask` falls back to `ask_fallback` in
`policy.toml`. The default is `"deny"`, and the reason tells the model to ask the user. Set it
to `"allow"` to let those calls through.

aiwarden writes Codex hooks to `~/.codex/hooks.json` and never rewrites `config.toml`. If
`config.toml` already has an inline `[hooks]` entry for aiwarden, that counts as installed.

`aiwarden usage` also reads Gemini CLI chats in `~/.gemini/tmp/<project>/chats/`, both the
older `session-*.json` files and the newer `.jsonl` ones. Gemini's `input` count includes
cached tokens, and its thinking tokens are counted as output.

## Teams

Map users and devices to teams in `~/.aiwarden/config.toml` on each device. Alternatively,
keep one mapping file and pass it to the analysis commands with `--teams FILE`:

```toml
team = "platform"                 # this device's team, written into the report's device block

[teams]                           # first match wins: device:<id>, host:<hostname>, or a user name
platform = ["alice", "host:build-01"]
data = ["bob", "device:3f2a9c51d0e4b7a2"]
```

`ask`, `alerts` and `report weekly` work out each report's team in this order:
1. the `[teams]` mapping file
2. the report's own `device.team`
3. `team` in the config

This lets you slice usage, cost and findings by team, user or app.

## Cost

aiwarden prices token counts from a table in `src/aiwarden/pricing.py`. The table is dated
(`PRICES_AS_OF`) and must be updated by hand when list prices change.
- Prices for current Anthropic models come from Anthropic's model table, as cached on
  2026-10-06.
- Prices for older Claude models (Sonnet 4.5, Opus 4.1 and others), OpenAI and Google were
  not checked against the providers' pricing pages. They are marked unverified, and
  `aiwarden usage` says so.
- A model with no price is listed as unpriced. Its cost is not guessed.

Override or add prices in `config.toml`:

```toml
[prices."claude-sonnet-4-5"]
input = 3.0          # USD per million tokens
output = 15.0
cache_read = 0.30    # default 0.1 x input
cache_write = 3.75   # default 1.25 x input
```

The estimate is what the usage would cost at API list prices. It ignores subscriptions
(Claude Max, ChatGPT plans), batch discounts and long-context surcharges. Reports carry
`cost_usd` per model, app, day and session, plus a total in `summary.cost_usd`.

## Asking questions

```
aiwarden ask "which teams' token usage doubled this month?" --server https://aiwarden.internal:8765 --token T
aiwarden ask "which Claude Code sessions called the github MCP?"          # this device
aiwarden ask "top 5 users by cost in the last 30 days" --report fleet.json
aiwarden ask --query '{"entity": "usage", "metric": "cost_usd", "group_by": ["team", "app"], "window": {"preset": "last_month"}}'
```

A small parser recognises a fixed set of question patterns (`aiwarden ask --help` lists
them). It turns each question into a structured query with an entity, metric, filters,
group_by, time window and comparison, and the engine runs that query over the reports.
Supported entities are usage, sessions, MCP calls, findings, apps, MCP servers, guard events
and risky events. With `--server`, aiwarden reads `/api/fleet` and then `/api/devices/<id>` for
each device.

If `ANTHROPIC_API_KEY` is set and the parser doesn't recognise a question, aiwarden sends it
to Claude (`claude-sonnet-5-5`, over the Messages API) with today's date and the query schema.
Claude returns a structured query, which aiwarden validates and runs locally. No report
content is sent: no hostnames, users, MCP names or numbers. `--llm` tries Claude first, and
`--no-llm` never calls it.

Limits:
- Each report keeps only the latest 200 sessions, so session questions over long periods can
  undercount. Daily token and cost series are complete.
- Inventory entities (apps, findings, MCP servers) come from the latest report per device and
  ignore time windows.

## Alerts and the weekly report

```
aiwarden alerts --server URL --token T --webhook https://hooks.slack.com/services/…
aiwarden report weekly --server URL --token T --format html --out weekly.html
```

| Rule | Fires when |
|---|---|
| ALR001 | Tokens for a user, team or app grow by `token_spike_pct` day-over-day or week-over-week, and exceed `spike_min_tokens`. |
| ALR002 | The same, for estimated cost (`cost_spike_pct`, `spike_min_cost_usd`). |
| ALR003 | A new MCP server is configured on a device. |
| ALR004 | A new plaintext secret appears in an MCP config (only a redacted fingerprint is reported). |
| ALR005 | Guard blocks on a device reach `guard_blocks_threshold` within `guard_blocks_window_days`. |
| ALR006 | An AI app is newly installed on a device. |

Thresholds and the webhook go under `[alerts]` in `config.toml`. Alerts already raised are
stored in `~/.aiwarden/alerts_state.json`, so each alert fires once: a day spike once per day,
a week spike once per ISO week.

The first run, and the first report from a new device, record a baseline instead of raising
ALR003, ALR004 or ALR006. `--alert-existing` raises them anyway. `--dry-run` prints alerts
without posting them or saving state. The webhook body is Slack incoming-webhook JSON
(`text` + `blocks`).

To run both on a schedule:

```
# cron (Linux/macOS)
*/30 * * * *  AIWARDEN_TOKEN=T aiwarden alerts --server https://aiwarden.internal:8765
0 8 * * MON   AIWARDEN_TOKEN=T aiwarden report weekly --server https://aiwarden.internal:8765 --format html --out /srv/reports/weekly.html

# Windows Task Scheduler
schtasks /create /sc minute /mo 30 /tn aiwarden-alerts /tr "aiwarden alerts --server https://aiwarden.internal:8765 --token T"
schtasks /create /sc weekly /d MON /st 08:00 /tn aiwarden-weekly /tr "aiwarden report weekly --server https://aiwarden.internal:8765 --token T --out C:\reports\weekly.md"
```

## MCP security scan

```
aiwarden mcp-scan                                   # configs only: known-risky packages; starts nothing
aiwarden mcp-scan --connect --name github --name docs
aiwarden mcp-scan --connect --all --yes             # every enabled server
aiwarden mcp-scan --tools-file tools.json           # a saved tools/list response
```

With `--connect`, aiwarden starts each named stdio server using the command, args and env
from its config, and calls remote servers over Streamable HTTP.
- It sends only `initialize`, `notifications/initialized` and `tools/list`. The client refuses
  any other method, so no tool is ever called.
- Each server has a timeout (`--timeout`, default 15 s). The whole process tree is killed
  afterwards.
- Launch values are re-read from the config into memory and never printed.

| Rule | Looks for |
|---|---|
| MCPX001 | Hidden instructions: `<IMPORTANT>`, "ignore previous instructions", "do not tell the user", "before using this tool". |
| MCPX002 | Descriptions that point the agent at `~/.ssh`, `.env`, `mcp.json`, credentials or keys. |
| MCPX003 | URLs in tool or parameter descriptions. High severity for webhook, ngrok and pastebin-style hosts. |
| MCPX004 | Zero-width, bidi-override and Unicode tag characters, and non-ASCII letters in tool names. |
| MCPX005 | Shadowing: "when the X tool is used…", "always BCC…", or naming another server's tool. |
| MCPX006 | A tool that can execute commands. |
| MCPX008 | One server that combines command execution, network egress and sensitive reads. |
| MCPX007 | Very long descriptions. |
| MCPX010 | Known-risky packages (`postmark-mcp`, `mcp-remote` < 0.1.16, `@modelcontextprotocol/inspector` < 0.14.1), each with its advisory link. |

Parameter descriptions inside `inputSchema` are checked too. These checks are heuristics
over text the server controls, so a clean result means only that no pattern matched, not
that the server is safe. Starting a stdio server runs its code: connect only to servers you
would run anyway. The legacy HTTP+SSE transport is not supported.

## Fleet mode

```
# collector (put it behind TLS if it leaves localhost)
AIWARDEN_TOKEN=change-me aiwarden serve --host 0.0.0.0 --port 8765

# each device, e.g. from cron / Task Scheduler
AIWARDEN_TOKEN=change-me aiwarden push --server https://aiwarden.internal:8765 --days 30
```

The collector is stdlib Python with SQLite. It keeps the last 20 reports per device. Every
API route needs the bearer token. The dashboard escapes every value it renders, because
report contents come from endpoints.

## Commands

```
aiwarden scan [--json] [--out FILE] [--days N] [--fail-on high]   # CI-friendly exit code
aiwarden mcp [--json]
aiwarden usage [--days N] [--json] [--include-content]
aiwarden graph [--out graph.json]
aiwarden hooks install|uninstall|status [--agent claude-code|gemini-cli|codex|all] [--project DIR | --settings PATH]
aiwarden guard [--agent claude-code|gemini-cli|codex]                # the hook entrypoint (stdin JSON)
aiwarden policy init | aiwarden rules | aiwarden check TOOL "COMMAND" [--agent A]
aiwarden mcp-scan [--connect --name N | --connect --all --yes] [--tools-file F] [--json]
aiwarden ask "QUESTION" | --query JSON  [--server URL --token T | --report FILE] [--teams FILE] [--as-of DATE]
aiwarden alerts [--webhook URL] [--dry-run] [--json]  [same source options]
aiwarden report weekly [--format md|html|json] [--out FILE]  [same source options]
aiwarden serve [--local] [--host H] [--port P] [--token T]
aiwarden push --server URL [--token T]
```

`--home DIR --platform windows|darwin|linux` scans another home directory, such as a mounted
image or a test fixture.

## Development

```
pip install -e ".[dev]"
pytest
```

The tests build a synthetic home directory with the config and transcript layouts of each
supported tool (`tests/conftest.py`). No real user data is read.

Known limits for v0.1:
- Gemini CLI and Codex hooks cannot ask the user, so `ask` rules block (or allow, depending on
  `ask_fallback`).
- Codex hooks run only after you trust them with `/hooks`. Codex calls its hooks "a useful
  guardrail, not a complete enforcement boundary", and some of its tool paths skip hooks.
- Gemini's docs say some users were moved from Gemini CLI to Antigravity CLI on 2026-06-18.
  aiwarden does not hook Antigravity.
- Gemini doesn't document how MCP tools are named in hooks. aiwarden accepts
  `mcp__server__tool`, `server__tool` and `mcp_context`.
- The Gemini transcript schema comes from third-party documentation. It was tested only on
  synthetic files, never on files a real Gemini CLI wrote.
- The OpenAI and Google prices are unverified.
- The `ask` parser understands only the listed question patterns. Anything else needs
  `--query` or `ANTHROPIC_API_KEY`.
- Browser extension discovery covers Chromium browsers only.
- Shell
analysis does not tell heredoc bodies apart from commands, so a heredoc that writes SQL or
key-like text into a file can trigger an ask or deny.

## License

MIT
