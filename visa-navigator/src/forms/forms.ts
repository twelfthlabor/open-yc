// Fill-along forms. The Schengen form follows the harmonised application form in Annex I of
// Regulation (EU) 2019/1155 (field numbers 1–32; saved under docs/sources). The UK sheets are
// common questions, not an official field list, and are labelled that way in the UI.

import { countryName } from '../data/countries';
import { PURPOSE_LABELS, type FormId, type Route, type Source } from '../rules/types';
import type { Traveller, Trip } from '../store/model';

export type FieldType = 'text' | 'date' | 'email' | 'tel' | 'textarea' | 'select';

export interface FormField {
  id: string;
  /** Official field number, when the form has one (e.g. "13" on the Schengen form). */
  number?: string;
  label: string;
  hint?: string;
  type?: FieldType;
  options?: string[];
  optional?: boolean;
  /** Same answer for everyone on the trip: entered once on the lead traveller. */
  shared?: boolean;
  /** Value worked out from the passport or trip details when the user has not typed one. */
  derive?: (t: Traveller, trip: Trip) => string;
}

export interface FormSection {
  id: string;
  title: string;
  fields: FormField[];
}

export interface FormDef {
  id: FormId;
  title: string;
  official: boolean;
  where: string;
  source?: Source;
  sections: FormSection[];
}

const REG_2019_1155: Source = {
  label: 'Regulation (EU) 2019/1155, Annex I: harmonised Schengen visa application form',
  url: 'https://publications.europa.eu/resource/celex/32019R1155',
  retrievedOn: '2026-10-10',
};

const p = (fn: (pp: NonNullable<Traveller['passport']>) => string | undefined) => (t: Traveller) => (t.passport ? fn(t.passport) ?? '' : '');

const PURPOSE_TO_SCHENGEN: Record<string, string> = {
  tourism: 'Tourism',
  business: 'Business',
  family: 'Visiting family or friends',
  transit: 'Airport transit',
};

const SCHENGEN: FormDef = {
  id: 'schengen_c',
  title: 'Application for Schengen visa',
  official: true,
  where: 'Fill these in on the application form (online where the country offers it, such as CROVISA for Croatia or France-Visas for France), then print and sign it.',
  source: REG_2019_1155,
  sections: [
    {
      id: 'identity',
      title: 'Personal details',
      fields: [
        { id: 'surname', number: '1', label: 'Surname (family name)', hint: 'Exactly as in the passport.', derive: p((x) => x.surname) },
        { id: 'surname_at_birth', number: '2', label: 'Surname at birth (former family names)', optional: true },
        { id: 'given_names', number: '3', label: 'First name(s) (given names)', hint: 'Exactly as in the passport.', derive: p((x) => x.givenNames) },
        { id: 'birth_date', number: '4', label: 'Date of birth', type: 'date', derive: p((x) => x.birthDate) },
        { id: 'place_of_birth', number: '5', label: 'Place of birth', derive: p((x) => x.placeOfBirth) },
        { id: 'country_of_birth', number: '6', label: 'Country of birth' },
        { id: 'nationality', number: '7', label: 'Current nationality', derive: p((x) => countryName(x.nationality)) },
        { id: 'nationality_at_birth', number: '7', label: 'Nationality at birth, if different', optional: true },
        { id: 'other_nationalities', number: '7', label: 'Other nationalities', optional: true },
        { id: 'sex', number: '8', label: 'Sex', type: 'select', options: ['', 'Male', 'Female'], derive: p((x) => (x.sex === 'M' ? 'Male' : x.sex === 'F' ? 'Female' : '')) },
        {
          id: 'civil_status',
          number: '9',
          label: 'Civil status',
          type: 'select',
          options: ['', 'Single', 'Married', 'Registered Partnership', 'Separated', 'Divorced', 'Widow(er)', 'Other'],
        },
        { id: 'parental_authority', number: '10', label: 'Parental authority / legal guardian (minors only)', type: 'textarea', optional: true },
        { id: 'national_id', number: '11', label: 'National identity number, where applicable', optional: true },
      ],
    },
    {
      id: 'document',
      title: 'Travel document',
      fields: [
        {
          id: 'travel_doc_type',
          number: '12',
          label: 'Type of travel document',
          type: 'select',
          options: ['', 'Ordinary passport', 'Diplomatic passport', 'Service passport', 'Official passport', 'Special passport', 'Other travel document'],
          derive: (_t, trip) => (trip.input.passportType === 'national' ? 'Ordinary passport' : ''),
        },
        { id: 'passport_number', number: '13', label: 'Number of travel document', derive: p((x) => x.documentNumber) },
        { id: 'issue_date', number: '14', label: 'Date of issue', type: 'date', derive: p((x) => x.issueDate) },
        { id: 'expiry_date', number: '15', label: 'Valid until', type: 'date', derive: p((x) => x.expiryDate) },
        { id: 'issued_by', number: '16', label: 'Issued by (country)', derive: p((x) => countryName(x.issuingState || x.nationality)) },
      ],
    },
    {
      id: 'eu_family',
      title: 'EU, EEA or Swiss family member (only if it applies)',
      fields: [
        { id: 'eu_family_member', number: '17', label: 'Family member who is an EU, EEA or CH citizen', type: 'textarea', optional: true, hint: 'Name, date of birth, nationality, document number.' },
        { id: 'eu_family_relationship', number: '18', label: 'Family relationship', type: 'select', optional: true, options: ['', 'Spouse', 'Child', 'Grandchild', 'Dependent ascendant', 'Registered Partnership', 'Other'] },
      ],
    },
    {
      id: 'contact',
      title: 'Home, contact and work',
      fields: [
        { id: 'address', number: '19', label: 'Home address', type: 'textarea' },
        { id: 'email', number: '19', label: 'Email address', type: 'email' },
        { id: 'phone', number: '19', label: 'Telephone number', type: 'tel' },
        { id: 'residence_other', number: '20', label: 'Residence in a country other than your nationality', type: 'select', options: ['', 'No', 'Yes'] },
        { id: 'residence_permit', number: '20', label: 'If yes: residence permit number and valid until', optional: true },
        { id: 'occupation', number: '21', label: 'Current occupation' },
        { id: 'employer', number: '22', label: 'Employer name, address and phone (students: school name and address)', type: 'textarea' },
      ],
    },
    {
      id: 'journey',
      title: 'Journey',
      fields: [
        {
          id: 'purpose',
          number: '23',
          label: 'Purpose of the journey',
          shared: true,
          derive: (_t, trip) => PURPOSE_TO_SCHENGEN[trip.input.purpose] ?? PURPOSE_LABELS[trip.input.purpose],
        },
        { id: 'purpose_info', number: '24', label: 'Additional information on purpose of stay', type: 'textarea', shared: true, optional: true },
        { id: 'main_destination', number: '25', label: 'Member State of main destination', shared: true, derive: (_t, trip) => countryName(trip.input.destination) },
        { id: 'first_entry', number: '26', label: 'Member State of first entry', shared: true, derive: (_t, trip) => countryName(trip.input.destination) },
        { id: 'entries', number: '27', label: 'Number of entries requested', type: 'select', options: ['', 'Single entry', 'Two entries', 'Multiple entries'], shared: true },
        { id: 'arrival_date', number: '27', label: 'Intended date of arrival', type: 'date', shared: true, derive: (_t, trip) => trip.input.departDate ?? '' },
        { id: 'departure_date', number: '27', label: 'Intended date of departure', type: 'date', shared: true, derive: (_t, trip) => trip.input.returnDate ?? '' },
        { id: 'fingerprints_before', number: '28', label: 'Fingerprints collected before for a Schengen visa', type: 'select', options: ['', 'No', 'Yes'] },
        { id: 'fingerprints_details', number: '28', label: 'If yes: date and visa sticker number, if known', optional: true },
        { id: 'entry_permit_final', number: '29', label: 'Entry permit for the final country of destination, where applicable', optional: true },
      ],
    },
    {
      id: 'host',
      title: 'Accommodation and costs',
      fields: [
        { id: 'host_name', number: '30', label: 'Inviting person, or name of hotel / accommodation', shared: true },
        { id: 'host_address', number: '30', label: 'Address and email of the inviting person or accommodation', type: 'textarea', shared: true },
        { id: 'host_phone', number: '30', label: 'Telephone of the inviting person or accommodation', type: 'tel', shared: true, optional: true },
        { id: 'inviting_company', number: '31', label: 'Inviting company or organisation (business trips)', type: 'textarea', shared: true, optional: true },
        { id: 'cost_covered_by', number: '32', label: 'Cost of travelling and living is covered by', type: 'select', options: ['', 'The applicant', 'A sponsor (host, company, organisation)'] },
        { id: 'means_of_support', number: '32', label: 'Means of support', hint: 'For example: cash, credit card, pre-paid accommodation, pre-paid transport.' },
      ],
    },
  ],
};

const UK_COMMON: FormSection[] = [
  {
    id: 'identity',
    title: 'You',
    fields: [
      { id: 'given_names', label: 'Given names (as on passport)', derive: p((x) => x.givenNames) },
      { id: 'surname', label: 'Family name (as on passport)', derive: p((x) => x.surname) },
      { id: 'other_names', label: 'Other names you have used', optional: true },
      { id: 'birth_date', label: 'Date of birth', type: 'date', derive: p((x) => x.birthDate) },
      { id: 'place_of_birth', label: 'Place of birth', derive: p((x) => x.placeOfBirth) },
      { id: 'sex', label: 'Sex (as on passport)', type: 'select', options: ['', 'F', 'M', 'X'], derive: p((x) => x.sex) },
      { id: 'civil_status', label: 'Relationship status', type: 'select', options: ['', 'Single', 'Married or civil partnership', 'Unmarried partner', 'Divorced', 'Separated', 'Widowed'] },
    ],
  },
  {
    id: 'passport',
    title: 'Passport',
    fields: [
      { id: 'passport_number', label: 'Passport number', derive: p((x) => x.documentNumber) },
      { id: 'nationality', label: 'Nationality', derive: p((x) => countryName(x.nationality)) },
      { id: 'issuing_authority', label: 'Issuing authority', derive: p((x) => x.issuingAuthority) },
      { id: 'issue_date', label: 'Issue date', type: 'date', derive: p((x) => x.issueDate) },
      { id: 'expiry_date', label: 'Expiry date', type: 'date', derive: p((x) => x.expiryDate) },
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    fields: [
      { id: 'email', label: 'Email', type: 'email' },
      { id: 'phone', label: 'Phone (with country code)', type: 'tel' },
      { id: 'address', label: 'Home address', type: 'textarea' },
      { id: 'address_since', label: 'Living at this address since', type: 'date' },
    ],
  },
];

const UK_VISIT_EXTRA: FormSection[] = [
  {
    id: 'work',
    title: 'Work and money',
    fields: [
      { id: 'occupation', label: 'Employment status', type: 'select', options: ['', 'Employed', 'Self-employed', 'Student', 'Retired', 'Not working'] },
      { id: 'employer', label: 'Employer or school name and address', type: 'textarea' },
      { id: 'job_title', label: 'Job title' },
      { id: 'monthly_income', label: 'Monthly income after tax', hint: 'Include the currency.' },
      { id: 'trip_cost', label: 'Expected cost of the trip', hint: 'Include the currency.', shared: true },
      { id: 'cost_covered_by', label: 'Who is paying for the trip', type: 'select', options: ['', 'The applicant', 'Family member', 'Employer', 'Friend', 'Other'] },
    ],
  },
  {
    id: 'trip',
    title: 'This trip',
    fields: [
      { id: 'host_address', label: 'Where you will stay in the UK', type: 'textarea', shared: true },
      { id: 'uk_contacts', label: 'Family or friends in the UK', type: 'textarea', optional: true },
      { id: 'travel_history', label: 'Countries visited in the last 10 years', hint: 'Country, month and year, and reason.', type: 'textarea' },
      { id: 'uk_history', label: 'Previous UK visits or applications', type: 'textarea', optional: true },
    ],
  },
];

const ukForm = (id: FormId, title: string, sections: FormSection[]): FormDef => ({
  id,
  title,
  official: false,
  where: 'Common questions on the gov.uk application. Copy each answer into the online form.',
  sections,
});

const stayLength = (trip: Trip) => {
  const { departDate, returnDate } = trip.input;
  if (!departDate || !returnDate) return '';
  const days = Math.round((Date.parse(returnDate) - Date.parse(departDate)) / 86_400_000) + 1;
  return Number.isFinite(days) && days > 0 ? `${days} days` : '';
};

// Common DS-160 questions for a B-1/B-2 visitor. The official form at ceac.state.gov cannot be read
// automatically, so this is not an official field list and the UI says so.
const US_B: FormDef = {
  id: 'us_b',
  title: 'DS-160 answers (visitor visa)',
  official: false,
  where: 'Common questions on the DS-160 online application. Copy each answer into the form at ceac.state.gov.',
  sections: [
    {
      id: 'personal',
      title: 'Personal',
      fields: [
        { id: 'surname', label: 'Surnames', hint: 'Exactly as in the passport.', derive: p((x) => x.surname) },
        { id: 'given_names', label: 'Given names', hint: 'Exactly as in the passport.', derive: p((x) => x.givenNames) },
        { id: 'full_name_native', label: 'Full name in your native alphabet', optional: true },
        { id: 'other_names', label: 'Other names you have used (maiden, religious, professional)', optional: true },
        { id: 'sex', label: 'Sex', type: 'select', options: ['', 'Male', 'Female'], derive: p((x) => (x.sex === 'M' ? 'Male' : x.sex === 'F' ? 'Female' : '')) },
        {
          id: 'civil_status',
          label: 'Marital status',
          type: 'select',
          options: ['', 'Married', 'Common law marriage', 'Civil union / domestic partnership', 'Single', 'Widowed', 'Divorced', 'Legally separated', 'Other'],
        },
        { id: 'birth_date', label: 'Date of birth', type: 'date', derive: p((x) => x.birthDate) },
        { id: 'place_of_birth', label: 'City of birth', derive: p((x) => x.placeOfBirth) },
        { id: 'country_of_birth', label: 'Country of birth' },
      ],
    },
    {
      id: 'nationality',
      title: 'Nationality and identity numbers',
      fields: [
        { id: 'nationality', label: 'Country of nationality', derive: p((x) => countryName(x.nationality)) },
        { id: 'other_nationalities', label: 'Other nationalities, held now or before', optional: true },
        { id: 'national_id', label: 'National identification number', optional: true },
        { id: 'us_ssn', label: 'US Social Security number, if you have one', optional: true },
      ],
    },
    {
      id: 'contact',
      title: 'Address, phone and email',
      fields: [
        { id: 'address', label: 'Home address', type: 'textarea' },
        { id: 'phone', label: 'Primary phone number (with country code)', type: 'tel' },
        { id: 'email', label: 'Email address', type: 'email' },
        { id: 'social_media', label: 'Social media platforms and usernames', hint: 'Platforms you have used in the last five years.', type: 'textarea', optional: true },
      ],
    },
    {
      id: 'passport',
      title: 'Passport',
      fields: [
        { id: 'passport_type', label: 'Passport type', type: 'select', options: ['', 'Regular', 'Official', 'Diplomatic', 'Other'], derive: (_t, trip) => (trip.input.passportType === 'national' ? 'Regular' : '') },
        { id: 'passport_number', label: 'Passport number', derive: p((x) => x.documentNumber) },
        { id: 'passport_book_number', label: 'Passport book number, if shown', optional: true },
        { id: 'issuing_country', label: 'Country that issued the passport', derive: p((x) => countryName(x.issuingState || x.nationality)) },
        { id: 'issue_place', label: 'City where it was issued' },
        { id: 'issue_date', label: 'Issuance date', type: 'date', derive: p((x) => x.issueDate) },
        { id: 'expiry_date', label: 'Expiration date', type: 'date', derive: p((x) => x.expiryDate) },
        { id: 'lost_passport', label: 'Have you ever lost a passport or had one stolen?', type: 'select', options: ['', 'No', 'Yes'] },
      ],
    },
    {
      id: 'travel',
      title: 'Travel',
      fields: [
        { id: 'purpose', label: 'Purpose of trip', shared: true, derive: () => 'Temporary business or pleasure visitor (B1/B2)' },
        { id: 'arrival_date', label: 'Intended date of arrival', type: 'date', shared: true, derive: (_t, trip) => trip.input.departDate ?? '' },
        { id: 'stay_length', label: 'Intended length of stay', shared: true, derive: (_t, trip) => stayLength(trip) },
        { id: 'host_address', label: 'Address where you will stay in the US', type: 'textarea', shared: true },
        { id: 'cost_covered_by', label: 'Person or entity paying for your trip', type: 'select', options: ['', 'Self', 'Other person', 'Present employer', 'Employer in the US', 'Other company or organisation'] },
        { id: 'travelling_with_others', label: 'Are other people travelling with you?', type: 'select', options: ['', 'No', 'Yes'], shared: true, derive: (_t, trip) => (trip.travellers.length > 1 ? 'Yes' : 'No') },
        { id: 'us_history', label: 'Previous US visits, visas and any refusals', hint: 'Dates, length of stay and visa numbers.', type: 'textarea', optional: true },
      ],
    },
    {
      id: 'us_contact',
      title: 'Contact in the United States',
      fields: [{ id: 'us_contact', label: 'Person or organisation you will visit or stay with', hint: 'Name, address, phone and email. A hotel is fine.', type: 'textarea', shared: true }],
    },
    {
      id: 'family',
      title: 'Family',
      fields: [
        { id: 'father_name', label: 'Father’s full name and date of birth' },
        { id: 'mother_name', label: 'Mother’s full name and date of birth' },
        { id: 'relatives_in_us', label: 'Immediate relatives in the United States', type: 'textarea', optional: true },
        { id: 'spouse', label: 'Spouse’s full name, date and place of birth', type: 'textarea', optional: true },
      ],
    },
    {
      id: 'work',
      title: 'Work and education',
      fields: [
        {
          id: 'occupation',
          label: 'Primary occupation',
          type: 'select',
          options: ['', 'Business', 'Computer science', 'Education', 'Engineering', 'Government', 'Homemaker', 'Medical / health', 'Retired', 'Student', 'Not employed', 'Other'],
        },
        { id: 'employer', label: 'Present employer or school: name, address and phone', type: 'textarea' },
        { id: 'monthly_income', label: 'Monthly income in local currency', optional: true },
        { id: 'duties', label: 'Briefly describe your duties', type: 'textarea', optional: true },
        { id: 'education', label: 'Schools and universities attended (secondary level and above)', type: 'textarea', optional: true },
        { id: 'travel_history', label: 'Countries visited in the last five years', type: 'textarea', optional: true },
      ],
    },
  ],
};

export const FORMS: Record<FormId, FormDef> = {
  schengen_c: SCHENGEN,
  uk_visitor: ukForm('uk_visitor', 'Standard Visitor visa answers', [...UK_COMMON, ...UK_VISIT_EXTRA]),
  uk_eta: ukForm('uk_eta', 'ETA answers', [UK_COMMON[0], UK_COMMON[1], UK_COMMON[2]]),
  uk_youth_mobility: ukForm('uk_youth_mobility', 'Youth Mobility Scheme answers', [...UK_COMMON, UK_VISIT_EXTRA[0]]),
  uk_skilled_worker: ukForm('uk_skilled_worker', 'Skilled Worker answers', [...UK_COMMON, UK_VISIT_EXTRA[0]]),
  us_b: US_B,
};

export function formFor(route: Route): FormDef | undefined {
  return route.formId ? FORMS[route.formId] : undefined;
}

export function allFields(form: FormDef): FormField[] {
  return form.sections.flatMap((s) => s.fields);
}

/** Answer for one traveller: typed value, else the lead traveller's shared value, else derived. */
export function fieldValue(trip: Trip, traveller: Traveller, field: FormField): string {
  const typed = traveller.answers[field.id];
  if (typed) return typed;
  if (field.shared) {
    const lead = trip.travellers[0];
    if (lead && lead.id !== traveller.id && lead.answers[field.id]) return lead.answers[field.id];
  }
  return field.derive?.(traveller, trip) ?? '';
}

export function isDerived(trip: Trip, traveller: Traveller, field: FormField): boolean {
  return !traveller.answers[field.id] && Boolean(field.derive?.(traveller, trip));
}

export function formProgress(trip: Trip, traveller: Traveller, form: FormDef): { done: number; total: number } {
  const required = allFields(form).filter((f) => !f.optional);
  const done = required.filter((f) => fieldValue(trip, traveller, f) !== '').length;
  return { done, total: required.length };
}

/** Look up an answer by id across the form, for drafts. */
export function answerById(trip: Trip, traveller: Traveller, id: string, form?: FormDef): string {
  const field = form ? allFields(form).find((f) => f.id === id) : undefined;
  return field ? fieldValue(trip, traveller, field) : traveller.answers[id] ?? '';
}
