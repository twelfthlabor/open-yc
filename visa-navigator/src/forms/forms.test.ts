import { describe, expect, it } from 'vitest';
import { newTraveller, newTrip, type PassportRecord } from '../store/model';
import { allFields, fieldValue, FORMS, formProgress, isDerived } from './forms';

const passport: PassportRecord = {
  surname: 'ERIKSSON',
  givenNames: 'ANNA MARIA',
  documentNumber: 'L898902C3',
  nationality: 'IND',
  issuingState: 'IND',
  birthDate: '1974-08-12',
  sex: 'F',
  expiryDate: '2030-04-15',
  mrzValid: true,
  confirmedAt: '2026-10-10T00:00:00.000Z',
};

const trip = () => {
  const t = newTrip({ nationality: 'IND', destination: 'HRV', purpose: 'tourism', passportType: 'national', departDate: '2026-12-01', returnDate: '2026-12-15' }, [
    'Anna',
    'Ben',
  ]);
  t.travellers[0].passport = passport;
  return t;
};

const field = (id: string) => allFields(FORMS.schengen_c).find((f) => f.id === id)!;

describe('Schengen fill-along form', () => {
  it('covers every numbered field 1 to 32 of the harmonised form', () => {
    const numbers = new Set(allFields(FORMS.schengen_c).map((f) => Number(f.number)));
    for (let n = 1; n <= 32; n++) expect(numbers.has(n), `field ${n}`).toBe(true);
  });

  it('fills fields from the passport and trip', () => {
    const t = trip();
    const anna = t.travellers[0];
    expect(fieldValue(t, anna, field('surname'))).toBe('ERIKSSON');
    expect(fieldValue(t, anna, field('sex'))).toBe('Female');
    expect(fieldValue(t, anna, field('nationality'))).toBe('India');
    expect(fieldValue(t, anna, field('main_destination'))).toBe('Croatia');
    expect(fieldValue(t, anna, field('arrival_date'))).toBe('2026-12-01');
    expect(fieldValue(t, anna, field('travel_doc_type'))).toBe('Ordinary passport');
    expect(isDerived(t, anna, field('surname'))).toBe(true);
  });

  it('a typed answer wins over a derived one', () => {
    const t = trip();
    t.travellers[0].answers.place_of_birth = 'Mumbai';
    expect(fieldValue(t, t.travellers[0], field('place_of_birth'))).toBe('Mumbai');
  });

  it('shared answers are entered once on the lead traveller', () => {
    const t = trip();
    t.travellers[0].answers.host_name = 'Hotel Adriatic';
    expect(fieldValue(t, t.travellers[1], field('host_name'))).toBe('Hotel Adriatic');
    // Personal answers are not shared.
    t.travellers[0].answers.occupation = 'Engineer';
    expect(fieldValue(t, t.travellers[1], field('occupation'))).toBe('');
  });

  it('counts only required fields in progress', () => {
    const t = trip();
    const p0 = formProgress(t, newTraveller('x'), FORMS.schengen_c);
    const p1 = formProgress(t, t.travellers[0], FORMS.schengen_c);
    expect(p1.total).toBe(p0.total);
    expect(p1.done).toBeGreaterThan(p0.done);
  });

  it('UK sheets are not presented as official field lists', () => {
    expect(FORMS.uk_visitor.official).toBe(false);
    expect(FORMS.schengen_c.official).toBe(true);
  });
});
