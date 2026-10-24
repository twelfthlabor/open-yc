"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("manifest is MV3 and every referenced file exists", () => {
  assert.equal(manifest.manifest_version, 3);
  const files = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page,
    ...manifest.content_scripts.flatMap((c) => c.js)];
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  assert.deepEqual(manifest.content_scripts[0].js, ["detect.js", "sites.js", "content.js"]);
});

test("minimal permissions, no broad host access", () => {
  assert.deepEqual(manifest.permissions.sort(), ["alarms", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
  for (const m of manifest.content_scripts[0].matches) assert.match(m, /^https:\/\/[a-z0-9.\-]+\/(?:chat\/)?\*$/);
});

test("no remote code, eval or innerHTML anywhere in the extension", () => {
  const js = fs.readdirSync(ROOT).filter((f) => /\.(?:js|html)$/.test(f));
  for (const f of js) {
    const src = read(f);
    assert.ok(!/\binnerHTML\b|outerHTML\s*=|insertAdjacentHTML|\beval\s*\(|new Function\s*\(/.test(src), f);
    assert.ok(!/<script[^>]+src=["']https?:/i.test(src), f);
    assert.ok(!/importScripts\(\s*["']https?:/.test(src), f);
  }
});

test("content script sends only metadata fields", () => {
  const src = read("content.js");
  // The only message carrying an event builds it from these keys.
  const m = /const ev = \{([\s\S]*?)\};/.exec(src);
  assert.ok(m);
  let body = m[1];
  while (/\([^()]*\)/.test(body)) body = body.replace(/\([^()]*\)/g, "");
  const keys = body.split(",").map((p) => p.split(":")[0].trim()).filter(Boolean);
  assert.ok(keys.length >= 7);
  for (const k of keys) assert.ok(["event_id", "ts", "site", "channel", "action", "decision", "detectors"].includes(k), k);
});

test("site adapters resolve and fall back to generic selectors", () => {
  const S = require("../sites.js");
  assert.equal(S.forHost("chatgpt.com").id, "chatgpt");
  assert.equal(S.forHost("claude.ai").id, "claude");
  const other = S.forHost("example.org");
  assert.equal(other.id, "other");
  assert.ok(other.composer.includes("textarea") && other.send.length > 0);
  for (const site of S.SITES) for (const h of site.hosts) {
    assert.ok(manifest.content_scripts[0].matches.some((m) => m.startsWith(`https://${h}/`)), h);
  }
});
