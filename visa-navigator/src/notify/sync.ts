import type { Settings } from '@/store/model';
import type { Reminder } from './reminders';

/**
 * What the local server should hold for one trip. The server stores the WhatsApp number and switch per file,
 * so they are part of the signature too. Equal signatures mean nothing needs sending.
 */
export function reminderSignature(reminders: Reminder[], settings: Pick<Settings, 'whatsappNumber' | 'notifyWhatsApp'>): string {
  return JSON.stringify([settings.whatsappNumber, settings.notifyWhatsApp, reminders]);
}

// Both lists live in localStorage, which is per browser, like the vault. Storage can be blocked, so every access is guarded.
const PENDING_KEY = 'vn-reminder-removals';
const KNOWN_KEY = 'vn-known-trips';

function readIds(key: string, storage: Storage): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[], storage: Storage): void {
  try {
    storage.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage is full or blocked: the change still applies for this session.
  }
}

// Trips this browser deleted whose reminders have not yet been removed from the local server. Only ids this browser
// deleted are listed, because the server's schedule is shared by everything on this machine. A removal that fails
// (for example while the server is down) stays here and is retried later, even after a reload.
export function readPendingRemovals(storage: Storage = localStorage): string[] {
  return readIds(PENDING_KEY, storage);
}

export function addPendingRemoval(id: string, storage: Storage = localStorage): void {
  const ids = readPendingRemovals(storage);
  if (!ids.includes(id)) writeIds(PENDING_KEY, [...ids, id], storage);
}

export function clearPendingRemoval(id: string, storage: Storage = localStorage): void {
  writeIds(
    PENDING_KEY,
    readPendingRemovals(storage).filter((x) => x !== id),
    storage,
  );
}

/** Removes pending trips from the local server one at a time. A failed removal stays pending and its error is thrown. */
export async function flushPendingRemovals(remove: (tripId: string) => Promise<unknown>, storage: Storage = localStorage): Promise<void> {
  for (const id of readPendingRemovals(storage)) {
    await remove(id);
    clearPendingRemoval(id, storage);
  }
}

/**
 * Ids of the trips in the vault as last seen while it was open. A wipe happens while the vault is locked, when
 * the trips are no longer in memory, so their reminders are found through this list.
 */
export function readKnownTrips(storage: Storage = localStorage): string[] {
  return readIds(KNOWN_KEY, storage);
}

export function writeKnownTrips(ids: string[], storage: Storage = localStorage): void {
  writeIds(KNOWN_KEY, ids, storage);
}
