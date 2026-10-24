/* aiwarden content script: inspects what is about to be sent to an AI chat site, before it is sent.
 *
 * Privacy: text is scanned in this tab and never leaves it. Only metadata (site, detector kinds and
 * counts, action, the user's decision, time) goes to the background worker.
 *
 * Fail open: every handler is wrapped so that a bug or a site markup change never stops the user.
 */
(function () {
  "use strict";
  if (window.__aiwardenLoaded) return;
  window.__aiwardenLoaded = true;

  const D = globalThis.AIWardenDetect;
  const S = globalThis.AIWardenSites;
  if (!D || !S) return;

  const HOST = String(location.hostname || "localhost").toLowerCase();
  const adapter = S.forHost(HOST);
  let settings = { policy: {}, emailThreshold: 5, minRows: 10, enabled: true };
  let bypass = null; // {hash, until}: one-shot pass for the exact text the user chose to send anyway
  let replaying = false; // set while we re-dispatch a held paste/drop/file event
  let modalOpen = false;

  function loadSettings() {
    try {
      chrome.storage.local.get("settings", (r) => {
        if (r && r.settings) settings = Object.assign(settings, r.settings);
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.settings) settings = Object.assign({}, settings, changes.settings.newValue || {});
      });
    } catch (e) { /* defaults apply */ }
  }

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch (e) { /* extension reloaded or unavailable: nothing to do */ }
  }

  function record(channel, findings, action, decision, file) {
    const detectors = {};
    for (const f of findings) detectors[f.kind] = (detectors[f.kind] || 0) + f.count;
    const ev = {
      event_id: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, ""),
      ts: new Date().toISOString(), site: HOST, channel, action, decision, detectors,
    };
    if (file) {
      ev.file_ext = file.ext;
      ev.file_size = file.size;
      ev.file_inspected = file.inspected;
    }
    send({ type: "event", event: ev });
  }

  // ---------- DOM helpers ----------

  function safeClosest(node, selectors) {
    if (!node || !node.closest) return null;
    for (const sel of selectors) {
      try {
        const m = node.closest(sel);
        if (m) return m;
      } catch (e) { /* invalid selector on this browser */ }
    }
    return null;
  }

  function visible(el) {
    return !!(el && el.isConnected && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function queryAll(scope, selectors, ok) {
    const out = [];
    for (const sel of selectors) {
      try {
        for (const el of scope.querySelectorAll(sel)) if (ok(el) && !out.includes(el)) out.push(el);
      } catch (e) { /* invalid selector on this browser */ }
    }
    return out;
  }

  // Walks up from `from` and returns the nearest match: in the smallest ancestor that has any candidate,
  // the one closest in document order on the preferred side (send buttons follow the composer; the
  // composer precedes its send button). Pages with several composers then pair each with its own button.
  function nearest(from, selectors, ok, after) {
    for (let scope = from && from.parentElement; scope; scope = scope.parentElement) {
      const c = queryAll(scope, selectors, ok).filter((el) => el !== from && !el.contains(from) && !from.contains(el));
      if (!c.length) continue;
      c.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      const follows = (el) => !!(from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (after) return c.find(follows) || c[0];
      const before = c.filter((el) => !follows(el));
      return before.length ? before[before.length - 1] : c[0];
    }
    return null;
  }

  function findComposer(near) {
    return safeClosest(near, adapter.composer) || nearest(near, adapter.composer, visible, false);
  }

  function findSendButton(composer) {
    return nearest(composer, adapter.send, (el) => visible(el) && !el.disabled, true);
  }

  function textOf(el) {
    if (!el) return "";
    if ("value" in el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return el.value || "";
    // innerText keeps the line breaks between <p> blocks (ProseMirror), which textContent would drop.
    return el.innerText || el.textContent || "";
  }

  function isEditable(el) {
    return !!(el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(?:text|search|)$/i.test(el.type)) || el.isContentEditable));
  }

  // ---------- UI (closed shadow root, built with textContent only) ----------

  const CSS = `
:host{all:initial}
.wrap{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(15,15,14,.45);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
.card{background:#fff;color:#1d1d1b;max-width:460px;width:calc(100% - 32px);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.3);padding:18px 20px;border-top:5px solid #c27a12}
.card.block{border-top-color:#c62f2f}
h2{font-size:16px;margin:0 0 8px}
ul{margin:8px 0 10px;padding-left:20px}li{margin:2px 0}
p{margin:6px 0;color:#4a4a46}.small{font-size:12px;color:#6b6b66}
.row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
button{font:inherit;padding:7px 14px;border-radius:6px;border:1px solid #d6d5cf;background:#fff;color:#1d1d1b;cursor:pointer}
button.primary{background:#1d1d1b;color:#fff;border-color:#1d1d1b}button.danger{background:#fff;color:#c62f2f;border-color:#c62f2f}
.toast{position:fixed;top:16px;right:16px;z-index:2147483647;max-width:380px;background:#1d1d1b;color:#fff;border-radius:8px;padding:10px 14px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);border-left:5px solid #c27a12}
.toast.block{border-left-color:#c62f2f}
@media (prefers-color-scheme:dark){.card{background:#1d1d1b;color:#ecebe6}p{color:#c9c8c2}.small{color:#9a9993}button{background:#2a2926;color:#ecebe6;border-color:#3a3936}button.primary{background:#ecebe6;color:#1d1d1b}button.danger{background:#2a2926;color:#ff6b6b;border-color:#ff6b6b}}`;

  function mount() {
    const host = document.createElement("aiwarden-guard");
    const root = host.attachShadow({ mode: "closed" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch (e) { /* unstyled but functional */ }
    (document.body || document.documentElement).appendChild(host);
    return { host, root };
  }

  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function describe(findings) {
    return findings.map((f) => `${D.LABELS[f.kind] || f.kind}${f.count > 1 ? ` (${f.count})` : ""}`);
  }

  const VERB = { submit: "send this message", paste: "paste this", drop: "drop this", file: "attach this file" };

  /** Resolves "proceed" or "cancel". Block mode only offers a way back. */
  function showModal(action, findings, channel) {
    return new Promise((resolve) => {
      const { host, root } = mount();
      modalOpen = true;
      const wrap = h("div", "wrap");
      wrap.setAttribute("role", "dialog");
      wrap.setAttribute("aria-modal", "true");
      const card = h("div", "card" + (action === "block" ? " block" : ""));
      card.append(h("h2", null, action === "block" ? "Blocked: this contains sensitive data" : "This looks like sensitive data"));
      const ul = h("ul");
      for (const line of describe(findings)) ul.append(h("li", null, line));
      card.append(ul);
      card.append(h("p", null, action === "block"
        ? `Your organisation's policy does not allow you to ${VERB[channel] || "send this"} to ${adapter.name}. Remove the sensitive part and try again.`
        : `You are about to ${VERB[channel] || "send this"} to ${adapter.name}. Check that it is OK to share before continuing.`));
      card.append(h("p", "small", "Checked on this device by aiwarden. Nothing you typed was sent or stored."));
      const row = h("div", "row");
      const done = (v) => {
        modalOpen = false;
        document.removeEventListener("keydown", onKey, true);
        host.remove();
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopImmediatePropagation();
          done("cancel");
        }
      };
      document.addEventListener("keydown", onKey, true);
      if (action === "block") {
        const ok = h("button", "primary", "Go back and edit");
        ok.addEventListener("click", () => done("cancel"));
        row.append(ok);
        card.append(row);
        wrap.append(card);
        root.append(wrap);
        ok.focus();
      } else {
        const cancel = h("button", "primary", "Cancel");
        const go = h("button", "danger", channel === "submit" ? "Send anyway" : "Continue anyway");
        cancel.addEventListener("click", () => done("cancel"));
        go.addEventListener("click", () => done("proceed"));
        row.append(go, cancel);
        card.append(row);
        wrap.append(card);
        root.append(wrap);
        cancel.focus();
      }
    });
  }

  function toast(action, msg) {
    try {
      const { host, root } = mount();
      const t = h("div", "toast" + (action === "block" ? " block" : ""), msg);
      t.setAttribute("role", "status");
      root.append(t);
      setTimeout(() => host.remove(), 6000);
    } catch (e) { /* ignore */ }
  }

  function stop(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function scan(text) {
    return D.scanText(text, { emailThreshold: settings.emailThreshold, minRows: settings.minRows });
  }

  // ---------- submit (Enter / send button / form submit) ----------

  function consumeBypass(text) {
    // Valid for the same text until it expires: one send can surface as click + submit + keydown.
    if (bypass && Date.now() >= bypass.until) bypass = null;
    return !!(bypass && bypass.hash === D.textHash(text));
  }

  /** Returns true if the event was held (prevented). */
  function guardSubmit(e, composer, resend) {
    const text = textOf(composer);
    if (!text.trim() || consumeBypass(text)) return false;
    const findings = scan(text);
    if (!findings.length) return false;
    const { action } = D.decide(findings, settings.policy);
    if (action === "allow") {
      record("submit", findings, "allow", "allowed");
      return false;
    }
    stop(e);
    showModal(action, findings, "submit").then((choice) => {
      if (action === "block") return record("submit", findings, "block", "blocked");
      if (choice !== "proceed") return record("submit", findings, "warn", "cancelled");
      record("submit", findings, "warn", "sent_anyway");
      bypass = { hash: D.textHash(textOf(composer)), until: Date.now() + 10000 };
      if (!resend()) toast("warn", "Press Enter again to send. aiwarden will not ask again for this message.");
    });
    return true;
  }

  function onKeydown(e) {
    try {
      if (modalOpen) return;
      if (e.key !== "Enter" || e.shiftKey || e.altKey || e.isComposing || e.keyCode === 229) return;
      const composer = safeClosest(e.target, adapter.composer);
      if (!composer) return;
      guardSubmit(e, composer, () => {
        const btn = findSendButton(composer);
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
    } catch (err) { /* fail open */ }
  }

  function onClick(e) {
    try {
      if (modalOpen || e.button !== 0) return;
      const btn = safeClosest(e.target, adapter.send);
      if (!btn) return;
      const composer = findComposer(btn);
      if (!composer) return;
      guardSubmit(e, composer, () => {
        btn.click();
        return true;
      });
    } catch (err) { /* fail open */ }
  }

  function onSubmit(e) {
    try {
      if (modalOpen) return;
      const form = e.target;
      const composer = form && form.querySelector ? findComposer(form.querySelector(adapter.composer.join(",")) || form) : null;
      if (!composer || !form.contains(composer)) return;
      guardSubmit(e, composer, () => {
        if (form.requestSubmit) form.requestSubmit();
        else form.submit();
        return true;
      });
    } catch (err) { /* fail open */ }
  }

  // ---------- files ----------

  function readText(file) {
    return new Promise((resolve) => {
      try {
        const r = new FileReader();
        r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
        r.onerror = () => resolve(null);
        r.readAsText(file);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function checkFiles(files) {
    const results = [];
    for (const f of files) {
      const meta = { name: f.name, size: f.size, type: f.type };
      const text = D.isInspectable(meta) ? await readText(f) : null;
      const r = D.scanFile(meta, text, { emailThreshold: settings.emailThreshold, minRows: settings.minRows });
      results.push({ findings: r.findings, file: { ext: r.ext, size: r.size, inspected: r.inspected } });
    }
    return results;
  }

  /** Paste/drop/file attach: findings from text and files, decision, and the user's choice. */
  async function evaluate(channel, text, files) {
    let findings = text ? scan(text) : [];
    let file = null;
    if (files && files.length) {
      const rs = await checkFiles(files);
      for (const r of rs) findings = findings.concat(r.findings);
      file = rs[0].file;
      if (rs.length > 1) file = { ext: rs[0].file.ext, size: rs.reduce((a, r) => a + r.file.size, 0), inspected: rs.every((r) => r.file.inspected) };
    }
    if (!findings.length) return true;
    const { action } = D.decide(findings, settings.policy);
    if (action === "allow") {
      record(channel, findings, "allow", "allowed", file);
      return true;
    }
    const choice = await showModal(action, findings, channel);
    if (action === "block") {
      record(channel, findings, "block", "blocked", file);
      return false;
    }
    record(channel, findings, "warn", choice === "proceed" ? "sent_anyway" : "cancelled", file);
    return choice === "proceed";
  }

  function needsAsync(files) {
    return Array.from(files || []).some((f) => D.isInspectable({ name: f.name, size: f.size, type: f.type }) ||
      D.scanFile({ name: f.name, size: f.size }, null).findings.length);
  }

  function cloneTransfer(dt) {
    const out = new DataTransfer();
    for (const type of ["text/plain", "text/html"]) {
      const v = dt.getData(type);
      if (v) out.setData(type, v);
    }
    for (const f of dt.files) out.items.add(f);
    return out;
  }

  function insertText(target, text) {
    target.focus();
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      const s = target.selectionStart ?? target.value.length;
      const en = target.selectionEnd ?? s;
      target.setRangeText(text, s, en, "end");
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text }));
    } else {
      document.execCommand("insertText", false, text);
    }
  }

  // Paste and drop are decided synchronously when we can (text only, or files that need no reading).
  // Otherwise the event is held, files are read locally, and an allowed event is replayed.
  function onTransfer(e) {
    try {
      if (replaying || modalOpen) return;
      const dt = e.type === "paste" ? e.clipboardData : e.dataTransfer;
      if (!dt) return;
      const target = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
      const editable = safeClosest(target, adapter.composer) || (isEditable(target) ? target : null);
      if (!editable && !(dt.files && dt.files.length)) return;
      const channel = e.type === "paste" ? "paste" : "drop";
      const text = dt.getData("text/plain") || "";
      const files = Array.from(dt.files || []);
      const textFindings = text ? scan(text) : [];
      if (!textFindings.length && !needsAsync(files)) return;
      const saved = cloneTransfer(dt);
      stop(e);
      evaluate(channel, text, files).then((ok) => {
        if (!ok) return;
        replaying = true;
        try {
          const evt = channel === "paste"
            ? new ClipboardEvent("paste", { clipboardData: saved, bubbles: true, cancelable: true })
            : new DragEvent("drop", { dataTransfer: saved, bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY });
          const handled = !(e.target.dispatchEvent(evt)); // a page handler called preventDefault => it consumed it
          if (!handled && channel === "paste" && text && editable) insertText(editable, text);
        } finally {
          replaying = false;
        }
      });
    } catch (err) { /* fail open */ }
  }

  const pendingInputs = new WeakSet();

  function onFileInput(e) {
    try {
      const input = e.target;
      if (replaying || !input || input.tagName !== "INPUT" || input.type !== "file") return;
      const files = Array.from(input.files || []);
      if (!files.length) return;
      if (pendingInputs.has(input)) return stop(e); // the paired input/change event of a held selection
      if (!needsAsync(files)) return;
      stop(e);
      pendingInputs.add(input);
      evaluate("file", "", files).then((ok) => {
        pendingInputs.delete(input);
        if (!ok) {
          try { input.value = ""; } catch (x) { /* ignore */ }
          return;
        }
        replaying = true;
        try {
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        } finally {
          replaying = false;
        }
      });
    } catch (err) { /* fail open */ }
  }

  // ---------- site usage (time on site, metadata only) ----------

  const BEAT = 15;
  function startUsage() {
    send({ type: "visit", site: HOST });
    setInterval(() => {
      try {
        if (document.visibilityState === "visible" && document.hasFocus()) send({ type: "heartbeat", site: HOST, seconds: BEAT });
      } catch (e) { /* ignore */ }
    }, BEAT * 1000);
  }

  loadSettings();
  // Capture phase on window: we see the event before any handler the page attached to the composer.
  window.addEventListener("keydown", (e) => settings.enabled !== false && onKeydown(e), true);
  window.addEventListener("click", (e) => settings.enabled !== false && onClick(e), true);
  window.addEventListener("submit", (e) => settings.enabled !== false && onSubmit(e), true);
  window.addEventListener("paste", (e) => settings.enabled !== false && onTransfer(e), true);
  window.addEventListener("drop", (e) => settings.enabled !== false && onTransfer(e), true);
  window.addEventListener("input", (e) => settings.enabled !== false && onFileInput(e), true);
  window.addEventListener("change", (e) => settings.enabled !== false && onFileInput(e), true);
  startUsage();

  // Exposed for the local test harness only (extension/test/e2e); holds no content.
  window.__aiwarden = { adapter: adapter.id, host: HOST };
})();
