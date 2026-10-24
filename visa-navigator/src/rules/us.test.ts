import { describe, expect, it } from 'vitest';
import { newTrip, type PassportRecord } from '../store/model';
import { checkPassport } from '../verify/checks';
import { resolveRoute } from './engine';
import type { TripInput } from './types';

const TODAY = new Date('2026-10-11T00:00:00Z');
const trip = (over: Partial<TripInput> = {}): TripInput => ({
  nationality: 'IND',
  destination: 'USA',
  purpose: 'tourism',
  passportType: 'national',
  departDate: '2026-12-01',
  returnDate: '2026-12-10',
  ...over,
});
const route = (over: Partial<TripInput> = {}, today = TODAY) => resolveRoute(trip(over), today);

describe('United States: visitor routes', () => {
  it('Indian visitors need a B-1/B-2 visa with the $185 fee and an interview', () => {
    const r = route();
    expect(r.id).toBe('us-b');
    expect(r.kind).toBe('visa');
    expect(r.fee).toContain('$185');
    expect(r.appointment).toBe('required');
    expect(r.applyUrl).toContain('ceac.state.gov');
    expect(r.checklist.map((c) => c.id)).toEqual(expect.arrayContaining(['passport', 'ds160', 'fee_receipt', 'interview', 'funds']));
  });

  it('prepares DS-160 answers for the visa, but no form for the ESTA', () => {
    const visa = route();
    expect(visa.formId).toBe('us_b');
    expect(visa.features).toContain('form');
    expect(visa.checklist.find((c) => c.id === 'ds160')?.helper).toBe('form');
    expect(route({ nationality: 'GBR' }).formId).toBeUndefined();
  });

  it('Visa Waiver countries need an ESTA, priced by the date', () => {
    for (const nationality of ['GBR', 'D', 'JPN', 'AUS', 'HRV', 'QAT']) expect(route({ nationality }).id).toBe('us-esta');
    expect(route({ nationality: 'GBR' }).fee).toContain('$40.27');
    expect(route({ nationality: 'GBR' }, new Date('2026-10-20T00:00:00Z')).fee).toContain('$40.62');
    expect(route({ nationality: 'GBR' }).checklist.map((c) => c.id)).toContain('return_ticket');
  });

  it('asks ESTA travellers to confirm the Visa Waiver conditions instead of assuming them', () => {
    const r = route({ nationality: 'GBR' });
    expect(r.summary).toMatch(/if you meet/i);
    const item = r.checklist.find((c) => c.id === 'vwp_eligibility');
    expect(item?.required).toBe(true);
    expect(item?.source.url).toContain('cbp.gov');
    for (const word of ['Iran', 'North Korea', 'Cuba', '1 March 2011', '12 January 2021', 'electronic']) expect(item?.detail).toContain(word);
    expect(r.checklist.find((c) => c.id === 'passport')?.detail).toMatch(/electronic/i);
  });

  it('Taiwan qualifies for ESTA only with the ID number in the passport', () => {
    expect(route({ nationality: 'TWN', taiwanIdOnPassport: true }).id).toBe('us-esta');
    expect(route({ nationality: 'TWN', taiwanIdOnPassport: false }).id).toBe('us-b');
  });

  it('stays over 90 days, or a non-national travel document, need a visa even from a Visa Waiver country', () => {
    expect(route({ nationality: 'GBR', returnDate: '2027-03-15' }).id).toBe('us-b');
    expect(route({ nationality: 'GBR', passportType: 'other' }).id).toBe('us-b');
  });

  it('Canadian and Bermudian citizens visit without a visa or ESTA', () => {
    for (const nationality of ['CAN', 'BMU']) {
      const r = route({ nationality });
      expect(r.kind).toBe('visa_free');
      expect(r.fee).toBeUndefined();
    }
  });

  it('US citizens need nothing', () => {
    expect(route({ nationality: 'USA' }).kind).toBe('none');
  });

  it('keeps the proclamation restrictions for suspended nationalities', () => {
    expect(route({ nationality: 'IRN' }).kind).toBe('restricted');
    expect(route({ nationality: 'NGA' }).kind).toBe('restricted');
  });

  it('does not cover study, work or long stays on a visa', () => {
    expect(route({ purpose: 'study' }).kind).toBe('not_covered');
    expect(route({ purpose: 'work_sponsored' }).kind).toBe('not_covered');
  });

  it('shows the temporary $750 expedite fee only while it applies', () => {
    expect(route().extraCosts?.join(' ')).toContain('$750');
    expect(route({}, new Date('2027-01-05T00:00:00Z')).extraCosts?.join(' ') ?? '').not.toContain('$750');
  });

  it('cites a dated source for every checklist item', () => {
    for (const r of [route(), route({ nationality: 'GBR' }), route({ nationality: 'CAN' })]) {
      expect(r.sources.length).toBeGreaterThan(0);
      for (const c of r.checklist) {
        expect(c.source.url).toMatch(/^https:\/\//);
        expect(c.source.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe('United States: passport validity', () => {
  const passport = (expiryDate: string): PassportRecord => ({
    surname: 'SHARMA',
    givenNames: 'ANNA',
    documentNumber: 'Z1234567',
    nationality: 'IND',
    issuingState: 'IND',
    birthDate: '1990-01-15',
    sex: 'F',
    expiryDate,
    mrzValid: true,
    confirmedAt: '2026-10-10T00:00:00.000Z',
  });
  const t = newTrip(trip());

  it('asks for six months beyond the stay, as a check because some countries are exempt', () => {
    const r = route();
    const short = checkPassport(passport('2027-02-01'), t, r, TODAY).find((c) => c.id === 'validity');
    expect(short?.status).toBe('warn');
    expect(short?.label).toContain('6 months');
    expect(checkPassport(passport('2027-07-01'), t, r, TODAY).find((c) => c.id === 'validity')?.status).toBe('pass');
  });

  it('fails a passport that expires before the trip ends', () => {
    expect(checkPassport(passport('2026-12-05'), t, route(), TODAY).find((c) => c.id === 'validity')?.status).toBe('fail');
  });
});
