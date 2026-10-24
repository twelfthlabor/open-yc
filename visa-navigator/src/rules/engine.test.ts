import { describe, expect, it } from 'vitest';
import { resolveRoute } from './engine';
import type { TripInput } from './types';
import { UK_VISA_NATIONALS } from './uk';

const TODAY = new Date('2026-10-09T00:00:00Z');
const base: TripInput = {
  nationality: 'CAN',
  destination: 'GBR',
  purpose: 'tourism',
  passportType: 'national',
  departDate: '2026-12-01',
  returnDate: '2026-12-15',
  birthDate: '1998-05-20',
};

describe('UK rules', () => {
  it('has all 115 visa-national entries', () => {
    expect(UK_VISA_NATIONALS.size).toBe(115);
  });

  it('Canadian tourist needs an ETA', () => {
    const r = resolveRoute(base, TODAY);
    expect(r.kind).toBe('eta');
    expect(r.fee).toContain('£20');
    expect(r.features).not.toContain('cover_letter');
    expect(r.formId).toBe('uk_eta');
  });

  it('visa-national tourist needs a Standard Visitor visa', () => {
    const r = resolveRoute({ ...base, nationality: 'IND' }, TODAY);
    expect(r.kind).toBe('visa');
    expect(r.id).toBe('uk-standard-visitor');
    expect(r.fee).toContain('£135');
    expect(r.features).toEqual(expect.arrayContaining(['form', 'itinerary', 'cover_letter', 'appointment']));
  });

  it('non-national travel document needs a visa even for a Canadian', () => {
    expect(resolveRoute({ ...base, passportType: 'other' }, TODAY).kind).toBe('visa');
  });

  it('stateless travellers need a visa', () => {
    expect(resolveRoute({ ...base, nationality: 'XXA' }, TODAY).kind).toBe('visa');
  });

  it('Taiwan passport depends on the ID number exemption', () => {
    expect(resolveRoute({ ...base, nationality: 'TWN', taiwanIdOnPassport: true }, TODAY).kind).toBe('eta');
    expect(resolveRoute({ ...base, nationality: 'TWN', taiwanIdOnPassport: false }, TODAY).kind).toBe('visa');
  });

  it('Hong Kong SAR passport uses the ETA route', () => {
    expect(resolveRoute({ ...base, nationality: 'HKG' }, TODAY).kind).toBe('eta');
  });

  it('British and Irish citizens need nothing', () => {
    expect(resolveRoute({ ...base, nationality: 'GBR' }, TODAY).kind).toBe('none');
    expect(resolveRoute({ ...base, nationality: 'IRL' }, TODAY).kind).toBe('none');
  });

  it('visits over 6 months are not covered', () => {
    expect(resolveRoute({ ...base, returnDate: '2027-08-01' }, TODAY).kind).toBe('not_covered');
  });

  describe('Youth Mobility Scheme', () => {
    const yms: TripInput = { ...base, purpose: 'youth_mobility' };

    it('Canadian aged 28 is eligible', () => {
      const r = resolveRoute(yms, TODAY);
      expect(r.kind).toBe('visa');
      expect(r.id).toBe('uk-yms');
      expect(r.maxStay).toMatch(/extend/);
    });

    it('Canadian aged 36 is not eligible', () => {
      expect(resolveRoute({ ...yms, birthDate: '1990-01-01' }, TODAY).kind).toBe('not_eligible');
    });

    it('Japanese aged 32 is not eligible (18 to 30)', () => {
      expect(resolveRoute({ ...yms, nationality: 'JPN', birthDate: '1994-01-01' }, TODAY).kind).toBe('not_eligible');
    });

    it('dependent children make you ineligible', () => {
      expect(resolveRoute({ ...yms, hasDependentChildren: true }, TODAY).kind).toBe('not_eligible');
    });

    it('nationalities not on the list are not eligible', () => {
      expect(resolveRoute({ ...yms, nationality: 'USA' }, TODAY).kind).toBe('not_eligible');
    });

    it('Taiwan requires the ballot email', () => {
      const r = resolveRoute({ ...yms, nationality: 'TWN', birthDate: '2000-01-01' }, TODAY);
      expect(r.checklist.map((c) => c.id)).toContain('ballot');
    });
  });

  it('sponsored work routes to Skilled Worker', () => {
    const r = resolveRoute({ ...base, purpose: 'work_sponsored' }, TODAY);
    expect(r.id).toBe('uk-skilled-worker');
    expect(r.checklist.map((c) => c.id)).toContain('cos');
  });

  it('every checklist item has an official gov.uk source and date', () => {
    for (const nat of ['CAN', 'IND']) {
      for (const purpose of ['tourism', 'youth_mobility', 'work_sponsored'] as const) {
        const r = resolveRoute({ ...base, nationality: nat, purpose }, TODAY);
        for (const item of r.checklist) {
          expect(item.source.url).toMatch(/^https:\/\/www\.gov\.uk\//);
          expect(item.source.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    }
  });
});

describe('unsupported destinations', () => {
  it('returns a not-covered route without invented requirements', () => {
    const r = resolveRoute({ ...base, destination: 'JPN' }, TODAY);
    expect(r.kind).toBe('not_covered');
    expect(r.checklist).toEqual([]);
    expect(r.title).toContain('Japan');
  });
});
