// Every Schengen state, with deeper sourced profiles for Sweden, France and the Netherlands.
//
// Who needs a visa, the fee, the timing, the €30,000 insurance and the form are EU-wide (Regulation (EU) 2018/1806,
// Regulation (EC) 810/2009 and the European Commission's "Applying for a Schengen visa"). The official visa site for
// each state is the one the European Commission links from that page (retrieved 2026-10-10; the Netherlands link
// there was dead, so NetherlandsWorldwide, the Dutch government's visa site, is used). Each state sets its own daily
// funds amount, so a state without a profile below gets no amount rather than a guessed one.
// Croatia keeps its own route in schengen.ts (CROVISA, €70 a day).

import { croatiaRules, needsBiometricQuestion, schengenBucket, schengenVisaNeed, SCHENGEN_SOURCES } from './schengen';
import type { ChecklistItem, DestinationRules, Route, Source, TripInput } from './types';
import { monthsBetween } from './uk';

const src = (label: string, url: string, retrievedOn = '2026-10-10'): Source => ({ label, url, retrievedOn });

export interface SchengenState {
  code: string;
  name: string;
  /** Adjective for "the French embassy". */
  adjective: string;
  info: Source;
}

const state = (code: string, name: string, adjective: string, url: string): SchengenState => ({
  code,
  name,
  adjective,
  info: src(`${name}: official visa information (linked by the European Commission)`, url),
});

export const SCHENGEN_STATES: SchengenState[] = [
  state('AUT', 'Austria', 'Austrian', 'https://www.bmeia.gv.at/en/travel-stay/entrance-and-residence-in-austria/visa'),
  state('BEL', 'Belgium', 'Belgian', 'https://dofi.ibz.be/fr/themes/third-country-nationals/court-sejour'),
  state('BGR', 'Bulgaria', 'Bulgarian', 'https://www.mfa.bg/en/services-travel/consular-services/travel-bulgaria/visa-bulgaria'),
  { code: 'HRV', name: 'Croatia', adjective: 'Croatian', info: SCHENGEN_SOURCES.mvepVisas },
  state('CZE', 'Czechia', 'Czech', 'https://www.mzv.cz/jnp/en/information_for_aliens/index.html'),
  state('DNK', 'Denmark', 'Danish', 'https://nyidanmark.dk/da/Du-vil-ans%C3%B8ge/Kort-ophold-(Visum)'),
  state('EST', 'Estonia', 'Estonian', 'https://vm.ee/en/consular-visa-and-travel-information/visa-information/application-schengen-visa'),
  state('FIN', 'Finland', 'Finnish', 'https://um.fi/visa-to-visit-finland'),
  state('FRA', 'France', 'French', 'https://france-visas.gouv.fr/'),
  state('D', 'Germany', 'German', 'https://www.auswaertiges-amt.de/en/visa-service/visabestimmungen-node'),
  state('GRC', 'Greece', 'Greek', 'https://www.mfa.gr/en/visas/'),
  state('HUN', 'Hungary', 'Hungarian', 'https://konzinfo.mfa.gov.hu/en'),
  state('ISL', 'Iceland', 'Icelandic', 'https://www.government.is/topics/foreign-affairs/visa-to-iceland/'),
  state('ITA', 'Italy', 'Italian', 'https://vistoperitalia.esteri.it/'),
  state('LVA', 'Latvia', 'Latvian', 'https://www.mfa.gov.lv/en/consular-information/obtaining-visas'),
  state('LIE', 'Liechtenstein', 'Liechtenstein', 'https://www.llv.li/en/individuals/migration-and-integration/immigration/visa'),
  state('LTU', 'Lithuania', 'Lithuanian', 'https://www.migracija.lt/en/stay-less-than-3-months'),
  state('LUX', 'Luxembourg', 'Luxembourg', 'https://guichet.public.lu/en/citoyens/immigration.html'),
  state('MLT', 'Malta', 'Maltese', 'https://identita.gov.mt/central-visa-unit-sec-page-schengen-visa/'),
  state('NLD', 'the Netherlands', 'Dutch', 'https://www.netherlandsworldwide.nl/visa-the-netherlands'),
  state('NOR', 'Norway', 'Norwegian', 'https://www.udi.no/'),
  state('POL', 'Poland', 'Polish', 'https://www.msz.gov.pl/en/travel%20to%20poland/entering%20poland/'),
  state('PRT', 'Portugal', 'Portuguese', 'https://vistos.mne.gov.pt/'),
  state('ROU', 'Romania', 'Romanian', 'https://www.mae.ro/en/node/2035'),
  state('SVK', 'Slovakia', 'Slovak', 'https://www.mzv.sk/web/en'),
  state('SVN', 'Slovenia', 'Slovenian', 'https://www.gov.si/en/topics/entry-and-residence/'),
  state('ESP', 'Spain', 'Spanish', 'https://www.exteriores.gob.es/Consulados/londres/en/ServiciosConsulares/Paginas/Consular/Visados-Schengen.aspx'),
  state('SWE', 'Sweden', 'Swedish', 'https://www.swedenabroad.se/en/about-sweden-non-swedish-citizens/going-to-sweden/visiting-sweden/'),
  state('CHE', 'Switzerland', 'Swiss', 'https://www.swiss-visa.ch/'),
];

const STATE_BY_CODE = new Map(SCHENGEN_STATES.map((s) => [s.code, s]));

export function isSchengenDestination(code: string): boolean {
  return STATE_BY_CODE.has(code);
}

const VISA_CODE = src(
  'Regulation (EC) No 810/2009 (Visa Code), Article 15: travel medical insurance of at least €30,000',
  'https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32009R0810',
);

const MAIN_DESTINATION =
  'Visiting several Schengen countries? Apply to the country where you will spend the longest time; if the stays are equal, to the first one you enter.';

// ---- Country profiles (retrieved 2026-10-23) ----

const TODAY_SOURCES = '2026-10-23';

export const STATE_SOURCES = {
  sweden: src(
    'Swedish Migration Agency: Visiting Sweden for up to 90 days (entry visa) — SEK 700 a day, VFS Global, form 119031',
    'https://www.migrationsverket.se/en/you-want-to-apply/visiting-sweden/visiting-sweden-for-up-to-90-days-entry-visa.html',
    TODAY_SOURCES,
  ),
  swedenForm: src(
    'Swedish Migration Agency: Application for Schengen visa (form 119031, PDF), linked from the page above',
    'https://www.migrationsverket.se/en/you-want-to-apply/visiting-sweden/visiting-sweden-for-up-to-90-days-entry-visa.html',
    TODAY_SOURCES,
  ),
  franceVisas: src('France-Visas: the official visa website for France (online application and centre booking)', 'https://france-visas.gouv.fr/en/', TODAY_SOURCES),
  franceFunds: src(
    'France-Visas: Your arrival in France — €120 a day, €65 with a hotel booking, €32.50 with an attestation d’accueil (page blocks automated reading; check it yourself)',
    'https://france-visas.gouv.fr/en/your-arrival-in-france',
    TODAY_SOURCES,
  ),
  nlApply: src(
    'NetherlandsWorldwide: Apply for a Schengen visa (online form, then VFS Global appointment; example page for India)',
    'https://www.netherlandsworldwide.nl/visa-the-netherlands/schengen-visa/apply-india',
    TODAY_SOURCES,
  ),
  nlForm: src('Dutch Ministry of Foreign Affairs: online Schengen short-stay application form', 'https://consular.mfaservices.nl/schengen-visa/short-stay?lang=en', TODAY_SOURCES),
  nlFunds: src('IND: Short stay, holiday or business visa — at least €55 per person per day', 'https://ind.nl/en/short-stay/short-stay-holiday-or-business-visa', TODAY_SOURCES),
};

interface StateProfile {
  funds: NonNullable<Route['funds']>;
  fundsLabel: string;
  fundsDetail: string;
  fundsSource: Source;
  formLabel: string;
  formDetail: string;
  formSource: Source;
  applyUrl: string;
  applyLabel: string;
  bookingLabel: string;
  service: 'full' | 'paperwork';
  steps: string[];
  notes: string[];
  sources: Source[];
  passportDetail?: string;
  passportSource?: Source;
}

const PROFILES: Record<string, StateProfile> = {
  SWE: {
    funds: { perDay: 700, currency: 'SEK' },
    fundsLabel: 'Proof of funds: SEK 700 per person per day',
    fundsDetail: 'The Migration Agency says the amount can be lower for young children, prepaid meals and accommodation, or a stay with relatives or friends, and the person inviting you can cover it.',
    fundsSource: STATE_SOURCES.sweden,
    formLabel: 'Application for Schengen visa (form 119031), completed and signed',
    formDetail: 'Sweden takes the paper form in most countries: fill in the PDF from the Migration Agency, print and sign it. This app prepares every answer.',
    formSource: STATE_SOURCES.swedenForm,
    applyUrl: STATE_SOURCES.sweden.url,
    applyLabel: 'Swedish Migration Agency: how to apply',
    bookingLabel: 'In most countries you hand in the application at VFS Global, Sweden’s external service provider; in some, at the Swedish embassy or a Schengen country that represents Sweden.',
    service: 'full',
    passportDetail: 'Valid at least 3 months after the visa ends, issued in the last 10 years, with at least 2 blank pages.',
    passportSource: STATE_SOURCES.sweden,
    steps: [
      'Collect your documents. Upload each one and the app checks it against the requirement.',
      'Fill in form 119031 with the fill-along answers, print it and sign it.',
      'Book an appointment with VFS Global (or the Swedish embassy where you live) and hand in the application.',
      'Give fingerprints and pay the €90 fee when you submit.',
      'Track the decision. It normally takes 15 days.',
    ],
    notes: [
      'The border police decide at the border whether you may enter; a visa is not an advance decision.',
      'Fees are not refunded if the application is refused.',
    ],
    sources: [STATE_SOURCES.sweden],
  },
  FRA: {
    funds: { perDay: 120, currency: 'EUR', reduced: { perDay: 65, when: 'with a hotel booking (€32.50 with an attestation d’accueil from a host)' }, unquoted: true },
    fundsLabel: 'Proof of funds: €120 per person per day (€65 with a hotel booking)',
    fundsDetail: 'France-Visas lists €120 a day without a hotel booking, €65 a day with one, and €32.50 a day when a private host gives you an attestation d’accueil. The app could not read the page automatically; open it and check the figure.',
    fundsSource: STATE_SOURCES.franceFunds,
    formLabel: 'France-Visas online application, printed, dated and signed',
    formDetail: 'Fill in the application on france-visas.gouv.fr, print it with the registration receipt, then date and sign it. This app prepares every answer.',
    formSource: STATE_SOURCES.franceVisas,
    applyUrl: STATE_SOURCES.franceVisas.url,
    applyLabel: 'Apply on France-Visas',
    bookingLabel: 'France-Visas sends you to the centre for where you live: a French consulate or an external provider (TLScontact, VFS Global or Capago). Book from France-Visas, not from a third-party site.',
    service: 'paperwork',
    steps: [
      'Collect your documents. Upload each one and the app checks it against the requirement.',
      'Create an account on France-Visas and fill in the online application with the fill-along answers.',
      'Print the application and the registration receipt; date and sign the application.',
      'Book the appointment at the centre France-Visas assigns (consulate, TLScontact, VFS Global or Capago).',
      'Hand in the file, give fingerprints and pay the €90 visa fee plus any centre fee.',
      'Track the decision. It usually takes 15 days.',
    ],
    notes: ['Paperwork packet: the app prepares the answers, cover letter, itinerary and checklist; the booking is made by you on the official system.'],
    sources: [STATE_SOURCES.franceVisas, STATE_SOURCES.franceFunds],
  },
  NLD: {
    funds: { perDay: 55, currency: 'EUR' },
    fundsLabel: 'Proof of funds: €55 per person per day',
    fundsDetail: 'Or a guarantor in the Netherlands who meets the income requirement.',
    fundsSource: STATE_SOURCES.nlFunds,
    formLabel: 'Online Schengen application form, printed and signed',
    formDetail: 'Fill in the Dutch online form, note the code it gives you, then print and sign it. Each person fills in their own form. This app prepares every answer.',
    formSource: STATE_SOURCES.nlForm,
    applyUrl: STATE_SOURCES.nlForm.url,
    applyLabel: 'Open the Dutch online application form',
    bookingLabel: 'Book your appointment yourself with VFS Global (one appointment per person), as NetherlandsWorldwide asks; not through an intermediary.',
    service: 'paperwork',
    steps: [
      'Collect your documents with the NetherlandsWorldwide checklist for your country and purpose.',
      'Fill in the online form with the fill-along answers, print it and sign it.',
      'Book an appointment with VFS Global for each person.',
      'Attend with your documents and passport; give fingerprints and pay the visa and VFS fees.',
      'Track the decision. It usually takes 15 days.',
    ],
    notes: [
      'Paperwork packet: the app prepares the answers, cover letter, itinerary and checklist; the booking is made by you on the official system.',
      'NetherlandsWorldwide has a separate checklist per country of residence; the app links the India page as an example.',
    ],
    sources: [STATE_SOURCES.nlApply, STATE_SOURCES.nlForm, STATE_SOURCES.nlFunds],
  },
};

export function stateProfile(code: string): StateProfile | undefined {
  return PROFILES[code];
}

function schengenVisaRoute(s: SchengenState): Route {
  const S = SCHENGEN_SOURCES;
  const p = PROFILES[s.code];
  const prefix = s.code.toLowerCase();
  const checklist: ChecklistItem[] = [
    p
      ? { id: 'form', label: p.formLabel, detail: p.formDetail, required: true, source: p.formSource, helper: 'form', perTraveller: true }
      : { id: 'form', label: 'Visa application form, completed and signed', detail: `Some countries take the form online; check the ${s.adjective} visa site. This app prepares every answer.`, required: true, source: S.euApply, helper: 'form', perTraveller: true },
    { id: 'passport', label: 'Passport', detail: p?.passportDetail ?? 'Valid for at least 3 months after you leave the Schengen area.', required: true, source: p?.passportSource ?? S.euApply, helper: 'passport', perTraveller: true },
    { id: 'photo', label: 'Passport photo', detail: 'In line with ICAO standards.', required: true, source: S.euApply, helper: 'photo', perTraveller: true },
    { id: 'insurance', label: 'Travel medical insurance of at least €30,000', detail: 'Valid in the Schengen area for the whole stay. Covers emergency treatment, hospitalisation and repatriation.', required: true, source: VISA_CODE, helper: 'insurance', perTraveller: true },
    p
      ? { id: 'funds', label: p.fundsLabel, detail: p.fundsDetail, required: true, source: p.fundsSource, helper: 'funds', perTraveller: false }
      : { id: 'funds', label: 'Proof of funds for the whole stay', detail: `${s.name} sets its own daily amount; check the ${s.adjective} visa site for the figure.`, required: true, source: S.euApply, helper: 'funds', perTraveller: false },
    { id: 'accommodation', label: 'Proof of accommodation', required: true, source: S.euApply, helper: 'accommodation', perTraveller: false },
    { id: 'return_ticket', label: 'Proof you will return home, such as a return ticket reservation', required: true, source: S.euApply, helper: 'ticket', perTraveller: false },
    { id: 'itinerary', label: 'Documents showing the purpose of your trip, such as an itinerary', required: true, source: S.euApply, helper: 'itinerary', perTraveller: false },
    { id: 'cover_letter', label: 'Cover letter (optional)', detail: 'Not on the EU list. If you include one, it must only state facts you can back up.', required: false, source: S.euApply, helper: 'cover_letter', perTraveller: false },
  ];
  return {
    id: `${prefix}-schengen-c`,
    kind: 'visa',
    title: `Schengen short-stay visa (type C) for ${s.name}`,
    summary: `Your passport needs a Schengen visa. You apply to the ${s.adjective} embassy, consulate or its visa centre, hand in your documents in person and give fingerprints.`,
    fee: '€90 for ages 12 and over, €45 for children aged 6 to under 12, free under 6',
    extraCosts: ['Visa centre service fee if you apply through an external provider (charged separately)'],
    decisionTime: 'Usually 15 days; can be extended up to 45 days',
    maxStay: 'Up to 90 days in any 180-day period',
    applyWindow: 'No earlier than 6 months and at least 15 days before you travel.',
    applyEarliestMonthsBefore: 6,
    applyUrl: p?.applyUrl ?? s.info.url,
    applyLabel: p?.applyLabel ?? `${s.name}: official visa site`,
    appointment: 'required',
    bookingLabel: p?.bookingLabel ?? `Book at the ${s.adjective} embassy, consulate or its visa centre in your country.`,
    formId: 'schengen_c',
    funds: p?.funds,
    insurance: { minimum: 30000, currency: 'EUR', territory: 'the Schengen area' },
    service: p?.service ?? 'full',
    checklist,
    steps: p?.steps ?? [
      'Collect your documents. Upload each one and the app checks it against the requirement.',
      `Fill in the application form using the fill-along answers (online if the ${s.adjective} visa site offers it), then print and sign it.`,
      `Book an appointment at the ${s.adjective} embassy, consulate or visa centre where you live.`,
      'Go to the appointment with your documents; your fingerprints are taken there.',
      'Pay the €90 visa fee (plus any visa centre fee).',
      'Track the decision. It usually takes 15 days.',
    ],
    notes: [MAIN_DESTINATION, ...(p?.notes ?? []), 'A visa does not guarantee entry. Carry your documents when you travel.', 'Consulates may ask for more documents than this list.'],
    sources: [S.euApply, S.regulation, VISA_CODE, s.info, ...(p?.sources ?? [])],
    features: ['travellers', 'documents', 'form', 'itinerary', 'cover_letter', 'appointment', 'notifications', 'review'],
  };
}

function schengenVisaFreeRoute(s: SchengenState, note?: string): Route {
  const S = SCHENGEN_SOURCES;
  const p = PROFILES[s.code];
  return {
    id: `${s.code.toLowerCase()}-visa-free`,
    kind: 'visa_free',
    title: 'No visa needed for short stays',
    summary: `You can visit ${s.name} without a visa for short stays. At the border you register in the EU Entry/Exit System and may be asked to show your documents.`,
    maxStay: 'Up to 90 days in any 180-day period across the Schengen area',
    applyWindow: 'Nothing to apply for. ETIAS travel authorisation is not running yet; check travel-europe.europa.eu before you travel.',
    appointment: 'none',
    funds: p?.funds,
    checklist: [
      { id: 'passport', label: 'Passport valid for at least 3 months after you leave', required: true, source: S.euApply, helper: 'passport', perTraveller: true },
      { id: 'funds', label: 'Proof you can support yourself', detail: p ? `Border police may ask to see it. ${p.fundsLabel.replace('Proof of funds: ', '')}.` : `Border police may ask to see it. ${s.name} sets its own daily amount.`, required: false, source: p?.fundsSource ?? S.euApply, helper: 'funds', perTraveller: false },
      { id: 'accommodation', label: 'Proof of accommodation', required: false, source: S.euApply, helper: 'accommodation', perTraveller: false },
      { id: 'return_ticket', label: 'Return or onward ticket', required: false, source: S.euApply, helper: 'ticket', perTraveller: false },
    ],
    steps: ['Check your passport validity.', 'Keep your bookings and proof of funds with you when you travel.', 'Count your days: 90 in any 180 across all Schengen countries.'],
    notes: [note ?? 'Based on Annex II of Regulation (EU) 2018/1806.', 'Your passport is scanned and fingerprints may be taken at the border under the EU Entry/Exit System.'],
    sources: [S.regulation, S.euApply, s.info, ...(p ? [p.fundsSource] : [])],
    features: ['travellers', 'documents', 'itinerary', 'notifications', 'review'],
  };
}

function notCovered(s: SchengenState, title: string, summary: string): Route {
  return {
    id: `${s.code.toLowerCase()}-not-covered`,
    kind: 'not_covered',
    title,
    summary,
    checklist: [],
    steps: [],
    notes: [],
    sources: [s.info, SCHENGEN_SOURCES.regulation],
    applyUrl: s.info.url,
    applyLabel: `${s.name}: official visa site`,
    features: [],
  };
}

const VISIT_PURPOSES = new Set(['tourism', 'business', 'family', 'transit']);

function resolveState(s: SchengenState, input: TripInput): Route {
  if (!VISIT_PURPOSES.has(input.purpose)) {
    return notCovered(s, 'Long stays, work and study are not covered', `This app covers short stays (tourism, business, family visits, transit) for ${s.name}. Check the ${s.adjective} visa site for work, study and long-stay permits.`);
  }
  const months = monthsBetween(input.departDate, input.returnDate);
  if (months !== undefined && months * 30.4375 > 90) {
    return notCovered(s, 'Stays longer than 90 days', 'Short-stay rules allow up to 90 days in any 180-day period. Longer stays need a national long-stay visa or permit, which this app does not cover.');
  }
  const need = schengenVisaNeed(input);
  if (need === 'free_movement') {
    return {
      id: `${s.code.toLowerCase()}-free-movement`,
      kind: 'none',
      title: 'Free movement: no visa needed',
      summary: `EU, EEA and Swiss citizens can travel to ${s.name} with a passport or national ID card.`,
      checklist: [],
      steps: [],
      notes: [],
      sources: [SCHENGEN_SOURCES.regulation],
      features: [],
    };
  }
  if (need === 'visa') return schengenVisaRoute(s);
  if (need === 'visa_free') {
    const agreement = schengenBucket(input.nationality) === 'annex_ii_agreement';
    return schengenVisaFreeRoute(
      s,
      agreement ? `Your exemption depends on an EU visa waiver agreement with your country being in force. It is listed as visa-free, but confirm with the ${s.adjective} embassy before you travel.` : undefined,
    );
  }
  if (input.passportType === 'other' || input.nationality === 'XXA') {
    return notCovered(s, `Check with the ${s.adjective} embassy`, `Rules for stateless travellers, refugees and other travel documents depend on the document. This app does not guess; ask the ${s.adjective} embassy.`);
  }
  if (needsBiometricQuestion(input.nationality)) {
    return notCovered(s, 'Is your passport biometric?', 'Your exemption depends on having a biometric passport (with a chip). Answer the passport question to see your route.');
  }
  return notCovered(s, 'We could not confirm your visa status', `Your country is not clearly covered by the sources this app uses. Check the ${s.adjective} visa site for your nationality.`);
}

/** Rules for every Schengen state. Croatia keeps its own sourced route (funds amount, CROVISA). */
export const SCHENGEN_RULES: DestinationRules[] = SCHENGEN_STATES.map((s) =>
  s.code === 'HRV' ? croatiaRules : { code: s.code, name: s.name, checkerUrl: s.info.url, resolve: (input: TripInput) => resolveState(s, input) },
);
