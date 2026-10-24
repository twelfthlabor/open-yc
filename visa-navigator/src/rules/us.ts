import type { ChecklistItem, DestinationRules, Route, Source, TripInput } from './types';

// Every figure below comes from a primary source retrieved on RETRIEVED: the Code of Federal Regulations (eCFR),
// the Federal Register, DHS and CBP. travel.state.gov refuses automated requests, so it is linked, not quoted.
const RETRIEVED = '2026-10-11';

// Presidential Proclamation 10998 (in force 1 January 2026). Sections 2 and 4 suspend entry; sections 3 and 5
// suspend visitor (B-1/B-2) visas. Lists as kept in the original project's sourced corrections file.
const PROCLAMATION_10998: Source = {
  label: 'The White House: Proclamation 10998, Restricting and Limiting the Entry of Foreign Nationals (16 Dec 2025, in force 1 Jan 2026)',
  url: 'https://www.whitehouse.gov/presidential-actions/2025/12/restricting-and-limiting-the-entry-of-foreign-nationals-to-protect-the-security-of-the-united-states/',
  retrievedOn: '2026-10-10',
};
const ENTRY_SUSPENDED = new Set(['AFG', 'MMR', 'TCD', 'COG', 'GNQ', 'ERI', 'HTI', 'IRN', 'LBY', 'SOM', 'SDN', 'YEM', 'BFA', 'LAO', 'MLI', 'NER', 'SLE', 'SSD', 'SYR', 'PSE']);
const VISITOR_VISA_SUSPENDED = new Set(['BDI', 'CUB', 'TGO', 'VEN', 'AGO', 'ATG', 'BEN', 'CIV', 'DMA', 'GAB', 'GMB', 'MWI', 'MRT', 'NGA', 'SEN', 'TZA', 'TON', 'ZMB', 'ZWE']);

function restrictedRoute(nationality: string): Route {
  const full = ENTRY_SUSPENDED.has(nationality);
  return {
    id: 'us-restricted',
    kind: 'restricted',
    title: full ? 'Entry suspended by presidential proclamation' : 'Visitor visas suspended by presidential proclamation',
    summary: full
      ? 'Since 1 January 2026, a US presidential proclamation suspends entry to the United States for nationals of your country, including visitors.'
      : 'Since 1 January 2026, a US presidential proclamation suspends visitor (B-1/B-2) visas for nationals of your country, so tourist, business and family visits are not possible on a new visa.',
    checklist: [],
    steps: [],
    notes: ['People who already held a valid US visa on 1 January 2026, permanent residents and a few listed categories are exempt. Check with the US embassy.'],
    sources: [PROCLAMATION_10998],
    features: [],
  };
}

const src = (label: string, url: string): Source => ({ label, url, retrievedOn: RETRIEVED });

export const US_SOURCES = {
  vwp: src('DHS: Visa Waiver Program (designated countries, stays of up to 90 days)', 'https://www.dhs.gov/visa-waiver-program'),
  vwpRule: src('8 CFR 217.2: Visa Waiver Program eligibility (round-trip ticket)', 'https://www.ecfr.gov/current/title-8/chapter-I/subchapter-B/part-217/section-217.2'),
  vwpAct: src(
    'CBP: Visa Waiver Program Improvement and Terrorist Travel Prevention Act FAQ (travel since 2011, dual nationals, Cuba, e-passports)',
    'https://www.cbp.gov/travel/international-visitors/visa-waiver-program/visa-waiver-program-improvement-and-terrorist-travel-prevention-act-faq',
  ),
  estaRule: src('8 CFR 217.5: Electronic System for Travel Authorization', 'https://www.ecfr.gov/current/title-8/chapter-I/subchapter-B/part-217/section-217.5'),
  esta: src('CBP: Official ESTA application website', 'https://esta.cbp.dhs.gov/'),
  estaFee2026: src(
    'Federal Register 2025-20304: DHS fees required by HR-1, fiscal year 2026 (ESTA $40.27)',
    'https://www.federalregister.gov/documents/2025/11/19/2025-20304/certain-dhs-immigration-fees-required-by-hr-1-fiscal-year-2026-adjustments-for-inflation',
  ),
  estaFee2027: src(
    'Federal Register 2026-20185: DHS fees required by HR-1, fiscal year 2027 (ESTA $40.62 from 16 Oct 2026)',
    'https://www.federalregister.gov/documents/2026/10/01/2026-20185/certain-dhs-immigration-related-fees-required-by-hr-1-fiscal-year-2027-adjustments-for-inflation',
  ),
  canada: src('8 CFR 212.1(a): Canadian and Bermudian citizens do not generally need a visa', 'https://www.ecfr.gov/current/title-8/chapter-I/subchapter-B/part-212/section-212.1'),
  fees: src('22 CFR 22.1: Schedule of fees for consular services (item 21(a): $185)', 'https://www.ecfr.gov/current/title-22/chapter-I/subchapter-C/part-22/section-22.1'),
  expedite: src(
    'Federal Register 2026-11513: temporary $750 visa appointment expedite fee (1 Jul to 31 Dec 2026)',
    'https://www.federalregister.gov/documents/2026/06/09/2026-11513/schedule-of-fees-for-consular-services-department-of-state-and-overseas-embassies-and',
  ),
  ds160: src('22 CFR 41.103: Filing a nonimmigrant visa application (Form DS-160)', 'https://www.ecfr.gov/current/title-22/chapter-I/subchapter-E/part-41/subpart-I/section-41.103'),
  interview: src('22 CFR 41.102: Personal appearance and interview', 'https://www.ecfr.gov/current/title-22/chapter-I/subchapter-E/part-41/subpart-I/section-41.102'),
  visitor: src('22 CFR 41.31: Temporary visitors for business or pleasure', 'https://www.ecfr.gov/current/title-22/chapter-I/subchapter-E/part-41/subpart-C/section-41.31'),
  admission: src('8 CFR 214.2(b): Visitors, period of admission', 'https://www.ecfr.gov/current/title-8/chapter-I/subchapter-B/part-214/section-214.2'),
  passport: src('9 FAM 403.9-3(B): Passport validity for nonimmigrant visas', 'https://fam.state.gov/fam/09FAM/09FAM040309.html'),
  ceac: src('Department of State: Online Nonimmigrant Visa Application (DS-160)', 'https://ceac.state.gov/genniv/'),
};

/**
 * Visa Waiver Program countries as listed by DHS (page updated 2 May 2025). Codes are ISO alpha-3 / MRZ; D is Germany.
 * GBR is British citizens only (the MRZ code for other British nationalities differs). Taiwan needs the ID number in the passport.
 */
export const US_VWP = new Set([
  'AND', 'AUS', 'AUT', 'BEL', 'BRN', 'CHL', 'HRV', 'CZE', 'DNK', 'EST',
  'FIN', 'FRA', 'D', 'GRC', 'HUN', 'ISL', 'IRL', 'ISR', 'ITA', 'JPN',
  'KOR', 'LVA', 'LIE', 'LTU', 'LUX', 'MLT', 'MCO', 'NLD', 'NZL', 'NOR',
  'POL', 'PRT', 'QAT', 'SMR', 'SGP', 'SVK', 'SVN', 'ESP', 'SWE', 'CHE',
  'TWN', 'GBR',
]);

const VISIT_PURPOSES = new Set(['tourism', 'business', 'family', 'transit']);
const NO_VISA = new Set(['CAN', 'BMU']);

/** The ESTA fee changed with the fiscal year 2027 notice on 16 October 2026. */
function estaFee(today: Date): string {
  return today.toISOString().slice(0, 10) < '2026-10-16' ? '$40.27 ($40.62 from 16 October 2026)' : '$40.62';
}

const EXPEDITE = { from: '2026-07-01', to: '2026-12-31' };

export function stayDays(input: TripInput): number | undefined {
  if (!input.departDate || !input.returnDate) return undefined;
  const ms = Date.parse(input.returnDate) - Date.parse(input.departDate);
  return Number.isNaN(ms) ? undefined : Math.round(ms / 86_400_000) + 1;
}

const passportItem = (detail: string, source: Source): ChecklistItem => ({
  id: 'passport',
  label: 'Passport',
  detail,
  required: true,
  source,
  helper: 'passport',
  perTraveller: true,
});

function estaRoute(today: Date): Route {
  return {
    id: 'us-esta',
    kind: 'eta',
    title: 'ESTA (Visa Waiver Program)',
    summary:
      'Your passport can visit the United States without a visa for up to 90 days for tourism or business, if you meet the Visa Waiver conditions. You need an approved ESTA before you board.',
    fee: estaFee(today),
    maxStay: 'Up to 90 days per visit',
    applyWindow: 'Valid for 2 years, or until your passport expires if sooner. Apply before you board.',
    applyUrl: US_SOURCES.esta.url,
    applyLabel: 'Apply on the official ESTA site',
    appointment: 'none',
    checklist: [
      passportItem('A valid, unexpired electronic (chip) passport from a Visa Waiver country.', US_SOURCES.vwpAct),
      {
        id: 'vwp_eligibility',
        label: 'Confirm you can use the Visa Waiver Program',
        detail:
          'You need a visitor visa instead if you have been in Iraq, Iran, Libya, North Korea, Somalia, Sudan, Syria or Yemen on or after 1 March 2011 (except some military or government duty), or in Cuba on or after 12 January 2021; if you are also a national of Iraq, Iran, North Korea, Sudan, Syria or Cuba; or if your passport is not electronic.',
        required: true,
        source: US_SOURCES.vwpAct,
        perTraveller: true,
      },
      {
        id: 'esta',
        label: 'Approved ESTA',
        detail: 'Each traveller needs their own, before boarding.',
        required: true,
        source: US_SOURCES.estaRule,
        perTraveller: true,
      },
      {
        id: 'return_ticket',
        label: 'Return or onward ticket',
        detail: 'You must arrive with a ticket that takes you out of the United States.',
        required: true,
        source: US_SOURCES.vwpRule,
        helper: 'ticket',
        perTraveller: false,
      },
    ],
    steps: [
      'Read each passport in this app so you can copy the details exactly.',
      'Apply on the official ESTA site (esta.cbp.dhs.gov) for each traveller and pay the fee.',
      'Wait for approval before you board; record it in the tracker.',
      'Travel with the passport you used for the ESTA and a return or onward ticket.',
    ],
    notes: [
      'You need a visa instead if you have been in Iran, Iraq, Libya, North Korea, Somalia, Sudan, Syria or Yemen since 1 March 2011 or in Cuba since 12 January 2021, hold certain dual nationalities, or have a passport without a chip.',
      'An ESTA lets you board; the officer at the border decides whether to admit you.',
      'A new passport needs a new ESTA.',
      'Dutch passports issued for Curaçao, Bonaire, St Eustatius, Saba or St Maarten do not qualify; apply for a visa instead.',
      'Apply only on esta.cbp.dhs.gov, the official site.',
    ],
    sources: [US_SOURCES.vwp, US_SOURCES.vwpAct, US_SOURCES.vwpRule, US_SOURCES.estaRule, US_SOURCES.estaFee2026, US_SOURCES.estaFee2027],
    features: ['travellers', 'documents', 'notifications', 'review'],
  };
}

function visitorVisaRoute(input: TripInput, today: Date, longStay: boolean): Route {
  const day = today.toISOString().slice(0, 10);
  const expedite = day >= EXPEDITE.from && day <= EXPEDITE.to;
  return {
    id: 'us-b',
    kind: 'visa',
    title: 'Visitor visa (B-1/B-2)',
    summary: longStay
      ? 'The Visa Waiver Program allows up to 90 days, so a longer visit needs a visitor visa: apply online, then attend an interview at a US embassy or consulate.'
      : 'Your passport needs a visitor visa for the United States. You fill in the DS-160 online, pay the fee, then attend an interview at a US embassy or consulate.',
    fee: '$185 per person',
    extraCosts: [
      'Visa issuance (reciprocity) fee for some nationalities, paid when the visa is issued',
      ...(expedite ? ['Optional: $750 to expedite the interview appointment (until 31 December 2026)'] : []),
    ],
    decisionTime: 'Usually decided at or after the interview; wait times vary by embassy',
    maxStay: 'Set by the officer at entry; up to 1 year per visit',
    applyUrl: US_SOURCES.ceac.url,
    applyLabel: 'Fill in the DS-160',
    appointment: 'required',
    bookingLabel: 'After paying the fee, book your interview at the US embassy or consulate where you live.',
    passportRule: { monthsAfter: 6, exceptions: true },
    formId: 'us_b',
    checklist: [
      passportItem('Valid for at least 6 months after your stay, unless your country is on the State Department’s exceptions list.', US_SOURCES.passport),
      {
        id: 'ds160',
        label: 'DS-160 confirmation page',
        detail: 'Filled in and signed online for each traveller. This app prepares the answers.',
        required: true,
        source: US_SOURCES.ds160,
        helper: 'form',
        perTraveller: true,
      },
      {
        id: 'fee_receipt',
        label: 'Visa fee receipt ($185)',
        required: true,
        source: US_SOURCES.fees,
        perTraveller: true,
      },
      {
        id: 'interview',
        label: 'Interview appointment confirmation',
        detail: 'Everyone aged 14 to 79 is interviewed in person unless the embassy waives it, for example for some renewals within 12 months.',
        required: true,
        source: US_SOURCES.interview,
        perTraveller: true,
      },
      {
        id: 'funds',
        label: 'Evidence you can pay for the trip',
        detail: 'The officer must be satisfied that you have made adequate financial arrangements. Bank statements are commonly used.',
        required: true,
        source: US_SOURCES.visitor,
        helper: 'funds',
        perTraveller: false,
      },
      {
        id: 'ties',
        label: 'Evidence you will leave at the end of your visit',
        detail: 'For example a return booking, your itinerary, and proof of your job, studies or home.',
        required: false,
        source: US_SOURCES.visitor,
        helper: 'itinerary',
        perTraveller: false,
      },
      {
        id: 'cover_letter',
        label: 'Cover letter summarising your trip (optional)',
        detail: 'Not required. If you bring one, it must only state facts you can back up.',
        required: false,
        source: US_SOURCES.visitor,
        helper: 'cover_letter',
        perTraveller: false,
      },
    ],
    steps: [
      'Read each passport and collect your documents using the checklist.',
      'Prepare your DS-160 answers in this app, then copy them into the online form for each traveller and print the confirmation page.',
      'Pay the $185 fee and book the interview at the US embassy or consulate where you live.',
      'Attend the interview with your passport, confirmation page and supporting documents.',
      'Record the decision in the tracker; the visa is placed in your passport if approved.',
    ],
    notes: [
      'A visa lets you travel to a port of entry; the officer at the border decides how long you may stay.',
      'You cannot study or work on a visitor visa.',
      ...(input.nationality === 'MEX' ? ['Mexican citizens may apply for a Border Crossing Card instead; it has the same $185 fee.'] : []),
    ],
    sources: [US_SOURCES.fees, US_SOURCES.ds160, US_SOURCES.interview, US_SOURCES.visitor, US_SOURCES.admission, US_SOURCES.passport, ...(expedite ? [US_SOURCES.expedite] : [])],
    features: ['travellers', 'documents', 'form', 'itinerary', 'cover_letter', 'appointment', 'notifications', 'review'],
  };
}

function notCovered(title: string, reason: string): Route {
  return {
    id: 'us-not-covered',
    kind: 'not_covered',
    title,
    summary: reason,
    checklist: [],
    steps: [],
    notes: [],
    sources: [US_SOURCES.visitor],
    features: [],
  };
}

export const usRules: DestinationRules = {
  code: 'USA',
  name: 'United States',
  checkerUrl: US_SOURCES.vwp.url,
  resolve(input: TripInput, today: Date = new Date()): Route {
    if (input.nationality === 'USA') {
      return { id: 'us-none', kind: 'none', title: 'No visa needed', summary: 'US citizens do not need a visa to enter the United States.', checklist: [], steps: [], notes: [], sources: [], features: [] };
    }
    // Entry suspensions under the presidential proclamation are kept in the shared corrections list.
    if (ENTRY_SUSPENDED.has(input.nationality) || VISITOR_VISA_SUSPENDED.has(input.nationality)) return restrictedRoute(input.nationality);

    if (!VISIT_PURPOSES.has(input.purpose)) {
      return notCovered('Not covered yet', 'Study, work and other long-term US visas are not covered yet. This app covers visits for tourism, business and family.');
    }

    if (NO_VISA.has(input.nationality) && input.passportType === 'national') {
      return {
        id: 'us-no-visa',
        kind: 'visa_free',
        title: 'No visa needed',
        summary: 'Canadian and Bermudian citizens do not generally need a visa or an ESTA to visit the United States. Travel with a valid passport.',
        maxStay: 'Set by the officer at entry',
        checklist: [passportItem('A valid, unexpired passport.', US_SOURCES.canada)],
        steps: ['Travel with a valid passport. The officer at the border decides how long you may stay.'],
        notes: [],
        sources: [US_SOURCES.canada],
        features: ['travellers', 'notifications'],
      };
    }

    const days = stayDays(input);
    const longStay = days !== undefined && days > 90;
    const vwp = US_VWP.has(input.nationality) && input.passportType === 'national' && (input.nationality !== 'TWN' || input.taiwanIdOnPassport === true);
    // Transit through the US is allowed under the Visa Waiver Program; a long visit is not.
    if (vwp && (!longStay || input.purpose === 'transit')) return estaRoute(today);
    if (input.purpose === 'transit') {
      return notCovered('Transit visa (C)', 'Passing through the United States without a Visa Waiver passport needs a transit visa, which this app does not cover yet.');
    }
    return visitorVisaRoute(input, today, vwp && longStay);
  },
};
