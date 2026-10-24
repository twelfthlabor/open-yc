import { BellRing, MessageCircle, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { getSchedule, sendTestWhatsApp, type ScheduleView } from '@/api';
import { SectionHeader, StatusPill } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useHealth } from '@/hooks';
import { buildReminders } from '@/notify/reminders';
import { resolveRoute } from '@/rules/engine';
import { useVault } from '@/state/VaultContext';
import type { AppData } from '@/store/model';
import type { PanelProps } from './Workspace';

const E164 = /^\+[1-9]\d{6,14}$/;
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function Notifications({ trip, route }: PanelProps) {
  const vault = useVault();
  const health = useHealth();
  const { settings } = vault.data;
  const [schedule, setSchedule] = useState<ScheduleView | null>(null);
  const [sending, setSending] = useState(false);
  const upcoming = useMemo(() => buildReminders(trip, route), [trip, route]);
  const number = settings.whatsappNumber.replace(/[\s()-]/g, '');
  const numberOk = E164.test(number);
  const waReady = Boolean(health?.whatsapp.configured);

  useEffect(() => {
    getSchedule().then(setSchedule).catch(() => setSchedule(null));
  }, [vault.reminderSync]);

  const history = (schedule?.reminders ?? []).filter((r) => r.tripId === trip.id && (r.sentAt || r.skippedAt)).slice(-5).reverse();

  return (
    <div className="grid gap-6">
      <SectionHeader title="Reminders" description="Get reminded when your application window opens, before appointments, when to check for slots, and when a decision is due." />

      <section className="grid gap-4 rounded-2xl border border-border p-4">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-success/12 text-success">
            <MessageCircle className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-heading font-semibold">WhatsApp</h3>
            <p className="text-sm text-muted-foreground">Messages are sent by the local server through your Twilio account while the app’s server is running.</p>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="wa-on" checked={settings.notifyWhatsApp} disabled={!waReady} onCheckedChange={(v) => vault.updateSettings({ notifyWhatsApp: v })} />
            <Label htmlFor="wa-on">{settings.notifyWhatsApp ? 'On' : 'Off'}</Label>
          </div>
        </div>
        {!waReady && (
          <div className="rounded-xl bg-muted px-3 py-2 text-sm">
            WhatsApp is not set up on the server. Add <span className="mono">TWILIO_ACCOUNT_SID</span>, <span className="mono">TWILIO_AUTH_TOKEN</span> and{' '}
            <span className="mono">TWILIO_WHATSAPP_FROM</span> to <span className="mono">.env</span> and restart <span className="mono">npm run dev</span>. See the README.
          </div>
        )}
        {waReady && !health?.whatsapp.template && (
          <div className="rounded-xl bg-warning/15 px-3 py-2 text-sm">
            No message template is set (<span className="mono">TWILIO_CONTENT_SID</span>). WhatsApp only delivers free-form messages within 24 hours of you last messaging the sender, so
            scheduled reminders may not arrive.
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="wa-number">Your WhatsApp number</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="wa-number" type="tel" placeholder="+14155550100" className="h-10 max-w-xs rounded-xl" value={settings.whatsappNumber} onChange={(e) => vault.updateSettings({ whatsappNumber: e.target.value })} />
            <Button
              variant="outline"
              disabled={!waReady || !numberOk || sending}
              onClick={async () => {
                setSending(true);
                try {
                  await sendTestWhatsApp(number);
                  toast.success('Test message sent. Check WhatsApp.');
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not send.');
                } finally {
                  setSending(false);
                }
              }}
            >
              <Send /> Send test message
            </Button>
          </div>
          {settings.whatsappNumber && !numberOk && <p className="text-xs text-destructive">Use international format with the country code, for example +14155550100.</p>}
          <p className="text-xs text-muted-foreground">Stored on the local server with reminder text only. No passport details are sent.</p>
        </div>
      </section>

      <section className="flex flex-wrap items-start gap-3 rounded-2xl border border-border p-4">
        <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <BellRing className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading font-semibold">Desktop notifications</h3>
          <p className="text-sm text-muted-foreground">Shown while Visa Navigator is open in a tab.</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="desk-on"
            checked={settings.notifyDesktop}
            onCheckedChange={async (v) => {
              if (v && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
              vault.updateSettings({ notifyDesktop: v });
            }}
          />
          <Label htmlFor="desk-on">{settings.notifyDesktop ? 'On' : 'Off'}</Label>
        </div>
      </section>

      <section className="grid gap-2">
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-semibold">Upcoming</h3>
          <StatusPill status={vault.reminderSync === 'ok' ? 'pass' : vault.reminderSync === 'idle' ? 'neutral' : 'warn'}>
            {vault.reminderSync === 'ok' ? 'Synced to server' : vault.reminderSync === 'offline' ? 'Server offline' : vault.reminderSync === 'error' ? 'Sync failed' : 'Syncing…'}
          </StatusPill>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming reminders. Add travel dates, an appointment, or turn on availability tracking.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {upcoming.slice(0, 8).map((r) => (
              <li key={r.id} className="grid gap-0.5 px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.title}</span>
                  <span className="text-xs text-muted-foreground">{fmt(r.at)}</span>
                </div>
                <span className="text-muted-foreground">{r.body}</span>
              </li>
            ))}
          </ul>
        )}
        {history.length > 0 && (
          <div className="grid gap-1 pt-2 text-xs text-muted-foreground">
            {history.map((r) => (
              <div key={r.id}>
                {r.sentAt ? `Sent ${fmt(r.sentAt)}` : `Not sent (${r.error ?? 'missed'})`}: {r.title}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Shows reminders that come due while the app is open (toast, plus a desktop notification if allowed). */
export function useReminderAlerts(data: AppData, active: boolean) {
  const last = useRef(Date.now());
  // Read the latest data through a ref so typing does not restart the one-minute timer.
  const latest = useRef(data);
  latest.current = data;
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const now = Date.now();
      const since = new Date(last.current);
      last.current = now;
      const data = latest.current;
      if (!data.settings.notifyDesktop) return;
      for (const trip of data.trips) {
        for (const r of buildReminders(trip, resolveRoute(trip.input), since)) {
          if (new Date(r.at).getTime() > now) continue;
          toast.info(r.title, { description: r.body });
          if ('Notification' in window && Notification.permission === 'granted') new Notification(r.title, { body: r.body });
        }
      }
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [active]);
}
