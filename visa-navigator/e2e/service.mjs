// End-to-end drive of the hosted service in headless Chrome: a customer signs in and does the three
// steps, then the operator reviews and approves in the console.
// Usage: start `npm run dev:service` with SERVICE_KEY, OPERATOR_PASSWORD and AGENT_TOKEN set and the
// service's output going to a log file, then: SERVICE_LOG=<that file> OPERATOR_PASSWORD=<it> node e2e/service.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.E2E_URL ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LOG = process.env.SERVICE_LOG;
const PASSWORD = process.env.OPERATOR_PASSWORD;
const OUT = path.join(import.meta.dirname, 'shots');
mkdirSync(OUT, { recursive: true });
if (!LOG || !PASSWORD) throw new Error('Set SERVICE_LOG and OPERATOR_PASSWORD.');

// ICAO 9303 TD3 MRZ with valid check digits.
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

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `service-${name}.png`), fullPage: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];
const email = `e2e-${Date.now()}@example.com`;

try {
  // ---- customer ----
  const customer = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await customer.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/401|Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await page.goto(`${URL}/apply`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.getByText('Check your email').waitFor();
  await shot(page, '01-signin');
  let link;
  for (let i = 0; i < 20 && !link; i++) {
    link = readFileSync(LOG, 'utf8').match(new RegExp(`\\[sign-in link for ${email.replace(/[.+]/g, '\\$&')}\\] (\\S+)`))?.[1];
    if (!link) await page.waitForTimeout(250);
  }
  check('Sign-in link is sent', Boolean(link));
  await page.goto(link);
  await page.getByText('Where are you going?').waitFor();
  check('The link signs in and opens step 1', page.url().endsWith('/apply'));

  // Step 1
  await page.getByRole('combobox').click();
  await page.getByPlaceholder('Search countries…').fill('India');
  await page.getByRole('option', { name: /India/ }).first().click();
  await page.locator('#depart').fill('2026-12-01');
  await page.locator('#return').fill('2026-12-12');
  await page.getByText('Schengen short-stay visa').first().waitFor();
  await shot(page, '02-step1');
  await page.getByRole('button', { name: 'Next: your passport' }).click();

  // Step 2: passport by MRZ (no AI key in this run), then the remaining questions.
  const [l1, l2] = mrz({ nat: 'IND', surname: 'SHARMA', given: 'ANNA', num: 'Z1234567', dob: '900115', sex: 'F', exp: '310101' });
  await page.getByLabel('MRZ line 1').fill(l1);
  await page.getByLabel('MRZ line 2').fill(l2);
  await page.getByRole('button', { name: 'Fill fields from MRZ' }).click();
  await page.getByRole('button', { name: /I checked these/ }).click();
  await page.getByText('A few more details').waitFor();
  check('Passport saved from the MRZ', await page.getByText(/Anna Sharma · Z1234567/).isVisible());

  const questions = page.locator('[id^="q-"]');
  const count = await questions.count();
  for (let i = 0; i < count; i++) {
    const q = questions.nth(i);
    if (!(await q.isVisible())) continue;
    const tag = await q.evaluate((el) => el.tagName);
    const type = await q.getAttribute('type');
    if (tag === 'BUTTON') {
      await q.click();
      await page.getByRole('option').nth(0).click();
    } else if (type === 'date') await q.fill('2015-06-01');
    else if (type === 'email') await q.fill(email);
    else if (type === 'tel') await q.fill('+911234567890');
    else await q.fill('Test answer');
  }
  check('Step 2 asks only what the passport and trip do not answer', count > 5 && count < 30, `${count} questions`);
  await page.getByText('Saved', { exact: true }).waitFor({ timeout: 5000 });
  await shot(page, '03-step2');
  await page.getByRole('button', { name: 'Next: pick a time' }).click();

  // Step 3
  await page.locator('#date-0').fill('2026-11-10');
  await page.locator('#place').fill('Mumbai');
  await page.getByLabel('I agree to the declaration').click();
  check('The official Schengen declaration is shown', await page.getByText('I declare that to the best of my knowledge').isVisible());
  await shot(page, '04-step3');
  await page.getByRole('button', { name: 'Send for review' }).click();
  await page.getByRole('heading', { name: 'In review' }).waitFor();
  check('Sent for review', true);
  await shot(page, '05-status');

  // ---- operator ----
  const op = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const consolePage = await op.newPage();
  consolePage.on('pageerror', (e) => errors.push(e.message));
  await consolePage.goto(`${URL}/console`);
  await consolePage.getByLabel('Password').fill(PASSWORD);
  await consolePage.getByRole('button', { name: 'Sign in' }).click();
  await consolePage.getByText('Anna Sharma').first().waitFor();
  check('The application is in the review queue', true);
  await consolePage.getByText('Anna Sharma').first().click();
  await consolePage.getByRole('button', { name: 'Approve for filing' }).waitFor();
  check('The review shows the declaration agreement', await consolePage.getByText(/Agreed .* by e2e-/).isVisible());
  check('The review shows the drafted cover letter', await consolePage.getByText('Cover letter (drafted)').isVisible());
  await shot(consolePage, '06-review');
  await consolePage.getByRole('button', { name: 'Approve for filing' }).click();
  await consolePage.getByRole('heading', { name: 'File it' }).waitFor();
  check('Approved; the console shows the filing panel', true);

  // Filing by hand: references and the filed form go back to the customer.
  await consolePage.getByLabel('Serial number').fill('HR2026-0091');
  await consolePage.getByLabel('PIN').fill('7310');
  await consolePage.locator('input[type=file]').setInputFiles({ name: 'application.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await consolePage.getByText('For the customer: application.pdf').waitFor();
  await shot(consolePage, '07-file-it');
  await consolePage.getByRole('button', { name: 'Mark as filed' }).click();
  await consolePage.getByRole('heading', { name: 'Filing details' }).waitFor();
  check('Marked as filed', true);

  await page.getByRole('button', { name: 'All applications' }).click();
  await page.getByText('Filed', { exact: true }).first().click();
  await page.getByRole('heading', { name: 'Filed', exact: true }).waitFor();
  check('The customer sees the references', await page.getByText('serial number HR2026-0091, PIN 7310').isVisible());
  check('The customer can download the filed form', await page.getByRole('link', { name: 'application.pdf' }).isVisible());
  check('The customer gets the cover letter, itinerary and what to bring', (await page.getByRole('link', { name: 'Cover letter' }).isVisible()) && (await page.getByText('What to bring to the appointment').isVisible()));
  await shot(page, '08-customer-filed');

  check('No page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
} catch (err) {
  check('Run finished', false, err.message.split('\n')[0]);
} finally {
  await browser.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
