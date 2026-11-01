import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EVENTS, handlerFor, install, settingsPath, status, uninstall } from "../src/server/install.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bc-install-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe("hook install", () => {
  it("adds every event once and keeps the user's other hooks and settings", () => {
    const path = join(dir, "settings.json");
    const theirs = { type: "command", command: "my-guard", timeout: 10 };
    writeFileSync(path, JSON.stringify({ model: "opus", hooks: { PostToolUse: [{ matcher: "Bash", hooks: [theirs] }] } }));
    expect(install("claude-code", path)).toEqual(EVENTS["claude-code"]);
    expect(install("claude-code", path)).toEqual([]);
    const data = read(path);
    expect(data.model).toBe("opus");
    expect(data.hooks.PostToolUse[0]).toEqual({ matcher: "Bash", hooks: [theirs] });
    expect(data.hooks.PostToolUse[1].matcher).toBe("*");
    expect(data.hooks.Stop[0].matcher).toBeUndefined();
    expect(data.hooks.Stop[0].hooks[0]).toMatchObject({ type: "command", args: [expect.stringMatching(/backchannel-hook\.mjs$/), "claude-code"] });
    expect(status(path).sort()).toEqual([...EVENTS["claude-code"]].sort());
    expect(existsSync(`${path}.backchannel.bak`)).toBe(true);
  });

  it("uninstall removes only backchannel entries", () => {
    const path = join(dir, "settings.json");
    const theirs = { type: "command", command: "my-guard" };
    writeFileSync(path, JSON.stringify({ hooks: { Stop: [{ hooks: [theirs] }] } }));
    install("claude-code", path);
    expect(uninstall(path).sort()).toEqual([...EVENTS["claude-code"]].sort());
    expect(read(path)).toEqual({ hooks: { Stop: [{ hooks: [theirs] }] } });
    expect(uninstall(path)).toEqual([]);
  });

  it("creates the file when missing and refuses a file that is not a JSON object", () => {
    const path = join(dir, "new", "hooks.json");
    expect(install("codex", path)).toEqual(EVENTS.codex);
    expect(read(path).hooks.PermissionRequest[0].matcher).toBe("*");
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "[1,2]");
    expect(() => install("claude-code", bad)).toThrow(/not a JSON object/);
  });

  it("quotes the Codex command for PowerShell on Windows and for sh elsewhere", () => {
    const win = handlerFor("codex", { node: "C:\\Program Files\\nodejs\\node.exe", hook: "D:\\Github Projects\\bc\\hook\\backchannel-hook.mjs", platform: "win32" });
    expect(win.command).toBe('& "C:/Program Files/nodejs/node.exe" "D:/Github Projects/bc/hook/backchannel-hook.mjs" codex');
    const nix = handlerFor("codex", { node: "/usr/bin/node", hook: "/opt/bc/hook/backchannel-hook.mjs", platform: "linux" });
    expect(nix.command).toBe('"/usr/bin/node" "/opt/bc/hook/backchannel-hook.mjs" codex');
    expect(handlerFor("claude-code", { node: "/usr/bin/node", hook: "/h.mjs" })).toEqual({ type: "command", command: "/usr/bin/node", args: ["/h.mjs", "claude-code"], timeout: 5 });
  });

  it("puts project installs in settings.local.json and .codex/hooks.json", () => {
    expect(settingsPath("claude-code", { userHome: "/u", project: "/p" })).toBe(join("/p", ".claude", "settings.local.json"));
    expect(settingsPath("codex", { userHome: "/u", project: "/p" })).toBe(join("/p", ".codex", "hooks.json"));
    expect(settingsPath("claude-code", { userHome: "/u" })).toBe(join("/u", ".claude", "settings.json"));
  });
});
