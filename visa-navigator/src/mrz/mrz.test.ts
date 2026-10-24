import { describe, expect, it } from 'vitest';
import { checkDigit, parseMrz } from './mrz';

// ICAO Doc 9303 Part 4 specimen passport (Utopia, ERIKSSON ANNA MARIA).
const L1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const L2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';
const TODAY = new Date('2026-10-09T00:00:00Z');

describe('MRZ', () => {
  it('computes ICAO check digits', () => {
    expect(checkDigit('L898902C3')).toBe(6);
    expect(checkDigit('740812')).toBe(2);
    expect(checkDigit('120415')).toBe(9);
  });

  it('parses and validates the ICAO specimen', () => {
    const r = parseMrz(L1, L2, TODAY);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.surname).toBe('ERIKSSON');
    expect(r.givenNames).toBe('ANNA MARIA');
    expect(r.documentNumber).toBe('L898902C3');
    expect(r.nationality).toBe('UTO');
    expect(r.birthDate).toBe('1974-08-12');
    expect(r.expiryDate).toBe('2012-04-15');
    expect(r.sex).toBe('F');
    expect(r.personalNumber).toBe('ZE184226B');
  });

  it('flags a single mistyped character', () => {
    const typo = L2.replace('L898902C3', 'L898902C8');
    const r = parseMrz(L1, typo, TODAY);
    expect(r.valid).toBe(false);
    expect(r.checks.documentNumber).toBe(false);
  });

  it('tolerates spaces and lowercase from pasting', () => {
    const r = parseMrz(L1.toLowerCase(), L2.slice(0, 20) + ' ' + L2.slice(20), TODAY);
    expect(r.valid).toBe(true);
  });

  it('rejects wrong-length lines', () => {
    const r = parseMrz(L1.slice(0, 40), L2, TODAY);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/44/);
  });
});
