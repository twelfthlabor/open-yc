// Drives the runner against local copies of the portal pages (fixtures/), in headless Chrome.
// The test plays the user: it types the CAPTCHA, fills a field the app has no answer for, and ticks the declaration.
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FillItem } from '../../src/autofill/match';
import { AutofillRunner, type RunStatus } from './runner';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FIXTURES = path.join(import.meta.dirname, 'fixtures');

const items: FillItem[] = [
  { id: 'purpose', label: 'Purpose of the journey', number: '23', value: 'Tourism' },
  { id: 'surname', label: 'Surname (family name)', number: '1', value: 'SILVA' },
  { id: 'surname_at_birth', label: 'Surname at birth (former family names)', number: '2', value: '' },
  { id: 'given_names', label: 'First name(s) (given names)', number: '3', value: 'MARTA' },
  { id: 'birth_date', label: 'Date of birth', number: '4', value: '1998-03-07', type: 'date' },
  { id: 'nationality', label: 'Current nationality', number: '7', value: 'Canada' },
  { id: 'sex', label: 'Sex', number: '8', value: 'Male', type: 'select' },
];

let server: Server;
let base: string;
let context: BrowserContext | undefined;
let runner: AutofillRunner | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    const name = path.basename(new URL(req.url ?? '/', 'http://x').pathname);
    // The wizard posts back to its own address and gets the next step, like an ASP.NET form.
    const file = path.join(FIXTURES, name === 'wizard' ? (req.method === 'POST' ? 'wizard-step2.html' : 'wizard-step1.html') : name);
    if (!existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

afterEach(async () => {
  await runner?.stop();
  await context?.close().catch(() => {});
  runner = undefined;
  context = undefined;
});

function makeRunner(): AutofillRunner {
  return new AutofillRunner({
    launch: async () => {
      context = await chromium.launchPersistentContext('', { executablePath: CHROME, headless: true });
      return context;
    },
    pollMs: 100,
    settleMs: 300,
    humanSettleMs: 800,
  });
}

async function until(r: AutofillRunner, test: (s: RunStatus) => boolean, what: string, ms = 15_000): Promise<RunStatus> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = r.status();
    if (test(s)) return s;
    if (s.state === 'error') throw new Error(`runner error: ${s.message}`);
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`timed out waiting for ${what}; last status: ${JSON.stringify(r.status())}`);
}

const page = (): Page => context!.pages()[0];

describe.skipIf(!existsSync(CHROME))('autofill runner', { timeout: 30_000 }, () => {
  it('fills every page, waits for the user at the CAPTCHA, unknown fields and declaration, then submits', async () => {
    runner = makeRunner();
    runner.start({ startUrl: `${base}/start.html`, hosts: ['127.0.0.1'], items, options: { dateFormat: 'dd.mm.yyyy', hints: { purpose: 'purpose' } }, allowSubmit: true });

    // Page 1: purpose is selected, the CAPTCHA is left for the user.
    let s = await until(runner, (x) => x.waitingFor === 'captcha', 'captcha wait');
    expect(await page().locator('#purpose').inputValue()).toBe('6');
    expect(await page().locator('#captchaCode').inputValue()).toBe('');
    expect(s.filled.map((f) => f.itemId)).toEqual(['purpose']);
    await page().fill('#captchaCode', 'X7Y2Q');
    await page().click('text=Create New Request');

    // Page 2: everything the app knows is filled; it waits on the one field it has no answer for.
    s = await until(runner, (x) => x.waitingFor === 'needs_you', 'needs_you wait');
    expect(s.needsYou).toEqual(['Favourite colour']);
    const p = page();
    expect(await p.locator('#Surname').inputValue()).toBe('SILVA');
    expect(await p.locator('#SurnameAtBirth').inputValue()).toBe('');
    expect(await p.locator('#FirstName').inputValue()).toBe('MARTA');
    expect(await p.locator('#DateOfBirth').inputValue()).toBe('07.03.1998');
    expect(await p.locator('#Nationality').inputValue()).toBe('CAN');
    expect(await p.locator('input[name=Sex][value=M]').isChecked()).toBe(true);
    await p.fill('#Colour', 'Blue');

    // Page 3: it moves on by itself, then waits for the user to tick the declaration and never ticks it.
    s = await until(runner, (x) => x.waitingFor === 'declaration', 'declaration wait');
    expect(page().url()).toContain('declaration.html');
    expect(await page().locator('#Declaration').isChecked()).toBe(false);
    await new Promise((r) => setTimeout(r, 600));
    expect(page().url()).toContain('declaration.html');
    await page().check('#Declaration');

    // With allowSubmit it presses Submit, then reads the serial number and PIN from the confirmation.
    s = await until(runner, (x) => x.state === 'submitted' && Boolean(x.captured.pin), 'submitted');
    expect(page().url()).toContain('done.html');
    expect(s.captured).toEqual({ serial: 'HR2026-004817', pin: '5821' });
    // The status reports what was filled, not the answers themselves.
    expect(JSON.stringify(s)).not.toContain('MARTA');
  });

  it('without allowSubmit it stops at Submit for the user to press', async () => {
    runner = makeRunner();
    runner.start({ startUrl: `${base}/declaration.html`, hosts: ['127.0.0.1'], items, options: {}, allowSubmit: false });
    await until(runner, (x) => x.waitingFor === 'declaration', 'declaration wait');
    await page().check('#Declaration');
    const s = await until(runner, (x) => x.waitingFor === 'submit', 'submit wait');
    expect(s.message).toMatch(/press submit/i);
    await new Promise((r) => setTimeout(r, 600));
    expect(page().url()).toContain('declaration.html');
  });

  it('pauses and touches nothing on a site that is not the portal', async () => {
    runner = makeRunner();
    runner.start({ startUrl: `${base}/details.html`, hosts: ['portal.example'], items, options: {}, allowSubmit: true });
    const s = await until(runner, (x) => x.waitingFor === 'other_site', 'other_site wait');
    expect(s.filled).toEqual([]);
    expect(await page().locator('#Surname').inputValue()).toBe('');
  });

  it('does not press Submit when there is no declaration box the user ticked', async () => {
    runner = makeRunner();
    runner.start({ startUrl: `${base}/submit-only.html`, hosts: ['127.0.0.1'], items, options: {}, allowSubmit: true });
    const s = await until(runner, (x) => x.waitingFor === 'submit', 'submit wait');
    expect(s.message).toMatch(/press submit/i);
    await new Promise((r) => setTimeout(r, 800));
    expect(page().url()).toContain('submit-only.html');
  });

  it('prefers Next over Submit when a page has both', async () => {
    runner = makeRunner();
    runner.start({ startUrl: `${base}/next-and-submit.html`, hosts: ['127.0.0.1'], items, options: {}, allowSubmit: true });
    await until(runner, (x) => x.waitingFor === 'submit' && x.url.includes('submit-only.html'), 'next page');
    expect(page().url()).not.toContain('done.html');
  });

  it('fills the next step of a form that posts back to the same address', async () => {
    runner = makeRunner();
    runner.start({ startUrl: `${base}/wizard`, hosts: ['127.0.0.1'], items, options: {}, allowSubmit: false });
    const s = await until(runner, (x) => x.waitingFor === 'needs_you', 'step 2');
    expect(s.filled.map((f) => f.itemId)).toEqual(['surname', 'given_names']);
    expect(await page().locator('#FirstName').inputValue()).toBe('MARTA');
  });

  it('waits longer before moving on after the user has typed', async () => {
    runner = makeRunner();
    runner.start({ startUrl: `${base}/wizard`, hosts: ['127.0.0.1'], items, options: {}, allowSubmit: false });
    await until(runner, (x) => x.waitingFor === 'needs_you', 'step 2');
    await page().fill('#Colour', 'Bl');
    await new Promise((r) => setTimeout(r, 450));
    expect(await page().locator('#Colour').inputValue()).toBe('Bl');
    expect(await page().locator('#FirstName').count()).toBe(1);
  });

  it('refuses a second run while one is going', async () => {
    runner = makeRunner();
    runner.start({ startUrl: `${base}/start.html`, hosts: ['127.0.0.1'], items, options: {}, allowSubmit: false });
    expect(() => runner!.start({ startUrl: `${base}/start.html`, hosts: ['127.0.0.1'], items, options: {}, allowSubmit: false })).toThrow(/already/i);
  });
});
