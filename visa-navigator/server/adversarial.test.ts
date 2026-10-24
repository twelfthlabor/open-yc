import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { ScheduleStore } from './schedule';

// Each test gets its own temporary schedule folder. Nothing here touches the real data/ directory or a port.
let folder: string;
let store: ScheduleStore;
let app: ReturnType<typeof createApp>;

const LOCAL = { host: '127.0.0.1:8787' };
const APP_ORIGIN = 'http://localhost:5173';
const JSON_FROM_APP = { ...LOCAL, 'content-type': 'application/json', origin: APP_ORIGIN };

const reminder = (over: Record<string, unknown> = {}) => ({
  id: 'trip-1:apply',
  tripId: 'trip-1',
  at: '2026-06-01T09:00:00.000Z',
  title: 'You can apply now',
  body: 'The window opens today.',
  kind: 'apply_window',
  ...over,
});
const putBody = (over: Record<string, unknown> = {}) => ({ tripId: 'trip-1', to: '', whatsapp: false, reminders: [reminder()], ...over });
const put = (body: unknown, headers: Record<string, string> = JSON_FROM_APP, raw = false) =>
  app.request('/api/reminders', { method: 'PUT', headers, body: raw ? String(body) : JSON.stringify(body) });

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_WHATSAPP_FROM;
  folder = mkdtempSync(path.join(tmpdir(), 'vn-api-'));
  store = new ScheduleStore(folder);
  app = createApp(store);
});

describe('baseline: a genuine local request gets through', () => {
  it('GET /api/health with the local host returns 200', async () => {
    const res = await app.request('/api/health', { headers: LOCAL });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ai: false });
  });
});

describe('request guard', () => {
  it('rejects a DNS-rebinding host even for a GET', async () => {
    expect((await app.request('/api/health', { headers: { host: 'evil.example' } })).status).toBe(403);
  });

  it('rejects a host that only starts with localhost', async () => {
    expect((await app.request('/api/health', { headers: { host: 'localhost.evil.example' } })).status).toBe(403);
  });

  it('rejects a write from another web page', async () => {
    const res = await put(putBody(), { ...LOCAL, 'content-type': 'application/json', origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });

  it('rejects a write with no origin at all', async () => {
    const res = await put(putBody(), { ...LOCAL, 'content-type': 'application/json' });
    expect(res.status).toBe(403);
  });

  it('rejects the literal string "null" as an origin', async () => {
    const res = await put(putBody(), { ...LOCAL, 'content-type': 'application/json', origin: 'null' });
    expect(res.status).toBe(403);
  });

  it('rejects a JSON body sent as text/plain (a form-style cross-site post)', async () => {
    const res = await put(putBody(), { ...LOCAL, 'content-type': 'text/plain', origin: APP_ORIGIN });
    expect(res.status).toBe(403);
  });
});

describe('malformed and oversized input', () => {
  it('rejects invalid JSON with 400', async () => {
    expect((await put('{not json', JSON_FROM_APP, true)).status).toBe(400);
  });

  it('rejects a JSON value that is not an object', async () => {
    expect((await put([1, 2, 3])).status).toBe(400);
  });

  it('rejects a body larger than 15 MB before reading it', async () => {
    const huge = `{"pad":"${'x'.repeat(15 * 1024 * 1024 + 10)}"}`;
    expect((await put(huge, JSON_FROM_APP, true)).status).toBe(413);
  });

  it('ignores a __proto__ key instead of polluting the object prototype', async () => {
    const raw = '{"tripId":"trip-1","to":"","whatsapp":false,"reminders":[],"__proto__":{"polluted":true}}';
    expect((await put(raw, JSON_FROM_APP, true)).status).toBe(200);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(store.read())).not.toContain('polluted');
  });

  it('rejects more than 200 reminders for one trip', async () => {
    const many = Array.from({ length: 201 }, (_, i) => reminder({ id: `trip-1:${i}` }));
    expect((await put(putBody({ reminders: many }))).status).toBe(400);
  });

  it('rejects a title longer than 200 characters', async () => {
    expect((await put(putBody({ reminders: [reminder({ title: 'x'.repeat(201) })] }))).status).toBe(400);
  });

  it('rejects a reminder date that is not a date', async () => {
    expect((await put(putBody({ reminders: [reminder({ at: 'not a date' })] }))).status).toBe(400);
  });

  it('rejects a reminder date with no timezone', async () => {
    expect((await put(putBody({ reminders: [reminder({ at: '2026-06-01T09:00:00' })] }))).status).toBe(400);
  });

  it('accepts the date format the app sends (ISO with milliseconds and Z)', async () => {
    expect((await put(putBody())).status).toBe(200);
  });
});

describe('path and identifier tricks', () => {
  it('a traversal-style trip id removes nothing and writes nothing outside the schedule folder', async () => {
    await put(putBody({ tripId: 'trip-1' }));
    const res = await app.request('/api/reminders/' + encodeURIComponent('../../x'), { method: 'DELETE', headers: JSON_FROM_APP });
    expect(res.status).toBe(200);
    expect(store.read().reminders.map((r) => r.tripId)).toEqual(['trip-1']);
    expect(readdirSync(folder).sort()).toEqual(['reminders.json']);
  });

  it('deleting one trip leaves the other trips in place', async () => {
    await put(putBody({ tripId: 'trip-1' }));
    await put(putBody({ tripId: 'trip-2', reminders: [reminder({ id: 'trip-2:apply', tripId: 'trip-2' })] }));
    await app.request('/api/reminders/trip-1', { method: 'DELETE', headers: JSON_FROM_APP });
    expect(store.read().reminders.map((r) => r.tripId)).toEqual(['trip-2']);
  });
});

describe('WhatsApp number tricks', () => {
  it('rejects a number with a zero-width character hidden in it', async () => {
    expect((await put(putBody({ to: '+1415​5550100', whatsapp: true }))).status).toBe(400);
  });

  it('rejects a number with a line break that tries to add a second parameter', async () => {
    expect((await put(putBody({ to: '+14155550100\nBody=injected', whatsapp: true }))).status).toBe(400);
  });

  it('accepts a valid international number', async () => {
    expect((await put(putBody({ to: '+14155550100', whatsapp: true }))).status).toBe(200);
  });
});

describe('AI routes with no API key', () => {
  it.each(['/api/extract-passport', '/api/extract-document', '/api/polish'])('%s answers 503 and says how to fix it', async (route) => {
    const res = await app.request(route, {
      method: 'POST',
      headers: JSON_FROM_APP,
      body: JSON.stringify({ image: 'AA==', mediaType: 'image/png', kind: 'funds', data: 'AA==', draft: 'x' }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/ANTHROPIC_API_KEY|MRZ|key details/);
  });
});

describe('WhatsApp test route with no setup', () => {
  it('answers 503 and does not send anything', async () => {
    const res = await app.request('/api/notify/test', { method: 'POST', headers: JSON_FROM_APP, body: JSON.stringify({ to: '+14155550100' }) });
    expect(res.status).toBe(503);
  });
});
