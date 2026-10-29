import { COUNTRIES } from './countries';

// Other names people type for a country. The list shows the name in countries.ts.
const ALIASES: Record<string, string[]> = {
  USA: ['US', 'America', 'United States of America'],
  GBR: ['UK', 'Britain', 'Great Britain', 'England', 'Scotland', 'Wales'],
  CIV: ['Ivory Coast'],
  TUR: ['Türkiye', 'Turkiye'],
  KOR: ['South Korea'],
  PRK: ['North Korea'],
  CZE: ['Czech Republic'],
  NLD: ['Holland'],
  SWZ: ['Swaziland'],
  CPV: ['Cabo Verde'],
  MMR: ['Burma'],
  TLS: ['East Timor'],
  COD: ['DRC', 'Congo-Kinshasa'],
  COG: ['Congo-Brazzaville'],
  ARE: ['UAE'],
  VAT: ['Holy See'],
  MKD: ['Macedonia'],
  D: ['DEU', 'Deutschland'], // passports use D, not DEU
};

const NAMES = new Map(COUNTRIES.map((c) => [c.code, c.name]));

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function textScore(text: string, q: string, qWords: string[]): number {
  const t = norm(text);
  if (t === q) return 1;
  if (t.startsWith(q)) return 0.9;
  const words = t.split(' ');
  return qWords.every((w) => words.some((x) => x.startsWith(w))) ? 0.7 : 0;
}

/**
 * How well a country (by ISO alpha-3 code) matches a search, from 0 (hide) to 1.
 * Word-prefix matching, so "india" finds India but not Trinidad or Saint Kitts,
 * as a subsequence matcher would. Accents and case are ignored.
 */
export function countryScore(code: string, search: string): number {
  const q = norm(search);
  if (!q) return 1;
  const c = code.toUpperCase();
  const name = NAMES.get(c);
  if (!name) return 0;
  if (q === c.toLowerCase()) return 0.95;
  const qWords = q.split(' ');
  const alias = Math.max(0, ...(ALIASES[c] ?? []).map((a) => textScore(a, q, qWords) * 0.95));
  return Math.max(textScore(name, q, qWords), alias);
}
