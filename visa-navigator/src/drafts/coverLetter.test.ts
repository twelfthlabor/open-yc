import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../rules/engine';
import { newTrip, type Trip } from '../store/model';
import { assembleLetter, coverLetterFacts, factsPreview, fillTokens, unsupportedNumbers } from './coverLetter';

const TODAY = new Date('2026-10-23T12:00:00Z');
const trip = (): Trip => {
  const t = newTrip({ nationality: 'EGY', destination: 'SWE', purpose: 'tourism', passportType: 'national', departDate: '2026-12-01', returnDate: '2026-12-05' }, ['Anna', 'Ben']);
  t.travellers[0].passport = {
    surname: 'HASSAN',
    givenNames: 'ANNA',
    documentNumber: 'A12345678',
    nationality: 'EGY',
    issuingState: 'EGY',
    birthDate: '1990-01-01',
    sex: 'F',
    expiryDate: '2031-01-01',
    mrzValid: true,
    confirmedAt: '',
  };
  t.travellers[0].answers = { occupation: 'Engineer', employer: 'Acme Ltd\nCairo', address: '1 Nile St, Cairo', email: 'anna@example.com', cost_covered_by: 'The applicant' };
  t.stops = [{ id: 's', date: '2026-12-01', city: 'Stockholm', lodging: 'Hotel A', plans: '' }];
  return t;
};
const route = (t: Trip) => resolveRoute(t.input, TODAY);

describe('cover letter facts', () => {
  it('builds facts from the trip and answers only', () => {
    const t = trip();
    const cf = coverLetterFacts(t, route(t));
    expect(cf.facts).toMatchObject({ Applicant: 'Anna Hassan', 'Travelling with': 'Ben', Destination: 'Sweden', 'Arrival date': '1 December 2026', 'Departure date': '5 December 2026', 'Length of stay': '5 days', 'Cities on the itinerary': 'Stockholm', Accommodation: 'Hotel A', Occupation: 'Engineer', 'Employer or school': 'Acme Ltd', 'Trip paid for by': 'the applicant' });
    expect(cf.missing).toEqual([]);
  });

  it('never sends the passport number, address or email: they travel as tokens and are filled in locally', () => {
    const t = trip();
    const cf = coverLetterFacts(t, route(t));
    const sent = JSON.stringify(cf.facts) + factsPreview(cf);
    for (const secret of ['A12345678', '1 Nile St', 'anna@example.com']) expect(sent).not.toContain(secret);
    expect(cf.facts['Passport number']).toBe('{{PASSPORT_NUMBER}}');
    const letter = assembleLetter('To the visa officer,\nMy passport number is {{PASSPORT_NUMBER}}.', cf, TODAY);
    expect(letter).toContain('A12345678');
    expect(letter).toContain('1 Nile St, Cairo');
    expect(letter).toContain('23 October 2026');
    expect(letter.trim().endsWith('Anna Hassan')).toBe(true);
    expect(letter).not.toMatch(/\{\{/);
  });

  it('lists what is missing so the letter keeps placeholders', () => {
    const t = trip();
    t.travellers[0].answers = {};
    t.stops = [];
    const cf = coverLetterFacts(t, route(t));
    expect(cf.missing).toEqual(expect.arrayContaining(['your occupation', 'who is paying for the trip', 'the cities you will visit', 'where you will stay']));
    expect(assembleLetter('Body', cf, TODAY)).toContain('[add your home address]');
  });

  it('spots numbers the model added that are not in the facts', () => {
    const facts = { 'Arrival date': '1 December 2026', 'Length of stay': '5 days' };
    expect(unsupportedNumbers('I arrive on 1 December 2026 and stay 5 days.', facts)).toEqual([]);
    expect(unsupportedNumbers('I arrive on 01 December 2026.', facts)).toEqual([]);
    expect(unsupportedNumbers('I have €5,000 in savings and stay 90 days.', facts)).toEqual(['000', '90']);
  });

  it('fills every token', () => {
    expect(fillTokens('{{A}} and {{A}}', { '{{A}}': 'x' })).toBe('x and x');
  });
});
