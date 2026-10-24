import type { ChecklistItem, DestinationRules, Route, Source, TripInput } from './types';

// Every figure below comes from a gov.uk page retrieved on the date in RETRIEVED.
// If a page does not state a figure, the route says "check the official page" instead.
const RETRIEVED = '2026-10-09';

const src = (label: string, url: string): Source => ({ label, url, retrievedOn: RETRIEVED });

export const UK_SOURCES = {
  visaNationals: src(
    'Immigration Rules: Appendix Visitor: Visa national list',
    'https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-visitor-visa-national-list',
  ),
  eta: src('Apply for an electronic travel authorisation (ETA)', 'https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta'),
  etaApply: src('Apply for an ETA', 'https://www.gov.uk/eta/apply'),
  visitor: src('Standard Visitor visa', 'https://www.gov.uk/standard-visitor'),
  visitorDocs: src('Standard Visitor visa: documents you need', 'https://www.gov.uk/standard-visitor/documents-you-need'),
  ymsOverview: src('Youth Mobility Scheme visa', 'https://www.gov.uk/youth-mobility'),
  ymsEligibility: src('Youth Mobility Scheme visa: eligibility', 'https://www.gov.uk/youth-mobility/eligibility'),
  ymsDocs: src('Youth Mobility Scheme visa: documents you must provide', 'https://www.gov.uk/youth-mobility/documents-you-must-provide'),
  skilledWorker: src('Skilled Worker visa', 'https://www.gov.uk/skilled-worker-visa'),
  skilledWorkerCosts: src('Skilled Worker visa: how much it costs', 'https://www.gov.uk/skilled-worker-visa/how-much-it-costs'),
  checker: src('Check if you need a UK visa', 'https://www.gov.uk/check-uk-visa'),
};

/** VN 1.1(a), 115 entries, page last updated 8 October 2026. Codes are ISO alpha-3 / MRZ. */
export const UK_VISA_NATIONALS = new Set([
  'AFG', 'ALB', 'DZA', 'AGO', 'ARM', 'AZE', 'BGD', 'BLR', 'BEN', 'BTN',
  'BOL', 'BIH', 'BWA', 'BFA', 'BDI', 'KHM', 'CMR', 'CPV', 'CAF', 'TCD',
  'CHN', 'COL', 'COM', 'COG', 'CIV', 'CUB', 'COD', 'DJI', 'DMA', 'DOM',
  'ECU', 'EGY', 'SLV', 'GNQ', 'ERI', 'SWZ', 'ETH', 'FJI', 'GAB', 'GMB',
  'GEO', 'GHA', 'GIN', 'GNB', 'HTI', 'HND', 'IND', 'IDN', 'IRN', 'IRQ',
  'JAM', 'JOR', 'KAZ', 'KEN', 'PRK', 'RKS', 'KGZ', 'LAO', 'LBN', 'LSO',
  'LBR', 'LBY', 'MDG', 'MWI', 'MLI', 'MRT', 'MDA', 'MNG', 'MNE', 'MAR',
  'MOZ', 'MMR', 'NAM', 'NRU', 'NPL', 'NIC', 'NER', 'NGA', 'MKD', 'PAK',
  'PSE', 'PHL', 'RUS', 'RWA', 'STP', 'SEN', 'SRB', 'SLE', 'SOM', 'ZAF',
  'SSD', 'LKA', 'LCA', 'SDN', 'SUR', 'SYR', 'TWN', 'TJK', 'TZA', 'THA',
  'TLS', 'TGO', 'TTO', 'TUN', 'TUR', 'TKM', 'UGA', 'UKR', 'UZB', 'VUT',
  'VEN', 'VNM', 'YEM', 'ZMB', 'ZWE',
]);

/** Youth Mobility Scheme: maximum age at application, per the eligibility page. */
export const UK_YMS_MAX_AGE: Record<string, number> = {
  AUS: 35, CAN: 35, NZL: 35, KOR: 35,
  AND: 30, ISL: 30, JPN: 30, MCO: 30, SMR: 30, URY: 30, HKG: 30, TWN: 30,
};
const YMS_BALLOT = new Set(['HKG', 'TWN']);

const NO_PERMISSION_NEEDED = new Set(['GBR', 'IRL']);
const VISIT_PURPOSES = new Set(['tourism', 'business', 'family', 'transit']);

export function monthsBetween(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const a = new Date(start + 'T00:00:00Z');
  const b = new Date(end + 'T00:00:00Z');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return undefined;
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
}

export function ageOn(birthDate: string | undefined, on: Date): number | undefined {
  if (!birthDate) return undefined;
  const b = new Date(birthDate + 'T00:00:00Z');
  if (Number.isNaN(b.getTime())) return undefined;
  let age = on.getUTCFullYear() - b.getUTCFullYear();
  const m = on.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/** True when the UK visa-national rules (VN 1.1 and the VN 2.2 exemptions) require a visit visa. */
export function needsUkVisitVisa(input: TripInput): boolean {
  if (input.nationality === 'XXA') return true; // VN 1.1(b) stateless
  if (input.passportType === 'other') return true; // VN 1.1(c) non-national travel document
  if (input.nationality === 'TWN') return !input.taiwanIdOnPassport; // VN 2.2 exemption
  return UK_VISA_NATIONALS.has(input.nationality);
}

const passportItem = (source: Source, detail: string): ChecklistItem => ({
  id: 'passport',
  label: 'Passport',
  detail,
  required: true,
  source,
  helper: 'passport',
});

function etaRoute(): Route {
  return {
    id: 'uk-eta',
    kind: 'eta',
    title: 'Electronic Travel Authorisation (ETA)',
    summary:
      'You usually need an ETA rather than a visa. It is a digital permission linked to your passport, applied for on the UK ETA app or online.',
    fee: '£20 (non-refundable)',
    decisionTime: 'Usually within 1 day; can take up to 3 working days',
    maxStay: 'Up to 6 months per visit',
    applyWindow: 'Valid for 2 years or until your passport expires, whichever is sooner. Multiple trips allowed.',
    applyUrl: UK_SOURCES.etaApply.url,
    applyLabel: 'Apply on gov.uk (UK ETA app or online)',
    appointment: 'none',
    checklist: [
      passportItem(UK_SOURCES.etaApply, 'The passport you will travel with.'),
      { id: 'email', label: 'Email address', required: true, source: UK_SOURCES.etaApply },
      {
        id: 'payment',
        label: 'Payment method',
        detail: 'Credit card, debit card, Apple Pay or Google Pay.',
        required: true,
        source: UK_SOURCES.etaApply,
      },
      {
        id: 'face_photo',
        label: 'Photo of your face',
        detail: 'Must meet the official digital photo rules. The app takes it with your phone camera.',
        required: true,
        source: UK_SOURCES.etaApply,
        helper: 'photo',
      },
      {
        id: 'passport_photo',
        label: 'Photo of your passport (online applications)',
        detail: 'Needed if you apply online instead of in the app.',
        required: false,
        source: UK_SOURCES.etaApply,
      },
    ],
    steps: [
      'Check your passport details in this app so you can copy them exactly.',
      'Apply on the UK ETA app (scan passport and face) or online if you cannot use the app.',
      'Pay the £20 fee.',
      'Wait for the decision by email (check spam after 3 working days).',
      'Record your ETA decision in the tracker.',
    ],
    notes: [
      'An ETA does not guarantee entry to the UK.',
      'Each traveller needs their own ETA, including children.',
      'Use only gov.uk: other websites may charge more or imitate government services.',
    ],
    sources: [UK_SOURCES.eta, UK_SOURCES.etaApply, UK_SOURCES.visaNationals],
    formId: 'uk_eta',
    features: ['travellers', 'documents', 'form', 'appointment', 'notifications', 'review'],
  };
}

function visitorVisaRoute(): Route {
  return {
    id: 'uk-standard-visitor',
    kind: 'visa',
    title: 'Standard Visitor visa',
    summary:
      'Your passport needs a visa to visit the UK. You apply online before you travel and prove you will leave at the end of your visit.',
    fee: '£135 for up to 6 months',
    decisionTime: 'Not stated on the overview page: check gov.uk',
    maxStay: 'Usually up to 6 months',
    applyWindow: 'The earliest you can apply is 3 months before you travel.',
    applyEarliestMonthsBefore: 3,
    applyUrl: UK_SOURCES.visitor.url,
    applyLabel: 'Apply on gov.uk',
    appointment: 'maybe',
    checklist: [
      passportItem(UK_SOURCES.visitorDocs, 'Valid for your whole stay.'),
      {
        id: 'leave_evidence',
        label: 'Evidence you will leave the UK at the end of your visit',
        detail: 'gov.uk does not name specific documents. A return booking and your trip itinerary help show this.',
        required: true,
        source: UK_SOURCES.visitorDocs,
        helper: 'itinerary',
      },
      {
        id: 'funds',
        label: 'Evidence you can support yourself (or someone else is funding you)',
        detail: 'gov.uk does not name specific documents. Bank statements are commonly used.',
        required: true,
        source: UK_SOURCES.visitorDocs,
        helper: 'funds',
      },
      {
        id: 'return_journey',
        label: 'Evidence you can pay for your return or onward journey',
        required: true,
        source: UK_SOURCES.visitorDocs,
      },
      {
        id: 'cover_letter',
        label: 'Cover letter summarising your trip (optional)',
        detail: 'Not listed by gov.uk. Some applicants include one; it must only state facts you can back up.',
        required: false,
        source: UK_SOURCES.visitorDocs,
        helper: 'cover_letter',
      },
    ],
    steps: [
      'Collect your documents using the checklist.',
      'Fill in your answers once in this app, then copy them into the gov.uk form.',
      'Draft your itinerary and (optional) cover letter from your own facts.',
      'Apply online and pay the £135 fee.',
      'If the application asks you to prove your identity at an appointment, book it and record it in the tracker.',
      'Record the decision in the tracker.',
    ],
    notes: [
      'You cannot work, claim public funds, or marry on a Standard Visitor visa.',
      'Translations: any document not in English or Welsh usually needs a certified translation. Check the gov.uk page for your case.',
    ],
    sources: [UK_SOURCES.visitor, UK_SOURCES.visitorDocs, UK_SOURCES.visaNationals],
    formId: 'uk_visitor',
    features: ['travellers', 'documents', 'form', 'itinerary', 'cover_letter', 'appointment', 'notifications', 'review'],
  };
}

function youthMobilityRoute(input: TripInput, today: Date): Route {
  const maxAge = UK_YMS_MAX_AGE[input.nationality];
  const base = {
    sources: [UK_SOURCES.ymsOverview, UK_SOURCES.ymsEligibility, UK_SOURCES.ymsDocs],
    applyUrl: UK_SOURCES.ymsOverview.url,
  };
  if (maxAge === undefined) {
    return notEligible('uk-yms', 'Youth Mobility Scheme visa', 'Your nationality is not on the Youth Mobility Scheme list.', base.sources);
  }
  if (input.hasDependentChildren) {
    return notEligible(
      'uk-yms',
      'Youth Mobility Scheme visa',
      'You cannot apply if you have children under 18 who live with you or that you are financially responsible for.',
      base.sources,
    );
  }
  const ageNow = ageOn(input.birthDate, today);
  const ageAtStart = input.departDate ? ageOn(input.birthDate, new Date(input.departDate + 'T00:00:00Z')) : undefined;
  if (ageNow !== undefined && ageNow > maxAge) {
    return notEligible('uk-yms', 'Youth Mobility Scheme visa', `You must be ${maxAge} or under when you apply.`, base.sources);
  }
  if (ageAtStart !== undefined && ageAtStart < 18) {
    return notEligible('uk-yms', 'Youth Mobility Scheme visa', 'You must be 18 or over when the visa starts.', base.sources);
  }
  const ballot = YMS_BALLOT.has(input.nationality);
  return {
    id: 'uk-yms',
    kind: 'visa',
    title: 'Youth Mobility Scheme visa',
    summary: `Live and work in the UK for up to 24 months. Your nationality can apply aged 18 to ${maxAge}.`,
    fee: '£340',
    extraCosts: ['Healthcare surcharge: usually £776 per year', 'Savings: at least £2,530'],
    decisionTime: 'Usually within 3 weeks',
    maxStay: input.nationality === 'CAN' ? 'Up to 24 months; Canadians can extend by 1 year' : 'Up to 24 months',
    applyWindow: 'You can apply up to 6 months before you travel.',
    applyEarliestMonthsBefore: 6,
    applyUrl: base.applyUrl,
    applyLabel: 'Apply on gov.uk',
    appointment: 'maybe',
    checklist: [
      passportItem(UK_SOURCES.ymsDocs, 'A valid passport or other document showing your identity and nationality.'),
      {
        id: 'savings',
        label: 'Bank statement showing at least £2,530',
        detail: 'The money must have been available for at least 28 days in a row, and day 28 must be within 31 days of applying.',
        required: true,
        source: UK_SOURCES.ymsEligibility,
        helper: 'funds',
      },
      {
        id: 'tb',
        label: 'TB test results (if required for your country)',
        required: false,
        source: UK_SOURCES.ymsDocs,
      },
      {
        id: 'translations',
        label: 'Certified translation of any document not in English or Welsh',
        required: false,
        source: UK_SOURCES.ymsDocs,
      },
      ...(ballot
        ? [
            {
              id: 'ballot',
              label: 'Email from the Home Office confirming you were selected in the ballot',
              required: true,
              source: UK_SOURCES.ymsDocs,
            },
          ]
        : []),
    ],
    steps: [
      ...(ballot ? ['Enter and win the Youth Mobility Scheme ballot first.'] : []),
      'Make sure your savings have been in your account for 28 days in a row.',
      'Fill in your answers once in this app, then copy them into the gov.uk form.',
      'Apply online, pay the fee and the healthcare surcharge.',
      'Prove your identity (the application tells you if you need an appointment) and upload documents.',
      'Record the decision in the tracker.',
    ],
    notes: ['Age is checked from the birth date you enter. Confirm the exact rule on gov.uk before applying.'],
    sources: base.sources,
    formId: 'uk_youth_mobility',
    features: ['travellers', 'documents', 'form', 'appointment', 'notifications', 'review'],
  };
}

function skilledWorkerRoute(): Route {
  return {
    id: 'uk-skilled-worker',
    kind: 'visa',
    title: 'Skilled Worker visa',
    summary:
      'For a job with a UK employer approved by the Home Office. Your employer must give you a certificate of sponsorship before you apply.',
    fee: '£819 (up to 3 years) or £1,618 (more than 3 years), per person, applying from outside the UK',
    extraCosts: [
      'Healthcare surcharge: usually £1,035 per year',
      'Savings: at least £1,270 in your bank account',
    ],
    decisionTime: '3 weeks from outside the UK; 8 weeks from inside',
    applyWindow: 'Up to 3 months before the start date on your certificate of sponsorship.',
    applyEarliestMonthsBefore: 3,
    applyUrl: UK_SOURCES.skilledWorker.url,
    applyLabel: 'Apply on gov.uk',
    appointment: 'maybe',
    checklist: [
      passportItem(UK_SOURCES.skilledWorker, 'You must prove your identity as part of the application.'),
      {
        id: 'cos',
        label: 'Certificate of sponsorship from your employer',
        detail: 'Your employer gives you this. It describes the role and has a reference number.',
        required: true,
        source: UK_SOURCES.skilledWorker,
      },
      {
        id: 'job_offer',
        label: 'Confirmed job offer in an eligible occupation, at the minimum salary',
        detail: 'The salary minimum depends on the type of work and the date you got your certificate. Check with your employer.',
        required: true,
        source: UK_SOURCES.skilledWorker,
      },
      {
        id: 'english',
        label: 'Proof of English',
        detail: 'You usually need to prove it when you apply.',
        required: true,
        source: UK_SOURCES.skilledWorker,
      },
      {
        id: 'savings',
        label: 'At least £1,270 in your bank account',
        required: true,
        source: UK_SOURCES.skilledWorkerCosts,
        helper: 'funds',
      },
    ],
    steps: [
      'Get your certificate of sponsorship reference from your employer.',
      'Fill in your answers once in this app, then copy them into the gov.uk form.',
      'Apply online, pay the fee and the healthcare surcharge.',
      'Prove your identity (the application tells you if you need an appointment).',
      'Record the decision in the tracker.',
    ],
    notes: [
      'This route depends on your employer. Most of the eligibility checks happen on their side.',
      'Health and care workers may qualify for the Health and Care Worker visa instead, which gov.uk says is cheaper.',
    ],
    sources: [UK_SOURCES.skilledWorker, UK_SOURCES.skilledWorkerCosts],
    formId: 'uk_skilled_worker',
    features: ['travellers', 'documents', 'form', 'appointment', 'notifications', 'review'],
  };
}

function notEligible(id: string, title: string, reason: string, sources: Source[]): Route {
  return {
    id,
    kind: 'not_eligible',
    title,
    summary: reason,
    checklist: [],
    steps: [],
    notes: ['Use the gov.uk visa checker to see other options.'],
    sources: [...sources, UK_SOURCES.checker],
    applyUrl: UK_SOURCES.checker.url,
    applyLabel: 'Open the gov.uk visa checker',
    features: [],
  };
}

function notCovered(title: string, reason: string): Route {
  return {
    id: 'uk-not-covered',
    kind: 'not_covered',
    title,
    summary: reason,
    checklist: [],
    steps: [],
    notes: [],
    sources: [UK_SOURCES.checker],
    applyUrl: UK_SOURCES.checker.url,
    applyLabel: 'Open the gov.uk visa checker',
    features: [],
  };
}

export const ukRules: DestinationRules = {
  code: 'GBR',
  name: 'United Kingdom',
  checkerUrl: UK_SOURCES.checker.url,
  resolve(input: TripInput, today: Date = new Date()): Route {
    if (NO_PERMISSION_NEEDED.has(input.nationality)) {
      return {
        id: 'uk-none',
        kind: 'none',
        title: 'No ETA or visa needed',
        summary: 'British and Irish passport holders do not need an ETA or visa to travel to the UK.',
        checklist: [],
        steps: [],
        notes: [],
        sources: [UK_SOURCES.eta],
        features: [],
      };
    }

    if (input.purpose === 'marriage') {
      return notCovered('Marriage Visitor visa', 'Marrying or giving notice in the UK needs a Marriage Visitor visa. This app does not cover it yet.');
    }
    if (input.purpose === 'study') {
      return notCovered('Student visa', 'Study routes are not covered yet. Use the gov.uk checker for your options.');
    }
    if (input.purpose === 'youth_mobility') return youthMobilityRoute(input, today);
    if (input.purpose === 'work_sponsored') return skilledWorkerRoute();

    if (VISIT_PURPOSES.has(input.purpose)) {
      const months = monthsBetween(input.departDate, input.returnDate);
      if (months !== undefined && months > 6) {
        return notCovered(
          'Visits longer than 6 months',
          'Visits are usually limited to 6 months. Longer stays need a different route, which this app does not cover yet.',
        );
      }
      return needsUkVisitVisa(input) ? visitorVisaRoute() : etaRoute();
    }

    return notCovered('Not covered', 'This purpose is not covered yet.');
  },
};
