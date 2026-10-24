// AI cover letter, grounded in the trip. The browser builds a list of facts from the user's own answers; the
// model writes the letter body from those facts only. Sensitive values (passport number, home address, email)
// never leave the machine: they are sent as {{TOKENS}} and put back locally. The server rejects a letter that
// contains a number not found in the facts, or wording that predicts a decision.

import { FORMS, answerById } from '../forms/forms';
import { PURPOSE_LABELS, type Route } from '../rules/types';
import { travellerName, type Trip } from '../store/model';
import { dayPlan } from './itinerary';
import { formatDate, localISODate, placeName } from './templates';

export interface CoverFacts {
  /** Label → value. Only these facts may appear in the letter. */
  facts: Record<string, string>;
  /** Facts the letter needs but the user has not given; the letter keeps an [add …] placeholder for each. */
  missing: string[];
  /** Token → real value, kept in the browser. */
  tokens: Record<string, string>;
}

const TOKEN = { passport: '{{PASSPORT_NUMBER}}', address: '{{HOME_ADDRESS}}', email: '{{EMAIL}}' };

export function coverLetterFacts(trip: Trip, route: Route): CoverFacts {
  const form = route.formId ? FORMS[route.formId] : undefined;
  const lead = trip.travellers[0];
  const a = (id: string) => (lead ? answerById(trip, lead, id, form).trim() : '');
  const facts: Record<string, string> = {};
  const missing: string[] = [];
  const tokens: Record<string, string> = {};
  const put = (label: string, value: string | undefined, need?: string) => {
    if (value && value.trim()) facts[label] = value.trim();
    else if (need) missing.push(need);
  };

  put('Applicant', lead ? travellerName(lead) : '', 'your full name');
  const others = trip.travellers.slice(1).map(travellerName);
  if (others.length) put('Travelling with', others.join(', '));
  put('Destination', placeName(trip.input.destination));
  put('Visa applied for', route.title);
  put('Purpose', PURPOSE_LABELS[trip.input.purpose].toLowerCase());
  put('Arrival date', formatDate(trip.input.departDate), 'arrival date');
  put('Departure date', formatDate(trip.input.returnDate), 'departure date');

  const rows = dayPlan(trip);
  if (rows.length) put('Length of stay', `${rows.length} days`);
  const cities = [...new Set(rows.map((r) => r.city).filter(Boolean))];
  put('Cities on the itinerary', cities.join(', '), 'the cities you will visit');
  const lodging = [...new Set(rows.map((r) => r.lodging).filter(Boolean))];
  const host = [a('host_name'), a('us_contact')].filter(Boolean).join('; ');
  put('Accommodation', lodging.join('; ') || host, 'where you will stay');
  const flights = trip.flights.filter((f) => f.date).map((f) => `${formatDate(f.date)} ${f.from} to ${f.to}${f.flightNo ? ` (${f.flightNo})` : ''}`);
  if (flights.length) put('Flights booked', flights.join('; '));

  put('Occupation', a('occupation'), 'your occupation');
  put('Employer or school', a('employer').split('\n')[0]);
  const payer = a('cost_covered_by');
  put('Trip paid for by', payer === 'The applicant' || payer === 'Self' ? 'the applicant' : payer.toLowerCase(), 'who is paying for the trip');

  const passport = a('passport_number') || lead?.passport?.documentNumber || '';
  if (passport) {
    facts['Passport number'] = TOKEN.passport;
    tokens[TOKEN.passport] = passport;
  } else missing.push('passport number');
  const address = a('address');
  if (address) tokens[TOKEN.address] = address;
  const email = a('email');
  if (email) tokens[TOKEN.email] = email;
  return { facts, missing, tokens };
}

/** Header (sender, date) and sign-off are built locally, so the model only writes the body. */
export function assembleLetter(body: string, cf: CoverFacts, today: Date = new Date()): string {
  const name = cf.facts.Applicant ?? '[add your full name]';
  const header = [name, cf.tokens[TOKEN.address] ? TOKEN.address : '[add your home address]', cf.tokens[TOKEN.email] ? TOKEN.email : '[add your email]', '', formatDate(localISODate(today)), ''];
  return fillTokens([...header, body.trim(), '', 'Yours faithfully,', name].join('\n'), cf.tokens);
}

export function fillTokens(text: string, tokens: Record<string, string>): string {
  return Object.entries(tokens).reduce((t, [k, v]) => t.split(k).join(v), text);
}

/** Numbers in the text (dates, amounts, flight numbers) that do not appear anywhere in the facts. */
export function unsupportedNumbers(text: string, facts: Record<string, string>): string[] {
  const known = new Set((Object.values(facts).join(' ').match(/\d+/g) ?? []).map((n) => String(Number(n))));
  const found = text.match(/\d+/g) ?? [];
  return [...new Set(found.filter((n) => !known.has(String(Number(n)))))];
}

/** The text that is sent, shown to the user before they press send. */
export function factsPreview(cf: CoverFacts): string {
  const lines = Object.entries(cf.facts).map(([k, v]) => `${k}: ${v}`);
  if (cf.missing.length) lines.push(`Missing (kept as placeholders): ${cf.missing.join(', ')}`);
  return lines.join('\n');
}

