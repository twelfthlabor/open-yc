import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyOutcomes, dispatchDue } from './dispatch';
import { partitionDue, ScheduleStore, type ScheduleFile, type StoredReminder } from './schedule';

const NOW = new Date('2026-06-01T12:00:00Z');
const cfg = { accountSid: 'AC1', username: 'AC1', password: 'secret', from: '+14155238886' };
const reminder = (id: string, at: string): StoredReminder => ({ id, tripId: 'trip-1', at, title: 'Title', body: 'Body', kind: 'test' });
const file = (reminders: StoredReminder[]): ScheduleFile => ({ to: '+14155550100', whatsapp: true, reminders });
const tempStore = (): ScheduleStore => new ScheduleStore(mkdtempSync(path.join(tmpdir(), 'vn-dispatch-')));

describe('reminders with unreadable dates', () => {
  it('are never sent; they are skipped instead', () => {
    const { send, skip } = partitionDue([reminder('bad', 'not a date')], NOW);
    expect(send).toEqual([]);
    expect(skip.map((r) => r.id)).toEqual(['bad']);
  });
});

describe('applyOutcomes', () => {
  it('records sent status on the reminders it was given', () => {
    const out = applyOutcomes(file([reminder('a', '2026-06-01T11:00:00Z')]), [{ id: 'a', sentAt: '2026-06-01T12:00:00Z' }]);
    expect(out.reminders[0].sentAt).toBe('2026-06-01T12:00:00Z');
  });

  it('keeps a reminder that was added while the send was running', () => {
    const latest = file([reminder('a', '2026-06-01T11:00:00Z'), reminder('new', '2026-07-01T09:00:00Z')]);
    const out = applyOutcomes(latest, [{ id: 'a', sentAt: '2026-06-01T12:00:00Z' }]);
    expect(out.reminders.map((r) => r.id)).toEqual(['a', 'new']);
  });

  it('does not bring back a reminder that was deleted while the send was running', () => {
    const out = applyOutcomes(file([]), [{ id: 'deleted', sentAt: '2026-06-01T12:00:00Z' }]);
    expect(out.reminders).toEqual([]);
  });
});

describe('dispatchDue', () => {
  it('keeps a reminder saved while a WhatsApp send was in progress', async () => {
    const store = tempStore();
    store.write(file([reminder('due', '2026-06-01T11:00:00Z')]));
    await dispatchDue(
      store,
      cfg,
      async () => {
        const current = store.read();
        store.write({ ...current, reminders: [...current.reminders, reminder('saved-meanwhile', '2026-07-01T09:00:00Z')] });
        return { sid: 'SM1' };
      },
      NOW,
    );
    const after = store.read().reminders;
    expect(after.find((r) => r.id === 'due')?.sentAt).toBeDefined();
    expect(after.map((r) => r.id)).toContain('saved-meanwhile');
  });

  it('does not resurrect a trip deleted while a WhatsApp send was in progress', async () => {
    const store = tempStore();
    store.write(file([reminder('due', '2026-06-01T11:00:00Z')]));
    await dispatchDue(
      store,
      cfg,
      async () => {
        store.write({ ...store.read(), reminders: [] });
        return { sid: 'SM2' };
      },
      NOW,
    );
    expect(store.read().reminders).toEqual([]);
  });
});
