import { describe, expect, it } from 'vitest';
import { COUNTRIES } from './countries';
import { countryScore } from './countrySearch';

const rank = (q: string) =>
  COUNTRIES.map((c) => ({ name: c.name, s: countryScore(c.code, q) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name))
    .map((r) => r.name);

describe('countryScore', () => {
  it('only matches words that start with what was typed', () => {
    expect(rank('India')).toEqual(['India']);
    expect(rank('ind')).toEqual(['India', 'Indonesia']);
  });
  it('puts names that start with the query ahead of later words', () => {
    const r = rank('ko');
    expect(r.slice(0, 2)).toEqual(['Korea (North)', 'Korea (South)']);
    expect(rank('guinea')[0]).toBe('Guinea');
    expect(rank('guinea')).toContain('Papua New Guinea');
  });
  it('ignores accents and case, and knows common other names and codes', () => {
    expect(rank('cote')[0]).toBe("Côte d'Ivoire");
    expect(rank('ivory coast')[0]).toBe("Côte d'Ivoire");
    expect(rank('USA')[0]).toBe('United States');
    expect(rank('uk')[0]).toBe('United Kingdom');
    expect(rank('türkiye')[0]).toBe('Turkey');
    expect(rank('south korea')[0]).toBe('Korea (South)');
    expect(rank('deu')[0]).toBe('Germany');
  });
  it('matches every word of a multi-word query', () => {
    expect(rank('united k')).toEqual(['United Kingdom']);
    expect(rank('')).toHaveLength(COUNTRIES.length);
  });
});
