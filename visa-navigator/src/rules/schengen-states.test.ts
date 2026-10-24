import { describe, expect, it } from 'vitest';
import { buildReminders } from '../notify/reminders';
import { newTrip } from '../store/model';
import { checkFunds } from '../verify/checks';
import { isSupportedDestination, resolveRoute } from './engine';
import { isSchengenDestination, SCHENGEN_STATES } from './schengen-states';
import type { TripInput } from './types';

const TODAY = new Date('2026-10-23T00:00:00Z');
const trip = (p: Partial<TripInput>): TripInput => ({
  nationality: 'EGY',
  destination: 'SWE',
  purpose: 'tourism',
  passportType: 'national',
  departDate: '2026-12-01',
  returnDate: '2026-12-10',
  ...p,
});

describe('Schengen states', () => {
  it('lists the 29 states the European Commission links', () => {
    const codes = SCHENGEN_STATES.map((s) => s.code);
    expect(codes).toHaveLength(29);
    for (const c of ['BGR', 'ROU', 'CHE', 'NOR', 'ISL', 'LIE', 'HRV', 'D', 'FRA', 'NLD', 'SWE']) expect(codes).toContain(c);
    for (const c of ['CYP', 'IRL', 'GBR']) expect(isSchengenDestination(c)).toBe(false);
  });

  it('every state is a supported destination with an official https source', () => {
    for (const s of SCHENGEN_STATES) {
      expect(isSupportedDestination(s.code), s.code).toBe(true);
      expect(s.info.url, s.code).toMatch(/^https:\/\//);
    }
  });

  it('a state without its own profile gets no invented funds amount', () => {
    const r = resolveRoute(trip({ destination: 'ITA' }), TODAY);
    expect(r.kind).toBe('visa');
    expect(r.funds).toBeUndefined();
    expect(r.insurance).toEqual({ minimum: 30000, currency: 'EUR', territory: 'the Schengen area' });
  });

  it('Annex II nationals are visa-free, EU citizens have free movement, biometric passports are asked about', () => {
    expect(resolveRoute(trip({ nationality: 'USA' }), TODAY).kind).toBe('visa_free');
    expect(resolveRoute(trip({ nationality: 'D', destination: 'NLD' }), TODAY).kind).toBe('none');
    expect(resolveRoute(trip({ nationality: 'SRB', destination: 'FRA' }), TODAY).kind).toBe('not_covered');
    expect(resolveRoute(trip({ nationality: 'SRB', destination: 'FRA', biometricPassport: true }), TODAY).kind).toBe('visa_free');
  });

  it('long stays and study are not covered for any state', () => {
    expect(resolveRoute(trip({ purpose: 'study' }), TODAY).kind).toBe('not_covered');
    expect(resolveRoute(trip({ returnDate: '2027-06-01' }), TODAY).kind).toBe('not_covered');
  });

  it('decision reminders work for the new states', () => {
    const t = newTrip(trip({}), ['A']);
    t.tracker.submittedOn = '2026-10-20';
    expect(buildReminders(t, resolveRoute(t.input, TODAY), TODAY).some((x) => x.kind === 'decision')).toBe(true);
  });

  it('Croatia keeps its sourced specifics', () => {
    const r = resolveRoute(trip({ destination: 'HRV' }), TODAY);
    expect(r.id).toBe('hrv-schengen-c');
    expect(r.funds).toEqual({ perDay: 70, currency: 'EUR' });
  });
});

describe('Sweden (full service)', () => {
  const r = resolveRoute(trip({}), TODAY);
  it('is a type C visa through VFS Global with the paper form 119031', () => {
    expect(r.id).toBe('swe-schengen-c');
    expect(r.service).toBe('full');
    expect(r.formId).toBe('schengen_c');
    expect(r.bookingLabel).toMatch(/VFS Global/);
    expect(r.checklist.find((c) => c.id === 'form')?.label).toContain('119031');
    expect(r.applyUrl).toContain('migrationsverket.se');
  });
  it('asks for SEK 700 a day, sourced to the Migration Agency', () => {
    expect(r.funds).toEqual({ perDay: 700, currency: 'SEK' });
    const funds = r.checklist.find((c) => c.id === 'funds')!;
    expect(funds.label).toContain('SEK 700');
    expect(funds.source.url).toContain('migrationsverket.se');
    expect(funds.source.retrievedOn).toBe('2026-10-23');
  });
  it('checks a statement against SEK 700 × days × travellers', () => {
    const t = newTrip(trip({}), ['A', 'B']);
    const statement = { holder_name: 'A', bank_name: 'X', currency: 'SEK', closing_balance: 14_000, statement_end_date: '2026-10-20' };
    // 10 days × 2 travellers × 700 = 14,000
    expect(checkFunds(statement, t, r, TODAY).find((c) => c.id === 'balance')?.status).toBe('pass');
    expect(checkFunds({ ...statement, closing_balance: 13_999 }, t, r, TODAY).find((c) => c.id === 'balance')?.status).toBe('fail');
  });
});

describe('France and the Netherlands (paperwork packet)', () => {
  it('France sends the form to France-Visas and books at the centre it assigns', () => {
    const r = resolveRoute(trip({ destination: 'FRA' }), TODAY);
    expect(r.service).toBe('paperwork');
    expect(r.applyUrl).toContain('france-visas.gouv.fr');
    expect(r.bookingLabel).toMatch(/TLScontact/);
    expect(r.notes.join(' ')).toMatch(/Paperwork packet/);
  });

  it('France: a balance between the €65 and €120 daily figures is flagged, not failed, and the figure is marked unquoted', () => {
    const r = resolveRoute(trip({ destination: 'FRA' }), TODAY);
    expect(r.funds?.unquoted).toBe(true);
    const t = newTrip(trip({ destination: 'FRA' }), ['A']);
    const st = { holder_name: 'A', bank_name: 'X', currency: 'EUR', closing_balance: 700, statement_end_date: '2026-10-20' };
    expect(checkFunds(st, t, r, TODAY).find((c) => c.id === 'balance')?.status).toBe('warn'); // ≥ €650, < €1,200
    expect(checkFunds({ ...st, closing_balance: 1200 }, t, r, TODAY).find((c) => c.id === 'balance')?.status).toBe('pass');
    expect(checkFunds({ ...st, closing_balance: 100 }, t, r, TODAY).find((c) => c.id === 'balance')?.status).toBe('warn');
  });

  it('the Netherlands: online form, VFS Global, €55 a day from the IND', () => {
    const r = resolveRoute(trip({ destination: 'NLD' }), TODAY);
    expect(r.service).toBe('paperwork');
    expect(r.applyUrl).toContain('consular.mfaservices.nl');
    expect(r.funds).toEqual({ perDay: 55, currency: 'EUR' });
    expect(r.checklist.find((c) => c.id === 'funds')?.source.url).toContain('ind.nl');
    expect(r.notes.join(' ')).toMatch(/longest/);
  });

  it('every checklist item of the three profiled states cites a dated https source', () => {
    for (const destination of ['SWE', 'FRA', 'NLD']) {
      const r = resolveRoute(trip({ destination }), TODAY);
      for (const c of r.checklist) {
        expect(c.source.url, `${destination} ${c.id}`).toMatch(/^https:\/\//);
        expect(c.source.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe('Schengen visa fee', () => {
  it('charges children the €45 rate from 6 to under 12 only, in every state', () => {
    for (const code of ['SWE', 'FRA', 'NLD', 'D', 'ITA']) {
      const r = resolveRoute(trip({ destination: code }), TODAY);
      expect(r.fee, code).toBe('€90 for ages 12 and over, €45 for children aged 6 to under 12, free under 6');
    }
  });
});
