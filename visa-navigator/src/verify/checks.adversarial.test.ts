import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../rules/engine';
import { newTrip, type Trip } from '../store/model';
import { checkFunds, type FundsFields } from './checks';

const TODAY = new Date('2026-10-10T00:00:00Z');
const trip = (): Trip => newTrip({ nationality: 'IND', destination: 'HRV', purpose: 'tourism', passportType: 'national', departDate: '2026-12-01', returnDate: '2026-12-10' }, ['Anna']);
const funds = (closing_balance: number | null): FundsFields => ({ holder_name: 'ANNA', bank_name: 'Bank', currency: 'EUR', closing_balance, statement_end_date: '2026-10-01' });
const balanceStatus = (value: number | null): string | undefined => {
  const t = trip();
  return checkFunds(funds(value), t, resolveRoute(t.input, TODAY), TODAY).find((c) => c.id === 'balance')?.status;
};

describe('balance check given values that are not real amounts', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('reports "could not read" for %s, never a pass or a fail', (_, value) => {
    expect(balanceStatus(value)).toBe('warn');
  });

  it('still passes a real balance that covers the requirement', () => {
    expect(balanceStatus(1500)).toBe('pass');
  });

  it('still fails a real balance that does not cover the requirement', () => {
    expect(balanceStatus(100)).toBe('fail');
  });
});
