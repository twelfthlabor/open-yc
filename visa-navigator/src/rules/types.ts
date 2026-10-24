export type Purpose =
  | 'tourism'
  | 'business'
  | 'family'
  | 'transit'
  | 'work_sponsored'
  | 'youth_mobility'
  | 'study'
  | 'marriage';

export const PURPOSE_LABELS: Record<Purpose, string> = {
  tourism: 'Tourism or holiday',
  business: 'Business meetings or events',
  family: 'Visiting family or friends',
  transit: 'Passing through to another country',
  work_sponsored: 'Work with a job offer from an employer',
  youth_mobility: 'Live and work for up to 2 years (youth scheme)',
  study: 'Study',
  marriage: 'Getting married or a civil partnership',
};

export type PassportType = 'national' | 'other';

export interface TripInput {
  nationality: string; // ISO alpha-3 / MRZ code
  destination: string; // ISO alpha-3
  purpose: Purpose;
  passportType: PassportType;
  departDate?: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD
  birthDate?: string; // YYYY-MM-DD
  hasDependentChildren?: boolean;
  /** Taiwan passports only: does the passport include the ID card number? */
  taiwanIdOnPassport?: boolean;
  /** Some exemptions only apply to biometric (chip) passports. */
  biometricPassport?: boolean;
}

export interface Source {
  label: string;
  url: string;
  retrievedOn: string; // YYYY-MM-DD
}

export interface ChecklistItem {
  id: string;
  label: string;
  detail?: string;
  required: boolean;
  source: Source;
  /** Links this item to an app feature that helps produce it. */
  helper?: 'passport' | 'itinerary' | 'cover_letter' | 'funds' | 'photo' | 'form' | 'insurance' | 'accommodation' | 'ticket';
  /** Whether each traveller needs their own copy (true) or one per application (false). */
  perTraveller?: boolean;
}

export type RouteKind = 'none' | 'visa_free' | 'eta' | 'visa' | 'restricted' | 'not_covered' | 'not_eligible';

export type Feature =
  | 'travellers'
  | 'documents'
  | 'form'
  | 'itinerary'
  | 'cover_letter'
  | 'appointment'
  | 'notifications'
  | 'review'
  | 'expert_review';

/** Which fill-along form the route uses. */
export type FormId = 'uk_visitor' | 'uk_eta' | 'uk_youth_mobility' | 'uk_skilled_worker' | 'schengen_c' | 'us_b';

export interface Route {
  id: string;
  kind: RouteKind;
  title: string;
  summary: string;
  fee?: string;
  extraCosts?: string[];
  decisionTime?: string;
  maxStay?: string;
  applyWindow?: string;
  /** Earliest you can apply, in months before the trip or start date (from the source page). */
  applyEarliestMonthsBefore?: number;
  applyUrl?: string;
  applyLabel?: string;
  appointment?: 'none' | 'maybe' | 'required';
  /** Where appointments are booked, when the route needs one. */
  bookingUrl?: string;
  bookingLabel?: string;
  formId?: FormId;
  /**
   * Minimum funds per traveller per day, when the source states one. `reduced` is a lower official figure that applies
   * in some cases (for example a prepaid hotel), so a balance between the two is flagged for checking, not failed.
   * `unquoted` marks a figure the app could not read on the official page itself (it is linked instead).
   */
  funds?: { perDay: number; currency: string; reduced?: { perDay: number; when: string }; unquoted?: boolean };
  /** Minimum travel medical insurance, when the source states one. */
  insurance?: { minimum: number; currency: string; territory: string };
  /**
   * Passport validity beyond the stay, when the source states it. With `exceptions`, some nationalities are exempt,
   * so a shortfall is something to check rather than a definite problem.
   */
  passportRule?: { monthsAfter: number; exceptions: boolean };
  /** Paperwork-only routes: the app prepares the packet; booking is a hand-off to the official system. */
  service?: 'full' | 'paperwork';
  checklist: ChecklistItem[];
  steps: string[];
  notes: string[];
  sources: Source[];
  /** Features the workspace should show for this route. */
  features: Feature[];
}

export interface DestinationRules {
  code: string;
  name: string;
  checkerUrl: string;
  resolve(input: TripInput, today?: Date): Route;
}
