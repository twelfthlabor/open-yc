// End-to-end drive of one Sweden tourist-visa application (npm run dev must be running), in headless Chrome:
// trip → checklist → documents → form → itinerary → cover letter → booking → expert review → packet export.
// Runs without an API key (manual mode); with one, the AI buttons appear but are not pressed, so no paid call is made.
// Usage: npm run e2e:sweden   (screenshots in e2e/shots/sweden, or E2E_SHOTS=<dir>)
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.E2E_URL ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.E2E_SHOTS ?? path.join(import.meta.dirname, 'shots', 'sweden');
mkdirSync(OUT, { recursive: true });

const val = (c) => (c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55);
const cd = (s) => String([...s].reduce((sum, c, i) => sum + val(c) * [7, 3, 1][i % 3], 0) % 10);
const pad = (s, n) => (s + '<'.repeat(n)).slice(0, n);
function mrz({ nat, surname, given, num, dob, sex, exp }) {
  const l1 = pad(`P<${nat}${surname}<<${given.replace(/ /g, '<')}`, 44);
  const n = pad(num, 9);
  const body = `${n}${cd(n)}${nat}${dob}${cd(dob)}${sex}${exp}${cd(exp)}${'<'.repeat(14)}0`;
  const composite = body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43);
  return [l1, body + cd(composite)];
}

const tripsBefore = new Set((await fetch(`${URL}/api/reminders`).then((r) => r.json())).reminders.map((r) => r.tripId));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: 'light', acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const shot = async (name, settle = 600) => {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};
const nav = (name) => page.getByRole('navigation', { name: 'Application sections' }).getByRole('button', { name, exact: true }).click();
const tinyPdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

try {
  await page.goto(URL);
  await page.getByLabel('Passphrase', { exact: true }).fill('sweden-e2e-pass');
  await page.getByLabel('Confirm passphrase').fill('sweden-e2e-pass');
  await page.getByRole('button', { name: 'Create vault' }).click();
  await page.getByText('Your visa, handled').waitFor();
  check('Home offers Sweden', await page.getByRole('button', { name: 'Apply for Sweden' }).isVisible());
  await shot('01-home', 2000);

  // ---- Trip ----
  await page.getByRole('button', { name: 'Apply for Sweden' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('combobox', { name: 'Passport country' }).click();
  await page.getByPlaceholder('Search countries…').fill('Egypt');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Arrival date').fill('2026-12-01');
  await page.getByLabel('Departure date').fill('2026-12-05');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Lead traveller', { exact: true }).fill('Laila');
  await page.getByRole('button', { name: 'See what we need' }).click();
  await page.getByText('Schengen short-stay visa (type C) for Sweden').waitFor();
  check('Egypt→Sweden needs a Schengen visa, €90', await page.getByText('€90 for ages 12 and over, €45 for children aged 6 to under 12').first().isVisible());
  await shot('02-route');
  await page.getByRole('button', { name: 'Start this application' }).click();
  await page.getByText('Your plan').waitFor();

  // ---- Passport ----
  await nav('Travellers & passports');
  const [l1, l2] = mrz({ nat: 'EGY', surname: 'MANSOUR', given: 'LAILA', num: 'A9876543', dob: '920304', sex: 'F', exp: '320101' });
  await page.getByLabel('MRZ line 1').fill(l1);
  await page.getByLabel('MRZ line 2').fill(l2);
  await page.getByRole('button', { name: 'Fill fields from MRZ' }).click();
  await page.getByLabel('Issue date', { exact: true }).fill('2022-01-02');
  await page.getByRole('button', { name: 'I checked these against the passport: save' }).click();
  await page.getByText('Passport checks passed').waitFor();
  check('Passport read and checked from the MRZ', true);

  // ---- Checklist and documents ----
  await nav('Documents');
  await page.getByRole('heading', { name: 'Documents', exact: true }).waitFor();
  await page.waitForTimeout(400);
  const funds = page.getByRole('heading', { name: 'Proof of funds: SEK 700 per person per day', exact: true }).locator('xpath=ancestor::section[1]');
  check('Checklist shows the Swedish funds rule (SEK 700/day) with its source', (await funds.locator('a[href*="migrationsverket.se"]').count()) > 0);
  await funds.locator('input[type=file]').setInputFiles({ name: 'statement.pdf', mimeType: 'application/pdf', buffer: tinyPdf });
  await funds.getByLabel('Account holder').fill('LAILA MANSOUR');
  await funds.getByLabel('Currency (e.g. EUR)').fill('SEK');
  await funds.getByLabel('Closing balance').fill('3600');
  await funds.getByLabel('Statement end date').fill('2026-10-20');
  await funds.getByRole('button', { name: 'Check details' }).click();
  await funds.getByText('Verified').waitFor();
  check('Funds verified against SEK 700 × 5 days × 1 traveller', true);
  await shot('03-documents');

  // ---- Form: Sweden must not offer the Croatian portal ----
  await nav('Application form');
  await page.getByRole('heading', { name: 'Application for Schengen visa' }).waitFor();
  check('No CROVISA autofill on a Swedish application', (await page.getByText('Fill CROVISA for me').count()) === 0);
  for (const [label, value] of [
    ['Home address', '12 Example Street, Cairo'],
    ['Email address', 'laila@example.com'],
    ['Current occupation', 'Architect'],
    ['Inviting person, or name of hotel / accommodation', 'Hotel Gamla'],
  ]) await page.getByLabel(label).first().fill(value);
  await shot('04-form');

  // ---- Itinerary: day by day ----
  await nav('Itinerary');
  await page.getByRole('button', { name: 'Add flight' }).click();
  await page.getByLabel('From', { exact: true }).fill('CAI');
  await page.getByLabel('To', { exact: true }).fill('ARN');
  await page.getByLabel('Flight number').fill('XX100');
  await page.getByRole('button', { name: 'Add day' }).click();
  await page.getByLabel('City').fill('Stockholm');
  await page.getByLabel('Where you are staying').fill('Hotel Gamla');
  const issues = page.getByRole('list', { name: 'Itinerary issues' });
  check('Consistency check flags the missing return flight', await issues.getByText(/No flight on your departure date/).isVisible());
  await page.getByRole('button', { name: 'Add flight' }).click();
  await page.getByLabel('Flight date').last().fill('2026-12-05');
  await page.getByLabel('From', { exact: true }).last().fill('ARN');
  await page.getByLabel('To', { exact: true }).last().fill('CAI');
  await page.getByText('Every day and night is covered, and flights match the trip dates.').waitFor();
  check('Day-by-day plan has 5 rows and no issues once the return flight is added', (await page.getByRole('region', { name: 'Day-by-day plan' }).locator('tbody tr').count()) === 5);
  await page.getByRole('button', { name: 'Build itinerary' }).click();
  const itin = await page.getByLabel('Itinerary text').inputValue();
  check('Itinerary document lists every day', itin.includes('Day 1 (Tuesday, 1 December 2026): Stockholm') && itin.includes('Day 5 (Saturday, 5 December 2026)') && itin.includes('Overnight: Hotel Gamla'));
  await shot('05-itinerary');

  // ---- Cover letter ----
  await nav('Cover letter');
  await page.getByRole('button', { name: 'Draft from my answers' }).click();
  const letter = await page.getByLabel('Cover letter text').inputValue();
  check('Cover letter uses the trip facts', letter.includes('Laila Mansour') && letter.includes('1 December 2026') && letter.includes('Architect'));
  await shot('06-cover-letter');

  // ---- Booking ----
  await nav('Appointment & tracking');
  const booking = page.getByRole('region', { name: 'Booking steps' });
  const href = await booking.getByRole('link', { name: /Open booking site/ }).getAttribute('href');
  check('Booking opens VFS Global for Sweden, for applicants in Egypt', href === 'https://visa.vfsglobal.com/egy/en/swe', href ?? '');
  check('Booking assistant says the user books and pays', await booking.getByText(/You sign in, solve any security check/).isVisible());
  await shot('07-booking');

  // ---- Expert review and packet ----
  await nav('Expert review');
  await page.getByRole('heading', { name: 'Expert review', exact: true }).waitFor();
  await page.waitForTimeout(400);
  check('Expert review says it is not legal advice', await page.getByRole('note').getByText(/not legal advice/).isVisible());
  const rubric = page.getByRole('region', { name: 'Rubric' });
  check('Rubric lists what is missing (e.g. the photo)', await rubric.getByText(/Missing: Passport photo/).isVisible());
  await shot('08-expert-review');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download review packet' }).click()]);
  const file = path.join(OUT, 'review-packet.html');
  await download.saveAs(file);
  const html = readFileSync(file, 'utf8');
  check('Packet masks the passport number and email by default', !html.includes('A9876543') && !html.includes('laila@example.com') && html.includes('543'), `number:${html.includes('A9876543')} email:${html.includes('laila@example.com')} tail:${html.includes('543')}`);
  check('Packet holds rubric, sources, itinerary and cover letter', html.includes('Automatic pre-review') && html.includes('migrationsverket.se') && html.includes('Day 1 (Tuesday') && html.includes('To the visa officer'));
  // ---- US leg: DS-160 answers and interview booking steps ----
  await page.getByRole('button', { name: 'Visa Navigator' }).first().click();
  await page.getByRole('button', { name: 'Apply for United States' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('combobox', { name: 'Passport country' }).click();
  await page.getByPlaceholder('Search countries…').fill('Egypt');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Arrival date').fill('2027-03-01');
  await page.getByLabel('Departure date').fill('2027-03-10');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Lead traveller', { exact: true }).fill('Laila');
  await page.getByRole('button', { name: 'See what we need' }).click();
  await page.getByText('Visitor visa (B-1/B-2)').first().waitFor();
  check('Egypt→US needs a B-1/B-2 visa ($185)', await page.getByText('$185 per person').first().isVisible());
  await page.getByRole('button', { name: 'Start this application' }).click();
  await page.getByText('Your plan').waitFor();
  await nav('Application form');
  await page.getByRole('heading', { name: 'DS-160 answers (visitor visa)' }).waitFor();
  check('DS-160 answer sheet, with no autofill offered', (await page.getByText(/^Fill .* for me$/).count()) === 0);
  await shot('10-us-ds160');
  await nav('Appointment & tracking');
  const usBooking = page.getByRole('region', { name: 'Booking steps' });
  await usBooking.waitFor();
  check('US booking steps: DS-160 → fee → interview', (await usBooking.getByText(/DS-160 confirmation number/).count()) >= 1 && (await usBooking.getByText(/Interview booked/).isVisible()));
  await usBooking.getByLabel(/DS-160 confirmation number/).fill('12345');
  check('A mistyped DS-160 number is flagged', await usBooking.getByText(/does not look like AA followed by 8/).isVisible());
  await shot('11-us-booking');

  await page.goto(`file:///${file.replace(/\\/g, '/')}`).catch(() => undefined);
  await shot('09-packet');
} catch (err) {
  check('Driver ran to the end', false, err instanceof Error ? err.message.split('\n')[0] : String(err));
  await page.screenshot({ path: path.join(OUT, 'zz-failure.png'), fullPage: true }).catch(() => undefined);
} finally {
  check('No console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const created = await fetch(`${URL}/api/reminders`)
    .then((r) => r.json())
    .then((f) => [...new Set(f.reminders.map((r) => r.tripId))].filter((id) => !tripsBefore.has(id)))
    .catch(() => []);
  const cleanup = await browser.newPage();
  await cleanup.goto(URL).catch(() => undefined);
  await cleanup
    .evaluate(async (ids) => {
      for (const id of ids) await fetch(`/api/reminders/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
    }, created)
    .catch(() => undefined);
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
}
