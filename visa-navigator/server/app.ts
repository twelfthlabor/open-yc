import Anthropic from '@anthropic-ai/sdk';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { PORTALS, hostAllowed, portalFor } from '../src/autofill/portals';
import { unsupportedNumbers } from '../src/drafts/coverLetter';
import { hasForbiddenPhrase } from '../src/drafts/templates';
import type { FormId } from '../src/rules/types';
import type { AutofillRunner } from './autofill/runner';
import { aiConfigured, AiRefusedError, DOCUMENT_SCHEMAS, extractDocument, extractPassport, polishDraft, preReview, suggestPlans, writeCoverLetter, type DocumentKind } from './ai';
import { checkRequest } from './guard';
import { replaceTrip, type ScheduleStore, type StoredReminder } from './schedule';
import { sendWhatsApp, toWhatsAppAddress, whatsappConfig } from './whatsapp';

export const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * The local API. The reminder store is a parameter, so tests can run the whole API against a temporary folder.
 * Only the entry point (index.ts) starts listening.
 */
export function createApp(
  schedule: ScheduleStore,
  allowedOrigins: string[] = ALLOWED_ORIGINS,
  autofill?: Pick<AutofillRunner, 'start' | 'status' | 'stop'>,
): Hono {
  const app = new Hono();

  app.use('/api/*', async (c, next) => {
    const problem = checkRequest(
      { method: c.req.method, host: c.req.header('host'), origin: c.req.header('origin'), contentType: c.req.header('content-type') },
      allowedOrigins,
    );
    if (problem) return c.json({ error: problem }, 403);
    await next();
  });
  app.use('/api/*', bodyLimit({ maxSize: 15 * 1024 * 1024, onError: (c) => c.json({ error: 'File is too large (15 MB limit).' }, 413) }));

  app.get('/api/health', (c) => {
    const wa = whatsappConfig();
    return c.json({ ok: true, ai: aiConfigured(), whatsapp: { configured: Boolean(wa), template: Boolean(wa?.contentSid) } });
  });

  const ExtractBody = z.object({
    image: z.string().min(1),
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  });

  app.post('/api/extract-passport', async (c) => {
    if (!aiConfigured()) return c.json({ error: 'AI is not configured. Add ANTHROPIC_API_KEY to .env, or enter the MRZ by hand.' }, 503);
    const parsed = ExtractBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send an image as base64 with its media type.' }, 400);
    if ((parsed.data.image.length * 3) / 4 > MAX_FILE_BYTES) return c.json({ error: 'Image is larger than 10 MB. Try a smaller photo.' }, 413);
    try {
      return c.json(await extractPassport(parsed.data.image, parsed.data.mediaType));
    } catch (err) {
      return c.json({ error: describeError(err) }, 502);
    }
  });

  const DocumentBody = z.object({
    kind: z.enum(Object.keys(DOCUMENT_SCHEMAS) as [DocumentKind, ...DocumentKind[]]),
    data: z.string().min(1),
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']),
  });

  app.post('/api/extract-document', async (c) => {
    if (!aiConfigured()) return c.json({ error: 'AI is not configured. Enter the key details by hand, or add ANTHROPIC_API_KEY to .env.' }, 503);
    const parsed = DocumentBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send a document (image or PDF) as base64 with its kind and media type.' }, 400);
    if ((parsed.data.data.length * 3) / 4 > MAX_FILE_BYTES) return c.json({ error: 'File is larger than 10 MB.' }, 413);
    try {
      return c.json(await extractDocument(parsed.data.kind, parsed.data.data, parsed.data.mediaType));
    } catch (err) {
      return c.json({ error: describeError(err) }, 502);
    }
  });

  const DraftBody = z.object({
    kind: z.enum(['itinerary', 'cover_letter']),
    draft: z.string().min(1).max(20_000),
  });

  app.post('/api/polish', async (c) => {
    if (!aiConfigured()) return c.json({ error: 'AI is not configured. Add ANTHROPIC_API_KEY to .env to polish drafts, or keep your own wording.' }, 503);
    const parsed = DraftBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send a draft to polish.' }, 400);
    try {
      const text = await polishDraft(parsed.data.kind, parsed.data.draft);
      if (hasForbiddenPhrase(text)) return c.json({ error: 'The polished draft contained wording about approval, so it was discarded. Your draft is unchanged.' }, 422);
      return c.json({ text });
    } catch (err) {
      return c.json({ error: describeError(err) }, 502);
    }
  });

  const LetterBody = z.object({
    facts: z.record(z.string().max(80), z.string().max(2000)).refine((r) => Object.keys(r).length <= 40, 'Too many facts.'),
    missing: z.array(z.string().max(80)).max(20),
  });

  // Writes a cover letter body from the applicant's facts. The reply is discarded if it promises a decision or
  // contains a number (date, amount, flight) that is not in the facts.
  app.post('/api/cover-letter', async (c) => {
    if (!aiConfigured()) return c.json({ error: 'AI is not configured. Use “Draft from my answers” for the template letter, or add ANTHROPIC_API_KEY to .env.' }, 503);
    const parsed = LetterBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send the letter facts.' }, 400);
    try {
      const text = await writeCoverLetter(parsed.data.facts, parsed.data.missing);
      if (!text) return c.json({ error: 'The model returned an empty letter.' }, 502);
      if (hasForbiddenPhrase(text)) return c.json({ error: 'The letter contained wording about approval, so it was discarded.' }, 422);
      const extra = unsupportedNumbers(text, parsed.data.facts);
      if (extra.length) return c.json({ error: `The letter contained numbers that are not in your facts (${extra.join(', ')}), so it was discarded.` }, 422);
      return c.json({ text });
    } catch (err) {
      return c.json({ error: describeError(err) }, 502);
    }
  });

  const PlansBody = z.object({
    purpose: z.string().max(60),
    days: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), city: z.string().min(1).max(100) })).min(1).max(60),
  });

  // Suggestions for days the user left empty. Only dates that were asked about come back, with no numbers
  // (times, prices) and no approval wording; the user accepts each one in the app.
  app.post('/api/suggest-plans', async (c) => {
    if (!aiConfigured()) return c.json({ error: 'AI is not configured. Type your own plans for each day, or add ANTHROPIC_API_KEY to .env.' }, 503);
    const parsed = PlansBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send the days to suggest plans for.' }, 400);
    try {
      const asked = new Set(parsed.data.days.map((d) => d.date));
      const out = (await suggestPlans(parsed.data.days, parsed.data.purpose))
        .filter((d) => asked.has(d.date))
        .map((d) => ({ date: d.date, suggestion: d.suggestion.trim().slice(0, 300) }))
        .filter((d) => d.suggestion && !/\d/.test(d.suggestion) && !hasForbiddenPhrase(d.suggestion));
      const seen = new Set<string>();
      return c.json({ days: out.filter((d) => (seen.has(d.date) ? false : (seen.add(d.date), true))) });
    } catch (err) {
      return c.json({ error: describeError(err) }, 502);
    }
  });

  const ReviewBody = z.object({ packet: z.string().min(1).max(40_000) });
  const ODDS = /\b(likely|unlikely|chances?|odds|probabilit|strong application|weak application|will be (granted|refused|rejected))\b/i;

  // AI comments on top of the code rubric. Findings that grade the application or predict the decision are dropped.
  app.post('/api/pre-review', async (c) => {
    if (!aiConfigured()) return c.json({ error: 'AI is not configured. The rubric above still runs without it.' }, 503);
    const parsed = ReviewBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send the review packet.' }, 400);
    try {
      const findings = (await preReview(parsed.data.packet))
        .slice(0, 8)
        .map((f) => ({ ...f, comment: f.comment.trim().slice(0, 400) }))
        .filter((f) => f.comment && !hasForbiddenPhrase(f.comment) && !ODDS.test(f.comment));
      return c.json({ findings });
    } catch (err) {
      return c.json({ error: describeError(err) }, 502);
    }
  });

  const ReminderBody = z.object({
    tripId: z.string().min(1).max(100),
    to: z.string().max(32),
    whatsapp: z.boolean(),
    reminders: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          tripId: z.string(),
          at: z.iso.datetime(),
          title: z.string().max(200),
          body: z.string().max(1000),
          kind: z.string(),
        }),
      )
      .max(200),
  });

  app.get('/api/reminders', (c) => c.json(schedule.read()));

  app.put('/api/reminders', async (c) => {
    const parsed = ReminderBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid reminder list.' }, 400);
    const { tripId, to, whatsapp, reminders } = parsed.data;
    if (whatsapp && to && !toWhatsAppAddress(to)) return c.json({ error: 'WhatsApp number must be in international format, for example +14155550100.' }, 400);
    const next = replaceTrip({ ...schedule.read(), to, whatsapp }, tripId, reminders as StoredReminder[]);
    schedule.write(next);
    return c.json({ ok: true, pending: next.reminders.filter((r) => !r.sentAt && !r.skippedAt).length });
  });

  app.delete('/api/reminders/:tripId', (c) => {
    const file = schedule.read();
    schedule.write({ ...file, reminders: file.reminders.filter((r) => r.tripId !== c.req.param('tripId')) });
    return c.json({ ok: true });
  });

  app.post('/api/notify/test', async (c) => {
    const cfg = whatsappConfig();
    if (!cfg) return c.json({ error: 'WhatsApp is not set up. Add the Twilio settings to .env (see README).' }, 503);
    const parsed = z.object({ to: z.string() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send a phone number.' }, 400);
    try {
      const r = await sendWhatsApp(cfg, parsed.data.to, 'Visa Navigator', 'WhatsApp reminders are working.');
      return c.json({ ok: true, sid: r.sid });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not send.' }, 502);
    }
  });

  const AutofillBody = z.object({
    formId: z.enum(Object.keys(PORTALS) as [FormId, ...FormId[]]),
    applyUrl: z.string().max(500).optional(),
    destination: z.string().max(3).optional(),
    allowSubmit: z.boolean(),
    items: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          label: z.string().max(300),
          number: z.string().max(4).optional(),
          value: z.string().max(4000),
          type: z.string().max(20).optional(),
        }),
      )
      .max(300),
  });

  // Starts filling the official form in a Chrome window on this computer. The portal decides where the
  // run may go: the start page must be on the portal's own hosts.
  app.post('/api/autofill/start', async (c) => {
    if (!autofill) return c.json({ error: 'Autofill is not available on this server.' }, 503);
    const parsed = AutofillBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send the form id and its answers.' }, 400);
    const { formId, applyUrl, allowSubmit, items, destination } = parsed.data;
    // A portal limited to some destinations (CROVISA: Croatia only) needs the destination to match.
    const portal = PORTALS[formId]?.destinations ? portalFor(formId, destination ?? '') : PORTALS[formId];
    if (!portal) return c.json({ error: 'This portal does not take applications for that destination.' }, 400);
    const startUrl = portal.startUrl ?? applyUrl ?? '';
    if (!hostAllowed(startUrl, portal.hosts)) return c.json({ error: `The start page must be on ${portal.name}.` }, 400);
    try {
      return c.json(autofill.start({ startUrl, hosts: portal.hosts, items, options: portal, allowSubmit }));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not start.' }, 409);
    }
  });

  app.get('/api/autofill/status', (c) => {
    if (!autofill) return c.json({ error: 'Autofill is not available on this server.' }, 503);
    return c.json(autofill.status());
  });

  app.post('/api/autofill/stop', async (c) => {
    if (!autofill) return c.json({ error: 'Autofill is not available on this server.' }, 503);
    await autofill.stop();
    return c.json(autofill.status());
  });

  function describeError(err: unknown): string {
    if (err instanceof AiRefusedError) return err.message;
    if (err instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check ANTHROPIC_API_KEY in .env.';
    if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a minute and try again.';
    if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the API. Check your connection.';
    if (err instanceof Anthropic.APIError) return `API error (${err.status ?? 'unknown'}). Try again.`;
    return err instanceof Error ? err.message : 'Unexpected error.';
  }

  return app;
}
