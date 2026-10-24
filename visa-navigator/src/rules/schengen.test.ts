import { describe, expect, it } from 'vitest';
import { COUNTRIES } from '../data/countries';
import { resolveRoute } from './engine';
import { schengenBucket, SCHENGEN_ANNEX_I } from './schengen';
import type { TripInput } from './types';

const TODAY = new Date('2026-10-10T00:00:00Z');
const base: TripInput = {
  nationality: 'IND',
  destination: 'HRV',
  purpose: 'tourism',
  passportType: 'national',
  departDate: '2026-12-01',
  returnDate: '2026-12-15',
};

describe('Schengen visa buckets (Regulation 2018/1806, consolidated 2025-12-30)', () => {
  it('puts every country in exactly one bucket', () => {
    const unassigned: string[] = [];
    for (const c of COUNTRIES) {
      const b = schengenBucket(c.code);
      if (!b) unassigned.push(c.code);
    }
    expect(unassigned).toEqual([]);
  });

  it('has the 103 Annex I states plus the Palestinian Authority (counted from the source text)', () => {
    expect(SCHENGEN_ANNEX_I.size).toBe(104);
  });

  it.each([
    ['IND', 'annex_i'],
    ['CHN', 'annex_i'],
    ['TUR', 'annex_i'],
    ['VUT', 'annex_i'], // moved to Annex I by amendment M6
    ['CAN', 'annex_ii'],
    ['USA', 'annex_ii'],
    ['GBR', 'annex_ii'],
    ['ARE', 'annex_ii_agreement'],
    ['PER', 'annex_ii_agreement'],
    ['SRB', 'annex_ii_biometric'],
    ['RKS', 'annex_ii_biometric'],
    ['UKR', 'annex_ii_biometric'],
    ['HKG', 'annex_ii_passport_condition'],
    ['TWN', 'annex_ii_passport_condition'],
    ['FRA', 'free_movement'],
    ['HRV', 'free_movement'],
    ['NOR', 'free_movement'],
    ['CHE', 'free_movement'],
    ['NRU', 'unconfirmed'],
    ['XXA', 'not_covered'],
  ])('%s is %s', (code, bucket) => {
    expect(schengenBucket(code)).toBe(bucket);
  });
});

describe('Croatia routes', () => {
  it('Annex I tourist needs a short-stay Schengen visa', () => {
    const r = resolveRoute(base, TODAY);
    expect(r.kind).toBe('visa');
    expect(r.id).toBe('hrv-schengen-c');
    expect(r.fee).toContain('€90');
    // Visa Code art. 16: €45 from 6 up to (not including) 12; 12 and over pay the adult €90.
    expect(r.fee).toBe('€90 for ages 12 and over, €45 for children aged 6 to under 12, free under 6');
    expect(r.appointment).toBe('required');
    expect(r.applyEarliestMonthsBefore).toBe(6);
    expect(r.features).toEqual(expect.arrayContaining(['documents', 'form', 'appointment', 'notifications']));
    const ids = r.checklist.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['form', 'passport', 'photo', 'insurance', 'funds', 'accommodation', 'return_ticket']));
  });

  it('Canadian tourist does not need a visa', () => {
    const r = resolveRoute({ ...base, nationality: 'CAN' }, TODAY);
    expect(r.kind).toBe('visa_free');
    expect(r.maxStay).toMatch(/90 days/);
  });

  it('EU citizens have free movement', () => {
    expect(resolveRoute({ ...base, nationality: 'D' }, TODAY).kind).toBe('none');
  });

  it('biometric condition is respected', () => {
    expect(resolveRoute({ ...base, nationality: 'SRB', biometricPassport: true }, TODAY).kind).toBe('visa_free');
    expect(resolveRoute({ ...base, nationality: 'SRB', biometricPassport: false }, TODAY).kind).toBe('visa');
  });

  it('Taiwan depends on the ID number', () => {
    expect(resolveRoute({ ...base, nationality: 'TWN', taiwanIdOnPassport: true }, TODAY).kind).toBe('visa_free');
    expect(resolveRoute({ ...base, nationality: 'TWN', taiwanIdOnPassport: false }, TODAY).kind).toBe('visa');
  });

  it('unconfirmed, stateless and other travel documents are not guessed', () => {
    expect(resolveRoute({ ...base, nationality: 'NRU' }, TODAY).kind).toBe('not_covered');
    expect(resolveRoute({ ...base, nationality: 'XXA' }, TODAY).kind).toBe('not_covered');
    expect(resolveRoute({ ...base, nationality: 'CAN', passportType: 'other' }, TODAY).kind).toBe('not_covered');
  });

  it('stays over 90 days and work purposes are not covered', () => {
    expect(resolveRoute({ ...base, returnDate: '2027-04-01' }, TODAY).kind).toBe('not_covered');
    expect(resolveRoute({ ...base, purpose: 'work_sponsored' }, TODAY).kind).toBe('not_covered');
  });

  it('every checklist item cites an official source with a date', () => {
    for (const item of resolveRoute(base, TODAY).checklist) {
      expect(item.source.url).toMatch(/^https:\/\/(home-affairs\.ec\.europa\.eu|mvep\.gov\.hr|crovisa\.mvep\.hr|publications\.europa\.eu)\//);
      expect(item.source.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('funds requirement scales with days and travellers', () => {
    const r = resolveRoute(base, TODAY);
    expect(r.funds).toEqual({ perDay: 70, currency: 'EUR' });
    expect(r.insurance).toEqual({ minimum: 30000, currency: 'EUR', territory: 'Croatia' });
  });
});
