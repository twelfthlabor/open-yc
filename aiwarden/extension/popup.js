"use strict";
const D = globalThis.AIWardenDetect;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function dur(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`;
}

function table(head, rows) {
  const t = el("table");
  const tr = el("tr");
  for (const x of head) tr.append(el("th", null, x));
  t.append(tr);
  for (const r of rows) {
    const row = el("tr");
    for (const c of r) {
      const td = el("td");
      td.append(c instanceof Node ? c : document.createTextNode(String(c)));
      row.append(td);
    }
    t.append(row);
  }
  return t;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function render() {
  const { usage = {}, events = [], sync } = await chrome.storage.local.get(["usage", "events", "sync"]);
  const sites = Object.entries(usage[today()] || {}).sort((a, b) => b[1].seconds - a[1].seconds);
  document.getElementById("sites").replaceChildren(sites.length
    ? table(["Site", "Time", "Visits"], sites.map(([s, u]) => [s, dur(u.seconds), u.visits]))
    : el("p", "muted", "None yet today."));
  const recent = events.slice(-15).reverse();
  document.getElementById("events").replaceChildren(recent.length
    ? table(["When", "Site", "Detected", "Result"], recent.map((e) => {
      const chips = el("span");
      for (const [k, n] of Object.entries(e.detectors || {})) chips.append(el("span", "chip", `${D.LABELS[k] || k}${n > 1 ? " x" + n : ""}`));
      const res = el("span");
      res.append(el("span", "tag " + e.action, e.action), document.createTextNode(" " + String(e.decision).replace("_", " ")));
      const when = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return [when, e.site + (e.channel !== "submit" ? ` (${e.channel})` : ""), chips, res];
    }))
    : el("p", "muted", "No sensitive data seen."));
  document.getElementById("sync").textContent = sync
    ? (sync.ok ? `Collector: synced ${sync.at}` : `Collector: ${sync.error}`)
    : "Collector: not configured";
  try { chrome.action.setBadgeText({ text: "" }); } catch (e) { /* ignore */ }
}

document.getElementById("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
render();
