import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../rules/engine';
import { newTrip, type PassportRecord, type Trip } from '../store/model';
import { checkPassport, nameMatches, overall, runChecks, stayDays, type FundsFields, type InsuranceFields, type TicketFields } from './checks';

const TODAY = new Date('2026-10-10T00:00:00Z');

function croatiaTrip(travellers = 1): Trip {
  const t = newTrip(
    { nationality: 'IND', destination: 'HRV', purpose: 'tourism', passportType: 'national', departDate: '2026-12-01', returnDate: '2026-12-10' },
    Array.from({ length: travellers }, (_, i) => `Traveller ${i + 1}`),
  );
  t.travellers[0].passport = passport();
  return t;
}

const passport = (over: Partial<PassportRecord> = {}): PassportRecord => ({
  surname: 'ŠARIĆ',
  givenNames: 'ANA',
  documentNumber: 'X1234567',
  nationality: 'IND',
  issuingState: 'IND',
  birthDate: '1990-01-01',
  sex: 'F',
  issueDate: '2020-01-01',
  expiryDate: '2030-01-01',
  mrzValid: true,
  confirmedAt: '2026-10-10T00:00:00.000Z',
  ...over,
});

const route = (trip: Trip) => resolveRoute(trip.input, TODAY);
const ctx = (trip: Trip) => ({ trip, route: route(trip), traveller: trip.travellers[0], today: TODAY });
const byId = (checks: { id: string; status: string }[], id: string) => checks.find((c) => c.id === id)?.status;

describe('names', () => {
  it('matches ignoring accents and case', () => {
    const t = croatiaTrip();
    expect(nameMatches('Ana Saric', t.travellers[0])).toBe(true);
    expect(nameMatches('MS ANA ŠARIĆ', t.travellers[0])).toBe(true);
    expect(nameMatches('Ana Saricka', t.travellers[0])).toBe(false);
  });
});

describe('funds (Croatia: €70 per person per day)', () => {
  const statement = (balance: number | null, currency = 'EUR', end = '2026-10-01'): FundsFields => ({
    holder_name: 'ANA SARIC',
    bank_name: 'Bank',
    currency,
    closing_balance: balance,
    statement_end_date: end,
  });

  it('counts both ends of the stay', () => {
    expect(stayDays(croatiaTrip())).toBe(10);
  });

  it('passes with enough money for one traveller (10 days × €70 = €700)', () => {
    const checks = runChecks('funds', statement(700), ctx(croatiaTrip()));
    expect(byId(checks, 'balance')).toBe('pass');
    expect(overall(checks)).toBe('pass');
  });

  it('scales with the number of travellers', () => {
    const checks = runChecks('funds', statement(1000), ctx(croatiaTrip(2)));
    expect(byId(checks, 'balance')).toBe('fail'); // needs €1,400
  });

  it('warns instead of guessing an exchange rate', () => {
    expect(byId(runChecks('funds', statement(90000, 'INR'), ctx(croatiaTrip())), 'balance')).toBe('warn');
  });

  it('warns on an old statement or unreadable balance', () => {
    expect(byId(runChecks('funds', statement(5000, 'EUR', '2026-06-01'), ctx(croatiaTrip())), 'recent')).toBe('warn');
    expect(byId(runChecks('funds', statement(null), ctx(croatiaTrip())), 'balance')).toBe('warn');
  });
});

describe('insurance (Croatia: €30,000, whole stay)', () => {
  const policy = (over: Partial<InsuranceFields> = {}): InsuranceFields => ({
    insured_names: ['Ana Saric'],
    coverage_amount: 30000,
    currency: 'EUR',
    start_date: '2026-12-01',
    end_date: '2026-12-10',
    territory: 'Schengen States',
    covers_emergency: true,
    covers_repatriation: true,
    ...over,
  });

  it('passes a compliant policy', () => {
    expect(overall(runChecks('insurance', policy(), ctx(croatiaTrip())))).toBe('pass');
  });

  it('fails too little cover, wrong dates, or wrong territory', () => {
    expect(byId(runChecks('insurance', policy({ coverage_amount: 25000 }), ctx(croatiaTrip())), 'amount')).toBe('fail');
    expect(byId(runChecks('insurance', policy({ end_date: '2026-12-09' }), ctx(croatiaTrip())), 'dates')).toBe('fail');
    expect(byId(runChecks('insurance', policy({ territory: 'Asia only' }), ctx(croatiaTrip())), 'territory')).toBe('fail');
  });

  it('warns when repatriation is not stated', () => {
    expect(byId(runChecks('insurance', policy({ covers_repatriation: null }), ctx(croatiaTrip())), 'repatriation')).toBe('warn');
  });
});

describe('tickets', () => {
  const ticket = (over: Partial<TicketFields> = {}): TicketFields => ({
    passenger_names: ['SARIC/ANA MS'],
    outbound_date: '2026-12-01',
    return_date: '2026-12-10',
    from: 'BOM',
    to: 'ZAG',
    ...over,
  });

  it('passes matching dates and names', () => {
    expect(overall(runChecks('ticket', ticket(), ctx(croatiaTrip())))).toBe('pass');
  });

  it('fails a one-way ticket', () => {
    expect(byId(runChecks('ticket', ticket({ return_date: '' }), ctx(croatiaTrip())), 'return')).toBe('fail');
  });
});

describe('passport (no AI needed)', () => {
  it('needs 3 months beyond departure for Schengen', () => {
    const t = croatiaTrip();
    expect(byId(checkPassport(passport({ expiryDate: '2027-03-09' }), t, route(t), TODAY), 'validity')).toBe('fail');
    expect(byId(checkPassport(passport({ expiryDate: '2027-03-10' }), t, route(t), TODAY), 'validity')).toBe('pass');
  });

  it('must be issued within 10 years for Schengen', () => {
    const t = croatiaTrip();
    expect(byId(checkPassport(passport({ issueDate: '2015-01-01' }), t, route(t), TODAY), 'issued')).toBe('fail');
  });

  it('UK only needs validity for the whole stay', () => {
    const t = croatiaTrip();
    t.input = { ...t.input, destination: 'GBR' };
    const checks = checkPassport(passport({ expiryDate: '2026-12-10', issueDate: '2010-01-01' }), t, route(t), TODAY);
    expect(byId(checks, 'validity')).toBe('pass');
    expect(byId(checks, 'issued')).toBeUndefined();
  });
});
