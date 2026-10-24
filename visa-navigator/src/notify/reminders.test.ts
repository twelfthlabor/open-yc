import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../rules/engine';
import { newTrip } from '../store/model';
import { buildReminders } from './reminders';

const NOW = new Date('2026-05-01T12:00:00');
const trip = () => newTrip({ nationality: 'IND', destination: 'HRV', purpose: 'tourism', passportType: 'national', departDate: '2026-12-01', returnDate: '2026-12-10' });

describe('reminders', () => {
  it('reminds when the application window opens and before departure', () => {
    const t = trip();
    const r = buildReminders(t, resolveRoute(t.input), NOW);
    const kinds = r.map((x) => x.kind);
    expect(kinds).toContain('apply_window');
    expect(kinds).toContain('departure');
    const apply = r.find((x) => x.kind === 'apply_window')!;
    expect(new Date(apply.at).getMonth()).toBe(5); // June: 6 months before 1 December
  });

  it('reminds a day and two hours before the appointment', () => {
    const t = trip();
    t.tracker.appointmentAt = '2026-09-15T10:30';
    t.tracker.appointmentPlace = 'VFS Mumbai';
    const r = buildReminders(t, resolveRoute(t.input), NOW).filter((x) => x.kind === 'appointment');
    expect(r).toHaveLength(2);
    expect(r[0].body).toContain('VFS Mumbai');
  });

  it('schedules availability checks only until an appointment is booked', () => {
    const t = trip();
    t.tracker.watch = { enabled: true, bookingUrl: 'https://example.org', everyHours: 6, log: [] };
    expect(buildReminders(t, resolveRoute(t.input), NOW).filter((x) => x.kind === 'availability')).toHaveLength(12);
    t.tracker.appointmentAt = '2026-09-15T10:30';
    expect(buildReminders(t, resolveRoute(t.input), NOW).filter((x) => x.kind === 'availability')).toHaveLength(0);
  });

  it('reminds to check for a decision 15 days after submitting (Croatia)', () => {
    const t = trip();
    t.tracker.status = 'submitted';
    t.tracker.submittedOn = '2026-09-20';
    const d = buildReminders(t, resolveRoute(t.input), NOW).find((x) => x.kind === 'decision')!;
    expect(d.at.slice(0, 10) >= '2026-10-04').toBe(true);
  });

  it('never includes passport numbers in reminder text', () => {
    const t = trip();
    t.travellers[0].answers.passport_number = 'L898902C3';
    t.tracker.appointmentAt = '2026-09-15T10:30';
    for (const r of buildReminders(t, resolveRoute(t.input), NOW)) expect(`${r.title} ${r.body}`).not.toContain('L898902C3');
  });

  it('drops reminders that are already in the past', () => {
    const t = trip();
    expect(buildReminders(t, resolveRoute(t.input), new Date('2026-12-05T00:00:00'))).toEqual([]);
  });
});
