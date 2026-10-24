import { describe, expect, it } from 'vitest';
import { COUNTRIES } from '@/data/countries';
import { flagFile, flagLoader, NO_FLAG_CODES } from './flags';

describe('flag lookup', () => {
  it('resolves every country code to a flag file, or to an explicit no-flag entry', () => {
    const unresolved = COUNTRIES.filter((c) => !flagLoader(c.code) && !NO_FLAG_CODES.includes(c.code)).map((c) => c.code);
    expect(unresolved).toEqual([]);
  });

  it('only lists codes that exist and have no flag', () => {
    const codes = new Set(COUNTRIES.map((c) => c.code));
    for (const code of NO_FLAG_CODES) {
      expect(codes.has(code)).toBe(true);
      expect(flagLoader(code)).toBeUndefined();
    }
  });

  it('maps Kosovo (RKS) to the XK flag, which the ISO table does not cover', () => {
    expect(flagFile('RKS')).toBe('/node_modules/country-flag-icons/3x2/XK.svg');
    expect(flagLoader('RKS')).toBeDefined();
  });

  it('maps MRZ alpha-3 codes to alpha-2 flag files', () => {
    expect(flagFile('HRV')).toBe('/node_modules/country-flag-icons/3x2/HR.svg');
    expect(flagFile('GBR')).toBe('/node_modules/country-flag-icons/3x2/GB.svg');
    expect(flagFile('IND')).toBe('/node_modules/country-flag-icons/3x2/IN.svg');
  });

  it('returns nothing for an unknown code instead of a broken path', () => {
    expect(flagFile('ZZZ')).toBeUndefined();
    expect(flagLoader('ZZZ')).toBeUndefined();
  });
});
