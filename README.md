# open-yc

Open-source rebuilds of the products behind recent Y Combinator companies, one folder per project.
Each project is self-contained, with its own README, tests and license, and is built to do the
same jobs as the company's product.

None of these projects is affiliated with, endorsed by, or uses code, branding or copy from the
companies they are modeled on. Company names appear only to describe the product category.

| Project | Live app | Modeled on | What it does | Stack |
|---|---|---|---|---|
| [aiwarden](./aiwarden) | [aiwarden-gamma.vercel.app](https://aiwarden-gamma.vercel.app) (read-only demo fleet) | Traceforce (YC S26), "CrowdStrike for AI agents" | Endpoint visibility and guardrails for AI apps, coding agents, MCP servers and browser AI. Inventory, risk findings, token usage and cost, pre-execution guard hooks, browser DLP extension, fleet web console, alerts and MCP scanning. | Python (stdlib), React console, MV3 extension |
| [backchannel](./backchannel) | [backchannel-demo-ruby.vercel.app](https://backchannel-demo-ruby.vercel.app) (replay of a recorded run) | Agent FM (YC F26), "one group chat to hear and steer your coding agents" | One channel for all your Claude Code and Codex sessions: progress digests, decisions, assumptions, failing tests and blockers, read aloud if you want. Replies reach the agent through its hook. Token spend by provider, model, session and day. Verified on real agent runs. | TypeScript (Node stdlib server), React, Vite |
| [visa-navigator](./visa-navigator) | [visa-ai-application.vercel.app](https://visa-ai-application.vercel.app) | Veeza AI (YC F26), AI tourist visa service | Plans and prepares tourist visa applications: requirement checklists from official sources, filled forms, cover letter, itinerary, document checks, appointment help and a reviewer packet. Encrypted on your device. | TypeScript, React, Vite |

## Layout

```
aiwarden/          python package, web console, browser extension   (cd aiwarden && pip install -e ".[dev]" && pytest)
backchannel/       local server, hook, web app                       (cd backchannel && npm install && npm test)
visa-navigator/    web app                               (cd visa-navigator && npm install && npm run dev)
```

CI runs each project's tests only when its folder changes (`.github/workflows/`).

## Adding a project

1. Pick a YC company whose core product can be rebuilt as software, without regulated services
   or proprietary data.
2. Write `docs/` research in the project folder: what the company ships, cited from public
   sources, and a parity checklist.
3. Build it with tests, then verify it independently: run it end to end and try to break it.
4. Add a row to the table above, with a link to the deployed app.

## License

Each project carries its own license file (MIT).
