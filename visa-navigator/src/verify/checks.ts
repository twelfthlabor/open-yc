// Document verification. The model only reads fields off the document (see server/ai.ts);
// every pass/fail decision below is plain code against the route's sourced requirements.

import type { Route } from '../rules/types';
import type { CheckStatus, PassportRecord, Traveller, Trip, VerificationCheck } from '../store/model';
import { travellerName } from '../store/model';

export type DocKind = 'funds' | 'insurance' | 'accommodation' | 'ticket' | 'photo' | 'other';

export interface FundsFields {
  holder_name: string;
  bank_name: string;
  currency: string;
  closing_balance: number | null;
  statement_end_date: string;
}

export interface InsuranceFields {
  insured_names: string[];
  coverage_amount: number | null;
  currency: string;
  start_date: string;
  end_date: string;
  territory: string;
  covers_emergency: boolean | null;
  covers_repatriation: boolean | null;
}

export interface AccommodationFields {
  guest_names: string[];
  property_name: string;
  address: string;
  check_in: string;
  check_out: string;
}

export interface TicketFields {
  passenger_names: string[];
  outbound_date: string;
  return_date: string;
  from: string;
  to: string;
}

export interface PhotoFields {
  is_single_face_photo: boolean;
  plain_light_background: boolean | null;
}

export type ExtractedFields = FundsFields | InsuranceFields | AccommodationFields | TicketFields | PhotoFields | Record<string, unknown>;

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00Z');
const valid = (iso?: string | null) => Boolean(iso && /^\d{4}-\d{2}-\d{2}/.test(iso) && !Number.isNaN(toDate(iso).getTime()));

export function addMonths(iso: string, months: number): string {
  const d = toDate(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Days of the stay, counting both the arrival and departure day. */
export function stayDays(trip: Trip): number | undefined {
  const { departDate, returnDate } = trip.input;
  if (!valid(departDate) || !valid(returnDate)) return undefined;
  return Math.round((toDate(returnDate!).getTime() - toDate(departDate!).getTime()) / DAY) + 1;
}

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the document name contains the traveller's surname (accents and case ignored). */
export function nameMatches(docName: string, traveller: Traveller): boolean {
  const surname = traveller.passport?.surname ?? traveller.answers.surname ?? traveller.label.split(' ').slice(-1)[0];
  if (!surname) return false;
  const doc = ` ${normalizeName(docName)} `;
  return normalizeName(surname)
    .split(' ')
    .filter((p) => p.length > 1)
    .every((part) => doc.includes(` ${part} `));
}

const check = (id: string, label: string, status: CheckStatus, detail?: string): VerificationCheck => ({ id, label, status, detail });

export function overall(checks: VerificationCheck[]): CheckStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  if (checks.some((c) => c.status === 'pass')) return 'pass';
  return 'info';
}

const money = (n: number, currency: string) => `${currency === 'EUR' ? '€' : `${currency} `}${n.toLocaleString('en-GB')}`;

export function checkFunds(f: FundsFields, trip: Trip, route: Route, today: Date): VerificationCheck[] {
  const out: VerificationCheck[] = [];
  const days = stayDays(trip);
  const req = route.funds;
  if (req && days !== undefined) {
    const needed = req.perDay * days * trip.travellers.length;
    const label = `Balance covers ${money(req.perDay, req.currency)} × ${days} days × ${trip.travellers.length} traveller${trip.travellers.length > 1 ? 's' : ''} = ${money(needed, req.currency)}`;
    // Only a finite number is an amount. NaN and Infinity (from a mistyped field) are not readable balances.
    const balance = Number.isFinite(f.closing_balance) ? f.closing_balance : null;
    if (balance === null) out.push(check('balance', label, 'warn', 'Could not read the balance.'));
    else if (f.currency.toUpperCase() !== req.currency) out.push(check('balance', label, 'warn', `Statement is in ${f.currency}. Convert ${money(balance, f.currency)} to ${req.currency} and compare.`));
    else if (balance >= needed) out.push(check('balance', label, 'pass', `Balance shown: ${money(balance, f.currency)}.`));
    else {
      // A lower official figure (for example with a prepaid hotel) or a figure the app could not read on the page itself
      // makes a shortfall something to check, not a definite problem.
      const lower = req.reduced ? req.reduced.perDay * days * trip.travellers.length : undefined;
      if (lower !== undefined && balance >= lower) {
        out.push(check('balance', label, 'warn', `Balance shown: ${money(balance, f.currency)}. That meets ${money(req.reduced!.perDay, req.currency)} a day, which applies ${req.reduced!.when}.`));
      } else if (req.unquoted) {
        out.push(check('balance', label, 'warn', `Balance shown: ${money(balance, f.currency)}. Check the figure on the official page; the app could not read it there.`));
      } else out.push(check('balance', label, 'fail', `Balance shown: ${money(balance, f.currency)}.`));
    }
  } else if (!req) {
    out.push(check('balance', 'No minimum amount is stated for this route', 'info'));
  } else {
    out.push(check('balance', 'Add your travel dates to check the amount needed', 'warn'));
  }

  if (valid(f.statement_end_date)) {
    const age = Math.floor((today.getTime() - toDate(f.statement_end_date).getTime()) / DAY);
    out.push(check('recent', 'Statement is recent (within the last month)', age <= 31 ? 'pass' : 'warn', `Statement ends ${f.statement_end_date}.`));
  } else {
    out.push(check('recent', 'Statement date', 'warn', 'Could not read the statement date.'));
  }

  const holderOk = trip.travellers.some((t) => nameMatches(f.holder_name, t));
  out.push(check('holder', 'Account holder is one of the travellers', holderOk ? 'pass' : 'warn', f.holder_name ? `Holder: ${f.holder_name}. If a sponsor pays, include their letter.` : 'Could not read the holder name.'));
  return out;
}

export function checkInsurance(f: InsuranceFields, trip: Trip, route: Route, traveller: Traveller): VerificationCheck[] {
  const out: VerificationCheck[] = [];
  const req = route.insurance;
  if (req) {
    const label = `Coverage of at least ${money(req.minimum, req.currency)}`;
    if (f.coverage_amount === null) out.push(check('amount', label, 'warn', 'Could not read the coverage amount.'));
    else if (f.currency.toUpperCase() !== req.currency) out.push(check('amount', label, 'warn', `Policy is in ${f.currency}; check it equals at least ${money(req.minimum, req.currency)}.`));
    else out.push(check('amount', label, f.coverage_amount >= req.minimum ? 'pass' : 'fail', `Policy covers ${money(f.coverage_amount, f.currency)}.`));

    const territory = f.territory.toLowerCase();
    const covers = [req.territory.toLowerCase(), 'schengen', 'europe', 'worldwide', 'world'].some((t) => territory.includes(t));
    out.push(check('territory', `Valid for ${req.territory}`, covers ? 'pass' : f.territory ? 'fail' : 'warn', f.territory ? `Territory: ${f.territory}.` : 'Could not read the territory.'));
  }

  const { departDate, returnDate } = trip.input;
  if (valid(f.start_date) && valid(f.end_date) && valid(departDate) && valid(returnDate)) {
    const ok = f.start_date <= departDate! && f.end_date >= returnDate!;
    out.push(check('dates', 'Covers the whole stay', ok ? 'pass' : 'fail', `Policy ${f.start_date} to ${f.end_date}; trip ${departDate} to ${returnDate}.`));
  } else {
    out.push(check('dates', 'Covers the whole stay', 'warn', 'Could not compare the policy dates with your trip.'));
  }

  const flag = (v: boolean | null, id: string, label: string) =>
    out.push(check(id, label, v === true ? 'pass' : v === false ? 'fail' : 'warn', v === null ? 'Not stated on the document; check the policy wording.' : undefined));
  flag(f.covers_emergency, 'emergency', 'Covers emergency medical treatment and hospital');
  flag(f.covers_repatriation, 'repatriation', 'Covers repatriation');

  const named = f.insured_names.some((n) => nameMatches(n, traveller));
  out.push(check('name', `Names ${travellerName(traveller)}`, named ? 'pass' : 'warn', f.insured_names.length ? `Insured: ${f.insured_names.join(', ')}.` : 'Could not read the insured names.'));
  return out;
}

export function checkAccommodation(f: AccommodationFields, trip: Trip): VerificationCheck[] {
  const out: VerificationCheck[] = [];
  const { departDate, returnDate } = trip.input;
  if (valid(f.check_in) && valid(f.check_out) && valid(departDate) && valid(returnDate)) {
    const ok = f.check_in <= departDate! && f.check_out >= returnDate!;
    out.push(check('dates', 'Booking covers your stay', ok ? 'pass' : 'warn', `Booked ${f.check_in} to ${f.check_out}. If you have several bookings, upload each.`));
  } else {
    out.push(check('dates', 'Booking dates', 'warn', 'Could not compare the booking dates with your trip.'));
  }
  const named = trip.travellers.some((t) => f.guest_names.some((n) => nameMatches(n, t)));
  out.push(check('name', 'Booking is in a traveller’s name', named ? 'pass' : 'warn', f.guest_names.length ? `Guests: ${f.guest_names.join(', ')}.` : 'No guest name found.'));
  return out;
}

export function checkTicket(f: TicketFields, trip: Trip): VerificationCheck[] {
  const out: VerificationCheck[] = [];
  const near = (a: string, b?: string) => valid(a) && valid(b) && Math.abs(toDate(a).getTime() - toDate(b!).getTime()) <= DAY;
  out.push(check('outbound', 'Outbound flight matches your arrival date', near(f.outbound_date, trip.input.departDate) ? 'pass' : 'warn', `Ticket: ${f.outbound_date || 'unknown'}; trip: ${trip.input.departDate ?? 'not set'}.`));
  out.push(
    check(
      'return',
      'Return flight matches your departure date',
      !f.return_date ? 'fail' : near(f.return_date, trip.input.returnDate) ? 'pass' : 'warn',
      f.return_date ? `Ticket: ${f.return_date}; trip: ${trip.input.returnDate ?? 'not set'}.` : 'No return flight found on this ticket.',
    ),
  );
  for (const t of trip.travellers) {
    const named = f.passenger_names.some((n) => nameMatches(n, t));
    out.push(check(`name-${t.id}`, `Ticket names ${travellerName(t)}`, named ? 'pass' : 'warn'));
  }
  return out;
}

export function checkPhoto(f: PhotoFields): VerificationCheck[] {
  return [
    check('face', 'A single face, facing the camera', f.is_single_face_photo ? 'pass' : 'fail'),
    check('background', 'Plain, light background', f.plain_light_background === true ? 'pass' : f.plain_light_background === false ? 'fail' : 'warn'),
    check('size', 'Printed at 35×45 mm (check at the photo shop)', 'info'),
  ];
}

/** Passport checks need no AI: they use the confirmed passport record. */
export function checkPassport(p: PassportRecord | undefined, trip: Trip, route: Route, today: Date): VerificationCheck[] {
  if (!p) return [check('missing', 'Read the passport first', 'warn')];
  const out: VerificationCheck[] = [];
  const end = trip.input.returnDate;
  const schengen = route.formId === 'schengen_c' || route.id.startsWith('hrv');
  const rule = route.passportRule;
  if (valid(end) && valid(p.expiryDate) && rule && !schengen) {
    const needed = addMonths(end!, rule.monthsAfter);
    const status = p.expiryDate >= needed ? 'pass' : p.expiryDate < end! ? 'fail' : rule.exceptions ? 'warn' : 'fail';
    const extra = status === 'warn' ? ' Some countries are exempt from this rule; check the official list.' : '';
    out.push(check('validity', `Valid at least ${rule.monthsAfter} months after your stay`, status, `Expires ${p.expiryDate}; needs to be valid until ${needed}.${extra}`));
  } else if (valid(end) && valid(p.expiryDate)) {
    const needed = schengen ? addMonths(end!, 3) : end!;
    out.push(
      check(
        'validity',
        schengen ? 'Valid at least 3 months after you leave' : 'Valid for your whole stay',
        p.expiryDate >= needed ? 'pass' : 'fail',
        `Expires ${p.expiryDate}; needs to be valid until ${needed}.`,
      ),
    );
  }
  if (schengen) {
    if (valid(p.issueDate)) {
      const tenYearsAgo = new Date(today);
      tenYearsAgo.setUTCFullYear(tenYearsAgo.getUTCFullYear() - 10);
      out.push(check('issued', 'Issued within the last 10 years', toDate(p.issueDate!) >= tenYearsAgo ? 'pass' : 'fail', `Issued ${p.issueDate}.`));
    } else {
      out.push(check('issued', 'Issued within the last 10 years', 'warn', 'Add the issue date to check this.'));
    }
  }
  out.push(check('nationality', 'Passport nationality matches the application', p.nationality === trip.input.nationality ? 'pass' : 'warn', `Passport: ${p.nationality}; application: ${trip.input.nationality}.`));
  out.push(check('mrz', 'Machine-readable zone check digits', p.mrzValid ? 'pass' : 'warn', p.mrzValid ? undefined : 'Not verified; compare the numbers by eye.'));
  return out;
}

export function runChecks(kind: DocKind, fields: ExtractedFields, ctx: { trip: Trip; route: Route; traveller: Traveller; today?: Date }): VerificationCheck[] {
  const today = ctx.today ?? new Date();
  switch (kind) {
    case 'funds':
      return checkFunds(fields as FundsFields, ctx.trip, ctx.route, today);
    case 'insurance':
      return checkInsurance(fields as InsuranceFields, ctx.trip, ctx.route, ctx.traveller);
    case 'accommodation':
      return checkAccommodation(fields as AccommodationFields, ctx.trip);
    case 'ticket':
      return checkTicket(fields as TicketFields, ctx.trip);
    case 'photo':
      return checkPhoto(fields as PhotoFields);
    default:
      return [check('stored', 'Stored with your application. This document type is not checked automatically.', 'info')];
  }
}

/** Maps a checklist helper to the kind of document the verifier reads. */
export function docKindFor(helper?: string): DocKind {
  switch (helper) {
    case 'funds':
    case 'insurance':
    case 'accommodation':
    case 'photo':
      return helper;
    case 'ticket':
      return 'ticket';
    default:
      return 'other';
  }
}
