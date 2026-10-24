import { describe, expect, it } from 'vitest';
import { parseMrz } from './mrz';

// Seeded generator: the same seed always produces the same inputs, so a failure can be replayed.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = [...'ABCXYZ0123456789<<<  \t\n-.é€✈日本​'];
function randomLine(next: () => number): string {
  const len = Math.floor(next() * 60);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(next() * ALPHABET.length)];
  return out;
}

const TODAY = new Date('2026-10-10T00:00:00Z');

describe('MRZ parser under hostile input', () => {
  it('never throws for 3000 seeded pairs of lines', () => {
    const next = seeded(20261010);
    for (let i = 0; i < 3000; i++) {
      const a = randomLine(next);
      const b = randomLine(next);
      expect(() => parseMrz(a, b, TODAY), `pair ${i}`).not.toThrow();
    }
  });

  it.each([
    ['empty lines', '', ''],
    ['only fillers', '<'.repeat(44), '<'.repeat(44)],
    ['a bare prefix', 'P<', '9'],
    ['very long lines', ' '.repeat(500), 'x'.repeat(5000)],
  ])('never throws for %s', (_, a, b) => {
    expect(() => parseMrz(a, b, TODAY)).not.toThrow();
  });
});
