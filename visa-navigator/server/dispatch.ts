import { partitionDue, type ScheduleFile, type ScheduleStore, type StoredReminder } from './schedule';
import type { WhatsAppConfig } from './whatsapp';

export interface Outcome {
  id: string;
  sentAt?: string;
  skippedAt?: string;
  error?: string;
}

export type Sender = (cfg: WhatsAppConfig, phone: string, title: string, body: string) => Promise<unknown>;

/**
 * Records send results on the latest copy of the schedule, matched by reminder id.
 * A reminder deleted while the send ran is not brought back; one added while it ran is kept.
 */
export function applyOutcomes(file: ScheduleFile, outcomes: Outcome[]): ScheduleFile {
  const byId = new Map(outcomes.map((o) => [o.id, o]));
  const reminders = file.reminders.map((r: StoredReminder): StoredReminder => {
    const o = byId.get(r.id);
    if (!o) return r;
    return { ...r, sentAt: o.sentAt ?? r.sentAt, skippedAt: o.skippedAt ?? r.skippedAt, error: o.error ?? r.error };
  });
  return { ...file, reminders };
}

/**
 * Sends the reminders that are due, then writes the results back. The file is read again before writing,
 * so changes saved by the app during the (slow) WhatsApp calls are not overwritten.
 */
export async function dispatchDue(schedule: ScheduleStore, cfg: WhatsAppConfig | null, send: Sender, now: Date = new Date()): Promise<void> {
  const snapshot = schedule.read();
  const { send: due, skip } = partitionDue(snapshot.reminders, now);
  if (!due.length && !skip.length) return;

  const stamp = now.toISOString();
  const outcomes: Outcome[] = skip.map((r) => ({ id: r.id, skippedAt: stamp }));
  for (const r of due) {
    if (!snapshot.whatsapp || !snapshot.to || !cfg) {
      outcomes.push({ id: r.id, skippedAt: stamp, error: 'WhatsApp off' });
      continue;
    }
    try {
      await send(cfg, snapshot.to, r.title, r.body);
      outcomes.push({ id: r.id, sentAt: new Date().toISOString() });
    } catch (err) {
      outcomes.push({ id: r.id, skippedAt: stamp, error: err instanceof Error ? err.message : 'send failed' });
    }
  }
  schedule.write(applyOutcomes(schedule.read(), outcomes));
}
