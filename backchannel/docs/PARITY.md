# Parity with Agent FM

Retrieved 2026-10-28. Sources are listed in `RESEARCH.md` (S1 is the YC launch post, S3 and S4 the earlier open-source app). Capabilities are paraphrased. Status values: **done**, **partial**, **not done**. Each status says how it was verified: unit tests (`npm test`), the live run with real agents (`npm run verify:live`, results in `VERIFICATION.md`), or the browser check of the demo build (`npm run e2e`).

| # | Agent FM capability (paraphrased) | Source | Status | How it works here, and how it was verified |
|---|---|---|---|---|
| 1 | One group chat for all your coding agents | S1 | **done** | The *Everyone* channel plus one station per session (`web/src/app/App.tsx`). Live run: four real sessions on the channel and nothing else; every post reached the open browser over the live stream. |
| 2 | Agents post progress, blockers, assumptions and decisions | S1 | **done** | `src/core/posts.ts`: progress digests every 20 s, decision and assumption lines (tagged or recognised), blockers from permission prompts, questions, agents stuck after three failed calls in a row, and lines starting "Blocked:". The SessionStart hook asks agents to tag those lines. Live run: a decision from agent B, an urgent blocker from agent D (missing `.env`), and a failing test run from agent A. Unit tests cover each rule. |
| 3 | Live text updates | S1 | **done** | Server-sent events (`/api/stream`). Live run: all 23 posts arrived in the open console while the agents worked. |
| 4 | Live audio updates | S1, S3 | **done** | Browser speech (`web/src/speech.ts`) with a voice and pitch per agent. Blockers and errors jump the queue, interrupt with a chime, and stale progress is dropped (`src/core/narrate.ts`). Queue rules are unit-tested. Speech output itself was not checked automatically: headless Chrome has no voices. |
| 5 | Reply from the chat to steer an agent | S1 | **done for Claude Code; wired but not live-verified for Codex** | The hook (`hook/backchannel-hook.mjs`) hands queued replies to the agent through the `Stop` hook. The agent keeps working with your message as its next instruction, and the chat shows a delivery receipt. Live runs with Claude Haiku: 6 of 6 replies delivered at Stop were acted on (one spike, plus five `verify:live` runs). Mid-run delivery through `PostToolUse` context was acted on in 4 of 5 runs where the session had the SessionStart introduction; once, Haiku declined it as "an instruction in a tool result". Without the introduction, it was declined in the one spike run that tried it. So mid-run delivery is opt-in (`serve --mid-run`). Codex uses the same hook output shapes (S7), and the hook tests cover the Codex call. Codex runs a project hook only after you trust it with `/hooks`, which the automated run cannot do, so no Codex reply was sent live. |
| 6 | Token spend across providers | S1 | **done** | `src/core/usage.ts`, the *Spend* view and `backchannel usage`. Live run: each Claude Code session's cost equals Claude Code's own `total_cost_usd` to six decimals. Codex token counts equal `codex exec --json` exactly. Models without a price (for example `gpt-5.6-terra`) show as unpriced, not $0. |
| 7 | Cost breakdowns | S1 | **done** | By provider, model, session and day. |
| 8 | Token usage for skills and MCP servers | S1 | **partial** | Estimated: the characters of each MCP or skill call's input and result divided by four, with call counts, and labelled as an estimate. Transcripts don't attribute billed tokens to tools, so an exact figure isn't available. |
| 9 | Voice-to-text for prompting | S1 | **partial** | Dictation in the reply box, through the browser's speech recognition (Chrome sends that audio to Google). Not system-wide: a browser tab can't own a global hotkey. |
| 10 | Claude Code, Codex, OpenCode and more | S1 | **partial** | Claude Code and Codex. OpenCode isn't supported. |
| 11 | Local and remote workspaces | S1 | **not done** | Local only: the server reads transcripts on the same machine. |
| 12 | Desktop app | S1–S4 | **partial, by design** | A local server plus a browser tab, on Windows, macOS and Linux (CI runs all three). No installer, menu bar or tray icon. |
| 13 | Stations, and a mix across all agents | S3, S4 | **done** | Stations and the Everyone channel. When tuned to one station you hear everything from that agent and only urgent posts from the others. |
| 14 | Blocker alerts | S3, S4 | **done** | Urgent posts, an amber row, a "Needs you" count in the tab, and a spoken "Heads up" with a chime. *Only when someone needs me* mode speaks blockers and errors only. |
| 15 | LLM-written narration with your own Gemini or OpenAI key | S3, S4 | **not done, by design** | Posts are rule-based and need no key or network. Summaries are the agent's own sentences, not rewritten prose. |
| 16 | Companion chat ("what is this agent doing?") | S3, S4 | **not done** | The station view shows the session's task, model, folder, branch, recent posts and spend. Nothing answers free-form questions. |
| 17 | Session pseudonyms | S4 | **done** | Call signs from our own list (`src/core/names.ts`), stable for each session. |
| 18 | Local-first, no account, no telemetry | S4 | **done** | Nothing leaves the machine. The API listens on 127.0.0.1, checks the Host and Origin headers, and needs a random token (unit-tested). The hosted demo is a static replay with no API. |
| 19 | Pricing | S5 | **different** | Free and MIT-licensed. |

## Known gaps worth doing next

- OpenCode transcripts.
- A `Notification`-style hook for Codex approvals. Codex `PermissionRequest` is wired, but untested live for the trust reason in row 5.
- Subagent (sidechain) transcripts. They are skipped for posts and for usage, so a session that spawns subagents shows lower spend than it really used.
