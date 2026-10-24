// Reminders worked out from a trip. Reminder text never includes passport numbers or other
// identity data, because the local server stores the schedule unencrypted to send WhatsApp messages.

import { countryName } from '../data/countries';
import type { Route } from '../rules/types';
import type { Trip } from '../store/model';
import { addMonths } from '../verify/checks';

export interface Reminder {
  id: string;
  tripId: string;
  at: string; // ISO date-time
  title: string;
  body: string;
  kind: 'apply_window' | 'appointment' | 'availability' | 'decision' | 'departure' | 'passport';
}

const at = (date: string, hhmm = '09:00') => new Date(`${date}T${hhmm}:00`).toISOString();

/** Typical decision times stated on the source pages, in days after submitting. */
function decisionDays(route: Route): number | undefined {
  if (route.kind === 'eta') return 3;
  // Every Schengen state: usually 15 days (Visa Code, Article 23), as each route states.
  if (route.formId === 'schengen_c' && route.kind === 'visa') return 15;
  if (route.id === 'uk-yms' || route.id === 'uk-skilled-worker') return 21;
  return undefined;
}

export function buildReminders(trip: Trip, route: Route, now: Date = new Date()): Reminder[] {
  const out: Reminder[] = [];
  const dest = countryName(trip.input.destination);
  const add = (r: Omit<Reminder, 'tripId'>) => {
    if (new Date(r.at).getTime() > now.getTime()) out.push({ ...r, tripId: trip.id });
  };
  const { departDate } = trip.input;
  const tr = trip.tracker;

  if (departDate && route.applyEarliestMonthsBefore && tr.status === 'preparing') {
    const opens = addMonths(departDate, -route.applyEarliestMonthsBefore);
    add({ id: `${trip.id}:apply`, at: at(opens), kind: 'apply_window', title: `You can apply for ${dest} now`, body: `The application window for your ${route.title} opens today.` });
  }

  if (tr.appointmentAt) {
    const appt = new Date(tr.appointmentAt);
    const place = tr.appointmentPlace ? ` at ${tr.appointmentPlace}` : '';
    add({ id: `${trip.id}:appt-1d`, at: new Date(appt.getTime() - 24 * 3600_000).toISOString(), kind: 'appointment', title: 'Visa appointment tomorrow', body: `Your appointment${place} is tomorrow. Bring your printed form, photos and documents.` });
    add({ id: `${trip.id}:appt-2h`, at: new Date(appt.getTime() - 2 * 3600_000).toISOString(), kind: 'appointment', title: 'Visa appointment in 2 hours', body: `Leave in time for your appointment${place}.` });
  }

  const watch = tr.watch;
  if (watch?.enabled && !tr.appointmentAt && watch.everyHours > 0) {
    const start = watch.lastCheckedAt ? new Date(watch.lastCheckedAt) : now;
    for (let i = 1; i <= 12; i++) {
      const when = new Date(start.getTime() + i * watch.everyHours * 3600_000);
      add({ id: `${trip.id}:watch-${when.getTime()}`, at: when.toISOString(), kind: 'availability', title: 'Check for appointment slots', body: `Time to check the ${dest} booking page for new appointment slots.` });
    }
  }

  const days = decisionDays(route);
  if (tr.submittedOn && !tr.decision && days) {
    const d = new Date(`${tr.submittedOn}T09:00:00`);
    d.setDate(d.getDate() + days);
    add({ id: `${trip.id}:decision`, at: d.toISOString(), kind: 'decision', title: 'Your visa decision may be ready', body: `It has been ${days} days since you applied for ${dest}. Check your email or the application centre.` });
  }

  if (departDate) {
    const d = new Date(`${departDate}T09:00:00`);
    d.setDate(d.getDate() - 3);
    add({ id: `${trip.id}:depart`, at: d.toISOString(), kind: 'departure', title: `Trip to ${dest} in 3 days`, body: 'Pack your passport, visa or travel authorisation, insurance and bookings.' });
  }

  return out.sort((a, b) => a.at.localeCompare(b.at));
}
