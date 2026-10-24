import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../rules/engine';
import { newTrip, type PassportRecord } from '../store/model';
import { consentText, DECLARATIONS, SCHENGEN_DECLARATION } from './declarations';
import { missingForReview, openQuestions } from './ready';

const passport: PassportRecord = {
  surname: 'SHARMA',
  givenNames: 'ANNA',
  documentNumber: 'Z1234567',
  nationality: 'IND',
  issuingState: 'IND',
  birthDate: '1990-01-15',
  sex: 'F',
  expiryDate: '2031-01-01',
  issueDate: '2021-01-02',
  mrzValid: true,
  confirmedAt: '2026-10-14T00:00:00Z',
};

describe('declarations', () => {
  it('quotes the Schengen declaration word for word from the saved official form', () => {
    const source = readFileSync(path.join(import.meta.dirname, '../../docs/sources/schengen-form.txt'), 'utf8').replace(/\s+/g, ' ');
    // The source has a placeholder sentence for the responsible authority, which is left out here.
    for (const sentence of SCHENGEN_DECLARATION.split(/(?<=\.) /)) expect(source).toContain(sentence);
  });

  it('every form has an authorisation, and the stored text includes the official declaration when there is one', () => {
    for (const [id, d] of Object.entries(DECLARATIONS)) expect(d.authorisation.length, id).toBeGreaterThan(100);
    expect(consentText('schengen_c')).toContain('I declare that to the best of my knowledge');
    expect(consentText('uk_visitor')).not.toContain('Member States');
  });
});

describe('readiness', () => {
  const input = { nationality: 'IND', destination: 'HRV', purpose: 'tourism' as const, passportType: 'national' as const, departDate: '2026-12-01', returnDate: '2026-12-15' };

  it('asks only for answers that the passport and trip do not give', () => {
    const trip = newTrip(input);
    trip.travellers[0].passport = passport;
    const route = resolveRoute(input, new Date('2026-10-14'));
    const ids = openQuestions(trip, trip.travellers[0], route).map((f) => f.id);
    expect(ids).toContain('address');
    expect(ids).not.toContain('surname');
    expect(ids).not.toContain('birth_date');
    expect(ids).not.toContain('surname_at_birth');
  });

  it('lists a missing passport and missing answers, and nothing once complete', () => {
    const trip = newTrip(input);
    const route = resolveRoute(input, new Date('2026-10-14'));
    expect(missingForReview(trip, route)).toContain('Traveller 1: passport');
    trip.travellers[0].passport = passport;
    for (const f of openQuestions(trip, trip.travellers[0], route)) trip.travellers[0].answers[f.id] = f.options?.[1] ?? 'x';
    expect(missingForReview(trip, route)).toEqual([]);
  });
});
