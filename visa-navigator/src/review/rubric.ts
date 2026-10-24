// Pre-review before a human looks at the application. The rubric is plain code over the user's own data:
// completeness, consistency between dates, bookings and documents, and leftover placeholders. It gives no
// score and no prediction of the decision (docs/PLAN.md rule 4). An optional AI pass adds comments on top,
// and a human reviewer gets an exported packet. None of this is legal advice.

import { itineraryIssues } from '../drafts/itinerary';
import { hasForbiddenPhrase, formatDate } from '../drafts/templates';
import { allFields, fieldValue, formFor } from '../forms/forms';
import type { Route } from '../rules/types';
import { doneKey, travellerName, type CheckStatus, type Trip } from '../store/model';
import { checkPassport } from '../verify/checks';
import { countryName } from '../data/countries';

export type RubricArea = 'passports' | 'documents' | 'form' | 'itinerary' | 'cover_letter' | 'booking';

export const RUBRIC: Record<RubricArea, { title: string; asks: string }> = {
  passports: { title: 'Passports', asks: 'Every traveller has a confirmed passport that meets the validity rule for this route.' },
  documents: { title: 'Supporting documents', asks: 'Every required document is collected, and the ones the app could read pass their checks (funds, insurance, bookings, tickets, photo).' },
  form: { title: 'Application form', asks: 'Every required answer is filled in for every traveller.' },
  itinerary: { title: 'Itinerary and dates', asks: 'The day-by-day plan covers every day of the trip, every night has accommodation, and flights and bookings match the trip dates.' },
  cover_letter: { title: 'Cover letter', asks: 'If included, it has no placeholders left, matches the trip dates and makes no promises about the decision.' },
  booking: { title: 'Appointment', asks: 'The appointment is booked, or the next booking step is clear.' },
};

export interface RubricItem {
  area: RubricArea;
  status: CheckStatus;
  text: string;
}

const ORDER: RubricArea[] = ['passports', 'documents', 'form', 'itinerary', 'cover_letter', 'booking'];

export function runRubric(trip: Trip, route: Route, today: Date = new Date()): RubricItem[] {
  const out: RubricItem[] = [];
  const has = (f: string) => route.features.includes(f as never);
  const push = (area: RubricArea, status: CheckStatus, text: string) => out.push({ area, status, text });

  // Passports
  for (const t of trip.travellers) {
    if (!t.passport) {
      push('passports', 'fail', `${t.label}: passport not read or confirmed yet.`);
      continue;
    }
    const checks = checkPassport(t.passport, trip, route, today).filter((c) => c.status === 'fail' || c.status === 'warn');
    if (checks.length === 0) push('passports', 'pass', `${travellerName(t)}: passport checks pass.`);
    for (const c of checks) push('passports', c.status, `${travellerName(t)}: ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
  }

  // Documents
  if (has('documents')) {
    for (const c of route.checklist) {
      const who = c.perTraveller ? trip.travellers : [undefined];
      for (const t of who) {
        const name = t ? ` (${travellerName(t)})` : '';
        const doc = t ? t.documents[c.id] : trip.sharedDocuments[c.id];
        const done = trip.checklistDone[doneKey(c.id, t?.id)];
        if (!done && c.required) push('documents', 'fail', `Missing: ${c.label}${name}.`);
        else if (doc?.verification?.overall === 'fail') {
          const fails = doc.verification.checks.filter((x) => x.status === 'fail').map((x) => x.label);
          push('documents', 'fail', `${c.label}${name} failed a check: ${fails.join('; ')}.`);
        } else if (doc?.verification?.overall === 'warn') push('documents', 'warn', `${c.label}${name}: some details need checking by eye.`);
        else if (done) push('documents', 'pass', `${c.label}${name}: collected.`);
      }
    }
  }

  // Form
  const form = formFor(route);
  if (form && has('form')) {
    for (const t of trip.travellers) {
      const empty = allFields(form).filter((f) => !f.optional && !fieldValue(trip, t, f));
      if (empty.length) push('form', 'fail', `${travellerName(t)}: ${empty.length} required answer${empty.length > 1 ? 's' : ''} empty, starting with “${empty[0].label}”.`);
      else push('form', 'pass', `${travellerName(t)}: every required answer is filled in.`);
    }
  }

  // Itinerary
  if (has('itinerary')) {
    const issues = itineraryIssues(trip);
    for (const i of issues) push('itinerary', i.level, i.text);
    if (!trip.itineraryText.trim()) push('itinerary', 'warn', 'The itinerary document has not been built yet.');
    else if (trip.itineraryText.includes('[add')) push('itinerary', 'fail', 'The itinerary still has [add …] placeholders.');
    if (issues.length === 0 && trip.itineraryText.trim() && !trip.itineraryText.includes('[add')) push('itinerary', 'pass', 'Every day and night is accounted for and matches the trip dates.');
  }

  // Cover letter
  if (has('cover_letter') && trip.coverLetter.trim()) {
    const letter = trip.coverLetter;
    if (letter.includes('[add')) push('cover_letter', 'fail', 'The cover letter still has [add …] placeholders.');
    if (/\{\{[A-Z_]+\}\}/.test(letter)) push('cover_letter', 'fail', 'The cover letter has an unfilled {{…}} token.');
    if (hasForbiddenPhrase(letter)) push('cover_letter', 'fail', 'The cover letter promises or predicts a decision; remove that wording.');
    for (const [label, iso] of [['arrival', trip.input.departDate], ['departure', trip.input.returnDate]] as const) {
      if (iso && !letter.includes(formatDate(iso))) push('cover_letter', 'warn', `The ${label} date (${formatDate(iso)}) is not in the letter; check it matches the trip.`);
    }
    if (!out.some((x) => x.area === 'cover_letter')) push('cover_letter', 'pass', 'No placeholders, the dates match and no promises about the decision.');
  } else if (has('cover_letter')) {
    push('cover_letter', 'info', 'No cover letter. It is optional on this route.');
  }

  // Booking
  if (route.appointment && route.appointment !== 'none') {
    const b = buildBookingStatus(trip);
    push('booking', b.status, b.text);
  }

  return out.sort((a, b) => ORDER.indexOf(a.area) - ORDER.indexOf(b.area));
}

function buildBookingStatus(trip: Trip): { status: CheckStatus; text: string } {
  const tr = trip.tracker;
  if (tr.appointmentAt) return { status: 'pass', text: `Appointment on ${formatDate(tr.appointmentAt.slice(0, 10))}${tr.appointmentPlace ? ` at ${tr.appointmentPlace}` : ''}.` };
  const done = Object.values(tr.booking?.done ?? {}).filter(Boolean).length;
  return { status: 'warn', text: done ? `Appointment not booked yet (${done} booking step${done > 1 ? 's' : ''} done).` : 'Appointment not booked yet. See Appointment & tracking.' };
}

export function rubricSummary(items: RubricItem[]): Record<'fail' | 'warn' | 'pass', number> {
  return {
    fail: items.filter((i) => i.status === 'fail').length,
    warn: items.filter((i) => i.status === 'warn').length,
    pass: items.filter((i) => i.status === 'pass').length,
  };
}

/** Passport number shown as its last 3 characters, for packets that leave the device. */
export function maskNumber(n: string): string {
  return n.length <= 3 ? '•••' : `${'•'.repeat(n.length - 3)}${n.slice(-3)}`;
}

/** Answers that identify or contact a person; masked in anything that leaves the device. */
export const SENSITIVE_FIELDS = new Set(['passport_number', 'passport_book_number', 'national_id', 'us_ssn', 'address', 'phone', 'email', 'social_media']);

/**
 * Replaces every passport number and every sensitive answer the travellers entered (and each line of a multi-line
 * answer, such as an address) wherever it appears in free text.
 */
export function scrubPersonal(text: string, trip: Trip, replace: (value: string, isPassport: boolean) => string): string {
  const passports = new Set(trip.travellers.map((t) => t.passport?.documentNumber ?? '').filter(Boolean));
  const values = trip.travellers
    .flatMap((t) => [t.passport?.documentNumber ?? '', ...[...SENSITIVE_FIELDS].map((id) => t.answers[id] ?? '')])
    .flatMap((v) => [v, ...v.split('\n')])
    .map((v) => v.trim())
    .filter((v) => v.length >= 4)
    .sort((a, b) => b.length - a.length);
  return values.reduce((x, v) => x.split(v).join(replace(v, passports.has(v))), text);
}

/**
 * What the AI reviewer sees: the rubric results and the texts the user wrote, with passport numbers, the travellers'
 * own addresses, emails and phone numbers, and anything shaped like an email or a phone number removed.
 * No images and no documents.
 */
export function aiReviewInput(trip: Trip, route: Route, items: RubricItem[]): string {
  const strip = (s: string) =>
    scrubPersonal(s, trip, (_v, isPassport) => (isPassport ? '[passport number]' : '[personal detail]'))
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
      // Phone-shaped: 9+ digits with optional spaces or dashes, not a YYYY-MM-DD date.
      .replace(/(?<![\d-])\+?\d(?:[\s-]?\d){8,}(?![\d-])/g, '[phone]');
  return [
    `Route: ${route.title} (${countryName(trip.input.nationality)} passport to ${countryName(trip.input.destination)}).`,
    `Trip: ${trip.input.departDate ?? '?'} to ${trip.input.returnDate ?? '?'}, ${trip.travellers.length} traveller(s), purpose ${trip.input.purpose}.`,
    '',
    'Rubric results (computed by code):',
    ...items.map((i) => `- [${i.status}] ${RUBRIC[i.area].title}: ${strip(i.text)}`),
    '',
    'Itinerary:',
    strip(trip.itineraryText || '(none)'),
    '',
    'Cover letter:',
    strip(trip.coverLetter || '(none)'),
  ].join('\n');
}
