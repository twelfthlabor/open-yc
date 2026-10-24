// Reminder schedule kept in data/reminders.json so it survives restarts. The file holds reminder
// text and the WhatsApp number only; it never holds passport data.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface StoredReminder {
  id: string;
  tripId: string;
  at: string;
  title: string;
  body: string;
  kind: string;
  sentAt?: string;
  skippedAt?: string;
  error?: string;
}

export interface ScheduleFile {
  to: string;
  whatsapp: boolean;
  reminders: StoredReminder[];
}

const MISSED_LIMIT_MS = 2 * 24 * 3600_000;

export const emptySchedule = (): ScheduleFile => ({ to: '', whatsapp: false, reminders: [] });

/** Unsent reminders that are due. Ones missed by more than two days are skipped, not sent late. */
export function partitionDue(list: StoredReminder[], now: Date): { send: StoredReminder[]; skip: StoredReminder[] } {
  const send: StoredReminder[] = [];
  const skip: StoredReminder[] = [];
  for (const r of list) {
    if (r.sentAt || r.skippedAt) continue;
    const t = new Date(r.at).getTime();
    // A date that cannot be read is skipped. Sending it would fire the reminder at once.
    if (!Number.isFinite(t)) {
      skip.push(r);
      continue;
    }
    if (t > now.getTime()) continue;
    (now.getTime() - t > MISSED_LIMIT_MS ? skip : send).push(r);
  }
  return { send, skip };
}

/** Replaces one trip's pending reminders and keeps the history of ones already sent. */
export function replaceTrip(file: ScheduleFile, tripId: string, incoming: StoredReminder[]): ScheduleFile {
  const kept = file.reminders.filter((r) => r.tripId !== tripId || r.sentAt || r.skippedAt);
  const sentIds = new Set(kept.map((r) => r.id));
  return { ...file, reminders: [...kept, ...incoming.filter((r) => !sentIds.has(r.id))] };
}

export class ScheduleStore {
  private file: string;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'reminders.json');
  }
  read(): ScheduleFile {
    try {
      return { ...emptySchedule(), ...(JSON.parse(readFileSync(this.file, 'utf8')) as ScheduleFile) };
    } catch {
      return emptySchedule();
    }
  }
  write(data: ScheduleFile): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.file);
  }
}
