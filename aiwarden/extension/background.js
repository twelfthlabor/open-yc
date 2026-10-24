/* aiwarden background worker: keeps metadata-only events and site usage in chrome.storage.local and,
 * if a collector is configured, sends them to POST /api/browser-events.
 *
 * Storage keys:
 *   settings   {policy, emailThreshold, minRows, enabled}         (read by content scripts)
 *   collector  {url, token, label, deviceId}                      (only read here and on the options page)
 *   profile    {id, browser}
 *   events     last 500 events, for the popup
 *   outbox     events not yet accepted by the collector (max 2000)
 *   usage      {"YYYY-MM-DD": {site: {seconds, visits}}}, last 30 days
 *   sync       {ok, at, error, accepted}
 */
"use strict";

const VERSION = chrome.runtime.getManifest().version;
const KEEP_EVENTS = 500;
const KEEP_OUTBOX = 2000;
const KEEP_DAYS = 30;
const CHANNELS = ["submit", "paste", "drop", "file"];
const ACTIONS = ["allow", "warn", "block"];
const DECISIONS = ["allowed", "sent_anyway", "cancelled", "blocked"];
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

// chrome.storage has no transactions; serialize every read-modify-write so concurrent
// heartbeats and events do not overwrite each other.
let chain = Promise.resolve();
function serial(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

const get = (keys) => chrome.storage.local.get(keys);
const set = (obj) => chrome.storage.local.set(obj);

function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function detectBrowser() {
  try {
    const brands = (navigator.userAgentData && navigator.userAgentData.brands || []).map((b) => b.brand);
    if (brands.some((b) => /Edge/i.test(b))) return "edge";
    if (navigator.brave) return "brave";
    if (brands.some((b) => /Opera/i.test(b))) return "opera";
    if (brands.some((b) => /Google Chrome/i.test(b))) return "chrome";
    if (brands.some((b) => /Chromium/i.test(b))) return "chromium";
  } catch (e) { /* fall through */ }
  return /Edg\//.test(navigator.userAgent) ? "edge" : "chrome";
}

async function profile() {
  const { profile: p } = await get("profile");
  if (p && p.id) return p;
  const rnd = crypto.getRandomValues(new Uint8Array(12));
  const np = { id: "prof_" + Array.from(rnd, (b) => b.toString(16).padStart(2, "0")).join(""), browser: detectBrowser() };
  await set({ profile: np });
  return np;
}

// Only the fields the collector accepts, so nothing else can leak even if a caller adds one.
function cleanEvent(ev) {
  // Mirrors the collector's validation: one malformed event would otherwise get every batch rejected.
  if (!ev || typeof ev !== "object" || !HOST_RE.test(String(ev.site || ""))) return null;
  if (!CHANNELS.includes(ev.channel) || !ACTIONS.includes(ev.action) || !DECISIONS.includes(ev.decision)) return null;
  const out = {
    event_id: String(ev.event_id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64),
    ts: TS_RE.test(String(ev.ts)) ? ev.ts : new Date().toISOString(),
    site: ev.site,
    channel: ev.channel,
    action: ev.action,
    decision: ev.decision,
    detectors: {},
  };
  for (const [k, v] of Object.entries(ev.detectors || {})) {
    if (/^[a-z][a-z0-9_]{0,39}$/.test(k) && Number.isInteger(v) && v >= 0) out.detectors[k] = Math.min(v, 1000000);
  }
  if (typeof ev.file_ext === "string" && /^[a-z0-9]{0,10}$/.test(ev.file_ext)) out.file_ext = ev.file_ext;
  if (Number.isInteger(ev.file_size) && ev.file_size >= 0) out.file_size = ev.file_size;
  if (typeof ev.file_inspected === "boolean") out.file_inspected = ev.file_inspected;
  if (out.event_id.length < 8) out.event_id = crypto.randomUUID().replace(/-/g, "");
  return out;
}

function addEvent(raw) {
  const ev = cleanEvent(raw);
  if (!ev) return Promise.resolve();
  return serial(async () => {
    const { events = [], outbox = [] } = await get(["events", "outbox"]);
    events.push(ev);
    outbox.push(ev);
    await set({ events: events.slice(-KEEP_EVENTS), outbox: outbox.slice(-KEEP_OUTBOX) });
    if (ev.action !== "allow") chrome.action.setBadgeText({ text: "!" }).catch(() => {});
  });
}

function addUsage(site, seconds, visits) {
  if (!HOST_RE.test(String(site || ""))) return Promise.resolve();
  return serial(async () => {
    const { usage = {} } = await get("usage");
    const day = localDay();
    const d = (usage[day] = usage[day] || {});
    const u = (d[site] = d[site] || { seconds: 0, visits: 0 });
    u.seconds = Math.min(86400, u.seconds + Math.max(0, Math.min(30, seconds | 0)));
    u.visits += visits;
    for (const k of Object.keys(usage).sort().slice(0, -KEEP_DAYS)) delete usage[k];
    await set({ usage });
  });
}

async function flush() {
  const { collector = {}, outbox = [], usage = {} } = await get(["collector", "outbox", "usage"]);
  if (!collector.url || !collector.token) return { ok: false, error: "no collector configured" };
  const p = await profile();
  const sending = outbox.slice(0, 500);
  const recent = {};
  for (const day of Object.keys(usage).sort().slice(-2)) recent[day] = usage[day];
  const prof = { id: p.id, browser: p.browser, extension_version: VERSION };
  if (collector.label) prof.label = String(collector.label).replace(/[^A-Za-z0-9 _.@-]/g, "").slice(0, 64);
  if (collector.deviceId && /^[A-Za-z0-9_-]{1,64}$/.test(collector.deviceId)) prof.device_id = collector.deviceId;
  const batch = { schema: "aiwarden.browser-events/v1", profile: prof, events: sending, usage: recent };
  let result;
  try {
    const r = await fetch(collector.url.replace(/\/+$/, "") + "/api/browser-events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + collector.token },
      body: JSON.stringify(batch),
      credentials: "omit",
    });
    const body = await r.json().catch(() => ({}));
    result = r.ok ? { ok: true, accepted: body.accepted || 0 }
      : { ok: false, status: r.status, error: `HTTP ${r.status}: ${body.error || r.statusText}` };
  } catch (e) {
    result = { ok: false, error: String(e && e.message || e).slice(0, 200) };
  }
  // 422 means the collector will never accept this batch (e.g. a schema change): drop it rather than
  // resending it forever and blocking newer events. Auth, server and network errors keep it for retry.
  if (result.ok || result.status === 422) {
    const sent = new Set(sending.map((e) => e.event_id));
    await serial(async () => {
      const { outbox: now = [] } = await get("outbox");
      await set({ outbox: now.filter((e) => !sent.has(e.event_id)) });
    });
  }
  await set({ sync: { ...result, at: new Date().toISOString() } });
  return result;
}

chrome.runtime.onInstalled.addListener(() => {
  profile();
  chrome.alarms.create("flush", { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => chrome.alarms.create("flush", { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "flush") flush();
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg !== "object") return;
  // Pages of this extension (options, popup) may trigger a sync even when opened in a tab; content scripts may not.
  const fromExtensionPage = !!(sender && sender.url && sender.url.startsWith(chrome.runtime.getURL("")));
  const fromTab = !!(sender && sender.tab) && !fromExtensionPage;
  if (msg.type === "event" && fromTab) addEvent(msg.event).then(() => reply({ ok: true }));
  else if (msg.type === "heartbeat" && fromTab) addUsage(msg.site, msg.seconds, 0).then(() => reply({ ok: true }));
  else if (msg.type === "visit" && fromTab) addUsage(msg.site, 0, 1).then(() => reply({ ok: true }));
  else if (msg.type === "flush" && fromExtensionPage) flush().then(reply);
  else return;
  return true; // async reply
});
