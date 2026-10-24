import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { newVaultKey, openVaultKey, seal, unseal, upgradeVault, type VaultKey } from '../crypto/vault';
import { buildReminders } from '../notify/reminders';
import { addPendingRemoval, flushPendingRemovals, readKnownTrips, reminderSignature, writeKnownTrips } from '../notify/sync';
import { resolveRoute } from '../rules/engine';
import { deleteDoc, deleteVault, listDocs, readDoc, readSealed, writeDoc, writeSealed } from '../store/db';
import { migrate } from '../store/migrate';
import { emptyData, newId, type AppData, type Settings, type Trip } from '../store/model';
import { deleteTripReminders, syncReminders } from '../api';

type Status = 'loading' | 'new' | 'locked' | 'open';

interface VaultApi {
  status: Status;
  data: AppData;
  saving: boolean;
  reminderSync: 'idle' | 'ok' | 'offline' | 'error';
  create(passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  lock(): Promise<void>;
  wipe(): Promise<void>;
  addTrip(trip: Trip): void;
  updateTrip(id: string, patch: (t: Trip) => Trip): void;
  removeTrip(id: string): void;
  updateSettings(patch: Partial<Settings>): void;
  /** Encrypts a file (as a data URL) into the document store and returns its id. */
  saveFile(dataUrl: string): Promise<string>;
  readFile(id: string): Promise<string | undefined>;
  removeFile(id: string): Promise<void>;
}

const Ctx = createContext<VaultApi | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<AppData>(emptyData);
  const [saving, setSaving] = useState(false);
  const [reminderSync, setReminderSync] = useState<VaultApi['reminderSync']>('idle');
  const keyRef = useRef<VaultKey | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<AppData | null>(null);

  useEffect(() => {
    readSealed()
      .then((blob) => setStatus(blob ? 'locked' : 'new'))
      .catch(() => setStatus('new'));
  }, []);

  // Writes any pending change now. Called by the debounce timer, on lock, and when the tab is hidden.
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    const key = keyRef.current;
    pending.current = null;
    if (next && key) await writeSealed(await seal(next, key));
    setSaving(false);
  }, []);

  const persist = useCallback(
    (next: AppData) => {
      pending.current = next;
      setSaving(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 350);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [flush]);

  // Keep the local server's reminder schedule in step with the trips (it sends WhatsApp messages).
  // Only trips whose reminders or WhatsApp settings changed are sent. Reminders of deleted trips are removed,
  // and a removal that fails (for example while the local server is down) is retried on the next pass.
  const sentSignatures = useRef(new Map<string, string>());
  useEffect(() => {
    if (status !== 'open') {
      sentSignatures.current.clear();
      return;
    }
    const t = setTimeout(async () => {
      try {
        for (const trip of data.trips) {
          const reminders = buildReminders(trip, resolveRoute(trip.input));
          const signature = reminderSignature(reminders, data.settings);
          if (sentSignatures.current.get(trip.id) === signature) continue;
          await syncReminders({ tripId: trip.id, to: data.settings.whatsappNumber, whatsapp: data.settings.notifyWhatsApp, reminders });
          sentSignatures.current.set(trip.id, signature);
        }
        setReminderSync('ok');
      } catch (err) {
        setReminderSync(err instanceof TypeError ? 'offline' : 'error');
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [data, status]);

  // Removes the reminders of deleted trips whenever the local server is reachable, including right after a vault wipe.
  useEffect(() => {
    if (status === 'open') writeKnownTrips(data.trips.map((trip) => trip.id));
    flushPendingRemovals(deleteTripReminders).catch(() => undefined);
  }, [data, status]);

  const mutate = useCallback(
    (fn: (d: AppData) => AppData) => {
      setData((prev) => {
        const next = fn(prev);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const api: VaultApi = {
    status,
    data,
    saving,
    reminderSync,
    async create(passphrase) {
      keyRef.current = await newVaultKey(passphrase);
      const fresh = emptyData();
      await writeSealed(await seal(fresh, keyRef.current));
      setData(fresh);
      setStatus('open');
    },
    async unlock(passphrase) {
      const blob = await readSealed();
      if (!blob) throw new Error('No vault found.');
      const vk = await openVaultKey(passphrase, blob);
      const raw = await unseal<{ version?: number }>(blob, vk);
      const opened = migrate(raw);
      // Older vaults used fewer PBKDF2 iterations; re-seal them (and their files) with the current count.
      const key = await upgradeVault(passphrase, vk, opened, { listDocs, writeDoc, writeSealed });
      keyRef.current = key;
      setData(opened);
      setStatus('open');
      if (key === vk && raw.version !== opened.version) await writeSealed(await seal(opened, key));
    },
    async lock() {
      await flush();
      keyRef.current = null;
      setData(emptyData());
      setStatus('locked');
    },
    async wipe() {
      if (timer.current) clearTimeout(timer.current);
      pending.current = null;
      keyRef.current = null;
      for (const id of new Set([...readKnownTrips(), ...data.trips.map((trip) => trip.id)])) addPendingRemoval(id);
      writeKnownTrips([]);
      await deleteVault();
      setData(emptyData());
      setStatus('new');
    },
    addTrip(trip) {
      mutate((d) => ({ ...d, trips: [trip, ...d.trips] }));
    },
    updateTrip(id, patch) {
      mutate((d) => ({
        ...d,
        trips: d.trips.map((t) => (t.id === id ? { ...patch(t), updatedAt: new Date().toISOString() } : t)),
      }));
    },
    removeTrip(id) {
      const trip = data.trips.find((t) => t.id === id);
      const ids = trip
        ? [
            ...Object.values(trip.sharedDocuments).map((d) => d.id),
            ...trip.travellers.flatMap((t) => Object.values(t.documents).map((d) => d.id)),
            ...trip.travellers.map((t) => t.passport?.imageDocId).filter((x): x is string => Boolean(x)),
          ]
        : [];
      mutate((d) => ({ ...d, trips: d.trips.filter((t) => t.id !== id) }));
      addPendingRemoval(id);
      void Promise.all(ids.map(deleteDoc));
    },
    updateSettings(patch) {
      mutate((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
    },
    async saveFile(dataUrl) {
      if (!keyRef.current) throw new Error('Vault is locked.');
      const id = newId();
      await writeDoc(id, await seal({ dataUrl }, keyRef.current));
      return id;
    },
    async readFile(id) {
      if (!keyRef.current) return undefined;
      const blob = await readDoc(id);
      if (!blob) return undefined;
      return (await unseal<{ dataUrl: string }>(blob, keyRef.current)).dataUrl;
    },
    async removeFile(id) {
      await deleteDoc(id);
    },
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useVault(): VaultApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVault must be used inside VaultProvider');
  return v;
}
