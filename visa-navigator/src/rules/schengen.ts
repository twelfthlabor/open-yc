import type { ChecklistItem, DestinationRules, Route, Source, TripInput } from './types';
import { monthsBetween } from './uk';

// Who needs a Schengen visa: Regulation (EU) 2018/1806, consolidated text of 2025-12-30
// (saved under docs/sources). Croatia-specific rules: Croatian Ministry of Foreign and European
// Affairs (mvep.gov.hr). Fees and timing: European Commission, "Applying for a Schengen visa".
const RETRIEVED = '2026-10-10';
const src = (label: string, url: string): Source => ({ label, url, retrievedOn: RETRIEVED });

export const SCHENGEN_SOURCES = {
  regulation: src(
    'Regulation (EU) 2018/1806, Annexes I and II (consolidated 30 Dec 2025)',
    'https://publications.europa.eu/resource/celex/02018R1806-20251230',
  ),
  euApply: src('European Commission: Applying for a Schengen visa', 'https://home-affairs.ec.europa.eu/policies/schengen/visa-policy/applying-schengen-visa_en'),
  mvepVisas: src('Croatian Ministry of Foreign Affairs: Visas', 'https://mvep.gov.hr/consular-information-125335/visas-180242/180242'),
  mvepGeneral: src(
    'Croatian Ministry of Foreign Affairs: General visa information (embassy page; matches the Beijing embassy on €70/day and €30,000 cover)',
    'https://mvep.gov.hr/consular-information-107317-252835/general-visa-information-252837/252837',
  ),
  crovisa: src('Croatian online visa application form (CROVISA)', 'https://crovisa.mvep.hr/'),
};

/** EU member states, EEA and Switzerland: free movement, no visa. */
export const FREE_MOVEMENT = new Set([
  'AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'D', 'GRC', 'HUN', 'IRL',
  'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE',
  'ISL', 'LIE', 'NOR', 'CHE',
]);

/** Annex I: nationals must hold a visa. 103 states + the Palestinian Authority. */
export const SCHENGEN_ANNEX_I = new Set([
  'AFG', 'ARM', 'AGO', 'AZE', 'BGD', 'BFA', 'BHR', 'BDI', 'BEN', 'BOL', 'BTN', 'BWA', 'BLR', 'BLZ',
  'COD', 'CAF', 'COG', 'CIV', 'CMR', 'CHN', 'CUB', 'CPV', 'DJI', 'DOM', 'DZA', 'ECU', 'EGY', 'ERI',
  'SWZ', 'ETH', 'FJI', 'GAB', 'GHA', 'GMB', 'GIN', 'GNQ', 'GNB', 'GUY', 'HTI', 'IDN', 'IND', 'IRQ',
  'IRN', 'JAM', 'JOR', 'KEN', 'KGZ', 'KHM', 'COM', 'PRK', 'KWT', 'KAZ', 'LAO', 'LBN', 'LKA', 'LBR',
  'LSO', 'LBY', 'MAR', 'MDG', 'MLI', 'MMR', 'MNG', 'MRT', 'MDV', 'MWI', 'MOZ', 'NAM', 'NER', 'NGA',
  'NPL', 'OMN', 'PNG', 'PHL', 'PAK', 'QAT', 'RUS', 'RWA', 'SAU', 'SDN', 'SLE', 'SEN', 'SOM', 'SUR',
  'SSD', 'STP', 'SYR', 'TCD', 'TGO', 'THA', 'TJK', 'TKM', 'TUN', 'TUR', 'TZA', 'UGA', 'UZB', 'VUT',
  'VNM', 'YEM', 'ZAF', 'ZMB', 'ZWE',
  'PSE',
]);

/** Annex II with no condition. */
const ANNEX_II = new Set([
  'AND', 'ATG', 'ARG', 'AUS', 'BRB', 'BRN', 'BRA', 'BHS', 'CAN', 'CHL', 'COL', 'CRI', 'GTM', 'HND',
  'ISR', 'JPN', 'KNA', 'KOR', 'MCO', 'MUS', 'MEX', 'MYS', 'NIC', 'NZL', 'PAN', 'PRY', 'SLB', 'SYC',
  'SGP', 'SMR', 'SLV', 'TTO', 'GBR', 'USA', 'URY', 'VAT', 'VEN', 'WSM',
]);

/**
 * Annex II footnotes 7 and 11: exempt from the date an EU visa waiver agreement enters into force.
 * Germany's Federal Foreign Office lists these as visa-free for 2026 (news report, not verified on an
 * EU page). Nauru (footnote 11) is not on that list, so it stays unconfirmed.
 */
const ANNEX_II_AGREEMENT = new Set(['ARE', 'DMA', 'FSM', 'GRD', 'KIR', 'LCA', 'MHL', 'PER', 'PLW', 'TLS', 'TON', 'TUV', 'VCT']);
const UNCONFIRMED = new Set(['NRU']);

/** Annex II footnotes 6, 8, 9, 10, 12, 13, 19: exemption only for biometric passports. */
const ANNEX_II_BIOMETRIC = new Set(['MKD', 'ALB', 'BIH', 'GEO', 'MDA', 'MNE', 'SRB', 'UKR', 'RKS']);

/** HKG/MAC: SAR passports only (footnotes 14, 15). TWN: passport must include the ID number (17). */
const ANNEX_II_PASSPORT_CONDITION = new Set(['HKG', 'MAC', 'TWN']);

export type SchengenBucket =
  | 'free_movement'
  | 'annex_i'
  | 'annex_ii'
  | 'annex_ii_agreement'
  | 'annex_ii_biometric'
  | 'annex_ii_passport_condition'
  | 'unconfirmed'
  | 'not_covered';

export function schengenBucket(code: string): SchengenBucket | undefined {
  if (FREE_MOVEMENT.has(code)) return 'free_movement';
  if (SCHENGEN_ANNEX_I.has(code)) return 'annex_i';
  if (ANNEX_II.has(code)) return 'annex_ii';
  if (ANNEX_II_AGREEMENT.has(code)) return 'annex_ii_agreement';
  if (ANNEX_II_BIOMETRIC.has(code)) return 'annex_ii_biometric';
  if (ANNEX_II_PASSPORT_CONDITION.has(code)) return 'annex_ii_passport_condition';
  if (UNCONFIRMED.has(code)) return 'unconfirmed';
  if (code === 'XXA') return 'not_covered';
  return undefined;
}

type VisaNeed = 'free_movement' | 'visa_free' | 'visa' | 'unknown';

export function schengenVisaNeed(input: TripInput): VisaNeed {
  if (input.passportType === 'other') return 'unknown';
  switch (schengenBucket(input.nationality)) {
    case 'free_movement':
      return 'free_movement';
    case 'annex_i':
      return 'visa';
    case 'annex_ii':
    case 'annex_ii_agreement':
      return 'visa_free';
    case 'annex_ii_biometric':
      if (input.biometricPassport === undefined) return 'unknown';
      return input.biometricPassport ? 'visa_free' : 'visa';
    case 'annex_ii_passport_condition':
      if (input.nationality === 'TWN') return input.taiwanIdOnPassport ? 'visa_free' : 'visa';
      return 'visa_free'; // HKG / MAC options in the picker mean SAR passports
    default:
      return 'unknown';
  }
}

export function needsBiometricQuestion(nationality: string): boolean {
  return ANNEX_II_BIOMETRIC.has(nationality);
}

const VISIT_PURPOSES = new Set(['tourism', 'business', 'family', 'transit']);

function croatiaVisaRoute(): Route {
  const S = SCHENGEN_SOURCES;
  const checklist: ChecklistItem[] = [
    {
      id: 'form',
      label: 'Visa application form, completed online, printed and signed',
      detail: 'Fill it in on CROVISA, print it, and sign it. This app prepares every answer so you can fill it in quickly.',
      required: true,
      source: S.mvepGeneral,
      helper: 'form',
      perTraveller: true,
    },
    {
      id: 'passport',
      label: 'Passport',
      detail: 'Valid for at least 3 months after you leave Croatia, with at least 2 empty pages.',
      required: true,
      source: S.mvepGeneral,
      helper: 'passport',
      perTraveller: true,
    },
    {
      id: 'photo',
      label: 'Passport photo',
      detail: 'In line with ICAO standards; the Croatian ministry asks for 35×45 mm, in colour.',
      required: true,
      source: S.euApply,
      helper: 'photo',
      perTraveller: true,
    },
    {
      id: 'insurance',
      label: 'Travel medical insurance of at least €30,000',
      detail: 'Valid for Croatia for the whole stay. Covers emergency treatment, hospitalisation and repatriation, including in the event of death.',
      required: true,
      source: S.mvepGeneral,
      helper: 'insurance',
      perTraveller: true,
    },
    {
      id: 'funds',
      label: 'Proof of funds: €70 per person per day',
      detail: 'Bank statements showing enough money for the whole stay.',
      required: true,
      source: S.mvepGeneral,
      helper: 'funds',
      perTraveller: false,
    },
    {
      id: 'accommodation',
      label: 'Proof of accommodation',
      detail: 'Hotel booking, rental confirmation, or an invitation letter if you stay with someone.',
      required: true,
      source: S.mvepGeneral,
      helper: 'accommodation',
      perTraveller: false,
    },
    {
      id: 'return_ticket',
      label: 'Return or round-trip ticket reservation',
      required: true,
      source: S.mvepGeneral,
      helper: 'ticket',
      perTraveller: false,
    },
    {
      id: 'itinerary',
      label: 'Travel itinerary',
      detail: 'Shows the purpose of the trip and where you will be.',
      required: true,
      source: S.mvepGeneral,
      helper: 'itinerary',
      perTraveller: false,
    },
    {
      id: 'employment',
      label: 'Employment letter or proof of studies (often requested)',
      detail: 'Listed on the ministry’s general page; embassies may ask for it.',
      required: false,
      source: S.mvepGeneral,
      perTraveller: true,
    },
    {
      id: 'cover_letter',
      label: 'Cover letter (optional)',
      detail: 'Not listed by the ministry. If you include one, it must only state facts you can back up.',
      required: false,
      source: S.mvepGeneral,
      helper: 'cover_letter',
      perTraveller: false,
    },
  ];

  return {
    id: 'hrv-schengen-c',
    kind: 'visa',
    title: 'Schengen short-stay visa (type C) for Croatia',
    summary:
      'Your passport needs a Schengen visa. You fill in the form online, then hand in your documents and give fingerprints in person at the Croatian embassy or visa centre.',
    fee: '€90 for ages 12 and over, €45 for children aged 6 to under 12, free under 6',
    extraCosts: ['Visa centre service fee if you apply through an external provider (charged separately)'],
    decisionTime: 'Usually 15 days; can be extended up to 45 days',
    maxStay: 'Up to 90 days in any 180-day period',
    applyWindow: 'No earlier than 6 months and at least 15 days before you travel.',
    applyEarliestMonthsBefore: 6,
    applyUrl: S.crovisa.url,
    applyLabel: 'Open the CROVISA form',
    appointment: 'required',
    bookingLabel: 'Book at the Croatian embassy or its visa centre in your country',
    formId: 'schengen_c',
    funds: { perDay: 70, currency: 'EUR' },
    insurance: { minimum: 30000, currency: 'EUR', territory: 'Croatia' },
    checklist,
    steps: [
      'Collect your documents. Upload each one and the app checks it against the requirement.',
      'Fill in the CROVISA form using the fill-along answers, then print and sign it.',
      'Book an appointment at the Croatian embassy or visa centre where you live.',
      'Go to the appointment with your documents; your fingerprints are taken there.',
      'Pay the €90 visa fee (plus any visa centre fee).',
      'Track the decision. It usually takes 15 days.',
    ],
    notes: [
      'A visa does not guarantee entry. Carry your documents when you travel.',
      'Embassy pages in some countries still list older fees. The EU-wide fee is €90 for adults.',
      'Documents not in English or Croatian may need an official translation.',
    ],
    sources: [S.euApply, S.regulation, S.mvepGeneral, S.mvepVisas, S.crovisa],
    features: ['travellers', 'documents', 'form', 'itinerary', 'cover_letter', 'appointment', 'notifications', 'review'],
  };
}

function croatiaVisaFreeRoute(note?: string): Route {
  const S = SCHENGEN_SOURCES;
  return {
    id: 'hrv-visa-free',
    kind: 'visa_free',
    title: 'No visa needed for short stays',
    summary: 'You can visit Croatia without a visa for short stays. At the border you register in the EU Entry/Exit System and may be asked to show your documents.',
    maxStay: 'Up to 90 days in any 180-day period across the Schengen area',
    applyWindow: 'Nothing to apply for. ETIAS travel authorisation is not running yet; check before you travel.',
    appointment: 'none',
    funds: { perDay: 70, currency: 'EUR' },
    checklist: [
      {
        id: 'passport',
        label: 'Passport valid for at least 3 months after you leave',
        required: true,
        source: S.euApply,
        helper: 'passport',
        perTraveller: true,
      },
      {
        id: 'funds',
        label: 'Proof you can support yourself (€70 per day)',
        detail: 'Border police may ask to see it.',
        required: false,
        source: S.mvepGeneral,
        helper: 'funds',
        perTraveller: false,
      },
      {
        id: 'accommodation',
        label: 'Proof of accommodation',
        required: false,
        source: S.mvepGeneral,
        helper: 'accommodation',
        perTraveller: false,
      },
      {
        id: 'return_ticket',
        label: 'Return or onward ticket',
        required: false,
        source: S.mvepGeneral,
        helper: 'ticket',
        perTraveller: false,
      },
    ],
    steps: ['Check your passport validity.', 'Keep your bookings and proof of funds with you when you travel.', 'Count your days: 90 in any 180 across all Schengen countries.'],
    notes: [note ?? 'Based on Annex II of Regulation (EU) 2018/1806.', 'Your passport is scanned and fingerprints may be taken at the border under the EU Entry/Exit System.'],
    sources: [S.regulation, S.euApply, S.mvepGeneral],
    features: ['travellers', 'documents', 'itinerary', 'notifications', 'review'],
  };
}

function notCovered(title: string, summary: string): Route {
  return {
    id: 'hrv-not-covered',
    kind: 'not_covered',
    title,
    summary,
    checklist: [],
    steps: [],
    notes: [],
    sources: [SCHENGEN_SOURCES.mvepVisas, SCHENGEN_SOURCES.regulation],
    applyUrl: SCHENGEN_SOURCES.mvepVisas.url,
    applyLabel: 'Croatian ministry visa page',
    features: [],
  };
}

export const croatiaRules: DestinationRules = {
  code: 'HRV',
  name: 'Croatia',
  checkerUrl: SCHENGEN_SOURCES.mvepVisas.url,
  resolve(input: TripInput): Route {
    if (!VISIT_PURPOSES.has(input.purpose)) {
      return notCovered('Long stays, work and study are not covered', 'This app covers short stays (tourism, business, family visits, transit) for Croatia. Check the Croatian ministry for work, study and long-stay permits.');
    }
    const months = monthsBetween(input.departDate, input.returnDate);
    if (months !== undefined && months * 30.4375 > 90) {
      return notCovered('Stays longer than 90 days', 'Short-stay rules allow up to 90 days in any 180-day period. Longer stays need a national long-stay visa or permit, which this app does not cover.');
    }

    const need = schengenVisaNeed(input);
    if (need === 'free_movement') {
      return {
        id: 'hrv-free-movement',
        kind: 'none',
        title: 'Free movement: no visa needed',
        summary: 'EU, EEA and Swiss citizens can travel to Croatia with a passport or national ID card.',
        checklist: [],
        steps: [],
        notes: [],
        sources: [SCHENGEN_SOURCES.regulation],
        features: [],
      };
    }
    if (need === 'visa') return croatiaVisaRoute();
    if (need === 'visa_free') {
      const agreement = schengenBucket(input.nationality) === 'annex_ii_agreement';
      return croatiaVisaFreeRoute(
        agreement
          ? 'Your exemption depends on an EU visa waiver agreement with your country being in force. It is listed as visa-free, but confirm with the Croatian embassy before you travel.'
          : undefined,
      );
    }
    if (input.passportType === 'other' || input.nationality === 'XXA') {
      return notCovered('Check with the Croatian embassy', 'Rules for stateless travellers, refugees and other travel documents depend on the document. This app does not guess; ask the Croatian embassy.');
    }
    return notCovered('We could not confirm your visa status', 'Your country is not clearly covered by the sources this app uses. Check the Croatian ministry’s visa overview for your nationality.');
  },
};
