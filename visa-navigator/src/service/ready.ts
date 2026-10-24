// What still stands between a customer's application and review: passports and required answers.

import { allFields, fieldValue, formFor, type FormField } from '../forms/forms';
import type { Route } from '../rules/types';
import { travellerName, type Traveller, type Trip } from '../store/model';

/** Questions the customer still has to answer: required, and not worked out from the passport or trip. */
export function openQuestions(trip: Trip, traveller: Traveller, route: Route): FormField[] {
  const form = formFor(route);
  if (!form) return [];
  return allFields(form).filter((f) => !f.optional && !fieldValue(trip, traveller, f));
}

/** Plain-language list of what is missing; empty when the application can go to review. */
export function missingForReview(trip: Trip, route: Route): string[] {
  if (!formFor(route)) return ['This route has no application form the service can file.'];
  const out: string[] = [];
  for (const t of trip.travellers) {
    const name = travellerName(t);
    if (!t.passport) out.push(`${name}: passport`);
    for (const f of openQuestions(trip, t, route)) out.push(`${name}: ${f.label}`);
  }
  return out;
}
