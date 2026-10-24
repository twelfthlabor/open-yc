// The hosted service API, end to end in memory: customer sign-in and three steps, operator review,
// and the PC agent picking up the approved application. No network, no real database file.
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PassportRecord, Trip } from '../../src/store/model';
import { consentText } from '../../src/service/declarations';
import { openQuestions } from '../../src/service/ready';
import { resolveRoute } from '../../src/rules/engine';
import { createServiceApp } from './app';
import { ServiceStore } from './store';

const ORIGIN = 'https://visa.example';
const OP_PASSWORD = 'correct horse battery staple';
const AGENT_TOKEN = 'agent-token-0123456789abcdef0123456789';

let store: ServiceStore;
let app: ReturnType<typeof createServiceApp>;
let sent: Array<{ email: string; url: string }>;
let aiCalls: number;

const input = { nationality: 'IND', destination: 'HRV', purpose: 'tourism', passportType: 'national', departDate: '2026-12-01', returnDate: '2026-12-15' };
const passport: PassportRecord = {
  surname: 'SHARMA',
  givenNames: 'ANNA',
  documentNumber: 'Z1234567',
  nationality: 'IND',
  issuingState: 'IND',
  birthDate: '1990-01-15',
  sex: 'F',
  expiryDate: '2031-01-01',
  issueDate: '2021-01-02',
  mrzValid: true,
  confirmedAt: '2026-10-14T00:00:00Z',
};

beforeEach(() => {
  sent = [];
  aiCalls = 0;
  store = new ServiceStore(':memory:', randomBytes(32), () => Date.parse('2026-10-14T12:00:00Z'));
  app = createServiceApp({
    store,
    origins: [ORIGIN],
    publicUrl: ORIGIN,
    operatorPassword: OP_PASSWORD,
    agentToken: AGENT_TOKEN,
    secureCookies: true,
    sendLink: async (email, url) => void sent.push({ email, url }),
    extractPassport: async () => {
      aiCalls++;
      return { readable: true, surname: 'SHARMA' };
    },
    today: () => new Date('2026-10-14T12:00:00Z'),
  });
});

type Init = { method?: string; body?: unknown; cookie?: string; origin?: string | null; auth?: string; ip?: string };
async function call(path: string, init: Init = {}) {
  const headers: Record<string, string> = { host: 'visa.example', 'x-forwarded-for': init.ip ?? '203.0.113.5' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.cookie) headers.cookie = init.cookie;
  if (init.auth) headers.authorization = init.auth;
  const res = await app.request(path, { method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

async function signIn(email = 'anna@example.com'): Promise<string> {
  await call('/svc/auth/link', { body: { email } });
  const url = new URL(sent.at(-1)!.url);
  const res = await call(`${url.pathname}${url.search}`, { origin: null });
  expect(res.status).toBe(302);
  const cookie = res.headers.get('set-cookie')!;
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  return cookie.split(';')[0];
}

async function operator(): Promise<string> {
  const res = await call('/svc/operator/login', { body: { password: OP_PASSWORD } });
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0];
}

/** Fills every question the customer would be asked. */
function completed(trip: Trip): Trip {
  const t = structuredClone(trip);
  const route = resolveRoute(t.input, new Date('2026-10-14'));
  t.travellers[0].passport = passport;
  for (const f of openQuestions(t, t.travellers[0], route)) t.travellers[0].answers[f.id] = f.options?.[1] ?? 'answer';
  return t;
}

const consent = { agreed: true, declarationText: consentText('schengen_c'), preferences: { dates: ['2026-11-02', '2026-11-03'], place: 'Mumbai' } };

describe('customer sign-in', () => {
  it('emails a one-time link and signs in with it', async () => {
    const res = await call('/svc/auth/link', { body: { email: 'Anna@Example.com' } });
    expect(res.json).toEqual({ ok: true });
    expect(sent[0].email).toBe('anna@example.com');
    expect(sent[0].url).toMatch(/^https:\/\/visa\.example\/svc\/auth\/verify\?token=/);
    const cookie = await signIn();
    expect((await call('/svc/me', { cookie })).json).toEqual({ email: 'anna@example.com', role: 'customer' });
  });

  it('rejects a bad email, too many links, and an unknown token', async () => {
    expect((await call('/svc/auth/link', { body: { email: 'not-an-email' } })).status).toBe(400);
    for (let i = 0; i < 5; i++) await call('/svc/auth/link', { body: { email: 'x@example.com' } });
    expect((await call('/svc/auth/link', { body: { email: 'x@example.com' } })).status).toBe(429);
    const bad = await call('/svc/auth/verify?token=nope', { origin: null });
    expect(bad.status).toBe(302);
    expect(bad.headers.get('location')).toContain('signin=expired');
    expect(bad.headers.get('set-cookie')).toBeNull();
  });

  it('blocks writes from other sites', async () => {
    expect((await call('/svc/auth/link', { body: { email: 'a@example.com' }, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('/svc/auth/link', { body: { email: 'a@example.com' }, origin: null })).status).toBe(403);
  });
});

describe('the three customer steps', () => {
  it('creates, completes, agrees and sends for review; then cannot edit until returned', async () => {
    const cookie = await signIn();
    const created = await call('/svc/applications', { cookie, body: { input, travellers: 1 } });
    expect(created.status).toBe(200);
    const id = created.json.id as string;
    expect(created.json.status).toBe('draft');

    const early = await call(`/svc/applications/${id}/submit`, { cookie, body: consent });
    expect(early.status).toBe(400);
    expect(early.json.missing).toContain('Traveller 1: passport');

    const trip = completed(created.json.trip);
    expect((await call(`/svc/applications/${id}/trip`, { cookie, method: 'PUT', body: { trip } })).status).toBe(200);

    expect((await call(`/svc/applications/${id}/submit`, { cookie, body: { ...consent, declarationText: 'something else' } })).status).toBe(400);
    expect((await call(`/svc/applications/${id}/submit`, { cookie, body: { ...consent, preferences: { dates: ['2020-01-01'] } } })).status).toBe(400);
    const ok = await call(`/svc/applications/${id}/submit`, { cookie, body: consent });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('in_review');
    expect(ok.json.consent.text).toBe(consentText('schengen_c'));
    expect(ok.json.consent.agreedAt).toBe('2026-10-14T12:00:00.000Z');

    expect((await call(`/svc/applications/${id}/trip`, { cookie, method: 'PUT', body: { trip } })).status).toBe(409);
  });

  it('refuses a route the service does not file', async () => {
    const cookie = await signIn();
    const res = await call('/svc/applications', { cookie, body: { input: { ...input, destination: 'FRA' }, travellers: 1 } });
    expect(res.status).toBe(400);
  });

  it('keeps each customer to their own applications and files', async () => {
    const anna = await signIn('anna@example.com');
    const ben = await signIn('ben@example.com');
    const id = (await call('/svc/applications', { cookie: anna, body: { input, travellers: 1 } })).json.id;
    const file = await call(`/svc/applications/${id}/files`, { cookie: anna, body: { kind: 'passport', mediaType: 'image/png', name: 'p.png', data: Buffer.from('PNG').toString('base64') } });
    expect(file.status).toBe(200);
    expect((await call(`/svc/applications/${id}`, { cookie: ben })).status).toBe(404);
    expect((await call(`/svc/applications/${id}/files/${file.json.id}`, { cookie: ben })).status).toBe(404);
    const mine = await app.request(`/svc/applications/${id}/files/${file.json.id}`, { headers: { host: 'visa.example', cookie: anna } });
    expect(mine.status).toBe(200);
    expect(mine.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await mine.arrayBuffer()).toString()).toBe('PNG');
    expect((await call('/svc/applications', { cookie: ben })).json).toEqual([]);
    expect((await call(`/svc/applications/${id}`)).status).toBe(401);
  });

  it('reads the passport with AI within a daily limit per customer', async () => {
    const cookie = await signIn();
    const id = (await call('/svc/applications', { cookie, body: { input, travellers: 1 } })).json.id;
    const body = { image: Buffer.from('JPEG').toString('base64'), mediaType: 'image/jpeg' };
    expect((await call(`/svc/applications/${id}/extract-passport`, { cookie, body })).json.surname).toBe('SHARMA');
    for (let i = 0; i < 9; i++) await call(`/svc/applications/${id}/extract-passport`, { cookie, body });
    expect((await call(`/svc/applications/${id}/extract-passport`, { cookie, body })).status).toBe(429);
    expect(aiCalls).toBe(10);
  });
});

describe('operator review and the PC agent', () => {
  async function inReview(): Promise<{ id: string; cookie: string }> {
    const cookie = await signIn();
    const created = await call('/svc/applications', { cookie, body: { input, travellers: 1 } });
    const id = created.json.id;
    await call(`/svc/applications/${id}/trip`, { cookie, method: 'PUT', body: { trip: completed(created.json.trip) } });
    await call(`/svc/applications/${id}/submit`, { cookie, body: consent });
    return { id, cookie };
  }

  it('signs the operator in only with the right password, and keeps customers out of the console', async () => {
    expect((await call('/svc/operator/login', { body: { password: 'wrong' } })).status).toBe(401);
    const customer = await signIn();
    expect((await call('/svc/operator/applications', { cookie: customer })).status).toBe(403);
  });

  it('returns with a note, the customer fixes and resends, the operator approves, the agent files', async () => {
    const { id, cookie } = await inReview();
    const op = await operator();
    const queue = await call('/svc/operator/applications?status=in_review', { cookie: op });
    expect(queue.json.map((a: { id: string }) => a.id)).toEqual([id]);
    expect(queue.json[0].email).toBe('anna@example.com');
    expect(queue.json[0].names).toEqual(['Anna Sharma']);

    expect((await call(`/svc/operator/applications/${id}/decision`, { cookie: op, body: { action: 'return' } })).status).toBe(400);
    await call(`/svc/operator/applications/${id}/decision`, { cookie: op, body: { action: 'return', note: 'The passport photo is blurred.' } });
    const returned = (await call(`/svc/applications/${id}`, { cookie })).json;
    expect(returned.status).toBe('returned');
    expect(returned.note).toBe('The passport photo is blurred.');
    await call(`/svc/applications/${id}/submit`, { cookie, body: consent });

    expect((await call('/svc/agent/claim', { body: {}, origin: null, auth: `Bearer ${AGENT_TOKEN}` })).json).toEqual({ job: null });
    await call(`/svc/operator/applications/${id}/decision`, { cookie: op, body: { action: 'approve' } });

    expect((await call('/svc/agent/claim', { body: {}, origin: null, auth: 'Bearer wrong' })).status).toBe(401);
    const claim = await call('/svc/agent/claim', { body: {}, origin: null, auth: `Bearer ${AGENT_TOKEN}` });
    const job = claim.json.job;
    expect(job.id).toBe(id);
    expect(job.formId).toBe('schengen_c');
    expect(job.consent.text).toBe(consentText('schengen_c'));
    expect(job.travellers[0].items.find((i: { id: string }) => i.id === 'surname').value).toBe('SHARMA');
    expect((await call('/svc/agent/claim', { body: {}, origin: null, auth: `Bearer ${AGENT_TOKEN}` })).json).toEqual({ job: null });

    const tid = job.travellers[0].id;
    await call(`/svc/agent/applications/${id}/result`, { origin: null, auth: `Bearer ${AGENT_TOKEN}`, body: { ok: true, travellers: { [tid]: { serial: 'HR2026-1', pin: '1234' } } } });
    const filed = (await call(`/svc/applications/${id}`, { cookie })).json;
    expect(filed.status).toBe('filed');
    expect(filed.filing.travellers[tid]).toEqual({ serial: 'HR2026-1', pin: '1234' });

    await call(`/svc/operator/applications/${id}/appointment`, { cookie: op, body: { at: '2026-11-02T09:30', place: 'VFS Mumbai' } });
    expect((await call(`/svc/applications/${id}`, { cookie })).json.filing.appointment).toEqual({ at: '2026-11-02T09:30', place: 'VFS Mumbai' });
    const history = (await call(`/svc/operator/applications/${id}`, { cookie: op })).json.events.map((e: { text: string }) => e.text);
    expect(history).toEqual(expect.arrayContaining(['Sent for review', 'Returned: The passport photo is blurred.', 'Approved', 'Filing started', 'Filed', 'Appointment booked']));
  });

  it('the operator files by hand: uploads the filed form, enters references, and the customer can download it', async () => {
    const { id, cookie } = await inReview();
    const op = await operator();
    const tid = (await call(`/svc/applications/${id}`, { cookie })).json.trip.travellers[0].id;
    expect((await call(`/svc/operator/applications/${id}/filed`, { cookie: op, body: { travellers: {} } })).status).toBe(409);
    await call(`/svc/operator/applications/${id}/decision`, { cookie: op, body: { action: 'approve' } });

    const pdf = await call(`/svc/operator/applications/${id}/files`, { cookie: op, body: { kind: 'filed_form', mediaType: 'application/pdf', name: 'application.pdf', data: Buffer.from('%PDF-1.4').toString('base64') } });
    expect(pdf.status).toBe(200);
    expect((await call(`/svc/applications/${id}/files`, { cookie, body: { kind: 'filed_form', mediaType: 'application/pdf', name: 'x.pdf', data: 'AA==' } })).status).toBe(409);

    const filed = await call(`/svc/operator/applications/${id}/filed`, { cookie: op, body: { travellers: { [tid]: { serial: 'HR2026-7', pin: '4821' } }, documents: [pdf.json.id] } });
    expect(filed.status).toBe(200);
    const seen = (await call(`/svc/applications/${id}`, { cookie })).json;
    expect(seen.status).toBe('filed');
    expect(seen.filing.travellers[tid]).toEqual({ serial: 'HR2026-7', pin: '4821' });
    expect(seen.filing.documents).toEqual([{ fileId: pdf.json.id, name: 'application.pdf' }]);
    const download = await app.request(`/svc/applications/${id}/files/${pdf.json.id}`, { headers: { host: 'visa.example', cookie } });
    expect(Buffer.from(await download.arrayBuffer()).toString()).toBe('%PDF-1.4');
    expect((await call(`/svc/operator/applications/${id}/filed`, { cookie: op, body: { travellers: {}, documents: ['not-a-file'] } })).status).toBe(400);
  });

  it('a failed filing waits for the operator to retry', async () => {
    const { id } = await inReview();
    const op = await operator();
    await call(`/svc/operator/applications/${id}/decision`, { cookie: op, body: { action: 'approve' } });
    await call('/svc/agent/claim', { body: {}, origin: null, auth: `Bearer ${AGENT_TOKEN}` });
    await call(`/svc/agent/applications/${id}/result`, { origin: null, auth: `Bearer ${AGENT_TOKEN}`, body: { ok: false, message: 'Portal down' } });
    expect((await call(`/svc/operator/applications/${id}`, { cookie: op })).json.status).toBe('filing_failed');
    expect((await call('/svc/agent/claim', { body: {}, origin: null, auth: `Bearer ${AGENT_TOKEN}` })).json).toEqual({ job: null });
    await call(`/svc/operator/applications/${id}/retry`, { cookie: op, body: {} });
    expect((await call('/svc/agent/claim', { body: {}, origin: null, auth: `Bearer ${AGENT_TOKEN}` })).json.job.id).toBe(id);
  });
});

describe('rate limits key on the client address', () => {
  type Env = { incoming: { socket: { remoteAddress: string } } };
  const socket = (remoteAddress: string): Env => ({ incoming: { socket: { remoteAddress } } });

  function appWith(trustProxyHeader?: string) {
    return createServiceApp({
      store,
      origins: [ORIGIN],
      publicUrl: ORIGIN,
      operatorPassword: OP_PASSWORD,
      agentToken: AGENT_TOKEN,
      secureCookies: true,
      sendLink: async (email, url) => void sent.push({ email, url }),
      trustProxyHeader,
    });
  }

  async function login(a: ReturnType<typeof createServiceApp>, headers: Record<string, string>, env?: Env): Promise<number> {
    const res = await a.request('/svc/operator/login', { method: 'POST', headers: { host: 'visa.example', origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: JSON.stringify({ password: 'wrong' }) }, env);
    return res.status;
  }

  it('ignores a rotated X-Forwarded-For on operator login by default', async () => {
    const a = appWith();
    for (let i = 0; i < 10; i++) expect(await login(a, { 'x-forwarded-for': `198.51.100.${i}`, 'fly-client-ip': `192.0.2.${i}` }, socket('203.0.113.9'))).toBe(401);
    expect(await login(a, { 'x-forwarded-for': '198.51.100.200', 'fly-client-ip': '192.0.2.200' }, socket('203.0.113.9'))).toBe(429);
  });

  it('counts each socket address separately by default', async () => {
    const a = appWith();
    for (let i = 0; i < 10; i++) await login(a, {}, socket('203.0.113.9'));
    expect(await login(a, {}, socket('203.0.113.9'))).toBe(429);
    expect(await login(a, {}, socket('203.0.113.10'))).toBe(401);
  });

  it('ignores a rotated X-Forwarded-For on sign-in links by default', async () => {
    const a = appWith();
    const link = (i: number) =>
      a.request('/svc/auth/link', { method: 'POST', headers: { host: 'visa.example', origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${i}` }, body: JSON.stringify({ email: `u${i}@example.com` }) }, socket('203.0.113.9'));
    for (let i = 0; i < 20; i++) expect((await link(i)).status).toBe(200);
    expect((await link(99)).status).toBe(429);
  });

  it('uses the configured proxy header (fly-client-ip) and nothing else', async () => {
    const a = appWith('fly-client-ip');
    for (let i = 0; i < 10; i++) expect(await login(a, { 'fly-client-ip': '192.0.2.1', 'x-forwarded-for': `198.51.100.${i}` }, socket('10.0.0.1'))).toBe(401);
    expect(await login(a, { 'fly-client-ip': '192.0.2.1', 'x-forwarded-for': '198.51.100.200' }, socket('10.0.0.1'))).toBe(429);
    expect(await login(a, { 'fly-client-ip': '192.0.2.2' }, socket('10.0.0.1'))).toBe(401);
  });

  it('takes the entry the proxy appended when X-Forwarded-For is the trusted header', async () => {
    const a = appWith('x-forwarded-for');
    for (let i = 0; i < 10; i++) await login(a, { 'x-forwarded-for': `198.51.100.${i}, 192.0.2.1` }, socket('10.0.0.1'));
    expect(await login(a, { 'x-forwarded-for': '198.51.100.200, 192.0.2.1' }, socket('10.0.0.1'))).toBe(429);
    expect(await login(a, { 'x-forwarded-for': '198.51.100.1, 192.0.2.2' }, socket('10.0.0.1'))).toBe(401);
  });
});
