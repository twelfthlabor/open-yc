"use strict";
const D = globalThis.AIWardenDetect;
const $ = (id) => document.getElementById(id);
const DEFAULTS = { policy: { ...D.DEFAULT_POLICY }, emailThreshold: 5, minRows: 10, enabled: true };

function row(kind, value) {
  const tr = document.createElement("tr");
  const name = document.createElement("td");
  name.textContent = D.LABELS[kind];
  const cat = document.createElement("td");
  cat.textContent = D.CATEGORY[kind] === "pii" ? "personal data" : "secret";
  cat.className = "muted";
  const td = document.createElement("td");
  const sel = document.createElement("select");
  sel.dataset.kind = kind;
  for (const a of D.ACTIONS) {
    const o = document.createElement("option");
    o.value = a;
    o.textContent = a;
    o.selected = a === value;
    sel.append(o);
  }
  td.append(sel);
  tr.append(name, cat, td);
  return tr;
}

function render(s, c) {
  $("enabled").checked = s.enabled !== false;
  $("emailThreshold").value = s.emailThreshold;
  $("minRows").value = s.minRows;
  $("detectors").replaceChildren(...D.DETECTORS.map((k) => row(k, D.actionFor(k, s.policy))));
  $("url").value = c.url || "";
  $("token").value = c.token || "";
  $("label").value = c.label || "";
  $("deviceId").value = c.deviceId || "";
}

function showSync(sync) {
  const el = $("syncStatus");
  if (!sync) {
    el.textContent = "";
    return;
  }
  el.className = sync.ok ? "ok" : "err";
  el.textContent = `${sync.ok ? "Last sync OK" : "Last sync failed: " + sync.error} (${sync.at || ""})`;
}

async function load() {
  const { settings, collector, sync } = await chrome.storage.local.get(["settings", "collector", "sync"]);
  const s = settings || {};
  render({ ...DEFAULTS, ...s, policy: { ...DEFAULTS.policy, ...(s.policy || {}) } }, collector || {});
  showSync(sync);
}

function clamp(v, lo, hi, d) {
  const n = Math.round(+v);
  return Number.isFinite(n) && n >= lo ? Math.min(n, hi) : d;
}

async function save() {
  const policy = {};
  for (const sel of document.querySelectorAll("select[data-kind]")) policy[sel.dataset.kind] = sel.value;
  const settings = {
    enabled: $("enabled").checked,
    policy,
    emailThreshold: clamp($("emailThreshold").value, 2, 1000, 5),
    minRows: clamp($("minRows").value, 3, 10000, 10),
  };
  const url = $("url").value.trim();
  if (url && !/^https?:\/\/[^\s/]+/.test(url)) {
    $("saved").className = "err";
    $("saved").textContent = "Collector URL must start with http:// or https://";
    return false;
  }
  const collector = {
    url,
    token: $("token").value.trim(),
    label: $("label").value.trim().replace(/[^A-Za-z0-9 _.@-]/g, "").slice(0, 64),
    deviceId: $("deviceId").value.trim(),
  };
  await chrome.storage.local.set({ settings, collector });
  $("saved").className = "ok";
  $("saved").textContent = "Saved.";
  setTimeout(() => ($("saved").textContent = ""), 2500);
  return true;
}

$("save").addEventListener("click", save);
$("reset").addEventListener("click", () => {
  $("detectors").replaceChildren(...D.DETECTORS.map((k) => row(k, D.DEFAULT_POLICY[k])));
});
$("test").addEventListener("click", async () => {
  if (!(await save())) return;
  $("syncStatus").textContent = "Sending...";
  const r = await chrome.runtime.sendMessage({ type: "flush" });
  showSync({ ...r, at: new Date().toISOString() });
});
load();
