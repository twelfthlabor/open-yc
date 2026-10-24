import { describe, expect, it } from 'vitest';
import { checkRequest, hostIsLocal } from './guard';
import { partitionDue, replaceTrip, type StoredReminder } from './schedule';
import { buildMessageParams, toWhatsAppAddress, whatsappConfig } from './whatsapp';

const ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

describe('request guard', () => {
  it('accepts the app on localhost', () => {
    expect(checkRequest({ method: 'POST', host: 'localhost:5173', origin: 'http://localhost:5173', contentType: 'application/json' }, ORIGINS)).toBeNull();
  });
  it('rejects other web pages (cross-site) and form posts', () => {
    expect(checkRequest({ method: 'POST', host: 'localhost:5173', origin: 'https://evil.example', contentType: 'application/json' }, ORIGINS)).toMatch(/app/);
    expect(checkRequest({ method: 'POST', host: 'localhost:5173', origin: 'http://localhost:5173', contentType: 'text/plain' }, ORIGINS)).toMatch(/JSON/);
    expect(checkRequest({ method: 'POST', host: 'localhost:5173', contentType: 'application/json' }, ORIGINS)).toMatch(/app/);
  });
  it('rejects DNS-rebinding hosts even for GET', () => {
    expect(hostIsLocal('evil.example:8787')).toBe(false);
    expect(checkRequest({ method: 'GET', host: 'evil.example:5173' }, ORIGINS)).toMatch(/computer/);
    expect(checkRequest({ method: 'GET', host: '127.0.0.1:8787' }, ORIGINS)).toBeNull();
  });
});

describe('reminder schedule', () => {
  const r = (id: string, at: string, extra: Partial<StoredReminder> = {}): StoredReminder => ({ id, tripId: 't', at, title: 'x', body: 'y', kind: 'k', ...extra });
  const now = new Date('2026-10-10T12:00:00Z');

  it('sends due reminders and skips ones missed by more than two days', () => {
    const { send, skip } = partitionDue([r('a', '2026-10-10T11:00:00Z'), r('b', '2026-10-01T00:00:00Z'), r('c', '2026-10-11T00:00:00Z'), r('d', '2026-10-10T10:00:00Z', { sentAt: 'x' })], now);
    expect(send.map((x) => x.id)).toEqual(['a']);
    expect(skip.map((x) => x.id)).toEqual(['b']);
  });

  it('replacing a trip keeps sent history and does not resend', () => {
    const file = { to: '', whatsapp: true, reminders: [r('a', '2026-10-09T00:00:00Z', { sentAt: 'x' }), r('b', '2026-10-12T00:00:00Z')] };
    const next = replaceTrip(file, 't', [r('a', '2026-10-09T00:00:00Z'), r('c', '2026-10-13T00:00:00Z')]);
    expect(next.reminders.map((x) => x.id).sort()).toEqual(['a', 'c']);
    expect(next.reminders.find((x) => x.id === 'a')?.sentAt).toBe('x');
  });
});

describe('WhatsApp via Twilio', () => {
  it('needs account, sender and credentials', () => {
    expect(whatsappConfig({})).toBeNull();
    expect(whatsappConfig({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_WHATSAPP_FROM: '+14155238886' })).toBeNull();
    expect(whatsappConfig({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_WHATSAPP_FROM: '+14155238886', TWILIO_AUTH_TOKEN: 't' })?.username).toBe('AC1');
  });

  it('formats numbers in E.164 with the whatsapp prefix', () => {
    expect(toWhatsAppAddress('+1 (415) 555-0100')).toBe('whatsapp:+14155550100');
    expect(toWhatsAppAddress('4155550100')).toBeNull();
  });

  it('uses a content template when configured, free text otherwise', () => {
    const base = { accountSid: 'AC1', username: 'AC1', password: 't', from: '+14155238886' };
    const free = buildMessageParams(base, 'whatsapp:+1', 'T', 'B');
    expect(free.get('Body')).toBe('T\nB');
    expect(free.get('From')).toBe('whatsapp:+14155238886');
    const tpl = buildMessageParams({ ...base, contentSid: 'HX1' }, 'whatsapp:+1', 'T', 'B');
    expect(tpl.get('ContentSid')).toBe('HX1');
    expect(JSON.parse(tpl.get('ContentVariables')!)).toEqual({ 1: 'T', 2: 'B' });
    expect(tpl.get('Body')).toBeNull();
  });
});
