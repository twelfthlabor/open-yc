import { describe, expect, it } from 'vitest';
import { hasForbiddenPhrase } from './templates';

// Each text says the application is decided, written so that a plain match misses it.
const evasions: [string, string][] = [
  ['zero-width space inside a word', 'Your visa is guar​anteed.'],
  ['soft hyphen inside a word', 'We guar­antee a decision.'],
  ['Cyrillic letter in an English phrase', 'Your visa will be аpproved.'],
  ['full-width letters', 'We ｇｕａｒａｎｔｅｅ a decision.'],
  ['extra spaces and a line break', 'You  are\neligible for entry.'],
  ['hyphens between the words', 'you-are-eligible for the visa'],
  ['letters spaced out', 'We g u a r a n t e e a decision.'],
  ['Cyrillic letter in a phrase', 'Certainly to be grаnted.'],
];

const ordinary = [
  'Please bring your passport, bank statement and insurance.',
  'The application will be reviewed by the embassy.',
  'Bring copies of your bookings.',
];

describe('forbidden phrases resist simple evasion', () => {
  it.each(evasions)('catches %s', (_, text) => {
    expect(hasForbiddenPhrase(text)).toBe(true);
  });
});

describe('ordinary text is not flagged', () => {
  it.each(ordinary)('%s', (text) => {
    expect(hasForbiddenPhrase(text)).toBe(false);
  });
});
