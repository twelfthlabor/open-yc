// Day-by-day itinerary built only from the user's own entries (trip dates, flights, stays, plans) and the
// dates read off their booking documents. Nothing here invents a place, a booking or a time: a day with no
// entry gets a [add …] placeholder, and the consistency check lists every mismatch for the user to fix.

import { countryName } from '../data/countries';
import { PURPOSE_LABELS } from '../rules/types';
import { travellerName, type Flight, type Trip } from '../store/model';

const DAY = 86_400_000;
const MAX_DAYS = 120;
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)));

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every date of the trip, arrival and departure day included. Empty when the dates are missing or reversed. */
export function tripDates(trip: Trip): string[] {
  const { departDate, returnDate } = trip.input;
  if (!isDate(departDate) || !isDate(returnDate) || returnDate! < departDate!) return [];
  const n = Math.round((Date.parse(`${returnDate}T00:00:00Z`) - Date.parse(`${departDate}T00:00:00Z`)) / DAY) + 1;
  return Array.from({ length: Math.min(n, MAX_DAYS) }, (_, i) => addDays(departDate!, i));
}

export interface DayRow {
  day: number;
  date: string;
  city: string;
  /** Where the traveller sleeps that night. Empty on the departure day. */
  lodging: string;
  plans: string;
  flights: Flight[];
  /** True when the user entered this date themselves; false when city and lodging carry over from an earlier day. */
  entered: boolean;
  /** Plans on this day are an accepted AI suggestion, not the user's own words. */
  suggested: boolean;
}

/** One row per day. City and lodging carry forward from the latest entry on or before the day. */
export function dayPlan(trip: Trip): DayRow[] {
  const dates = tripDates(trip);
  const stops = [...trip.stops].filter((s) => isDate(s.date)).sort((a, b) => a.date.localeCompare(b.date));
  const last = dates[dates.length - 1];
  return dates.map((date, i) => {
    const exact = stops.filter((s) => s.date === date).pop();
    const before = stops.filter((s) => s.date <= date).pop();
    const base = exact ?? before;
    return {
      day: i + 1,
      date,
      city: base?.city.trim() ?? '',
      lodging: date === last ? '' : base?.lodging.trim() ?? '',
      plans: exact?.plans.trim() ?? '',
      flights: trip.flights.filter((f) => f.date === date),
      entered: Boolean(exact),
      suggested: Boolean(exact?.suggested),
    };
  });
}

export type IssueLevel = 'fail' | 'warn';
export interface ItineraryIssue {
  id: string;
  level: IssueLevel;
  text: string;
}

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Mismatches between the itinerary, the trip dates and the booking documents. */
export function itineraryIssues(trip: Trip): ItineraryIssue[] {
  const out: ItineraryIssue[] = [];
  const dates = tripDates(trip);
  if (dates.length === 0) {
    out.push({ id: 'dates', level: 'fail', text: 'Add valid travel dates (arrival before departure) to build a day-by-day plan.' });
    return out;
  }
  const first = dates[0];
  const last = dates[dates.length - 1];

  for (const s of trip.stops) {
    if (!isDate(s.date)) out.push({ id: `stop-date-${s.id}`, level: 'warn', text: `A day entry${s.city ? ` for ${s.city}` : ''} has no date.` });
    else if (s.date < first || s.date > last) out.push({ id: `stop-out-${s.id}`, level: 'fail', text: `${fmt(s.date)}${s.city ? ` (${s.city})` : ''} is outside your trip dates.` });
  }
  for (const f of trip.flights) {
    if (!isDate(f.date)) out.push({ id: `flight-date-${f.id}`, level: 'warn', text: 'A flight has no date.' });
    else if (f.date < addDays(first, -1) || f.date > last) out.push({ id: `flight-out-${f.id}`, level: 'fail', text: `Flight on ${fmt(f.date)} is outside your trip dates.` });
  }
  if (trip.flights.length > 0) {
    if (!trip.flights.some((f) => f.date === first || f.date === addDays(first, -1))) {
      out.push({ id: 'outbound', level: 'warn', text: `No flight on your arrival date (${fmt(first)}). If you arrive another way, ignore this.` });
    }
    if (!trip.flights.some((f) => f.date === last)) out.push({ id: 'return', level: 'warn', text: `No flight on your departure date (${fmt(last)}).` });
  }

  const rows = dayPlan(trip);
  const noCity = rows.filter((r) => !r.city);
  if (noCity.length) out.push({ id: 'city', level: 'warn', text: `No city for ${noCity.length} day${noCity.length > 1 ? 's' : ''}, starting ${fmt(noCity[0].date)}.` });
  const nights = rows.slice(0, -1);
  const noBed = nights.filter((r) => !r.lodging);
  if (noBed.length) out.push({ id: 'lodging', level: 'fail', text: `No accommodation for ${noBed.length} night${noBed.length > 1 ? 's' : ''}, starting ${fmt(noBed[0].date)}.` });

  // Accommodation bookings read from the documents: together they should cover every night.
  const bookings = Object.entries(trip.sharedDocuments)
    .map(([, d]) => d.verification?.extracted)
    .filter((x): x is Record<string, string | number | boolean | null> => Boolean(x && typeof x.check_in === 'string' && typeof x.check_out === 'string'))
    .map((x) => ({ in: String(x.check_in), out: String(x.check_out) }))
    .filter((b) => isDate(b.in) && isDate(b.out));
  if (bookings.length) {
    const uncovered = nights.filter((r) => !bookings.some((b) => b.in <= r.date && r.date < b.out));
    if (uncovered.length) out.push({ id: 'booking-gap', level: 'warn', text: `Your accommodation booking does not cover ${uncovered.length} night${uncovered.length > 1 ? 's' : ''}, starting ${fmt(uncovered[0].date)}.` });
  }
  return out;
}

const missing = (what: string) => `[add ${what}]`;

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The itinerary document: a header, then one entry per day. */
export function buildDayByDayItinerary(trip: Trip): string {
  const names = trip.travellers.map(travellerName);
  const who = names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const rows = dayPlan(trip);
  const lines = [
    `Travel itinerary for ${who || missing('traveller names')}`,
    `Destination: ${countryName(trip.input.destination)}`,
    `Purpose: ${PURPOSE_LABELS[trip.input.purpose]}`,
  ];
  if (rows.length === 0) {
    lines.push(missing('your arrival and departure dates'));
    return lines.join('\n');
  }
  lines.push(`Dates: ${longDate(rows[0].date)} to ${longDate(rows[rows.length - 1].date)} (${rows.length} days, ${rows.length - 1} nights)`, '');
  const last = rows.length - 1;
  rows.forEach((r, i) => {
    lines.push(`Day ${r.day} (${longDate(r.date)}): ${r.city || missing('city')}`);
    for (const f of r.flights) lines.push(`  Flight ${f.flightNo || ''}${f.flightNo ? ' ' : ''}from ${f.from || missing('departure airport')} to ${f.to || missing('arrival airport')}`);
    if (r.plans) lines.push(`  ${r.plans}`);
    if (i < last) lines.push(`  Overnight: ${r.lodging || missing('accommodation')}`);
    else lines.push('  Departure day.');
  });
  return lines.join('\n');
}
