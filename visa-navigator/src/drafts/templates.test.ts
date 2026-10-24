import { describe, expect, it } from 'vitest';
import { newTrip } from '../store/model';
import { buildCoverLetter, buildItinerary, hasForbiddenPhrase } from './templates';

const TODAY = new Date(2026, 9, 10);
const trip = (labels = ['Traveller 1']) =>
  newTrip({ nationality: 'IND', destination: 'GBR', purpose: 'tourism', passportType: 'national', departDate: '2026-12-01', returnDate: '2026-12-15' }, labels);

describe('draft templates', () => {
  it('marks missing facts instead of inventing them', () => {
    const letter = buildCoverLetter(trip(), 'uk_visitor', TODAY);
    expect(letter).toContain('[add your home address]');
    expect(letter).toContain('[add passport number]');
    expect(letter).toContain('[add who is paying for the trip]');
  });

  it('uses facts the user entered', () => {
    const t = trip();
    t.travellers[0].answers = {
      given_names: 'Anna',
      surname: 'Eriksson',
      passport_number: 'L898902C3',
      cost_covered_by: 'The applicant',
      occupation: 'Engineer',
      employer: 'Acme\n1 Road',
      address: '1 Main St, Mumbai',
      email: 'anna@example.com',
      host_address: 'Hotel A, London',
    };
    t.travellers[0].label = 'Anna Eriksson';
    const letter = buildCoverLetter(t, 'uk_visitor', TODAY);
    expect(letter).toContain('Anna Eriksson');
    expect(letter).toContain('visit the United Kingdom');
    expect(letter).toContain('L898902C3');
    expect(letter).toContain('I work as Engineer at Acme.');
    expect(letter).toContain('10 October 2026');
    expect(letter).not.toContain('[add');
    expect(hasForbiddenPhrase(letter)).toBe(false);
  });

  it('mentions the other travellers in a group application', () => {
    const letter = buildCoverLetter(trip(['Anna', 'Ben', 'Cara']), 'uk_visitor', TODAY);
    expect(letter).toContain('travelling with Ben and Cara');
    expect(buildItinerary(trip(['Anna', 'Ben']))).toContain('Travel itinerary for Anna and Ben');
  });

  it('itinerary lists stops in date order', () => {
    const t = trip();
    t.stops = [
      { id: '2', date: '2026-12-05', city: 'Edinburgh', lodging: 'Hotel B', plans: '' },
      { id: '1', date: '2026-12-01', city: 'London', lodging: 'Hotel A', plans: 'Museums.' },
    ];
    const text = buildItinerary(t);
    expect(text.indexOf('London')).toBeLessThan(text.indexOf('Edinburgh'));
    expect(hasForbiddenPhrase(text)).toBe(false);
  });

  it('detects forbidden phrases', () => {
    expect(hasForbiddenPhrase('Your visa will be approved.')).toBe(true);
    expect(hasForbiddenPhrase('We guarantee a decision.')).toBe(true);
  });
});
