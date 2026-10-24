// Drafts built only from facts the user entered. Missing facts become [bracketed] prompts,
// never invented values.

import { countryName } from '../data/countries';
import { FORMS, answerById, type FormDef } from '../forms/forms';
import { PURPOSE_LABELS, type FormId } from '../rules/types';
import { travellerName, type Trip } from '../store/model';

const missing = (what: string) => `[add ${what}]`;
const or = (v: string | undefined, what: string) => (v && v.trim() ? v.trim() : missing(what));

const WITH_THE = new Set(['GBR', 'USA', 'ARE', 'NLD', 'PHL', 'BHS', 'GMB', 'CAF', 'COD', 'COG', 'DOM', 'MDV', 'MHL', 'SLB', 'VAT']);
/** Country name as used mid-sentence ("the United Kingdom"). */
export function placeName(code: string): string {
  return WITH_THE.has(code) ? `the ${countryName(code)}` : countryName(code);
}

/** Today's date in the user's time zone as YYYY-MM-DD (toISOString would give the UTC date). */
export function localISODate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function names(trip: Trip): string[] {
  return trip.travellers.map(travellerName);
}

function joinNames(list: string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

export function buildItinerary(trip: Trip): string {
  const { input } = trip;
  const lines: string[] = [];
  lines.push(`Travel itinerary for ${joinNames(names(trip))}`);
  lines.push(`Destination: ${countryName(input.destination)}`);
  lines.push(`Purpose: ${PURPOSE_LABELS[input.purpose]}`);
  lines.push(`Dates: ${or(formatDate(input.departDate), 'arrival date')} to ${or(formatDate(input.returnDate), 'departure date')}`);
  lines.push('');

  const flights = [...trip.flights].sort((a, b) => a.date.localeCompare(b.date));
  if (flights.length) {
    lines.push('Flights');
    for (const f of flights) {
      lines.push(`- ${or(formatDate(f.date), 'date')}: ${or(f.from, 'from')} to ${or(f.to, 'to')}${f.flightNo ? ` (${f.flightNo})` : ''}`);
    }
    lines.push('');
  }

  const stops = [...trip.stops].sort((a, b) => a.date.localeCompare(b.date));
  if (stops.length) {
    lines.push('Day by day');
    for (const s of stops) {
      lines.push(`- ${or(formatDate(s.date), 'date')}, ${or(s.city, 'city')}: staying at ${or(s.lodging, 'accommodation')}.${s.plans ? ` ${s.plans.trim()}` : ''}`);
    }
  } else {
    lines.push(missing('your day-by-day plan in the itinerary editor'));
  }
  return lines.join('\n');
}

export function buildCoverLetter(trip: Trip, formId?: FormId, today: Date = new Date()): string {
  const { input } = trip;
  const form: FormDef | undefined = formId ? FORMS[formId] : undefined;
  const lead = trip.travellers[0];
  const a = (id: string) => (lead ? answerById(trip, lead, id, form) : '');
  const leadName = lead ? travellerName(lead) : '';
  const others = trip.travellers.slice(1).map(travellerName);
  const occupation = a('occupation');
  const employer = a('employer');
  const coveredBy = a('cost_covered_by');
  const stay = [a('host_name'), a('host_address')].filter(Boolean).join(', ');

  const work = occupation
    ? `I work as ${occupation}${employer ? ` at ${employer.split('\n')[0]}` : ''}.`
    : missing('your occupation in the application answers');
  const funding =
    coveredBy === 'The applicant'
      ? 'I am paying for the trip myself.'
      : coveredBy
        ? `The trip is being paid for by: ${coveredBy.toLowerCase()}.`
        : missing('who is paying for the trip');
  const companions = others.length ? ` I am travelling with ${joinNames(others)}, whose applications are submitted together with mine.` : '';

  return [
    or(leadName, 'your full name'),
    or(a('address'), 'your home address'),
    or(a('email'), 'your email'),
    '',
    formatDate(localISODate(today)),
    '',
    'To the visa officer',
    '',
    `I am applying to visit ${placeName(input.destination)} for ${PURPOSE_LABELS[input.purpose].toLowerCase()}, from ${or(formatDate(input.departDate), 'arrival date')} to ${or(formatDate(input.returnDate), 'departure date')}. My passport number is ${or(a('passport_number'), 'passport number')}.${companions}`,
    '',
    `During my visit I will stay at ${or(stay, 'where you will stay')}. My itinerary is attached.`,
    '',
    `${work} ${funding}`,
    '',
    `I will return home on ${or(formatDate(input.returnDate), 'departure date')}. Supporting documents are enclosed.`,
    '',
    'Yours faithfully,',
    or(leadName, 'your full name'),
  ].join('\n');
}

/** Phrases a draft must never contain: the app does not predict or promise decisions. */
export const FORBIDDEN_PHRASES = [/guarantee/i, /will be approved/i, /certain(ly)? to be granted/i, /you are eligible/i, /you qualify/i];

// Phrases with the spaces removed, for text where the words are spaced out or separated by punctuation.
const SQUASHED_PHRASES = FORBIDDEN_PHRASES.map((re) => new RegExp(re.source.replace(/ /g, ''), 'i'));

// Letters from Cyrillic and Greek that look like Latin ones.
const LOOKALIKES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ν: 'v', α: 'a', ο: 'o', ρ: 'p', τ: 't', ι: 'i', κ: 'k',
};
const INVISIBLE = /[­​-‍⁠﻿]/g;

/** The text as a reader sees it: compatibility forms folded, invisible characters removed, lookalike letters mapped, spacing collapsed. */
export function foldForCheck(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .toLowerCase()
    .replace(/[\s\S]/gu, (ch) => LOOKALIKES[ch] ?? ch)
    .replace(/\s+/g, ' ');
}

export function hasForbiddenPhrase(text: string): boolean {
  const folded = foldForCheck(text);
  const letters = folded.replace(/[^a-z]/g, '');
  return FORBIDDEN_PHRASES.some((re) => re.test(folded)) || SQUASHED_PHRASES.some((re) => re.test(letters));
}
