// Entry point for the hosted service: `npm run service` (dev) or `node --import tsx server/service/index.ts` (production).
// Serves the API under /svc and the built site (dist/) for everything else.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { aiConfigured, extractPassport } from '../ai';
import { createServiceApp } from './app';
import { keyFromEnv } from './crypto';
import { ServiceStore } from './store';

try {
  process.loadEnvFile('.env');
} catch {
  // Settings come from the host's environment.
}

const env = process.env;
const production = env.NODE_ENV === 'production';
const PORT = Number(env.PORT ?? 8790);
const PUBLIC_URL = env.PUBLIC_URL ?? `http://localhost:5173`;

function required(name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is not set. See .env.example.`);
  return v;
}

const store = new ServiceStore(path.resolve(env.SERVICE_DB ?? 'data/service.db'), keyFromEnv(env.SERVICE_KEY));

/** Sends the sign-in link through Resend; without a key (local development) it prints the link instead. */
async function sendLink(email: string, url: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (production) throw new Error('RESEND_API_KEY is not set.');
    console.log(`[sign-in link for ${email}] ${url}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: required('MAIL_FROM'),
      to: email,
      subject: 'Your Visa Navigator sign-in link',
      text: `Sign in to Visa Navigator:\n\n${url}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
    }),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status}).`);
}

const api = createServiceApp({
  store,
  origins: [new URL(PUBLIC_URL).origin],
  publicUrl: PUBLIC_URL,
  operatorPassword: required('OPERATOR_PASSWORD'),
  // Optional: only the deferred PC agent uses it; without it the agent routes refuse every request.
  agentToken: env.AGENT_TOKEN ?? '',
  secureCookies: production,
  sendLink,
  extractPassport: aiConfigured() ? (image, mediaType) => extractPassport(image, mediaType as 'image/jpeg') as unknown as Promise<Record<string, unknown>> : undefined,
  aiDailyCap: Number(env.AI_DAILY_CAP ?? 300),
  // Behind a proxy (Fly.io: fly-client-ip), so rate limits see the customer and not the proxy. See .env.example.
  trustProxyHeader: env.TRUST_PROXY_HEADER || undefined,
});

const app = new Hono();
app.use('*', async (c, next) => {
  await next();
  c.header('x-frame-options', 'DENY');
  c.header('referrer-policy', 'no-referrer');
  c.header('x-content-type-options', 'nosniff');
  if (production) c.header('strict-transport-security', 'max-age=31536000');
});
app.route('/', api);
if (production) {
  app.use('/*', serveStatic({ root: './dist' }));
  // The site is one page; /apply and /console are handled in the browser.
  const index = readFileSync(path.resolve('dist/index.html'), 'utf8');
  app.get('*', (c) => c.html(index));
}

const purge = () => {
  const n = store.purge();
  if (n) console.log(`Deleted ${n} application(s) past the retention period.`);
};
purge();
setInterval(purge, 6 * 3600_000);

serve({ fetch: app.fetch, port: PORT, hostname: production ? '0.0.0.0' : '127.0.0.1' }, (info) => {
  console.log(`Service on http://localhost:${info.port} (public ${PUBLIC_URL}, AI ${aiConfigured() ? 'on' : 'off'})`);
});
