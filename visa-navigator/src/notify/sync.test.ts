import { describe, expect, it } from 'vitest';
import { addPendingRemoval, clearPendingRemoval, flushPendingRemovals, readKnownTrips, readPendingRemovals, reminderSignature, writeKnownTrips } from './sync';
import type { Reminder } from './reminders';

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: 'trip-1:apply',
  tripId: 'trip-1',
  at: '2026-06-01T09:00:00.000Z',
  kind: 'apply_window',
  title: 'You can apply for Croatia now',
  body: 'The application window opens today.',
  ...over,
});
const settings = { whatsappNumber: '+14155550100', notifyWhatsApp: true };

/** In-memory stand-in for localStorage. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

describe('reminderSignature', () => {
  it('is the same for the same reminders and settings', () => {
    expect(reminderSignature([reminder()], settings)).toBe(reminderSignature([reminder()], settings));
  });

  it('changes when a reminder changes, so the server is updated', () => {
    expect(reminderSignature([reminder({ title: 'Changed' })], settings)).not.toBe(reminderSignature([reminder()], settings));
  });

  it('changes when the WhatsApp number or the switch changes, because the server stores both per file', () => {
    const base = reminderSignature([reminder()], settings);
    expect(reminderSignature([reminder()], { ...settings, whatsappNumber: '+14155550199' })).not.toBe(base);
    expect(reminderSignature([reminder()], { ...settings, notifyWhatsApp: false })).not.toBe(base);
  });
});

describe('pending reminder removals', () => {
  it('is empty when nothing was saved', () => {
    expect(readPendingRemovals(memoryStorage())).toEqual([]);
  });

  it('is empty when the saved value is not valid, instead of throwing', () => {
    const storage = memoryStorage();
    storage.setItem('vn-reminder-removals', '{not json');
    expect(readPendingRemovals(storage)).toEqual([]);
  });

  it('keeps each trip once, and forgets it when cleared', () => {
    const storage = memoryStorage();
    addPendingRemoval('a', storage);
    addPendingRemoval('a', storage);
    addPendingRemoval('b', storage);
    expect(readPendingRemovals(storage)).toEqual(['a', 'b']);
    clearPendingRemoval('a', storage);
    expect(readPendingRemovals(storage)).toEqual(['b']);
  });
});

describe('flushPendingRemovals', () => {
  it('removes each pending trip and clears it once the server accepts', async () => {
    const storage = memoryStorage();
    addPendingRemoval('a', storage);
    addPendingRemoval('b', storage);
    const removed: string[] = [];
    await flushPendingRemovals(async (id) => void removed.push(id), storage);
    expect(removed).toEqual(['a', 'b']);
    expect(readPendingRemovals(storage)).toEqual([]);
  });

  it('keeps a trip whose removal failed, stops there, and reports the failure so it is retried later', async () => {
    const storage = memoryStorage();
    addPendingRemoval('a', storage);
    addPendingRemoval('b', storage);
    await expect(
      flushPendingRemovals(async (id) => {
        if (id === 'a') throw new TypeError('offline');
      }, storage),
    ).rejects.toThrow('offline');
    expect(readPendingRemovals(storage)).toEqual(['a', 'b']);
  });
});

describe('known trips', () => {
  it('is empty when nothing was saved', () => {
    expect(readKnownTrips(memoryStorage())).toEqual([]);
  });

  it('keeps the ids of the trips in the open vault, so a wipe can remove their reminders while the vault is locked', () => {
    const storage = memoryStorage();
    writeKnownTrips(['a', 'b'], storage);
    expect(readKnownTrips(storage)).toEqual(['a', 'b']);
    writeKnownTrips([], storage);
    expect(readKnownTrips(storage)).toEqual([]);
  });
});
