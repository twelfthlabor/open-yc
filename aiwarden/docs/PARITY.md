# Parity with Traceforce (YC S26)

What Traceforce says its product does, from the founders' Launch HN post and their replies in the thread
(news.ycombinator.com/item?id=48937020, read 2026-11-01), and where aiwarden stands on each claim. The YC
company page gives only the tagline "CrowdStrike for AI agents". Traceforce's own console has not been seen,
so this compares capabilities, not screens.

Status: **yes** covered, **partial** covered with a stated difference, **no** not built.

| Traceforce claim | aiwarden | Status |
|---|---|---|
| Runs on each device as a binary plus a browser extension, not at a gateway | Python CLI (`aiwarden scan` / `push`) plus the MV3 extension in `extension/` | yes |
| Device uploads live data to the company profile within 30 minutes | `aiwarden push` to a self-hosted collector, on whatever schedule you set (cron / Task Scheduler). The console polls the collector every 30 s while open and marks the data stale if the collector stops answering | partial: push is scheduled, not streamed |
| Discovers which AI apps are used and how they connect to data sources through MCP | App, MCP, skill, plugin and extension discovery for Claude Code/Desktop, Cursor, Windsurf, VS Code, Cline, Roo, Gemini CLI, Codex, Zed and more | yes |
| Dashboard of all AI agents and apps across company devices | Overview, Devices, MCP servers and Browser pages | yes |
| Monitor agent activity in real time | Usage, sessions, MCP calls and guard decisions from transcripts and hook logs, refreshed as devices push | partial: near-real-time, per push |
| Metadata and telemetry only by default; content inspected locally; prompts not stored unless configured | Same model: metadata only, secrets reduced to redacted fingerprints, `--include-content` opt-in, extension inspects in the tab | yes |
| Detect, warn on or block high-risk or destructive actions before they run | PreToolUse / BeforeTool hooks for Claude Code, Gemini CLI and Codex; rules GRD001–GRD070 | yes |
| Warn and let the developer acknowledge, instead of only blocking | `ask` rules (Claude Code prompts the user; the browser extension's "Send anyway") | yes. Gemini CLI and Codex hooks cannot ask, so `ask` falls back to `ask_fallback` |
| Plaintext secrets in MCP configs | MCP001 | yes |
| API keys leaking into AI-generated code | GRD050 (secret written into a file), GRD051 (secret in a command or MCP call) | yes |
| Warn before `DROP TABLE` and similar | GRD010, GRD011 | yes |
| Client lists sent to chatbots | Browser DLP customer-list and bulk-email detectors | yes |
| Connectivity graph of apps, MCP servers and tools, to find attack paths | Per-device relationship map; the attack-path toggle traces user → device → app → risky item → what it reaches | yes |
| Controls and alerts on risks as they arise | `aiwarden alerts` (ALR001–ALR006) to stdout, JSON or a Slack-compatible webhook, run on a schedule (cron / Task Scheduler); Alerts page | partial: alerts fire when the scheduled run sees a new report |
| Automated remediation | Each finding in the console says why it matters, how to fix it, and the command to run. Nothing is changed on the device automatically | partial: guided, not automatic |
| Natural-language questions over the fleet | `aiwarden ask` and the Ask page; optional Claude translation of free-form questions | yes |
| Agentic reports | `aiwarden report weekly` and the Weekly report page: a fixed, deterministic report, not one written by an agent | partial |
| Covers laptops, sandboxes and VMs | Anything that runs Python and has the agents' config files; `--home` scans a mounted image | yes |
| mcp-xray: dynamic MCP pentesting (code execution, SSRF, path traversal, auth bypass, injection, DoS), checked by a second agent | `aiwarden mcp-scan`: known-risky packages plus static tool-poisoning checks over `tools/list`. It never calls a tool | no: static only, by design |
| Hosted, continuously tested MCP registry | Not built | no |
| Kong gateway integration for remote MCP | Not built | no |
| MITRE ATT&CK mapping (asked about in the thread) | Not built | no |

## Not copied

No Traceforce code, copy, branding or screens are used. The console's look is aiwarden's own.
