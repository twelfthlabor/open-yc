import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { doctor } from "../src/server/doctor.ts";
import { handlerFor, install, settingsPath, stableHook } from "../src/server/install.ts";
import { resolvePaths } from "../src/server/paths.ts";
import { serve } from "../src/server/server.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bc-doctor-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const setup = () => {
  const env = { BACKCHANNEL_HOME: join(dir, "bc"), CLAUDE_CONFIG_DIR: join(dir, "claude"), CODEX_HOME: join(dir, "codex") };
  const paths = resolvePaths(env, dir);
  const scope = { userHome: dir, claudeDir: env.CLAUDE_CONFIG_DIR, codexDir: env.CODEX_HOME };
  return { paths, scope };
};

const byName = (checks: Awaited<ReturnType<typeof doctor>>, name: string) => checks.find((c) => c.name === name);

describe("doctor", () => {
  it("on a fresh machine: says hooks are missing, the server is down, and how to fix each", async () => {
    const { paths, scope } = setup();
    const checks = await doctor({ paths, scope });
    expect(byName(checks, "Claude Code hook")).toMatchObject({ level: "fail", fix: expect.stringContaining("hooks install") });
    expect(byName(checks, "Codex hook")).toMatchObject({ level: "fail" });
    expect(byName(checks, "Server")).toMatchObject({ level: "fail", fix: expect.stringContaining("serve") });
    expect(byName(checks, "Claude Code transcripts")).toMatchObject({ level: "warn" });
    expect(byName(checks, "Node")).toMatchObject({ level: "ok" });
  });

  it("flags a hook whose script no longer exists, as after an npx cache was cleared", async () => {
    const { paths, scope } = setup();
    install("claude-code", settingsPath("claude-code", scope), handlerFor("claude-code", { hook: join(dir, "gone", "backchannel-hook.mjs") }));
    const c = byName(await doctor({ paths, scope }), "Claude Code hook");
    expect(c).toMatchObject({ level: "fail", detail: expect.stringContaining("does not exist"), fix: expect.stringContaining("hooks install") });
  });

  it("all good: hooks in place, server answering, and Codex's trust step called out", async () => {
    const { paths, scope } = setup();
    mkdirSync(paths.claudeProjects, { recursive: true });
    mkdirSync(paths.codexSessions, { recursive: true });
    const hook = stableHook(paths.home);
    install("claude-code", settingsPath("claude-code", scope), handlerFor("claude-code", { hook }));
    install("codex", settingsPath("codex", scope), handlerFor("codex", { hook }));
    const run = await serve({ paths, port: 0, pollMs: 40 });
    try {
      const checks = await doctor({ paths, scope });
      expect(byName(checks, "Claude Code hook")?.level).toBe("ok");
      expect(byName(checks, "Codex hook")).toMatchObject({ level: "warn", detail: expect.stringContaining("/hooks") });
      expect(byName(checks, "Server")).toMatchObject({ level: "ok", detail: expect.stringContaining(String(run.port)) });
      expect(checks.filter((c) => c.level === "fail")).toEqual([]);
    } finally {
      await run.close();
    }
  });

  it("reports a stale server.json left by a server that is gone", async () => {
    const { paths, scope } = setup();
    mkdirSync(paths.home, { recursive: true });
    writeFileSync(join(paths.home, "server.json"), JSON.stringify({ port: 1, token: "x", pid: 999999 }));
    expect(byName(await doctor({ paths, scope }), "Server")).toMatchObject({ level: "fail", detail: expect.stringContaining("not answering") });
  });

  it("needs Node 22.18+ on 22, or 23.6+ where the source runs with type stripping", async () => {
    const { paths, scope } = setup();
    const level = async (v: string) => (await doctor({ paths, scope, nodeVersion: v })).find((c) => c.name === "Node")?.level;
    expect(await level("22.17.0")).toBe("fail");
    expect(await level("22.18.0")).toBe("ok");
    expect(await level("23.5.0")).toBe("fail");
    expect(await level("23.6.0")).toBe("ok");
    expect(await level("24.11.1")).toBe("ok");
  });

  it("prints fixes that also work in Windows PowerShell 5.1, which has no &&", async () => {
    const { paths, scope } = setup();
    install("claude-code", settingsPath("claude-code", scope), handlerFor("claude-code", { hook: join(dir, "gone", "backchannel-hook.mjs") }));
    const checks = await doctor({ paths, scope });
    expect(checks.every((c) => !c.fix?.includes("&&"))).toBe(true);
  });
});
