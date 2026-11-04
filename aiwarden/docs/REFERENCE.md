# aiwarden reference

Details moved out of the [README](../README.md): the guard rules, the browser extension, Gemini CLI and Codex
hooks, alert rules and the MCP security scan.

- [Guard rules](#guard-rules)
- [Browser extension](#browser-extension)
- [Gemini CLI and Codex](#gemini-cli-and-codex)
- [Alerts and the weekly report](#alerts-and-the-weekly-report)
- [MCP security scan](#mcp-security-scan)

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
warnings and blocks per detector and per browser profile. See [extension/README.md](../extension/README.md).

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
