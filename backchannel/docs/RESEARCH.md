# Research: Agent FM

Retrieved 2026-10-28. backchannel is an independent open-source project. It is **not affiliated with, endorsed by or derived from Agent FM or isoquant**, and it uses none of their name, branding, copy or code. For research we read only the public README and PRIVACY files of their open-source release. We did not read its source code. The UI terms, agent call signs and design here are our own.

## Sources

| # | Source | Kind | Notes |
|---|---|---|---|
| S1 | Y Combinator company page and launch post, "Agent FM: One group chat to hear and steer your coding agents": https://www.ycombinator.com/companies/agent-fm | YC profile | The profile is for isoquant (Fall 2026); the launch post is for Agent FM (agentfm.ai). The page does not say how the two relate. |
| S2 | https://agentfm.ai | Company site | On 2026-10-28 the site describes a different product: "AI teammates to hand off your busywork", general computer-use agents on macOS 14+ and Windows. It does not mention coding agents. |
| S3 | r/ClaudeAI post, "I built a Mac app that turns Claude Code agents into live radio stations \| Free & open source" (May 2026), via a snapshot: https://reddit.sentinel-team.org/posts/1tasoqo/snapshots/2026-05-16T01%3A22%3A27.604243Z | Founder post | The earliest public description. |
| S4 | Open-source release README and PRIVACY.md (Apache-2.0). The original repo, github.com/agentfm-ai/agent-fm, returns 404 on 2026-10-28; a copy is at https://github.com/wtasg/agent-fm | Project docs | Only README and PRIVACY.md were read. |
| S5 | aiindigo.com, "Agent FM deep dive" review: https://aiindigo.com/blog/agent-fm-deep-dive-technical-review | Third-party review | Unverified. It lists Starter $8, Pro $15 and Team $50 a month, and says much without evidence. Used only for pricing. |
| S6 | Claude Code hooks reference: https://code.claude.com/docs/en/hooks | Platform docs | Hook events, input fields and output semantics. |
| S7 | Codex hooks reference: https://learn.chatgpt.com/docs/hooks | Platform docs | Codex hook events. Output shapes match Claude Code's. Hooks run only once trusted. |

## What the product does

The product has gone through three versions in public:

1. **May 2026, the open-source radio app (S3, S4).** This was an Electron app for macOS on Apple Silicon. Each Claude Code or Codex session became a *station*, and a *Global Mix* played across all of them. It read the session transcript files the agents already write and turned raw events into "higher-signal updates", filtering repetition and noise. It narrated them through the user's own Gemini or OpenAI key (BYOK), with no hosted service. Blocker alerts announced when an agent was waiting for input, approval or a decision. A *companion* chat answered questions like "what is this agent doing?", and its voice mode sent microphone audio to the provider for transcription. Sessions got pseudonyms. The author listed the limits: Mac only, Claude Code and Codex only, heuristic state detection, and narration cadence still being tuned.
2. **YC launch, F26 (S1).** "One group chat to hear and steer your coding agents." Agents post progress updates, blockers, assumptions and decisions into one group chat. Live text and audio updates, and you reply from the chat. Token spend across providers, cost breakdowns, and token usage for skills and MCP servers. Context-aware, low-latency voice-to-text "for prompting anywhere on your computer". Supports Claude Code, Codex, OpenCode "and more", with local and remote workspaces. Reported traction: 410 engineers, more than 60 paying, more than 120k audio updates heard, and an average of 1.2 hours a day in the app.
3. **Now (S2).** The site has moved to general "AI teammates" for busywork.

backchannel rebuilds version 2, the coding-agent group chat. It also keeps the parts of version 1 that still make sense: stations, a shared channel and blocker alerts.

## Design consequences

- **Read transcripts, don't wrap terminals.** Like S4, backchannel reads the JSONL transcripts Claude Code (`~/.claude/projects`) and Codex (`~/.codex/sessions`) already write. It doesn't need a wrapper, a PTY or a change to how you start agents.
- **A typed event model, then renderers.** A commenter on S3 suggested parsing into typed events (start and stop, decisions, blocked, tool calls and results, file changes, errors), treating speech as one renderer over them, speaking blockers immediately, and batching the rest. backchannel follows that shape: parsers produce `AgentEvent`s (`src/core/types.ts`), `posts.ts` folds them into chat posts, and `narrate.ts` decides what is spoken.
- **Steering needs a way in.** Reading transcripts gives you a feed, not a reply channel. Both agents run hooks with the same JSON output shapes (S6, S7). A `Stop` hook that returns `decision: "block"` with a `reason` keeps the agent working with the reason as its next instruction. backchannel's hook hands over queued replies this way. Live runs showed this is reliable at the end of a turn, and unreliable mid-run (see `PARITY.md`, row 5).
- **No key by default.** S4 needs a paid model key for every narration. backchannel builds posts with rules over the transcript (digests, tagged lines, failure detection) and speaks with the browser's built-in voices, so it costs nothing to run. The trade-off: no LLM-written prose summaries.
- **Not a desktop app.** A local server plus a browser tab runs on Windows, macOS and Linux with no signing or installer. The trade-off: no system-wide dictation hotkey.

## Prior open-source work

The open-source release (S4) is the closest. Others are small hobby projects found by searching GitHub for "agent fm", none of them a coding-agent chat. aiwarden (in this repo) already parsed Claude Code and Codex transcripts for token usage. backchannel ports aiwarden's price table (`src/core/pricing.ts`), not its code.
