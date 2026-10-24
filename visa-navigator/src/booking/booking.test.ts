import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../rules/engine';
import type { TripInput } from '../rules/types';
import { newTrip } from '../store/model';
import { bookingGuide, bookingSheet, refKey, refLooksRight } from './booking';

const TODAY = new Date('2026-10-23T00:00:00Z');
const input = (p: Partial<TripInput>): TripInput => ({ nationality: 'EGY', destination: 'SWE', purpose: 'tourism', passportType: 'national', departDate: '2026-12-01', returnDate: '2026-12-10', ...p });
const setup = (p: Partial<TripInput>, residence?: string) => {
  const t = newTrip(input(p), ['Anna', 'Ben']);
  if (residence) t.tracker.booking = { residence, done: {}, refs: {} };
  const r = resolveRoute(t.input, TODAY);
  return { t, r, g: bookingGuide(r, t) };
};

describe('booking assistant', () => {
  it('opens VFS Global for Sweden and the Netherlands, for the country where the applicant lives', () => {
    expect(setup({}).g?.url).toBe('https://visa.vfsglobal.com/egy/en/swe');
    expect(setup({}, 'ARE').g?.url).toBe('https://visa.vfsglobal.com/are/en/swe');
    expect(setup({ destination: 'NLD' }).g?.url).toBe('https://visa.vfsglobal.com/egy/en/nld');
  });

  it('France goes through France-Visas; the UK through gov.uk; the US through the embassy booking system', () => {
    expect(setup({ destination: 'FRA' }).g?.url).toContain('france-visas.gouv.fr');
    expect(setup({ destination: 'GBR' }).g?.url).toBe('https://www.gov.uk/find-a-visa-application-centre');
    const us = setup({ destination: 'USA' }).g!;
    expect(us.steps.map((s) => s.id)).toEqual(['ds160', 'account', 'fee', 'booked', 'letter']);
    expect(us.sources.map((s) => s.url).join(' ')).toContain('ecfr.gov');
  });

  it('only links official hosts', () => {
    for (const destination of ['SWE', 'NLD', 'FRA', 'GBR', 'USA', 'ITA']) {
      const url = setup({ destination }).g?.url;
      if (url) expect(new URL(url).hostname, destination).toMatch(/(vfsglobal\.com|france-visas\.gouv\.fr|gov\.uk|usvisa-info\.com)$/);
    }
  });

  it('says plainly that the user books, signs in and pays', () => {
    expect(setup({}).g?.limits).toMatch(/You sign in, solve any security check, choose the slot and pay/);
  });

  it('has no booking step for routes without an appointment', () => {
    expect(setup({ nationality: 'USA' }).g).toBeUndefined(); // visa-free in Sweden
    expect(setup({ nationality: 'GBR', destination: 'USA' }).g).toBeUndefined(); // ESTA
  });

  it('checks the shape of portal references it knows', () => {
    const us = setup({ destination: 'USA' }).g!;
    const ds = us.steps.find((s) => s.id === 'ds160')!;
    expect(refLooksRight(ds, 'AA00ABCDEF')).toBe(true);
    expect(refLooksRight(ds, '12345')).toBe(false);
    expect(refLooksRight(ds, '')).toBe(true);
    const gwf = setup({ destination: 'GBR' }).g!.steps.find((s) => s.id === 'form_done')!;
    expect(refLooksRight(gwf, 'GWF012345678')).toBe(true);
  });

  it('the copy sheet uses only what the user entered, per traveller', () => {
    const { t, r, g } = setup({ destination: 'USA' });
    t.tracker.booking = { done: {}, refs: { [refKey('ds160_barcode', t.travellers[0].id)]: 'AA00ABCDEF' }, preferredDates: 'early November' };
    const sheet = bookingSheet(r, t, t.tracker.booking, g!);
    expect(sheet).toHaveLength(2);
    const anna = Object.fromEntries(sheet[0].rows.map((x) => [x.label, x.value]));
    expect(anna['DS-160 confirmation number']).toBe('AA00ABCDEF');
    expect(anna['Passport number']).toBe(''); // not read yet: left empty, never guessed
    expect(anna['Preferred dates']).toBe('early November');
    const ben = Object.fromEntries(sheet[1].rows.map((x) => [x.label, x.value]));
    expect(ben['DS-160 confirmation number']).toBe('');
  });
});
