"use strict";
// Runs background.js with stubbed chrome/fetch APIs, feeds it messages like the content script would
// (including a hostile one with extra fields), and prints the batch it POSTs to the collector.
// Used by tests/test_browser_events.py to check the extension and the collector agree on the schema.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const store = { collector: { url: "http://127.0.0.1:1", token: "t", label: "ci profile!", deviceId: "dev-1" } };
const listeners = {};
const on = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
const chrome = {
  runtime: { getManifest: () => ({ version: "0.1.0" }), getURL: (p) => "chrome-extension://abcdefghijklmnopabcdefghijklmnop/" + p, onInstalled: on("installed"), onStartup: on("startup"), onMessage: on("message") },
  alarms: { create() {}, onAlarm: on("alarm") },
  action: { setBadgeText: () => Promise.resolve() },
  storage: { local: {
    get: async (keys) => {
      const out = {};
      for (const k of [].concat(keys)) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
      return out;
    },
    set: async (obj) => Object.assign(store, JSON.parse(JSON.stringify(obj))),
  } },
};
let posted = null;
const fetch = async (url, init) => {
  posted = { url, headers: init.headers, body: JSON.parse(init.body) };
  return { ok: true, status: 200, json: async () => ({ ok: true, accepted: posted.body.events.length }) };
};
const ctx = vm.createContext({ chrome, fetch, crypto: globalThis.crypto, navigator: { userAgent: "Chrome", userAgentData: { brands: [{ brand: "Google Chrome" }] } }, console, setTimeout });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"), ctx);

const tab = { tab: { id: 1 }, url: "https://chatgpt.com/c/1" };
const optionsPage = { tab: { id: 2 }, url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html" };
const send = (msg, sender = tab) => new Promise((resolve) => {
  if (!listeners.message(msg, sender, resolve)) resolve();
});

(async () => {
  await Promise.all([
    send({ type: "visit", site: "chatgpt.com" }),
    send({ type: "heartbeat", site: "chatgpt.com", seconds: 15 }),
    send({ type: "heartbeat", site: "chatgpt.com", seconds: 15 }),
    send({ type: "heartbeat", site: "not a host", seconds: 15 }),
    send({ type: "event", event: { event_id: "abc12345abc12345", ts: new Date().toISOString(), site: "claude.ai", channel: "paste",
      action: "warn", decision: "cancelled", detectors: { customer_list: 12, email_bulk: 12 } } }),
    // Extra fields (as a buggy or malicious caller might add) must be dropped before anything is stored or sent.
    send({ type: "event", event: { event_id: "x", ts: new Date().toISOString(), site: "chatgpt.com", channel: "file", action: "block",
      decision: "blocked", detectors: { sensitive_file: 1, "Bad Key": 3 }, file_ext: "env", file_size: 42, file_inspected: true,
      prompt: "SHOULD-NOT-LEAVE", filename: "secret.env" } }),
    // Values the collector would reject must never reach the outbox, or they would stall every later batch.
    send({ type: "event", event: { event_id: "badbadbad1", ts: "now", site: "claude.ai", channel: "email", action: "warn",
      decision: "cancelled", detectors: {} } }),
    send({ type: "event", event: { event_id: "badbadbad2", ts: "yesterday", site: "claude.ai", channel: "paste", action: "warn",
      decision: "cancelled", detectors: { credit_card: 1 } } }),
  ]);
  const fromContentScript = await send({ type: "flush" }, tab);
  if (fromContentScript !== undefined || posted) throw new Error("content script was allowed to trigger a flush");
  const result = await send({ type: "flush" }, optionsPage);
  process.stdout.write(JSON.stringify({ result, posted, store }));
})();
