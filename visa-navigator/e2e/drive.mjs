// End-to-end drive of the running app (npm run dev) with headless Chrome.
// Usage: npm run e2e   (screenshots go to e2e/shots/)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.E2E_URL ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(import.meta.dirname, 'shots');
mkdirSync(OUT, { recursive: true });

// ---- MRZ builder (ICAO 9303 TD3) so each traveller gets a valid, distinct passport ----
const val = (c) => (c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55);
const cd = (s) => String([...s].reduce((sum, c, i) => sum + val(c) * [7, 3, 1][i % 3], 0) % 10);
const pad = (s, n) => (s + '<'.repeat(n)).slice(0, n);
function mrz({ nat, surname, given, num, dob, sex, exp }) {
  const l1 = pad(`P<${nat}${surname}<<${given.replace(/ /g, '<')}`, 44);
  const n = pad(num, 9);
  const personal = '<'.repeat(14);
  const body = `${n}${cd(n)}${nat}${dob}${cd(dob)}${sex}${exp}${cd(exp)}${personal}0`;
  const composite = body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43);
  return [l1, body + cd(composite)];
}

// Reminder trips already on the local server. Trips this run adds are removed at the end, so the shared schedule keeps only real data.
const schedulePath = `${URL}/api/reminders`;
const tripsBefore = new Set(
  (await fetch(schedulePath).then((r) => r.json())).reminders.map((r) => r.tripId),
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: 'light' });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
// Failed requests and HTTP errors are reported separately, so a missing asset or endpoint cannot pass unnoticed.
const badRequests = [];
page.on('response', (r) => r.status() >= 400 && badRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`));
page.on('requestfailed', (r) => badRequests.push(`failed ${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`));

const shot = async (name, full = true, settle = 600) => {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
};
const nav = (name) => page.getByRole('navigation', { name: 'Application sections' }).getByRole('button', { name, exact: true }).click();
const home = () => page.getByRole('button', { name: 'Visa Navigator' }).first().click();

async function pickCountry(label, text) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByPlaceholder('Search countries…').fill(text);
  await page.keyboard.press('Enter');
}

async function newApplication({ destination, passport, depart = '2026-12-01', ret = '2026-12-10', travellers = ['Anna'] }) {
  await home();
  const apply = page.getByRole('button', { name: `Apply for ${destination}` });
  await apply.click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await pickCountry('Passport country', passport);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Arrival date').fill(depart);
  await page.getByLabel('Departure date').fill(ret);
  await page.getByRole('button', { name: 'Continue' }).click();
  for (let i = 1; i < travellers.length; i++) await page.getByRole('button', { name: 'Add a traveller' }).click();
  for (let i = 0; i < travellers.length; i++) await page.getByLabel(i === 0 ? 'Lead traveller' : `Traveller ${i + 1}`, { exact: true }).fill(travellers[i]);
  await page.getByRole('button', { name: 'See what we need' }).click();
}

async function readPassport(lines, extra = {}) {
  await page.getByLabel('MRZ line 1').fill(lines[0]);
  await page.getByLabel('MRZ line 2').fill(lines[1]);
  await page.getByRole('button', { name: 'Fill fields from MRZ' }).click();
  for (const [label, value] of Object.entries(extra)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'I checked these against the passport: save' }).click();
}

const tinyPdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
);

try {
  // ---------- Vault ----------
  await page.goto(URL);
  await page.getByText('Create your private vault').waitFor();
  await shot('01-create-vault');
  await page.getByLabel('Passphrase', { exact: true }).fill('test-passphrase-1');
  await page.getByLabel('Confirm passphrase').fill('test-passphrase-1');
  await page.getByRole('button', { name: 'Create vault' }).click();
  await page.getByText('Your visa, handled').waitFor();
  await shot('02-home', true, 2500);

  // ---------- Scenario 1: India → Croatia, two travellers (full flow) ----------
  await newApplication({ destination: 'Croatia', passport: 'India', travellers: ['Anna', 'Ben'] });
  await page.getByText('Schengen short-stay visa (type C) for Croatia').waitFor();
  check('India→Croatia needs a Schengen visa', await page.getByText('€90 for ages 12 and over, €45 for children aged 6 to under 12').isVisible());
  await shot('03-croatia-result');
  await page.getByRole('button', { name: 'Start this application' }).click();
  await page.getByText('Your plan').waitFor();
  await page.waitForTimeout(1800);
  await shot('04-croatia-overview');

  await nav('Travellers & passports');
  await readPassport(mrz({ nat: 'IND', surname: 'SHARMA', given: 'ANNA', num: 'Z1234567', dob: '900115', sex: 'F', exp: '310101' }), { 'Issue date': '2021-01-02' });
  await readPassport(mrz({ nat: 'IND', surname: 'SHARMA', given: 'BEN', num: 'Z7654321', dob: '880620', sex: 'M', exp: '320505' }), { 'Issue date': '2022-05-06' });
  await page.getByText('Ben Sharma').first().waitFor();
  check('Both passports read and named from the MRZ', (await page.getByText('Passport checks passed').count()) === 2);
  await shot('05-travellers');

  await nav('Documents');
  const itemSection = (name) => page.getByRole('heading', { name, exact: true }).locator('xpath=ancestor::section[1]');
  const fundsSection = itemSection('Proof of funds: €70 per person per day');
  await fundsSection.locator('input[type=file]').setInputFiles({ name: 'statement.pdf', mimeType: 'application/pdf', buffer: tinyPdf });
  await fundsSection.getByLabel('Account holder').fill('ANNA SHARMA');
  await fundsSection.getByLabel('Currency (e.g. EUR)').fill('EUR');
  await fundsSection.getByLabel('Closing balance').fill('1500');
  await fundsSection.getByLabel('Statement end date').fill('2026-10-01');
  await fundsSection.getByRole('button', { name: 'Check details' }).click();
  // 10 days × 2 travellers × €70 = €1,400 → pass
  await fundsSection.getByText('Verified').waitFor();
  check('Funds verified against €70 × 10 days × 2 travellers', true);

  const insSection = itemSection('Travel medical insurance of at least €30,000');
  await insSection.locator('input[type=file]').first().setInputFiles({ name: 'policy.pdf', mimeType: 'application/pdf', buffer: tinyPdf });
  await insSection.getByLabel('Insured names (comma separated)').fill('Anna Sharma');
  await insSection.getByLabel('Medical cover amount').fill('20000');
  await insSection.getByLabel('Currency', { exact: true }).fill('EUR');
  await insSection.getByLabel('Policy start').fill('2026-12-01');
  await insSection.getByLabel('Policy end').fill('2026-12-10');
  await insSection.getByLabel('Territory (as worded)').fill('Schengen States');
  await insSection.getByRole('button', { name: 'Check details' }).click();
  await insSection.getByText('Problem found').waitFor();
  check('Insurance under €30,000 is flagged as a problem', true);
  await shot('06-documents');

  await nav('Application form');
  await page.getByRole('heading', { name: 'Application for Schengen visa' }).waitFor();
  await page.getByLabel(/^1\.Surname/).first().waitFor().catch(() => undefined);
  await page.getByRole('button', { name: /Anna Sharma/ }).click();
  await page.getByLabel('Email address').fill('anna@example.com');
  await page.getByLabel('Home address').fill('12 MG Road, Mumbai');
  await page.getByLabel('Inviting person, or name of hotel / accommodation').fill('Hotel Adriatic');
  await shot('07-form-all');
  await page.getByRole('button', { name: 'Ben Sharma' }).first().click();
  const hostForBen = await page.getByLabel('Inviting person, or name of hotel / accommodation').inputValue();
  check('Shared answer (hotel) carries over to the second traveller', hostForBen === 'Hotel Adriatic', hostForBen);
  await page.getByRole('button', { name: 'Fill-along' }).click();
  await page.getByRole('button', { name: 'Next field' }).click();
  await page.getByRole('button', { name: 'Next field' }).click();
  await shot('08-form-fill-along');

  await nav('Itinerary');
  await page.getByRole('button', { name: 'Add day' }).click();
  await page.getByLabel('City').fill('Zagreb');
  await page.getByLabel('Where you are staying').fill('Hotel Adriatic');
  await page.getByRole('button', { name: 'Build itinerary' }).click();
  check('Itinerary names both travellers', (await page.getByLabel('Itinerary text').inputValue()).includes('Anna Sharma and Ben Sharma'));

  await nav('Appointment & tracking');
  await page.getByLabel('Booking page').fill('https://example.org/book');
  await page.locator('#watch-on').click();
  await page.getByText('Next reminder').waitFor();
  check('Availability tracking schedules the next reminder', true);
  await shot('09-appointment');

  await nav('Reminders');
  await page.getByText('Synced to server').waitFor({ timeout: 10000 });
  check('Reminders synced to the local server', true);
  await shot('10-reminders');

  await nav('Review & export');
  await shot('11-review');
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: path.join(OUT, '12-print-packet.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });

  // ---------- Scenario 2: Canada → Croatia (no visa) ----------
  await newApplication({ destination: 'Croatia', passport: 'Canada' });
  await page.getByText('No visa needed for short stays').first().waitFor();
  check('Canada→Croatia is visa-free', true);
  await shot('13-canada-croatia');
  await page.getByRole('button', { name: 'Start this application' }).click();
  await page.getByText('Your plan').waitFor();

  // ---------- Scenario 3: Canada → UK (ETA) ----------
  await newApplication({ destination: 'United Kingdom', passport: 'Canada' });
  await page.getByText('Electronic Travel Authorisation (ETA)').first().waitFor();
  check('Canada→UK needs an ETA (£20)', await page.getByText('£20 (non-refundable)').isVisible());
  await page.getByRole('button', { name: 'Start this application' }).click();
  await page.getByText('Your plan').waitFor();

  // ---------- Scenario 4: India → UK (Standard Visitor) ----------
  await newApplication({ destination: 'United Kingdom', passport: 'India' });
  await page.getByText('Standard Visitor visa').first().waitFor();
  check('India→UK needs a Standard Visitor visa (£135)', await page.getByText('£135 for up to 6 months').isVisible());
  await page.getByRole('button', { name: 'Start this application' }).click();
  await nav('Application form');
  await page.getByRole('heading', { name: 'Standard Visitor visa answers' }).waitFor();
  check('UK answers are labelled as common questions, not official', await page.getByText('not an official field list').isVisible());
  await home();
  await page.locator('.trip-card').nth(3).waitFor();
  check('Home lists all four applications', (await page.locator('.trip-card').count()) === 4);

  // ---------- Persistence: lock immediately after an edit, unlock ----------
  await page.locator('.trip-card').last().click();
  await nav('Appointment & tracking');
  await page.getByLabel('Application reference').fill('REF-LAST-SECOND');
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill('wrong-pass');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('alert').waitFor();
  check('Wrong passphrase is rejected', true);
  await page.getByLabel('Passphrase', { exact: true }).fill('test-passphrase-1');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.locator('.trip-card').nth(3).waitFor();
  await page.locator('.trip-card').last().click();
  await nav('Appointment & tracking');
  check('Edit made right before locking survives', (await page.getByLabel('Application reference').inputValue()) === 'REF-LAST-SECOND');

  // ---------- Dark mode and phone width ----------
  await page.emulateMedia({ colorScheme: 'dark' });
  await home();
  await shot('14-home-dark', true, 2500);
  await page.locator('.trip-card').first().click();
  await nav('Documents');
  await shot('15-documents-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 400, height: 860 });
  await home();
  await shot('16-home-400', true, 2500);
  await page.locator('.trip-card').first().click();
  await shot('17-workspace-400');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('No horizontal scrolling at 400px', !overflow);
} catch (err) {
  check('Driver ran to the end', false, err instanceof Error ? err.message.split('\n')[0] : String(err));
  await page.screenshot({ path: path.join(OUT, 'zz-failure.png'), fullPage: true }).catch(() => undefined);
} finally {
  check('No console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No failed requests or HTTP errors', badRequests.length === 0, badRequests.slice(0, 3).join(' | '));
  const created = await fetch(schedulePath)
    .then((r) => r.json())
    .then((f) => [...new Set(f.reminders.map((r) => r.tripId))].filter((id) => !tripsBefore.has(id)))
    .catch(() => []);
  // Runs in the page so the request carries the app's Origin; the guard also needs the JSON content type on DELETE.
  await page
    .evaluate(
      async (ids) => {
        for (const id of ids) await fetch(`/api/reminders/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
      },
      created,
    )
    .catch((err) => console.log(`Could not remove test reminders: ${err.message}`));
  console.log(`Removed ${created.length} reminder trip(s) this run created.`);
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
}
