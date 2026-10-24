// Fills an official portal in a real Chrome window from the answers prepared in the app.
//
// Each tick it reads the page, works out what to fill (src/autofill/match.ts), types it in, and moves on
// with the page's own Next/Continue button. It hands over to the user, and waits, for anything that is
// theirs to do: CAPTCHAs, signing in, fields the app has no answer for, the declaration, and payment.
// It presses Submit only when the run allows it and the user has ticked the declaration themselves.
// It only reads and types on the portal's own hosts.

import type { BrowserContext, Dialog, Page } from 'playwright-core';
import { classifyButton, isDeclaration, planPage, type Fill, type FillItem, type PageField, type PlanOptions } from '../../src/autofill/match';
import { hostAllowed } from '../../src/autofill/portals';

export type WaitReason = 'captcha' | 'login' | 'needs_you' | 'declaration' | 'submit' | 'payment' | 'other_site' | 'stuck' | 'nothing_to_do';
export type RunState = 'idle' | 'starting' | 'running' | 'waiting' | 'submitted' | 'stopped' | 'error';

export interface RunStatus {
  state: RunState;
  waitingFor?: WaitReason;
  message: string;
  url: string;
  /** What was filled, by answer id and label. The answers themselves stay out of the status. */
  filled: Array<{ itemId: string; label: string }>;
  needsYou: string[];
  captured: { serial?: string; pin?: string; reference?: string };
  log: Array<{ at: string; text: string }>;
}

export interface StartRequest {
  startUrl: string;
  hosts: string[];
  items: FillItem[];
  options: PlanOptions;
  allowSubmit: boolean;
}

export interface RunnerDeps {
  launch: () => Promise<BrowserContext>;
  pollMs?: number;
  /** How long the page must stay unchanged before the runner presses a button. */
  settleMs?: number;
  /** The same, after the user has typed on the page, so a half-typed answer is not sent on. */
  humanSettleMs?: number;
}

interface Snapshot {
  fields: PageField[];
  buttons: Array<{ key: string; text: string }>;
  text: string;
  errors: string[];
  /** Random per document, so a form that posts back to the same address counts as a new page. */
  doc: string;
}

// Runs in the page. Kept as plain JavaScript text so the bundler cannot add helpers the page lacks.
// Inside an open modal dialog only the dialog is read.
const COLLECT_JS = String.raw`(() => {
  let n = Number(document.body.dataset.vnSeq || 0);
  if (!document.body.dataset.vnDoc) document.body.dataset.vnDoc = Math.random().toString(36).slice(2);
  const keyOf = (el) => { if (!el.dataset.vnKey) el.dataset.vnKey = 'vn' + (++n); return el.dataset.vnKey; };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const text = (el) => (el ? clean(el.innerText || el.textContent) : '');
  const visible = (el) => {
    if (el.classList.contains('select2-hidden-accessible')) { const c = el.nextElementSibling; return !!(c && c.getClientRects().length); }
    const st = getComputedStyle(el);
    return el.getClientRects().length > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const ownText = (lab) => { const c = lab.cloneNode(true); c.querySelectorAll('input, select, textarea, .visually-hidden, .sr-only').forEach((x) => x.remove()); return clean(c.textContent); };
  const modal = [...document.querySelectorAll('.modal.show, dialog[open], [role=dialog][aria-modal=true]')].find(visible);
  const root = modal || document;
  const labelOf = (el) => {
    if (el.labels && el.labels.length) return ownText(el.labels[0]);
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return clean(lb.split(/\s+/).map((id) => text(document.getElementById(id))).join(' '));
    for (const k of [el.name, el.id]) if (k) { const l = document.querySelector('label[for="' + CSS.escape(k) + '" i]'); if (l) return ownText(l); }
    const g = el.closest('.form-group, .govuk-form-group, .field, .form-row');
    if (g) { const l = g.querySelector('label, .control-label, legend'); if (l && !l.contains(el)) return ownText(l); }
    return '';
  };
  const legendOf = (el) => { const fs = el.closest('fieldset'); const lg = fs && fs.querySelector('legend'); return lg ? text(lg) : ''; };
  const required = (el) => el.required || el.getAttribute('aria-required') === 'true' || el.hasAttribute('data-val-required') || !!el.closest('.required');
  const fields = [];
  const radios = new Map();
  for (const el of root.querySelectorAll('input, select, textarea')) {
    const type = (el.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type) || el.disabled || !visible(el)) continue;
    if (type === 'radio') { if (!radios.has(el.name)) radios.set(el.name, []); radios.get(el.name).push(el); continue; }
    const kind = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : ['email', 'tel', 'number', 'date', 'checkbox', 'password', 'file'].includes(type) ? type : 'text';
    let label = labelOf(el);
    if (/^(day|month|year)$/i.test(label)) label = legendOf(el) + ' ' + label;
    fields.push({
      key: keyOf(el), kind, label, name: el.name || '', elId: el.id || '', placeholder: el.placeholder || '',
      options: kind === 'select' ? [...el.options].map((o) => clean(o.label || o.text)) : [],
      required: required(el), value: kind === 'checkbox' ? '' : (el.value || ''), checked: kind === 'checkbox' ? el.checked : undefined,
    });
  }
  for (const [name, els] of radios) {
    const first = els[0];
    // The nearest question group, not a section fieldset further out.
    const g = first.closest('.form-group, .govuk-form-group, .field, [role=radiogroup], fieldset');
    const l = g && g.querySelector('legend, .control-label, .govuk-fieldset__legend');
    const label = l ? text(l) : legendOf(first);
    const optLabel = (r) => (r.labels && r.labels[0] ? ownText(r.labels[0]) : r.value);
    const on = els.find((r) => r.checked);
    fields.push({ key: keyOf(first), kind: 'radio', label, name, elId: '', placeholder: '', options: els.map(optLabel), required: els.some(required), value: on ? optLabel(on) : '' });
  }
  const buttons = [...root.querySelectorAll('button, input[type=submit], input[type=button], a.btn, a.govuk-button, [role=button]')]
    .filter((b) => visible(b) && !b.disabled)
    .map((b) => ({ key: keyOf(b), text: clean(b.tagName === 'INPUT' ? b.value : text(b)) || clean(b.getAttribute('aria-label')) }));
  const errors = [...document.querySelectorAll('.invalid-feedback, .field-validation-error, .govuk-error-summary, .govuk-error-message, .error-message, [role=alert]')]
    .filter(visible).map(text).filter(Boolean).slice(0, 8);
  document.body.dataset.vnSeq = String(n);
  return { fields, buttons, text: (document.body.innerText || '').slice(0, 20000), errors, doc: document.body.dataset.vnDoc };
})()`;

// Picks a radio by its label text; clicking it fires the page's own change handlers.
const PICK_RADIO_JS = (key: string, value: string) => String.raw`(() => {
  const first = document.querySelector('[data-vn-key="' + ${JSON.stringify(key)} + '"]');
  if (!first) return false;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const own = (l) => { const c = l.cloneNode(true); c.querySelectorAll('input').forEach((x) => x.remove()); return clean(c.textContent); };
  const r = [...document.querySelectorAll('input[type=radio]')].filter((x) => x.name === first.name).find((x) => (x.labels && x.labels[0] ? own(x.labels[0]) : x.value) === ${JSON.stringify(value)});
  if (!r) return false;
  r.click();
  return true;
})()`;

// Lets the page's scripts (validation, jQuery/select2) see a value the runner typed.
const NOTIFY_JS = (key: string) => String.raw`(() => {
  const el = document.querySelector('[data-vn-key="' + ${JSON.stringify(key)} + '"]');
  if (!el) return;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur'));
  if (window.jQuery) window.jQuery(el).trigger('change');
})()`;

const SET_VALUE_JS = (key: string, value: string) => String.raw`(() => {
  const el = document.querySelector('[data-vn-key="' + ${JSON.stringify(key)} + '"]');
  if (el) { el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); }
})()`;

/** Reads the request's serial number, PIN or application reference from the page text. */
export function captureReferences(text: string): RunStatus['captured'] {
  const out: RunStatus['captured'] = {};
  const serial = text.match(/serial (?:number|no\.?)\s*[:#]?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,})/i);
  if (serial) out.serial = serial[1];
  const pin = text.match(/\bPIN(?: code)?\s*[:#]?\s*((?=[A-Z0-9]*\d)[A-Z0-9]{3,12})\b/);
  if (pin) out.pin = pin[1];
  const ref = text.match(/\b(GWF\d{9})\b/) ?? text.match(/(?:application|reference) (?:reference|number)\s*[:#]?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{6,})/i);
  if (ref) out.reference = ref[1];
  return out;
}

const PAYMENT_TEXT = /\b(card number|cardholder|name on card|cvv|cvc)\b/i;

export class AutofillRunner {
  private st: RunStatus = AutofillRunner.blank();
  private context?: BrowserContext;
  private page?: Page;
  private active = false;
  private stopped = false;
  private done = new Set<string>();
  private lastFp = '';
  private lastChangeAt = 0;
  private humanTouched = false;
  private justFilled = false;
  /** Declaration boxes seen unticked, and the page on which the user then ticked one. */
  private seenUnticked = new Set<string>();
  private consentOn?: string;
  private lastClick?: { sig: string; at: number };
  private submittedOn?: string;
  private readonly pollMs: number;
  private readonly settleMs: number;
  private readonly humanSettleMs: number;

  constructor(private readonly deps: RunnerDeps) {
    this.pollMs = deps.pollMs ?? 700;
    this.settleMs = deps.settleMs ?? 1500;
    this.humanSettleMs = deps.humanSettleMs ?? 5000;
  }

  private static blank(): RunStatus {
    return { state: 'idle', message: '', url: '', filled: [], needsYou: [], captured: {}, log: [] };
  }

  status(): RunStatus {
    return structuredClone(this.st);
  }

  /** Starts a run. Throws when one is already going. */
  start(req: StartRequest): RunStatus {
    if (this.active) throw new Error('An autofill run is already going. Stop it first.');
    this.active = true;
    this.stopped = false;
    this.st = { ...AutofillRunner.blank(), state: 'starting', message: 'Opening the official form…', url: req.startUrl };
    this.done.clear();
    this.seenUnticked.clear();
    this.consentOn = undefined;
    this.humanTouched = false;
    this.justFilled = false;
    this.lastFp = '';
    this.lastClick = undefined;
    this.submittedOn = undefined;
    void this.run(req);
    return this.status();
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.stopped = true;
    this.active = false;
    this.set('stopped', undefined, 'Stopped. The browser window was closed.');
    await this.context?.close().catch(() => {});
    this.context = undefined;
    this.page = undefined;
  }

  private log(text: string): void {
    this.st.log.push({ at: new Date().toISOString(), text });
    if (this.st.log.length > 200) this.st.log.splice(0, this.st.log.length - 200);
  }

  private set(state: RunState, waitingFor: WaitReason | undefined, message: string): void {
    if (this.st.message !== message) this.log(message);
    this.st.state = state;
    this.st.waitingFor = waitingFor;
    this.st.message = message;
  }

  private async run(req: StartRequest): Promise<void> {
    try {
      const context = await this.deps.launch();
      if (this.stopped) return void (await context.close().catch(() => {}));
      this.context = context;
      context.on('page', (p) => this.watch(p));
      context.on('close', () => {
        if (this.active) {
          this.active = false;
          this.stopped = true;
          this.set('stopped', undefined, 'The browser window was closed.');
        }
      });
      const page = context.pages()[0] ?? (await context.newPage());
      this.watch(page);
      await page.goto(req.startUrl);
      this.set('running', undefined, 'Reading the form…');
      while (!this.stopped) {
        try {
          await this.tick(req);
        } catch (err) {
          // A read that overlaps a page load fails harmlessly; anything else goes to the log and the run carries on.
          const msg = err instanceof Error ? err.message : String(err);
          if (!this.stopped && !/context was destroyed|navigation|Target .* closed|frame was detached/i.test(msg)) this.log(`Problem: ${msg.split('\n')[0]}`);
        }
        await new Promise((r) => setTimeout(r, this.pollMs));
      }
    } catch (err) {
      if (this.stopped) return;
      this.active = false;
      this.set('error', undefined, `Could not run the browser: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      await this.context?.close().catch(() => {});
    }
  }

  private watch(page: Page): void {
    this.page = page;
    page.on('dialog', (d: Dialog) => {
      // A dialog right after the runner pressed a button belongs to that action; any other is declined.
      const ours = this.lastClick && Date.now() - this.lastClick.at < 5000;
      this.log(`Page dialog: ${d.message().slice(0, 120)}`);
      void (ours || d.type() === 'alert' ? d.accept() : d.dismiss()).catch(() => {});
    });
  }

  private currentPage(): Page | undefined {
    if (this.page && !this.page.isClosed()) return this.page;
    this.page = this.context?.pages().filter((p) => !p.isClosed()).at(-1);
    return this.page;
  }

  private async tick(req: StartRequest): Promise<void> {
    const page = this.currentPage();
    if (!page) return;
    const url = page.url();
    this.st.url = url;
    if (!hostAllowed(url, req.hosts)) {
      let host = url;
      try {
        host = new URL(url).hostname || url;
      } catch {
        // keep the raw url
      }
      return this.set('waiting', 'other_site', `Paused on ${host}, which is not the official form. Go back to the form and it carries on.`);
    }

    const snap = (await page.evaluate(COLLECT_JS)) as Snapshot;
    const pageId = `${url.split('#')[0]}#${snap.doc}`;
    for (const [k, v] of Object.entries(captureReferences(snap.text)) as Array<[keyof RunStatus['captured'], string]>) {
      if (!this.st.captured[k]) {
        this.st.captured[k] = v;
        this.log(`Saved ${k === 'pin' ? 'PIN' : k}: ${v}`);
      }
    }

    if (this.submittedOn) {
      if (pageId !== this.submittedOn || !snap.buttons.some((b) => classifyButton(b.text) === 'submit')) {
        return this.set('submitted', undefined, 'Submitted. Any serial number, PIN or reference shown is saved to the tracker.');
      }
      if (Date.now() - (this.lastClick?.at ?? 0) < 4000) return;
      this.submittedOn = undefined;
    }

    const plan = planPage(snap.fields, req.items, req.options);
    const todo = plan.fills.filter((f) => !this.done.has(`${pageId}|${f.key}`));
    for (const f of todo) {
      await this.fillOne(page, f);
      this.done.add(`${pageId}|${f.key}`);
      const label = req.items.find((i) => i.id === f.itemId)?.label ?? f.itemId;
      this.st.filled.push({ itemId: f.itemId, label });
      this.log(`Filled: ${label}`);
    }
    if (todo.length) {
      this.lastChangeAt = Date.now();
      this.justFilled = true;
      return this.set('running', undefined, `Filled ${todo.length} field${todo.length === 1 ? '' : 's'} on this page.`);
    }

    const fp = `${pageId}§${snap.fields.map((f) => `${f.key}=${f.value}${f.checked ? '+' : ''}`).join('|')}`;
    if (fp !== this.lastFp) {
      const samePage = this.lastFp.startsWith(`${pageId}§`);
      // A change on the same page that the runner did not make is the user typing.
      this.humanTouched = samePage ? this.humanTouched || !this.justFilled : false;
      this.justFilled = false;
      this.lastFp = fp;
      this.lastChangeAt = Date.now();
    }
    const settled = Date.now() - this.lastChangeAt >= (this.humanTouched ? this.humanSettleMs : this.settleMs);

    // The user's consent to submit is ticking a declaration box: one seen unticked, then ticked. The runner never ticks these.
    for (const f of snap.fields) {
      if (f.kind !== 'checkbox' || !isDeclaration(f.label)) continue;
      const k = `${pageId}|${f.key}`;
      if (!f.checked) this.seenUnticked.add(k);
      else if (this.seenUnticked.has(k)) this.consentOn = pageId;
    }
    const buttons = snap.buttons.map((b) => ({ ...b, role: classifyButton(b.text) }));
    this.st.needsYou = plan.needsYou.map((f) => f.label || f.name || 'Unlabelled field');

    if (plan.captchaOnPage) return this.set('waiting', 'captcha', 'Type the security code shown in the browser window, then press the button under it.');
    if (plan.loginOnPage) return this.set('waiting', 'login', 'Sign in, or enter the code you were sent, in the browser window. It carries on after that.');
    if (buttons.some((b) => b.role === 'payment') || PAYMENT_TEXT.test(snap.text)) {
      return this.set('waiting', 'payment', 'This is the payment step. Pay in the browser window yourself.');
    }
    if (plan.needsYou.length) {
      return this.set('waiting', 'needs_you', `Fill in what the app has no answer for: ${this.st.needsYou.join(', ')}. It carries on by itself after that.`);
    }
    if (plan.declarationPending) return this.set('waiting', 'declaration', 'Read the declaration in the browser window and tick it yourself.');
    if (!settled) return;

    const next = buttons.find((b) => b.role === 'next');
    // Submit only on a final page (no Next), and only after the user ticked the declaration there.
    const submit = next ? undefined : buttons.find((b) => b.role === 'submit');
    const target = next ?? submit;
    if (!target) {
      return this.set('waiting', 'nothing_to_do', 'Nothing more to fill on this page. Carry on in the browser window; it picks up again on the next page.');
    }
    if (submit && !(req.allowSubmit && this.consentOn === pageId)) {
      return this.set(
        'waiting',
        'submit',
        req.allowSubmit
          ? 'Everything is filled in. This page has no declaration box to tick, so read it and press Submit yourself.'
          : 'Everything is filled in. Check the answers in the browser window and press Submit yourself.',
      );
    }
    if (this.lastClick?.sig === fp) {
      if (Date.now() - this.lastClick.at < 3000) return;
      const why = snap.errors.length ? `The page says: ${snap.errors.join(' · ')}` : 'The page did not move on. Check the browser window for a message.';
      return this.set('waiting', 'stuck', why);
    }
    this.lastClick = { sig: fp, at: Date.now() };
    this.set('running', undefined, `Pressing “${target.text}”…`);
    if (submit) this.submittedOn = pageId;
    await page.locator(`[data-vn-key="${target.key}"]`).click({ timeout: 5000 });
  }

  private async fillOne(page: Page, f: Fill): Promise<void> {
    if (f.kind === 'radio') {
      await page.evaluate(PICK_RADIO_JS(f.key, f.value));
      return;
    }
    const loc = page.locator(`[data-vn-key="${f.key}"]`);
    if (f.kind === 'select') {
      await loc.selectOption({ label: f.value }, { force: true, timeout: 3000 });
    } else {
      try {
        await loc.fill(f.value, { timeout: 3000 });
      } catch {
        // Read-only boxes driven by a date picker: set the value directly.
        await page.evaluate(SET_VALUE_JS(f.key, f.value));
      }
    }
    await page.evaluate(NOTIFY_JS(f.key));
  }
}
