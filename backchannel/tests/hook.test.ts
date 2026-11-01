// Runs the real hook script as a child process, the way Claude Code and Codex do.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render, trim } from "../hook/backchannel-hook.mjs";
import { resolvePaths } from "../src/server/paths.ts";
import { serve, type Running } from "../src/server/server.ts";

const HOOK = resolve(import.meta.dirname, "..", "hook", "backchannel-hook.mjs");
let dir: string;
let run: Running;

// Async spawn: the server under test runs in this process, so a blocking spawn would stall it.
function runHook(event: object | string, home = join(dir, "bc"), agent = "claude-code"): Promise<{ code: number | null; out: string; ms: number }> {
  const t = Date.now();
  return new Promise((ok) => {
    const child = spawn(process.execPath, [HOOK, agent], { env: { ...process.env, BACKCHANNEL_HOME: home, BACKCHANNEL_HOOK_TIMEOUT_MS: "800" } });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("close", (code) => ok({ code, out, ms: Date.now() - t }));
    child.stdin.end(typeof event === "string" ? event : JSON.stringify(event));
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bc-hook-"));
  const paths = resolvePaths({ BACKCHANNEL_HOME: join(dir, "bc"), CLAUDE_CONFIG_DIR: join(dir, "claude"), CODEX_HOME: join(dir, "codex") }, dir);
  run = await serve({ paths, port: 0, pollMs: 50, midRun: true }); // mid-run so both output shapes are exercised
});

afterAll(async () => {
  await run.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("hook relay", () => {
  it("prints the introduction at SessionStart in Claude Code's format", async () => {
    const r = await runHook({ hook_event_name: "SessionStart", session_id: "h1", cwd: "/w/app", source: "startup" });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toContain("connected to backchannel");
  });

  it("delivers a reply mid-run as additionalContext and at Stop as a block reason", async () => {
    run.store.reply("h1", "Run the linter too.");
    const mid = JSON.parse((await runHook({ hook_event_name: "PostToolUse", session_id: "h1", tool_name: "Bash", tool_input: { command: "ls" }, tool_response: "x".repeat(100_000) })).out);
    expect(mid).toEqual({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "Message from the user via backchannel: Run the linter too." } });
    run.store.reply("h1", "Then stop.");
    // Codex reads the same shape.
    const stop = JSON.parse((await runHook({ hook_event_name: "Stop", session_id: "h1", stop_hook_active: false }, undefined, "codex")).out);
    expect(stop).toEqual({ decision: "block", reason: "Message from the user via backchannel: Then stop." });
  });

  it("prints nothing when there is nothing to deliver, or for events that cannot carry a reply", async () => {
    expect((await runHook({ hook_event_name: "Stop", session_id: "h1" })).out).toBe("");
    run.store.reply("h1", "queued");
    expect((await runHook({ hook_event_name: "Notification", session_id: "h1", notification_type: "idle_prompt", message: "waiting" })).out).toBe("");
  });

  it("exits 0 silently and quickly when the server is not running", async () => {
    const empty = join(dir, "nobody");
    mkdirSync(empty);
    const r = await runHook({ hook_event_name: "PostToolUse", session_id: "x" }, empty);
    expect([r.code, r.out]).toEqual([0, ""]);
    writeFileSync(join(empty, "server.json"), JSON.stringify({ port: 9, token: "t" }));
    const r2 = await runHook({ hook_event_name: "Stop", session_id: "x" }, empty);
    expect([r2.code, r2.out]).toEqual([0, ""]);
    expect(r2.ms).toBeLessThan(3000);
  });

  it("exits 0 silently on a wrong token or bad input", async () => {
    const home = join(dir, "badtoken");
    mkdirSync(home);
    writeFileSync(join(home, "server.json"), JSON.stringify({ port: run.port, token: "wrong" }));
    expect(await runHook({ hook_event_name: "Stop", session_id: "h1" }, home)).toMatchObject({ code: 0, out: "" });
    expect(await runHook("not json")).toMatchObject({ code: 0, out: "" });
  });

  it("trims large fields before sending them", async () => {
    const t = trim({ hook_event_name: "PostToolUse", session_id: "s", tool_input: { command: "y".repeat(5000), description: "d" }, tool_response: "z".repeat(5000) });
    expect(t.tool_input.length).toBeLessThan(2100);
    expect(t.tool_description).toBe("d");
    expect("tool_response" in t).toBe(false);
    expect(render("Notification", "x")).toBeNull();
    expect(render("UserPromptSubmit", "x")).toEqual({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "x" } });
  });
});
