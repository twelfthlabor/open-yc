import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { newTrip } from '../../src/store/model';
import { ServiceStore } from './store';

let now = Date.parse('2026-10-14T12:00:00Z');
let file: string;
let store: ServiceStore;

beforeEach(() => {
  now = Date.parse('2026-10-14T12:00:00Z');
  file = path.join(mkdtempSync(path.join(tmpdir(), 'vn-svc-')), 'service.db');
  store = new ServiceStore(file, randomBytes(32), () => now);
});

const trip = () => newTrip({ nationality: 'IND', destination: 'HRV', purpose: 'tourism', passportType: 'national', departDate: '2026-12-01', returnDate: '2026-12-15' });

describe('sign-in links and sessions', () => {
  it('a link works once and expires after 15 minutes', () => {
    const t = store.createLink('A@Example.com ');
    expect(store.useLink(t)).toBe('a@example.com');
    expect(store.useLink(t)).toBeNull();
    const late = store.createLink('b@example.com');
    now += 16 * 60_000;
    expect(store.useLink(late)).toBeNull();
    expect(store.useLink('made-up')).toBeNull();
  });

  it('sessions resolve to the user or the operator, and end on sign-out or expiry', () => {
    const user = store.ensureUser('a@example.com');
    expect(store.ensureUser('a@example.com').id).toBe(user.id);
    const s = store.createSession(user.id, 'customer');
    expect(store.session(s)).toEqual({ userId: user.id, role: 'customer', email: 'a@example.com' });
    store.deleteSession(s);
    expect(store.session(s)).toBeNull();
    const op = store.createSession(null, 'operator');
    expect(store.session(op)?.role).toBe('operator');
    now += 31 * 24 * 3600_000;
    expect(store.session(op)).toBeNull();
  });
});

describe('applications', () => {
  it('stores the trip encrypted, never as readable text', () => {
    const user = store.ensureUser('a@example.com');
    const t = trip();
    t.travellers[0].answers.address = '12 MG Road, Mumbai';
    const id = store.createApplication(user.id, t);
    expect(store.getApplication(id)?.trip.travellers[0].answers.address).toBe('12 MG Road, Mumbai');
    const raw = new DatabaseSync(file).prepare('select * from applications').all();
    expect(JSON.stringify(raw)).not.toContain('MG Road');
  });

  it('moves through statuses, lists by owner and status, and keeps a history', () => {
    const a = store.ensureUser('a@example.com');
    const b = store.ensureUser('b@example.com');
    const id = store.createApplication(a.id, trip());
    store.createApplication(b.id, trip());
    expect(store.listByUser(a.id).map((x) => x.id)).toEqual([id]);
    store.update(id, { status: 'in_review', consent: { formId: 'schengen_c', text: 'I declare', agreedAt: 'x' }, preferences: { dates: ['2026-11-02'], place: 'Mumbai' } }, 'customer', 'Sent for review');
    expect(store.listByStatus('in_review').map((x) => x.id)).toEqual([id]);
    expect(store.getApplication(id)?.preferences?.place).toBe('Mumbai');
    expect(store.events(id).map((e) => e.text)).toEqual(['Created', 'Sent for review']);
  });

  it('hands each approved application to one agent claim only', () => {
    const u = store.ensureUser('a@example.com');
    const first = store.createApplication(u.id, trip());
    now += 1000;
    const second = store.createApplication(u.id, trip());
    store.update(second, { status: 'approved' }, 'operator', 'Approved');
    now += 1000;
    store.update(first, { status: 'approved' }, 'operator', 'Approved');
    expect(store.claimNextApproved()?.id).toBe(second);
    expect(store.claimNextApproved()?.id).toBe(first);
    expect(store.claimNextApproved()).toBeUndefined();
    expect(store.getApplication(first)?.status).toBe('filing');
  });

  it('keeps files encrypted and only under their own application', () => {
    const u = store.ensureUser('a@example.com');
    const id = store.createApplication(u.id, trip());
    const other = store.createApplication(u.id, trip());
    const fid = store.addFile(id, { kind: 'passport', mediaType: 'image/png', name: 'p.png' }, Buffer.from('PNGDATA'));
    expect(store.getFile(id, fid)?.bytes.toString()).toBe('PNGDATA');
    expect(store.getFile(other, fid)).toBeUndefined();
    expect(store.countFiles(id)).toBe(1);
    expect(JSON.stringify(new DatabaseSync(file).prepare('select data from files').all())).not.toContain('PNGDATA');
  });

  it('deletes applications 30 days after a decision or 90 days after the last activity', () => {
    const u = store.ensureUser('a@example.com');
    const decided = store.createApplication(u.id, trip());
    const idle = store.createApplication(u.id, trip());
    const live = store.createApplication(u.id, trip());
    store.addFile(decided, { kind: 'passport', mediaType: 'image/png', name: 'p.png' }, Buffer.from('x'));
    store.update(decided, { status: 'decided' }, 'operator', 'Decided');
    now += 31 * 24 * 3600_000;
    store.update(live, { status: 'in_review' }, 'customer', 'Sent');
    expect(store.purge()).toBe(1);
    now += 60 * 24 * 3600_000;
    expect(store.purge()).toBe(1);
    expect(store.getApplication(decided)).toBeUndefined();
    expect(store.getApplication(idle)).toBeUndefined();
    expect(store.getApplication(live)).toBeDefined();
  });
});
