// Appointment booking assistance per destination. The app opens the official booking system for where the
// applicant lives and keeps a copy sheet of everything that system asks for. It never signs in, solves a
// CAPTCHA, watches slot pages or pays: visa centres treat automated booking as bot traffic, and the booking
// is the applicant's own step (see the autofill principles in README and docs/SYSTEM_DESIGN.md).

import { countryName } from '../data/countries';
import { allFields, fieldValue, formFor } from '../forms/forms';
import type { Route, Source } from '../rules/types';
import { travellerName, type BookingProgress, type Trip } from '../store/model';

const RETRIEVED = '2026-10-23';
const src = (label: string, url: string): Source => ({ label, url, retrievedOn: RETRIEVED });

export const BOOKING_SOURCES = {
  sweden: src(
    'Swedish Migration Agency: in most cases you submit your application via VFS Global',
    'https://www.migrationsverket.se/en/you-want-to-apply/visiting-sweden/visiting-sweden-for-up-to-90-days-entry-visa.html',
  ),
  netherlands: src(
    'NetherlandsWorldwide: book your appointment yourself on the VFS Global portal, one per person (India page)',
    'https://www.netherlandsworldwide.nl/visa-the-netherlands/schengen-visa/apply-india',
  ),
  france: src('France-Visas: book at the centre allocated to your place of residence (consulate, TLScontact, VFS Global or Capago)', 'https://france-visas.gouv.fr/en/'),
  uk: src('gov.uk: after the online application, book an appointment at a visa application centre', 'https://www.gov.uk/standard-visitor/apply-standard-visitor-visa'),
  ukCentres: src('gov.uk: Find a visa application centre', 'https://www.gov.uk/find-a-visa-application-centre'),
  usInterview: src('22 CFR 41.102: personal appearance and interview', 'https://www.ecfr.gov/current/title-22/chapter-I/subchapter-E/part-41/subpart-I/section-41.102'),
  usDs160: src('22 CFR 41.103: filing the DS-160', 'https://www.ecfr.gov/current/title-22/chapter-I/subchapter-E/part-41/subpart-I/section-41.103'),
  usFees: src('22 CFR 22.1: schedule of fees (nonimmigrant visa application fee)', 'https://www.ecfr.gov/current/title-22/chapter-I/subchapter-C/part-22/section-22.1'),
  usAppointments: src('US visa appointment service used by many US embassies (check your embassy links to it)', 'https://ais.usvisa-info.com/'),
  usEmbassies: src('US embassies and consulates: find the one where you live (its visa page links the booking system)', 'https://www.usembassy.gov/'),
};

export interface BookingStep {
  id: string;
  label: string;
  /** A reference the user copies from the portal at this step. */
  ref?: { id: string; label: string; perTraveller: boolean; pattern?: RegExp; hint?: string };
}

export interface BookingGuide {
  system: string;
  /** The official page to open, for the applicant's country of residence when the pattern is known. */
  url: string;
  /** Says how sure the link is and what to check. */
  urlNote: string;
  steps: BookingStep[];
  sources: Source[];
  /** Hard limits of the assistant, always shown. */
  limits: string;
}

const LIMITS = 'You sign in, solve any security check, choose the slot and pay on the official site yourself. The app opens the page and keeps your details ready to copy; it does not book, watch for slots or pay.';

const vfs = (residence: string, dest: string) => `https://visa.vfsglobal.com/${residence.toLowerCase()}/en/${dest}`;

/** The booking assistant for a route, or undefined when the route needs no appointment. */
export function bookingGuide(route: Route, trip: Trip, residence: string = trip.tracker.booking?.residence || trip.input.nationality): BookingGuide | undefined {
  if (!route.appointment || route.appointment === 'none') return undefined;
  const where = residence ? countryName(residence) : 'your country';
  const dest = trip.input.destination;
  const schengenSteps = (centre: string): BookingStep[] => [
    { id: 'form_done', label: 'Application form filled in, printed and signed' },
    { id: 'documents', label: 'Documents collected (see Documents)' },
    { id: 'account', label: `Account created on ${centre}` },
    { id: 'booked', label: 'Appointment booked', ref: { id: 'appointment_ref', label: `${centre} booking reference`, perTraveller: false } },
    { id: 'letter', label: 'Appointment confirmation printed' },
  ];

  if (dest === 'SWE') {
    return {
      system: 'VFS Global (Sweden)',
      url: vfs(residence, 'swe'),
      urlNote: `The VFS Global page for applicants living in ${where}. If it does not open, the Swedish embassy where you live may take applications itself; check swedenabroad.se.`,
      steps: schengenSteps('VFS Global'),
      sources: [BOOKING_SOURCES.sweden],
      limits: LIMITS,
    };
  }
  if (dest === 'NLD') {
    return {
      system: 'VFS Global (the Netherlands)',
      url: vfs(residence, 'nld'),
      urlNote: `The VFS Global page for applicants living in ${where}. Book one appointment per person, yourself, not through an intermediary.`,
      steps: [
        { id: 'form_done', label: 'Online form filled in, code noted, printed and signed', ref: { id: 'nl_form_code', label: 'Online form code', perTraveller: true } },
        ...schengenSteps('VFS Global').slice(1),
      ],
      sources: [BOOKING_SOURCES.netherlands],
      limits: LIMITS,
    };
  }
  if (dest === 'FRA') {
    return {
      system: 'France-Visas, then the centre it assigns',
      url: 'https://france-visas.gouv.fr/en/',
      urlNote: 'France-Visas tells you which centre takes applications where you live (a consulate, TLScontact, VFS Global or Capago) and links its booking page. Book from there, not from a third-party site.',
      steps: [
        { id: 'form_done', label: 'France-Visas application filled in', ref: { id: 'fr_reference', label: 'France-Visas application reference', perTraveller: true } },
        { id: 'printed', label: 'Application and registration receipt printed, dated and signed' },
        { id: 'documents', label: 'Documents collected (see Documents)' },
        { id: 'booked', label: 'Appointment booked at the assigned centre', ref: { id: 'appointment_ref', label: 'Centre booking reference', perTraveller: false } },
        { id: 'letter', label: 'Appointment confirmation printed' },
      ],
      sources: [BOOKING_SOURCES.france],
      limits: LIMITS,
    };
  }
  if (dest === 'GBR') {
    return {
      system: 'gov.uk, then the visa application centre',
      url: BOOKING_SOURCES.ukCentres.url,
      urlNote: 'Booking opens from your gov.uk application once you have submitted and paid. The centre finder shows which provider runs the centre where you live.',
      steps: [
        { id: 'form_done', label: 'Online application submitted and paid', ref: { id: 'gwf', label: 'GWF reference number', perTraveller: true, pattern: /^GWF\d{9}$/i, hint: 'GWF followed by 9 digits' } },
        { id: 'booked', label: 'Biometrics appointment booked', ref: { id: 'appointment_ref', label: 'Centre booking reference', perTraveller: false } },
        { id: 'uploaded', label: 'Documents uploaded or ready to bring' },
        { id: 'letter', label: 'Appointment confirmation printed' },
      ],
      sources: [BOOKING_SOURCES.uk, BOOKING_SOURCES.ukCentres],
      limits: LIMITS,
    };
  }
  if (dest === 'USA') {
    return {
      system: 'DS-160, fee payment and the interview booking system for your embassy',
      url: BOOKING_SOURCES.usAppointments.url,
      urlNote: `Many US embassies use this booking service; some use a different one. Open the visa page of the US embassy in ${where} (usembassy.gov) and use the booking link it gives.`,
      steps: [
        { id: 'ds160', label: 'DS-160 submitted for each traveller and confirmation page printed', ref: { id: 'ds160_barcode', label: 'DS-160 confirmation number', perTraveller: true, pattern: /^AA[0-9A-Z]{8}$/i, hint: 'AA followed by 8 letters or digits' } },
        { id: 'account', label: 'Account created on the booking system your embassy links' },
        { id: 'fee', label: 'Visa application fee paid', ref: { id: 'mrv_receipt', label: 'Fee receipt number', perTraveller: true } },
        { id: 'booked', label: 'Interview booked (and the biometrics appointment, where your embassy has one)', ref: { id: 'appointment_ref', label: 'Appointment confirmation number', perTraveller: false } },
        { id: 'letter', label: 'Appointment confirmation printed; bring it with the DS-160 page and passport' },
      ],
      sources: [BOOKING_SOURCES.usDs160, BOOKING_SOURCES.usFees, BOOKING_SOURCES.usInterview, BOOKING_SOURCES.usAppointments, BOOKING_SOURCES.usEmbassies],
      limits: LIMITS,
    };
  }
  return {
    system: route.bookingLabel ? 'Embassy or visa centre' : 'Official booking page',
    url: '',
    urlNote: route.bookingLabel ?? 'Find the booking page through the official visa site, and paste it below.',
    steps: schengenSteps('the booking site'),
    sources: route.sources.slice(0, 1),
    limits: LIMITS,
  };
}

export function refKey(refId: string, travellerId?: string): string {
  return travellerId ? `${refId}:${travellerId}` : refId;
}

/** True when a reference has the shape the portal prints (when one is known). */
export function refLooksRight(step: BookingStep, value: string): boolean {
  if (!value.trim() || !step.ref?.pattern) return true;
  return step.ref.pattern.test(value.trim());
}

export interface SheetRow {
  label: string;
  value: string;
}

/**
 * Everything booking sites usually ask, per traveller, from answers already in the app. Values the user has not
 * entered stay empty: the app never fills a booking field with a guess.
 */
export function bookingSheet(route: Route, trip: Trip, booking: BookingProgress | undefined, guide: BookingGuide): Array<{ traveller: string; rows: SheetRow[] }> {
  const form = formFor(route);
  const answer = (t: Trip['travellers'][number], id: string) => {
    const field = form ? allFields(form).find((f) => f.id === id) : undefined;
    return field ? fieldValue(trip, t, field) : t.answers[id] ?? '';
  };
  return trip.travellers.map((t) => {
    const rows: SheetRow[] = [
      { label: 'Surname', value: t.passport?.surname ?? '' },
      { label: 'Given names', value: t.passport?.givenNames ?? '' },
      { label: 'Date of birth', value: t.passport?.birthDate ?? '' },
      { label: 'Nationality', value: t.passport ? countryName(t.passport.nationality) : '' },
      { label: 'Passport number', value: t.passport?.documentNumber ?? '' },
      { label: 'Passport expiry', value: t.passport?.expiryDate ?? '' },
      { label: 'Email', value: answer(t, 'email') },
      { label: 'Phone', value: answer(t, 'phone') },
      { label: 'Travel date', value: trip.input.departDate ?? '' },
    ];
    for (const s of guide.steps) {
      if (!s.ref) continue;
      const v = booking?.refs[refKey(s.ref.id, s.ref.perTraveller ? t.id : undefined)] ?? '';
      rows.push({ label: s.ref.label, value: v });
    }
    if (booking?.preferredDates) rows.push({ label: 'Preferred dates', value: booking.preferredDates });
    rows.push({ label: 'Applicants on this booking', value: String(trip.travellers.length) });
    return { traveller: travellerName(t), rows };
  });
}
