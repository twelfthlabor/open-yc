// Live verification: run real Claude Code and Codex sessions against a real backchannel server,
// steer them from the chat API, and check what happened on disk and in the channel.
//
//   npm run build && npm run verify:live
//
// Needs `claude` and `codex` on PATH and signed in. Spends a few cents (Claude Haiku, a small
// Codex task). Writes:
//   docs/VERIFICATION.md            pass/fail for each check, with the numbers
//   docs/screenshots/live-*.png     the console during and after the run
//   web/public/demo/run.json        the recorded channel, replayed by the hosted demo
// Hooks go into the throwaway projects only (.claude/settings.local.json, .codex/hooks.json);
// the user's own settings are not touched.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { install, settingsPath } from "../src/server/install.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { serve } from "../src/server/server.ts";

const HERE = resolve(import.meta.dirname, "..");
// A short path with no user name in it: it shows up in the console and in the screenshots.
const ROOT = resolve(process.env.BC_LIVE_ROOT ?? (process.platform === "win32" ? "D:/bc-live" : "/tmp/bc-live"));
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = join(HERE, "docs", "screenshots");
const TIMEOUT_MS = 6 * 60_000;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const skipped = [];
const skip = (name, why) => {
  skipped.push({ name, why });
  console.log(`SKIP  ${name}  (${why})`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- throwaway projects ----
rmSync(ROOT, { recursive: true, force: true });
const A = join(ROOT, "shop-api");
const B = join(ROOT, "config-svc");
const C = join(ROOT, "notes-cli");
const D = join(ROOT, "billing-hooks");
for (const d of [A, B, C, D]) mkdirSync(d, { recursive: true });
writeFileSync(join(D, "config.json"), JSON.stringify({ stripe: { webhookSecret: "" } }, null, 2));
writeFileSync(join(A, "package.json"), JSON.stringify({ name: "shop-api", type: "module", private: true }, null, 2));
writeFileSync(join(A, "sum.mjs"), "export const sum = (a, b) => a - b;\n");
writeFileSync(
  join(A, "sum.test.mjs"),
  'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\n\ntest("adds two numbers", () => {\n  assert.equal(sum(2, 3), 5);\n});\n',
);
writeFileSync(join(C, "notes.md"), "# Notes\n");
for (const d of [A, B, D]) install("claude-code", settingsPath("claude-code", { userHome: ROOT, project: d }));
install("codex", settingsPath("codex", { userHome: ROOT, project: C }));

// ---- the server, scoped to these projects ----
const home = join(ROOT, ".backchannel");
const paths = resolvePaths({ ...process.env, BACKCHANNEL_HOME: home });
// sinceHours ~2 s: only sessions this run starts, not ones left from an earlier run in ROOT.
const running = await serve({ paths, port: 0, sinceHours: 2 / 3600, webRoot: join(HERE, "dist"), only: [ROOT] });
const api = async (path, init = {}) => {
  const res = await fetch(`http://127.0.0.1:${running.port}${path}`, { ...init, headers: { "content-type": "application/json", "x-backchannel-token": running.token } });
  return res.json();
};
console.log(`backchannel at ${running.url}`);

// ---- agents ----
function run(cmd, args, cwd, prompt) {
  const env = { ...process.env, BACKCHANNEL_HOME: home };
  return new Promise((ok) => {
    const child = spawn(cmd, args, { cwd, env, shell: process.platform === "win32" });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      ok({ code, out, err });
    });
    child.stdin.end(prompt);
  });
}

// The console is open before any agent starts, so everything it shows arrived over the live stream.
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--disable-extensions"] });
const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
// A browser extension on the test machine injects a floating button; keep it out of the screenshots.
await page.addInitScript(() => new MutationObserver(() => document.querySelectorAll("settings-manager").forEach((e) => e.remove())).observe(document, { childList: true, subtree: true }));
await page.goto(running.url);
await page.getByText("Live", { exact: true }).waitFor({ timeout: 10_000 });
const shoot = async (name, fn) => {
  try {
    if (fn) await fn(page);
    await sleep(400);
    await page.screenshot({ path: join(SHOTS, `live-${name}.png`) });
  } catch (e) {
    console.log(`screenshot ${name} failed: ${e.message}`);
  }
};

const claudeArgs = (tools) => ["-p", "--setting-sources", "project,local", "--model", "haiku", "--permission-mode", "acceptEdits", "--allowedTools", ...tools.map((t) => `"${t}"`), "--output-format", "json"];
const started = Date.now();
const jobs = {
  A: run("claude", claudeArgs(["Read", "Edit", "Write", "Bash(node:*)"]), A, "The test in sum.test.mjs fails. Run `node --test` to see the failure, fix sum.mjs, then run `node --test` again to confirm it passes. Finish with one short sentence."),
  // No .env exists, so this one cannot finish without the user.
  D: run("claude", claudeArgs(["Read", "Write", "Edit", "Glob"]), D, "Copy STRIPE_WEBHOOK_SECRET from this project's .env file into config.json under stripe.webhookSecret. Do not invent a value."),
  B: run("claude", claudeArgs(["Write"]), B, "Create config.json for a small internal web server with a port, a host and a log level. Pick sensible values yourself; don't ask me. Finish with one short sentence."),
  // Codex runs project hooks only after the user trusts them with /hooks, so this run checks
  // Codex transcripts and usage; replies to Codex are recorded as skipped unless a hook fired.
  C: run("codex", ["exec", "--skip-git-repo-check", "-s", "workspace-write", "-m", process.env.BC_CODEX_MODEL ?? "gpt-5.6-terra", "--json", "-"], C, "Create a file named todo.txt with three short lines of todo items for a notes CLI, then show the file. Keep it brief."),
};

// ---- steer two of them from the chat, the way a person would ----
const sessionFor = (snap, dir) => snap.sessions.find((s) => resolve(s.cwd).toLowerCase() === dir.toLowerCase());
const replies = {};
const steer = async () => {
  const deadline = Date.now() + 120_000;
  const cWindow = Date.now() + 30_000; // give a trusted Codex hook time to report in
  while (Date.now() < deadline && (!replies.A || (!replies.C && Date.now() < cWindow))) {
    const snap = await api("/api/snapshot");
    const a = sessionFor(snap, A);
    // Reply once A has picked up its task and is working.
    const aBusy = a && snap.posts.some((p) => p.sessionId === a.id && (p.kind === "error" || p.kind === "progress"));
    if (a && !replies.A && a.hooked && aBusy) {
      replies.A = await api(`/api/sessions/${a.id}/reply`, { method: "POST", body: JSON.stringify({ text: "Also add a README.md with one line that says what sum.mjs does." }) });
      await shoot("channel-midrun");
    }
    const c = sessionFor(snap, C);
    if (c && !replies.C && c.hooked) replies.C = await api(`/api/sessions/${c.id}/reply`, { method: "POST", body: JSON.stringify({ text: "Also create done.txt containing the word done." }) });
    await sleep(250);
  }
};


await steer();
const out = Object.fromEntries(await Promise.all(Object.entries(jobs).map(async ([k, p]) => [k, await p])));
await sleep(2500); // last transcript lines and digests
running.store.tick();
console.log(`agents finished in ${Math.round((Date.now() - started) / 1000)} s`);

// ---- checks ----
const snap = await api("/api/snapshot");
const usage = await api("/api/usage");
const sA = sessionFor(snap, A);
const sB = sessionFor(snap, B);
const sC = sessionFor(snap, C);
const sD = sessionFor(snap, D);
const postsOf = (s) => (s ? snap.posts.filter((p) => p.sessionId === s.id) : []);
const parse = (txt) => {
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
};
const jA = parse(out.A.out);
const jB = parse(out.B.out);
const jD = parse(out.D.out);

check("Claude Code session A ran", out.A.code === 0 && jA && !jA.is_error, `exit ${out.A.code}`);
check("Claude Code session B ran", out.B.code === 0 && jB && !jB.is_error, `exit ${out.B.code}`);
check("Claude Code session D ran", out.D.code === 0 && jD && !jD.is_error, `exit ${out.D.code}`);
check("Codex session C ran", out.C.code === 0, `exit ${out.C.code}`);
check("agent D left the secret empty (no value invented)", JSON.parse(readFileSync(join(D, "config.json"), "utf8")).stripe?.webhookSecret === "");
check(
  "agent D's missing .env was posted as an urgent blocker",
  postsOf(sD).some((p) => p.kind === "blocker" && p.urgent),
  postsOf(sD).filter((p) => p.kind === "blocker").map((p) => p.text).join(" | ").slice(0, 240) || postsOf(sD).map((p) => `${p.kind}: ${p.text}`).join(" | ").slice(0, 240),
);
check("all four sessions are on the channel, and nothing else is", !!(sA && sB && sC && sD) && snap.sessions.length === 4, snap.sessions.map((s) => `${s.name}:${s.agent}:${s.project}`).join(", "));
check("hooks reported in for all three Claude Code sessions", !!(sA?.hooked && sB?.hooked && sD?.hooked));
check("agent A fixed the code (node --test passes)", /a \+ b/.test(readFileSync(join(A, "sum.mjs"), "utf8")));
check("the failing test run was posted as an error", postsOf(sA).some((p) => p.kind === "error" && /Tests are failing/.test(p.text)), postsOf(sA).find((p) => p.kind === "error")?.text ?? "none");
const rA = snap.posts.find((p) => p.id === replies.A?.id);
check("reply to A was delivered by the hook", rA?.delivery?.state === "delivered", rA?.delivery ? `${rA.delivery.state} via ${rA.delivery.via}` : "no reply post");
check("agent A acted on the reply (README.md exists)", existsSync(join(A, "README.md")), existsSync(join(A, "README.md")) ? readFileSync(join(A, "README.md"), "utf8").trim().slice(0, 100) : "missing");
check("agent B wrote config.json", existsSync(join(B, "config.json")));
check("agent B's choice was posted as a decision or assumption", postsOf(sB).some((p) => p.kind === "decision" || p.kind === "assumption"), postsOf(sB).filter((p) => p.kind === "decision" || p.kind === "assumption").map((p) => `${p.kind}: ${p.text}`).join(" | ").slice(0, 300));
check("every session posted a done summary", [sA, sB, sC, sD].every((s) => postsOf(s).some((p) => p.kind === "done")));
check("agent C (Codex) created todo.txt", existsSync(join(C, "todo.txt")));
const rC = snap.posts.find((p) => p.id === replies.C?.id);
if (sC?.hooked) {
  check("reply to C (Codex) was delivered by the hook", rC?.delivery?.state === "delivered", rC?.delivery ? `${rC.delivery.state}${rC.delivery.via ? ` via ${rC.delivery.via}` : ""}` : "no reply post");
  check("agent C acted on the reply (done.txt exists)", existsSync(join(C, "done.txt")));
} else {
  skip("reply to C (Codex) delivered by the hook", "Codex did not run the untrusted project hook (trust it with /hooks); so no reply was sent to it");
}

const rowFor = (s) => usage.bySession.find((r) => r.key === s?.id);
for (const [label, s, j] of [["A", sA, jA], ["B", sB, jB], ["D", sD, jD]]) {
  const row = rowFor(s);
  const ours = row?.costUsd ?? NaN;
  const theirs = j?.total_cost_usd ?? NaN;
  check(`session ${label} cost matches Claude Code's own total_cost_usd`, Math.abs(ours - theirs) < 1e-6, `ours $${ours.toFixed(6)}, Claude Code $${theirs.toFixed(6)}`);
}
// Codex --json prints a turn.completed event with the turn's usage.
const codexTurns = out.C.out.split("\n").map(parse).filter((e) => e?.type === "turn.completed");
const cu = codexTurns.reduce((t, e) => ({ input: t.input + (e.usage?.input_tokens ?? 0), cached: t.cached + (e.usage?.cached_input_tokens ?? 0), output: t.output + (e.usage?.output_tokens ?? 0) }), { input: 0, cached: 0, output: 0 });
const rowC = rowFor(sC);
check(
  "Codex token counts match codex exec --json",
  !!rowC && codexTurns.length > 0 && rowC.input + rowC.cacheRead === cu.input && rowC.cacheRead === cu.cached && rowC.output === cu.output,
  rowC ? `ours in ${rowC.input + rowC.cacheRead} (cached ${rowC.cacheRead}) out ${rowC.output}; codex in ${cu.input} (cached ${cu.cached}) out ${cu.output}` : "no usage row",
);

// ---- what the browser showed, having received it all over the live stream ----
await sleep(1000);
const shown = await page.locator(".feed > li").count();
check("the open console received every post live", shown === snap.posts.length, `${shown} shown, ${snap.posts.length} on the server`);
const receipt = await page.locator(".post.mine .delivery.delivered").first().textContent().catch(() => null);
check("the console shows the delivery receipt for the reply", !!receipt && /Delivered/.test(receipt), receipt ?? "none");
check("no errors in the page", pageErrors.length === 0, pageErrors.join("; ").slice(0, 200));

// ---- screenshots after the run ----
await shoot("channel");
if (sA) await shoot("station", async (p) => p.getByRole("button", { name: new RegExp(`^${sA.name}`) }).first().click());
await shoot("spend", async (p) => p.getByRole("button", { name: "Spend", exact: true }).click());
await browser.close();

// ---- the recording for the hosted demo, with local paths replaced ----
const variants = [ROOT, ROOT.replace(/\\/g, "/"), ROOT.replace(/\//g, "\\"), ROOT.replace(/\\/g, "\\\\")];
const scrub = (v) => {
  if (typeof v === "string") {
    let s = v;
    for (const r of variants) s = s.split(r).join("~/work");
    for (const r of variants.map((x) => x.toLowerCase())) s = s.split(r).join("~/work");
    return s.replace(/\\/g, "/");
  }
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
  return v;
};
const recording = scrub({
  recordedAt: new Date().toISOString(),
  note: "Three Claude Code sessions (Haiku) and one Codex session on throwaway projects; one reply was sent from this channel while its agent worked.",
  sessions: snap.sessions,
  posts: snap.posts,
  usage,
});
mkdirSync(join(HERE, "web", "public", "demo"), { recursive: true });
writeFileSync(join(HERE, "web", "public", "demo", "run.json"), `${JSON.stringify(recording, null, 1)}\n`);

// ---- report ----
const passed = results.filter((r) => r.ok).length;
const md = [
  "# Live verification",
  "",
  `Run on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC with \`npm run verify:live\` (${process.platform}, Node ${process.version}).`,
  "Real Claude Code and Codex sessions on throwaway projects, a real backchannel server, replies sent through its HTTP API.",
  "",
  `**${passed} of ${results.length} checks passed.**`,
  "",
  "| Check | Result | Detail |",
  "|---|---|---|",
  ...results.map((r) => `| ${r.name} | ${r.ok ? "pass" : "**fail**"} | ${String(scrub(r.detail)).replace(/\|/g, "\\|").replace(/\n/g, " ")} |`),
  ...skipped.map((s) => `| ${s.name} | skipped | ${s.why} |`),
  "",
  "## Channel at the end of the run",
  "",
  ...scrub(snap.posts).map((p) => `- **${snap.sessions.find((s) => s.id === p.sessionId)?.name ?? "?"}** (${p.kind}${p.delivery ? `, ${p.delivery.state}${p.delivery.via ? ` via ${p.delivery.via}` : ""}` : ""}): ${p.text.replace(/\n/g, " ")}`),
  "",
  "Screenshots: `docs/screenshots/live-*.png`.",
  "",
].join("\n");
writeFileSync(join(HERE, "docs", "VERIFICATION.md"), md);
console.log(`\n${passed}/${results.length} checks passed. Report: docs/VERIFICATION.md`);
await running.close();
process.exit(passed === results.length ? 0 : 1);
