import { describe, expect, it } from 'vitest';
import { newTrip, type Trip } from '../store/model';
import { buildDayByDayItinerary, dayPlan, itineraryIssues, tripDates } from './itinerary';

const base = (): Trip => {
  const t = newTrip({ nationality: 'EGY', destination: 'SWE', purpose: 'tourism', passportType: 'national', departDate: '2026-12-01', returnDate: '2026-12-05' }, ['Anna']);
  t.stops = [
    { id: 's1', date: '2026-12-01', city: 'Stockholm', lodging: 'Hotel A', plans: '' },
    { id: 's2', date: '2026-12-03', city: 'Uppsala', lodging: 'Hotel B', plans: 'Cathedral' },
  ];
  t.flights = [
    { id: 'f1', date: '2026-12-01', from: 'CAI', to: 'ARN', flightNo: 'XX1' },
    { id: 'f2', date: '2026-12-05', from: 'ARN', to: 'CAI', flightNo: 'XX2' },
  ];
  return t;
};

describe('day-by-day itinerary', () => {
  it('has one row per day, arrival and departure included', () => {
    expect(tripDates(base())).toEqual(['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']);
    expect(dayPlan(base())).toHaveLength(5);
  });

  it('carries city and lodging forward, and places flights on their dates', () => {
    const rows = dayPlan(base());
    expect(rows[1]).toMatchObject({ city: 'Stockholm', lodging: 'Hotel A', entered: false });
    expect(rows[2]).toMatchObject({ city: 'Uppsala', lodging: 'Hotel B', plans: 'Cathedral', entered: true });
    expect(rows[0].flights.map((f) => f.flightNo)).toEqual(['XX1']);
    expect(rows[4].lodging).toBe(''); // departure day: no night
  });

  it('a consistent trip has no issues', () => {
    expect(itineraryIssues(base())).toEqual([]);
  });

  it('flags days outside the trip, missing nights and flights on the wrong days', () => {
    const t = base();
    t.stops = [{ id: 's0', date: '2026-12-02', city: 'Stockholm', lodging: 'Hotel A', plans: '' }, { id: 'x', date: '2026-12-09', city: 'Malmö', lodging: 'H', plans: '' }];
    t.flights = [{ id: 'f', date: '2026-12-20', from: 'A', to: 'B', flightNo: '' }];
    const ids = itineraryIssues(t).map((i) => i.id);
    expect(ids).toContain('stop-out-x');
    expect(ids).toContain('flight-out-f');
    expect(ids).toContain('outbound');
    expect(ids).toContain('return');
    expect(ids).toContain('lodging'); // the first night has no stay
    expect(itineraryIssues(t).find((i) => i.id === 'lodging')?.level).toBe('fail');
  });

  it('compares the nights with the dates read off the accommodation booking', () => {
    const t = base();
    t.sharedDocuments.accommodation = {
      id: 'd',
      fileName: 'b.pdf',
      mediaType: 'application/pdf',
      size: 1,
      uploadedAt: '',
      verification: { verifiedAt: '', method: 'manual', extracted: { check_in: '2026-12-01', check_out: '2026-12-03' }, checks: [], overall: 'pass' },
    };
    const gap = itineraryIssues(t).find((i) => i.id === 'booking-gap');
    expect(gap?.text).toMatch(/2 nights/);
  });

  it('reports missing or reversed dates instead of building a plan', () => {
    const t = base();
    t.input.returnDate = '2026-11-01';
    expect(dayPlan(t)).toEqual([]);
    expect(itineraryIssues(t)[0].id).toBe('dates');
    expect(buildDayByDayItinerary(t)).toContain('[add your arrival and departure dates]');
  });

  it('the document lists every day and keeps placeholders for gaps, never invented places', () => {
    const t = base();
    const text = buildDayByDayItinerary(t);
    expect(text).toContain('Day 1 (Tuesday, 1 December 2026): Stockholm');
    expect(text).toContain('Day 5 (Saturday, 5 December 2026): Uppsala');
    expect(text).toContain('Flight XX1 from CAI to ARN');
    expect(text).toContain('Overnight: Hotel B');
    expect(text).toContain('5 days, 4 nights');
    t.stops = [];
    const empty = buildDayByDayItinerary(t);
    expect(empty).toContain('[add city]');
    expect(empty).toContain('[add accommodation]');
  });
});
