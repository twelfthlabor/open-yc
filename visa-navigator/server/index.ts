import path from 'node:path';
import { serve } from '@hono/node-server';
import { chromium } from 'playwright-core';
import { aiConfigured } from './ai';
import { createApp } from './app';
import { AutofillRunner } from './autofill/runner';
import { dispatchDue } from './dispatch';
import { ScheduleStore } from './schedule';
import { sendWhatsApp, whatsappConfig } from './whatsapp';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: the app runs without AI or WhatsApp.
}

const PORT = 8787;
const schedule = new ScheduleStore(path.resolve('data'));
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// A separate Chrome profile kept on this computer, so portal sign-ins survive between runs.
const autofill = new AutofillRunner({
  launch: () => chromium.launchPersistentContext(path.resolve('data/browser-profile'), { executablePath: CHROME, headless: false, viewport: null }),
});
const app = createApp(schedule, undefined, autofill);

let ticking = false;
/** Sends due WhatsApp reminders. Runs every minute and once at start-up to catch up. */
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await dispatchDue(schedule, whatsappConfig(), sendWhatsApp);
  } finally {
    ticking = false;
  }
}

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
  const wa = whatsappConfig();
  console.log(`API listening on http://127.0.0.1:${info.port} (AI ${aiConfigured() ? 'on' : 'off'}, WhatsApp ${wa ? (wa.contentSid ? 'on (template)' : 'on (free-form)') : 'off'})`);
  void tick();
  setInterval(() => void tick(), 60_000);
});
