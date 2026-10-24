import { allFields, fieldValue, formFor } from '@/forms/forms';
import type { Feature, Route } from '@/rules/types';
import { doneKey, type Trip } from '@/store/model';

export const REVIEW_ITEMS = [
  { id: 'names', label: 'Names match each passport exactly, including spelling and order.' },
  { id: 'numbers', label: 'Passport numbers and dates are copied exactly (check 0/O and 1/I).' },
  { id: 'dates', label: 'Travel dates match the bookings, insurance and itinerary.' },
  { id: 'validity', label: 'Every passport meets the validity rule shown in Documents.' },
  { id: 'truth', label: 'Every answer and document is true and can be backed up.' },
  { id: 'source', label: 'You opened each official source link and the requirement still matches.' },
];

export type SectionId = 'overview' | Feature;

/** True when every required checklist item is ticked for everyone who needs it. */
export function documentsDone(trip: Trip, route: Route): boolean {
  return route.checklist
    .filter((c) => c.required)
    .every((c) => (c.perTraveller ? trip.travellers.every((t) => trip.checklistDone[doneKey(c.id, t.id)]) : trip.checklistDone[doneKey(c.id)]));
}

export function sectionDone(trip: Trip, route: Route, id: SectionId): boolean {
  switch (id) {
    case 'overview':
      return false;
    case 'travellers':
      return trip.travellers.length > 0 && trip.travellers.every((t) => Boolean(t.passport));
    case 'documents':
      return documentsDone(trip, route);
    case 'form': {
      const form = formFor(route);
      if (!form) return false;
      return trip.travellers.every((t) => allFields(form).every((f) => f.optional || fieldValue(trip, t, f) !== ''));
    }
    case 'itinerary':
      return trip.itineraryText.trim().length > 0 && !trip.itineraryText.includes('[add');
    case 'cover_letter':
      return trip.coverLetter.trim().length > 0 && !trip.coverLetter.includes('[add');
    case 'appointment':
      return trip.tracker.status === 'decided';
    case 'notifications':
      return false;
    case 'review':
      return REVIEW_ITEMS.every((r) => trip.reviewDone[r.id]);
    case 'expert_review':
      return Boolean(trip.expertReview?.exportedAt);
  }
}

const COUNTED: SectionId[] = ['travellers', 'documents', 'form', 'itinerary', 'review'];

export function tripProgress(trip: Trip, route: Route): number {
  const sections = route.features.filter((f) => COUNTED.includes(f));
  if (sections.length === 0) return 0;
  return sections.filter((s) => sectionDone(trip, route, s)).length / sections.length;
}
