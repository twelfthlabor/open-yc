// Mocked model. These tests check the server's guards around the new AI features (cover letter, plan
// suggestions, pre-review): what is sent, and what is thrown away. They say nothing about a real model's output.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { method: 'create' | 'parse'; params: Record<string, unknown> };
const fake = vi.hoisted(() => ({
  calls: [] as Call[],
  reply: (() => ({})) as (method: 'create' | 'parse', params: Record<string, unknown>) => unknown,
}));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = (await importOriginal()) as { default: Record<string, unknown> };
  class FakeAnthropic {
    messages = {
      create: async (params: Record<string, unknown>) => {
        fake.calls.push({ method: 'create', params });
        return fake.reply('create', params);
      },
      parse: async (params: Record<string, unknown>) => {
        fake.calls.push({ method: 'parse', params });
        return fake.reply('parse', params);
      },
    };
  }
  Object.assign(FakeAnthropic, {
    AuthenticationError: actual.default.AuthenticationError,
    RateLimitError: actual.default.RateLimitError,
    APIConnectionError: actual.default.APIConnectionError,
    APIError: actual.default.APIError,
  });
  return { ...actual, default: FakeAnthropic };
});

import { createApp } from './app';
import { ScheduleStore } from './schedule';

const LOCAL = { host: '127.0.0.1:8787', origin: 'http://localhost:5173', 'content-type': 'application/json' };
const text = (t: string) => () => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
const parsed = (o: unknown) => () => ({ parsed_output: o, stop_reason: 'end_turn', content: [] });

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  fake.calls.length = 0;
  app = createApp(new ScheduleStore(mkdtempSync(path.join(tmpdir(), 'vn-draft-'))));
});
const post = (url: string, body: unknown) => app.request(url, { method: 'POST', headers: LOCAL, body: JSON.stringify(body) });

const FACTS = { Applicant: 'Anna Hassan', Destination: 'Sweden', 'Arrival date': '1 December 2026', 'Departure date': '5 December 2026', 'Passport number': '{{PASSPORT_NUMBER}}' };

describe('AI cover letter', () => {
  it('sends the facts in the user message, not the system prompt, and returns a clean letter', async () => {
    fake.reply = text('To the visa officer,\nI will visit Sweden from 1 December 2026 to 5 December 2026. My passport number is {{PASSPORT_NUMBER}}.');
    const res = await post('/api/cover-letter', { facts: FACTS, missing: ['your occupation'] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { text: string }).text).toContain('{{PASSPORT_NUMBER}}');
    const call = fake.calls[0];
    expect(String(call.params.system)).toMatch(/Use only the facts given/);
    const msg = (call.params.messages as { content: string }[])[0].content;
    expect(msg).toContain('Anna Hassan');
    expect(msg).toContain('Missing: your occupation');
  });

  it('discards a letter with a number that is not in the facts', async () => {
    fake.reply = text('To the visa officer,\nI have savings of €12,000 and arrive on 1 December 2026.');
    const res = await post('/api/cover-letter', { facts: FACTS, missing: [] });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/not in your facts/);
  });

  it('discards a letter that promises a decision', async () => {
    fake.reply = text('To the visa officer,\nI am certain to be granted the visa.');
    expect((await post('/api/cover-letter', { facts: FACTS, missing: [] })).status).toBe(422);
  });

  it('rejects malformed input and works without a key in manual mode (503 with a way forward)', async () => {
    expect((await post('/api/cover-letter', { facts: 'x' })).status).toBe(400);
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post('/api/cover-letter', { facts: FACTS, missing: [] });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/Draft from my answers/);
  });
});

describe('plan suggestions', () => {
  it('keeps only the dates asked about, one per date, and drops times, prices and promises', async () => {
    fake.reply = parsed({
      days: [
        { date: '2026-12-02', suggestion: 'Walk around Gamla stan and visit the Vasa Museum.' },
        { date: '2026-12-02', suggestion: 'A second idea for the same day.' },
        { date: '2026-12-03', suggestion: 'Dinner at 19:00, tickets 200 SEK.' },
        { date: '2026-12-04', suggestion: 'Your visa will be approved, enjoy the city.' },
        { date: '2027-01-01', suggestion: 'A day that was never asked about.' },
      ],
    });
    const res = await post('/api/suggest-plans', { purpose: 'Tourism', days: [{ date: '2026-12-02', city: 'Stockholm' }, { date: '2026-12-03', city: 'Stockholm' }, { date: '2026-12-04', city: 'Uppsala' }] });
    expect(res.status).toBe(200);
    const days = ((await res.json()) as { days: Array<{ date: string; suggestion: string }> }).days;
    expect(days).toEqual([{ date: '2026-12-02', suggestion: 'Walk around Gamla stan and visit the Vasa Museum.' }]);
  });

  it('validates the request', async () => {
    expect((await post('/api/suggest-plans', { purpose: 'x', days: [] })).status).toBe(400);
    expect((await post('/api/suggest-plans', { purpose: 'x', days: [{ date: 'tomorrow', city: 'A' }] })).status).toBe(400);
  });
});

describe('AI pre-review', () => {
  it('drops findings that grade the application or predict the decision', async () => {
    fake.reply = parsed({
      findings: [
        { area: 'Itinerary and dates', severity: 'warn', comment: 'Day 3 says Uppsala but the hotel booking is in Stockholm.' },
        { area: 'Cover letter', severity: 'info', comment: 'This is a strong application and likely to succeed.' },
        { area: 'Cover letter', severity: 'info', comment: 'Your chances are good.' },
      ],
    });
    const res = await post('/api/pre-review', { packet: 'Rubric results...' });
    expect(res.status).toBe(200);
    const findings = ((await res.json()) as { findings: Array<{ comment: string }> }).findings;
    expect(findings.map((f) => f.comment)).toEqual(['Day 3 says Uppsala but the hotel booking is in Stockholm.']);
    expect(String(fake.calls[0].params.system)).toMatch(/Do not judge the chance of approval/);
  });

  it('answers 503 without a key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await post('/api/pre-review', { packet: 'x' })).status).toBe(503);
  });
});
