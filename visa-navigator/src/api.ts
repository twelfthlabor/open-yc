import type { Reminder } from './notify/reminders';

export interface PassportExtraction {
  readable: boolean;
  mrz_line1: string;
  mrz_line2: string;
  surname: string;
  given_names: string;
  passport_number: string;
  nationality: string;
  birth_date: string;
  expiry_date: string;
  issue_date: string;
  place_of_birth: string;
  issuing_authority: string;
  sex: string;
  uncertain_fields: string[];
}

export interface Health {
  ai: boolean;
  whatsapp: { configured: boolean; template: boolean };
  online: boolean;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init });
  } catch {
    throw new TypeError('The local server is not running. Start it with `npm run dev`.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
  return body as T;
}

export async function health(): Promise<Health> {
  try {
    return { ...(await call<Omit<Health, 'online'>>('/api/health')), online: true };
  } catch {
    return { ai: false, whatsapp: { configured: false, template: false }, online: false };
  }
}

export function extractPassport(image: string, mediaType: string): Promise<PassportExtraction> {
  return call('/api/extract-passport', { method: 'POST', body: JSON.stringify({ image, mediaType }) });
}

export function extractDocument(kind: string, data: string, mediaType: string): Promise<Record<string, unknown>> {
  return call('/api/extract-document', { method: 'POST', body: JSON.stringify({ kind, data, mediaType }) });
}

export async function polish(kind: 'itinerary' | 'cover_letter', draft: string): Promise<string> {
  return (await call<{ text: string }>('/api/polish', { method: 'POST', body: JSON.stringify({ kind, draft }) })).text;
}

export function syncReminders(body: { tripId: string; to: string; whatsapp: boolean; reminders: Reminder[] }): Promise<{ ok: boolean; pending: number }> {
  return call('/api/reminders', { method: 'PUT', body: JSON.stringify(body) });
}

export function deleteTripReminders(tripId: string): Promise<{ ok: boolean }> {
  return call(`/api/reminders/${encodeURIComponent(tripId)}`, { method: 'DELETE' });
}

export interface ScheduleView {
  to: string;
  whatsapp: boolean;
  reminders: Array<Reminder & { sentAt?: string; skippedAt?: string; error?: string }>;
}

export function getSchedule(): Promise<ScheduleView> {
  return call('/api/reminders');
}

export function sendTestWhatsApp(to: string): Promise<{ ok: boolean; sid: string }> {
  return call('/api/notify/test', { method: 'POST', body: JSON.stringify({ to }) });
}

export type AutofillWait = 'captcha' | 'login' | 'needs_you' | 'declaration' | 'submit' | 'payment' | 'other_site' | 'stuck' | 'nothing_to_do';

export interface AutofillStatus {
  state: 'idle' | 'starting' | 'running' | 'waiting' | 'submitted' | 'stopped' | 'error';
  waitingFor?: AutofillWait;
  message: string;
  url: string;
  filled: Array<{ itemId: string; label: string }>;
  needsYou: string[];
  captured: { serial?: string; pin?: string; reference?: string };
  log: Array<{ at: string; text: string }>;
}

export function startAutofill(body: {
  formId: string;
  applyUrl?: string;
  destination?: string;
  allowSubmit: boolean;
  items: Array<{ id: string; label: string; number?: string; value: string; type?: string }>;
}): Promise<AutofillStatus> {
  return call('/api/autofill/start', { method: 'POST', body: JSON.stringify(body) });
}

export function autofillStatus(): Promise<AutofillStatus> {
  return call('/api/autofill/status');
}

export function stopAutofill(): Promise<AutofillStatus> {
  return call('/api/autofill/stop', { method: 'POST', body: '{}' });
}

export async function writeCoverLetter(facts: Record<string, string>, missing: string[]): Promise<string> {
  return (await call<{ text: string }>('/api/cover-letter', { method: 'POST', body: JSON.stringify({ facts, missing }) })).text;
}

export async function suggestPlans(purpose: string, days: Array<{ date: string; city: string }>): Promise<Array<{ date: string; suggestion: string }>> {
  return (await call<{ days: Array<{ date: string; suggestion: string }> }>('/api/suggest-plans', { method: 'POST', body: JSON.stringify({ purpose, days }) })).days;
}

export async function preReview(packet: string): Promise<Array<{ area: string; severity: 'fail' | 'warn' | 'info'; comment: string }>> {
  return (await call<{ findings: Array<{ area: string; severity: 'fail' | 'warn' | 'info'; comment: string }> }>('/api/pre-review', { method: 'POST', body: JSON.stringify({ packet }) })).findings;
}
