// The hosted service API (/svc/*): customers sign in by email link and do their three steps,
// the operator reviews in the console, and the agent on the operator's PC claims approved
// applications and reports back. The site never calls the PC; the agent polls.

import { createHash, timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { fillItems, portalFor } from '../../src/autofill/portals';
import { formFor } from '../../src/forms/forms';
import { resolveRoute } from '../../src/rules/engine';
import type { FormId, TripInput } from '../../src/rules/types';
import { consentText } from '../../src/service/declarations';
import { missingForReview } from '../../src/service/ready';
import { newTrip, travellerName, type Trip } from '../../src/store/model';
import type { AppRecord, AppStatus, ServiceStore } from './store';

export interface ServiceOptions {
  store: ServiceStore;
  /** Origins allowed to make changes (the site's own address). */
  origins: string[];
  /** Base address used in sign-in links. */
  publicUrl: string;
  operatorPassword: string;
  agentToken: string;
  secureCookies: boolean;
  sendLink: (email: string, url: string) => Promise<void>;
  extractPassport?: (image: string, mediaType: string) => Promise<Record<string, unknown>>;
  /** Passport reads allowed across all customers per day (the AI bill cap). */
  aiDailyCap?: number;
  /**
   * The request header a trusted proxy in front of the server sets to the client's address (on Fly.io,
   * `fly-client-ip`). Unset, rate limits use the socket address and ignore every forwarding header,
   * because a client can send those itself.
   */
  trustProxyHeader?: string;
  today?: () => Date;
}

const COOKIE = 'vn_sid';
const EDITABLE: AppStatus[] = ['draft', 'returned'];
const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 40;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Fixed-window counters, in memory: enough for one server. */
class Limiter {
  private hits = new Map<string, { n: number; reset: number }>();
  allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.reset <= now) {
      this.hits.set(key, { n: 1, reset: now + windowMs });
      return true;
    }
    h.n++;
    return h.n <= max;
  }
}

function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const InputSchema = z.object({
  nationality: z.string().regex(/^[A-Z]{3}$/),
  destination: z.string().regex(/^[A-Z]{3}$/),
  purpose: z.string().max(30),
  passportType: z.string().max(30),
  departDate: z.string().regex(ISO_DATE).optional(),
  returnDate: z.string().regex(ISO_DATE).optional(),
  birthDate: z.string().regex(ISO_DATE).optional(),
  hasDependentChildren: z.boolean().optional(),
  taiwanIdOnPassport: z.boolean().optional(),
  biometricPassport: z.boolean().optional(),
});

const TripSchema = z.looseObject({
  id: z.string().max(100),
  input: InputSchema,
  travellers: z
    .array(
      z.looseObject({
        id: z.string().max(100),
        label: z.string().max(80),
        answers: z.record(z.string().max(80), z.string().max(4000)),
        documents: z.record(z.string(), z.unknown()),
        passport: z.looseObject({ surname: z.string().max(80), givenNames: z.string().max(120), documentNumber: z.string().max(20) }).optional(),
      }),
    )
    .min(1)
    .max(6),
});

export function createServiceApp(opts: ServiceOptions): Hono {
  const { store } = opts;
  const today = opts.today ?? (() => new Date());
  const limits = new Limiter();
  let aiDay = '';
  let aiCount = 0;
  const app = new Hono();

  // The address rate limits count against. A forwarding header is used only when the operator names it; for
  // X-Forwarded-For that is the last entry, the one the proxy appended (earlier entries come from the client).
  const proxyHeader = opts.trustProxyHeader?.trim().toLowerCase();
  const ip = (c: Context): string => {
    if (proxyHeader) {
      const value = c.req.header(proxyHeader)?.split(',').at(-1)?.trim();
      if (value) return value;
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown'; // no socket, e.g. app.request() in tests
    }
  };

  // Changes must come from the site itself (cookies are SameSite=Lax; this closes the rest), except the agent, which uses a token.
  app.use('/svc/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !c.req.path.startsWith('/svc/agent/')) {
      if (!opts.origins.includes(c.req.header('origin') ?? '')) return c.json({ error: 'Requests must come from the Visa Navigator site.' }, 403);
      if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) return c.json({ error: 'Send JSON.' }, 415);
    }
    await next();
  });
  app.use('/svc/*', bodyLimit({ maxSize: 15 * 1024 * 1024, onError: (c) => c.json({ error: 'Too large (15 MB limit).' }, 413) }));

  const session = (c: Context) => {
    const token = getCookie(c, COOKIE);
    return token ? store.session(token) : null;
  };

  const startSession = (c: Context, userId: string | null, role: 'customer' | 'operator') => {
    setCookie(c, COOKIE, store.createSession(userId, role), { httpOnly: true, secure: opts.secureCookies, sameSite: 'Lax', path: '/', maxAge: 30 * 24 * 3600 });
  };

  // ---- sign-in ----

  app.post('/svc/auth/link', async (c) => {
    const parsed = z.object({ email: z.email().max(200) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Enter a valid email address.' }, 400);
    const email = parsed.data.email.trim().toLowerCase();
    if (!limits.allow(`link:${email}`, 5, HOUR) || !limits.allow(`link-ip:${ip(c)}`, 20, HOUR)) {
      return c.json({ error: 'Too many sign-in emails. Try again in an hour.' }, 429);
    }
    const token = store.createLink(email);
    await opts.sendLink(email, `${opts.publicUrl}/svc/auth/verify?token=${encodeURIComponent(token)}`);
    return c.json({ ok: true });
  });

  app.get('/svc/auth/verify', (c) => {
    const email = store.useLink(c.req.query('token') ?? '');
    if (!email) return c.redirect('/apply?signin=expired', 302);
    startSession(c, store.ensureUser(email).id, 'customer');
    return c.redirect('/apply', 302);
  });

  app.post('/svc/auth/logout', (c) => {
    const token = getCookie(c, COOKIE);
    if (token) store.deleteSession(token);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/svc/config', (c) => c.json({ ai: Boolean(opts.extractPassport) }));

  app.get('/svc/me', (c) => {
    const s = session(c);
    if (!s) return c.json({ error: 'Not signed in.' }, 401);
    return c.json(s.role === 'operator' ? { role: 'operator' } : { email: s.email, role: s.role });
  });

  // ---- customer ----

  const customer = (c: Context): { userId: string } | { error: Response } => {
    const s = session(c);
    if (!s) return { error: c.json({ error: 'Sign in first.' }, 401) };
    if (s.role !== 'customer' || !s.userId) return { error: c.json({ error: 'Customers only.' }, 403) };
    return { userId: s.userId };
  };

  const own = (c: Context): { rec: AppRecord } | { error: Response } => {
    const who = customer(c);
    if ('error' in who) return who;
    const rec = store.getApplication(c.req.param('id') ?? '');
    if (!rec || rec.userId !== who.userId) return { error: c.json({ error: 'Not found.' }, 404) };
    return { rec };
  };

  const view = (r: AppRecord) => ({
    id: r.id,
    status: r.status,
    trip: r.trip,
    consent: r.consent,
    preferences: r.preferences,
    note: r.note,
    filing: r.filing,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });

  // The hosted service files Croatia and the UK only (docs/SERVICE_PLAN.md). Other covered destinations are
  // prepared in the personal app, where the applicant files themselves.
  const SERVICE_DESTINATIONS = new Set(['HRV', 'GBR']);
  const formIdOf = (input: TripInput): FormId | undefined => (SERVICE_DESTINATIONS.has(input.destination) ? resolveRoute(input, today()).formId : undefined);

  app.post('/svc/applications', async (c) => {
    const who = customer(c);
    if ('error' in who) return who.error;
    const parsed = z.object({ input: InputSchema, travellers: z.number().int().min(1).max(6) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Choose a destination, dates and number of travellers.' }, 400);
    const input = parsed.data.input as TripInput;
    if (!formIdOf(input)) return c.json({ error: 'We cannot file this one for you yet. The route summary shows what you need.' }, 400);
    if (store.listByUser(who.userId).length >= 10) return c.json({ error: 'You have 10 applications already.' }, 429);
    const trip = newTrip(input, Array.from({ length: parsed.data.travellers }, (_, i) => `Traveller ${i + 1}`));
    const id = store.createApplication(who.userId, trip);
    return c.json(view(store.getApplication(id)!));
  });

  app.get('/svc/applications', (c) => {
    const who = customer(c);
    if ('error' in who) return who.error;
    return c.json(store.listByUser(who.userId).map(view));
  });

  app.get('/svc/applications/:id', (c) => {
    const r = own(c);
    return 'error' in r ? r.error : c.json(view(r.rec));
  });

  app.put('/svc/applications/:id/trip', async (c) => {
    const r = own(c);
    if ('error' in r) return r.error;
    if (!EDITABLE.includes(r.rec.status)) return c.json({ error: 'This application is with the reviewer and cannot be changed now.' }, 409);
    const parsed = z.object({ trip: TripSchema }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid application data.' }, 400);
    const trip = parsed.data.trip as unknown as Trip;
    if (trip.id !== r.rec.trip.id) return c.json({ error: 'Invalid application data.' }, 400);
    if (!formIdOf(trip.input)) return c.json({ error: 'We cannot file this route.' }, 400);
    store.update(r.rec.id, { trip: { ...trip, updatedAt: today().toISOString() } }, 'customer');
    return c.json(view(store.getApplication(r.rec.id)!));
  });

  app.post('/svc/applications/:id/files', async (c) => {
    const r = own(c);
    if ('error' in r) return r.error;
    if (!EDITABLE.includes(r.rec.status)) return c.json({ error: 'This application is with the reviewer and cannot be changed now.' }, 409);
    const parsed = z
      .object({
        kind: z.string().max(40),
        mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
        name: z.string().max(120),
        data: z.string().min(1),
        travellerId: z.string().max(100).optional(),
        itemId: z.string().max(80).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send a photo or PDF.' }, 400);
    const bytes = Buffer.from(parsed.data.data, 'base64');
    if (bytes.length > MAX_FILE) return c.json({ error: 'Files must be under 10 MB.' }, 413);
    if (store.countFiles(r.rec.id) >= MAX_FILES) return c.json({ error: 'Too many files on this application.' }, 429);
    const { kind, mediaType, name, travellerId, itemId } = parsed.data;
    return c.json({ id: store.addFile(r.rec.id, { kind, mediaType, name, travellerId, itemId }, bytes) });
  });

  app.get('/svc/applications/:id/files/:fileId', (c) => {
    const s = session(c);
    if (!s) return c.json({ error: 'Sign in first.' }, 401);
    const rec = store.getApplication(c.req.param('id'));
    if (!rec || (s.role !== 'operator' && rec.userId !== s.userId)) return c.json({ error: 'Not found.' }, 404);
    const f = store.getFile(rec.id, c.req.param('fileId'));
    if (!f) return c.json({ error: 'Not found.' }, 404);
    return new Response(new Uint8Array(f.bytes), {
      headers: {
        'content-type': f.meta.mediaType,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        'cache-control': 'private, no-store',
      },
    });
  });

  app.post('/svc/applications/:id/extract-passport', async (c) => {
    const r = own(c);
    if ('error' in r) return r.error;
    if (!opts.extractPassport) return c.json({ error: 'Passport reading is off. Type the details instead.' }, 503);
    const parsed = z.object({ image: z.string().min(1), mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send a photo of the passport page.' }, 400);
    if ((parsed.data.image.length * 3) / 4 > MAX_FILE) return c.json({ error: 'Photo must be under 10 MB.' }, 413);
    const day = today().toISOString().slice(0, 10);
    if (aiDay !== day) {
      aiDay = day;
      aiCount = 0;
    }
    if (!limits.allow(`ai:${r.rec.userId}`, 10, DAY) || aiCount >= (opts.aiDailyCap ?? 300)) {
      return c.json({ error: 'Passport reading is busy today. Type the details instead.' }, 429);
    }
    aiCount++;
    try {
      return c.json(await opts.extractPassport(parsed.data.image, parsed.data.mediaType));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not read the passport.' }, 502);
    }
  });

  const SubmitBody = z.object({
    agreed: z.literal(true),
    declarationText: z.string().max(20_000),
    preferences: z.object({ dates: z.array(z.string().regex(ISO_DATE)).min(1).max(5), place: z.string().max(120).optional() }),
  });

  app.post('/svc/applications/:id/submit', async (c) => {
    const r = own(c);
    if ('error' in r) return r.error;
    if (!EDITABLE.includes(r.rec.status)) return c.json({ error: 'Already sent for review.' }, 409);
    const parsed = SubmitBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Agree to the declaration and pick at least one date.' }, 400);
    const route = resolveRoute(r.rec.trip.input, today());
    if (!route.formId) return c.json({ error: 'We cannot file this route.' }, 400);
    if (parsed.data.declarationText !== consentText(route.formId)) return c.json({ error: 'The declaration has changed. Reload the page and read it again.' }, 400);
    const todayIso = today().toISOString().slice(0, 10);
    if (parsed.data.preferences.dates.some((d) => d <= todayIso)) return c.json({ error: 'Pick appointment dates after today.' }, 400);
    const missing = missingForReview(r.rec.trip, route);
    if (missing.length) return c.json({ error: 'Some details are still missing.', missing }, 400);
    store.update(
      r.rec.id,
      {
        status: 'in_review',
        note: null,
        consent: { formId: route.formId, text: parsed.data.declarationText, agreedAt: today().toISOString() },
        preferences: parsed.data.preferences,
      },
      'customer',
      'Sent for review',
    );
    return c.json(view(store.getApplication(r.rec.id)!));
  });

  // ---- operator ----

  app.post('/svc/operator/login', async (c) => {
    if (!limits.allow(`op:${ip(c)}`, 10, HOUR)) return c.json({ error: 'Too many attempts. Try again in an hour.' }, 429);
    const parsed = z.object({ password: z.string().max(200) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !opts.operatorPassword || !sameSecret(parsed.data.password, opts.operatorPassword)) return c.json({ error: 'Wrong password.' }, 401);
    startSession(c, null, 'operator');
    return c.json({ ok: true });
  });

  const isOperator = (c: Context): Response | null => {
    const s = session(c);
    if (!s) return c.json({ error: 'Sign in first.' }, 401);
    if (s.role !== 'operator') return c.json({ error: 'Operator only.' }, 403);
    return null;
  };

  const summary = (r: AppRecord) => ({
    id: r.id,
    status: r.status,
    email: store.userEmail(r.userId),
    names: r.trip.travellers.map(travellerName),
    route: resolveRoute(r.trip.input, today()).title,
    destination: r.trip.input.destination,
    nationality: r.trip.input.nationality,
    departDate: r.trip.input.departDate,
    preferences: r.preferences,
    updatedAt: r.updatedAt,
  });

  app.get('/svc/operator/applications', (c) => {
    const denied = isOperator(c);
    if (denied) return denied;
    const status = c.req.query('status') as AppStatus | undefined;
    return c.json(store.listByStatus(status || undefined).map(summary));
  });

  const opRecord = (c: Context): { rec: AppRecord } | { error: Response } => {
    const denied = isOperator(c);
    if (denied) return { error: denied };
    const rec = store.getApplication(c.req.param('id') ?? '');
    return rec ? { rec } : { error: c.json({ error: 'Not found.' }, 404) };
  };

  app.get('/svc/operator/applications/:id', (c) => {
    const r = opRecord(c);
    if ('error' in r) return r.error;
    return c.json({ ...view(r.rec), email: store.userEmail(r.rec.userId), events: store.events(r.rec.id), files: store.listFiles(r.rec.id) });
  });

  app.post('/svc/operator/applications/:id/decision', async (c) => {
    const r = opRecord(c);
    if ('error' in r) return r.error;
    if (r.rec.status !== 'in_review') return c.json({ error: 'Only applications in review can be decided.' }, 409);
    const parsed = z
      .discriminatedUnion('action', [z.object({ action: z.literal('approve') }), z.object({ action: z.literal('return'), note: z.string().trim().min(1).max(2000) })])
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Approve, or return with a note for the customer.' }, 400);
    if (parsed.data.action === 'approve') store.update(r.rec.id, { status: 'approved' }, 'operator', 'Approved');
    else store.update(r.rec.id, { status: 'returned', note: parsed.data.note }, 'operator', `Returned: ${parsed.data.note}`);
    return c.json(view(store.getApplication(r.rec.id)!));
  });

  // Filing by hand: the operator uploads what the portal produced (the printed form, a confirmation)...
  app.post('/svc/operator/applications/:id/files', async (c) => {
    const r = opRecord(c);
    if ('error' in r) return r.error;
    const parsed = z
      .object({ kind: z.string().max(40), mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']), name: z.string().max(120), data: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send a PDF or image.' }, 400);
    const bytes = Buffer.from(parsed.data.data, 'base64');
    if (bytes.length > MAX_FILE) return c.json({ error: 'Files must be under 10 MB.' }, 413);
    const { kind, mediaType, name } = parsed.data;
    return c.json({ id: store.addFile(r.rec.id, { kind, mediaType, name }, bytes) });
  });

  // ...then records the portal references and which files the customer gets.
  app.post('/svc/operator/applications/:id/filed', async (c) => {
    const r = opRecord(c);
    if ('error' in r) return r.error;
    if (!['approved', 'filing', 'filing_failed', 'filed'].includes(r.rec.status)) return c.json({ error: 'Approve the application first.' }, 409);
    const Ref = z.object({ serial: z.string().max(40).optional(), pin: z.string().max(20).optional(), reference: z.string().max(40).optional() });
    const parsed = z
      .object({ travellers: z.record(z.string().max(100), Ref), documents: z.array(z.string().max(100)).max(20).optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Enter the references from the official site.' }, 400);
    const files = store.listFiles(r.rec.id);
    const documents: Array<{ fileId: string; name: string }> = [];
    for (const id of parsed.data.documents ?? []) {
      const f = files.find((x) => x.id === id);
      if (!f) return c.json({ error: 'Unknown file.' }, 400);
      documents.push({ fileId: id, name: f.name });
    }
    const filing = { ...r.rec.filing, travellers: { ...r.rec.filing.travellers, ...parsed.data.travellers }, documents: documents.length ? documents : r.rec.filing.documents };
    store.update(r.rec.id, { status: 'filed', filing }, 'operator', r.rec.status === 'filed' ? 'Filing details updated' : 'Filed');
    return c.json(view(store.getApplication(r.rec.id)!));
  });

  app.post('/svc/operator/applications/:id/retry', (c) => {
    const r = opRecord(c);
    if ('error' in r) return r.error;
    if (r.rec.status !== 'filing_failed' && r.rec.status !== 'filing') return c.json({ error: 'Nothing to retry.' }, 409);
    store.update(r.rec.id, { status: 'approved' }, 'operator', 'Filing retried');
    return c.json(view(store.getApplication(r.rec.id)!));
  });

  app.post('/svc/operator/applications/:id/appointment', async (c) => {
    const r = opRecord(c);
    if ('error' in r) return r.error;
    if (r.rec.status !== 'filed' && r.rec.status !== 'appointment') return c.json({ error: 'File the application first.' }, 409);
    const parsed = z.object({ at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), place: z.string().trim().min(1).max(200) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Give the appointment date, time and place.' }, 400);
    store.update(r.rec.id, { status: 'appointment', filing: { ...r.rec.filing, appointment: parsed.data } }, 'operator', 'Appointment booked');
    return c.json(view(store.getApplication(r.rec.id)!));
  });

  app.post('/svc/operator/applications/:id/decided', async (c) => {
    const r = opRecord(c);
    if ('error' in r) return r.error;
    const parsed = z.object({ decision: z.enum(['approved', 'refused']) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Approved or refused?' }, 400);
    store.update(r.rec.id, { status: 'decided', filing: { ...r.rec.filing, decision: parsed.data.decision } }, 'operator', `Decision: ${parsed.data.decision}`);
    return c.json(view(store.getApplication(r.rec.id)!));
  });

  // ---- agent (operator's PC) ----

  const agent = (c: Context): Response | null => {
    const auth = c.req.header('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!opts.agentToken || !token || !sameSecret(token, opts.agentToken)) return c.json({ error: 'Bad agent token.' }, 401);
    return null;
  };

  app.post('/svc/agent/claim', (c) => {
    const denied = agent(c);
    if (denied) return denied;
    const rec = store.claimNextApproved();
    if (!rec) return c.json({ job: null });
    const route = resolveRoute(rec.trip.input, today());
    const form = formFor(route)!;
    return c.json({
      job: {
        id: rec.id,
        formId: form.id,
        applyUrl: portalFor(form.id, rec.trip.input.destination)?.startUrl ?? route.applyUrl,
        consent: rec.consent,
        travellers: rec.trip.travellers.map((t) => ({ id: t.id, name: travellerName(t), items: fillItems(rec.trip, t, form) })),
      },
    });
  });

  const ResultBody = z.object({
    ok: z.boolean(),
    message: z.string().max(500).optional(),
    travellers: z
      .record(z.string().max(100), z.object({ serial: z.string().max(40).optional(), pin: z.string().max(20).optional(), reference: z.string().max(40).optional() }))
      .optional(),
  });

  app.post('/svc/agent/applications/:id/result', async (c) => {
    const denied = agent(c);
    if (denied) return denied;
    const rec = store.getApplication(c.req.param('id'));
    if (!rec) return c.json({ error: 'Not found.' }, 404);
    if (rec.status !== 'filing') return c.json({ error: 'This application is not being filed.' }, 409);
    const parsed = ResultBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid result.' }, 400);
    if (parsed.data.ok) {
      store.update(rec.id, { status: 'filed', filing: { ...rec.filing, travellers: { ...rec.filing.travellers, ...parsed.data.travellers } } }, 'agent', 'Filed');
    } else {
      store.update(rec.id, { status: 'filing_failed' }, 'agent', `Filing failed: ${parsed.data.message ?? 'no reason given'}`);
    }
    return c.json({ ok: true });
  });

  return app;
}
