import { ArrowUpRight, CalendarCheck2, Check, Radar } from 'lucide-react';
import { SectionHeader, StatusPill } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { formatDate } from '@/drafts/templates';
import { cn } from '@/lib/utils';
import type { AvailabilityWatch, Tracker, TrackerStatus } from '@/store/model';
import { addMonths } from '@/verify/checks';
import { BookingAssistant } from './BookingAssistant';
import type { PanelProps } from './Workspace';

const STAGES: Array<{ id: TrackerStatus; label: string }> = [
  { id: 'preparing', label: 'Preparing' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'appointment', label: 'Appointment' },
  { id: 'decided', label: 'Decision' },
];

const DAY = 86_400_000;
function daysUntil(iso: string, today = new Date()): number {
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((new Date(iso.slice(0, 10) + 'T00:00:00Z').getTime() - start) / DAY);
}

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function Appointment({ trip, route, update }: PanelProps) {
  const tr = trip.tracker;
  const set = (patch: Partial<Tracker>) => update((t) => ({ ...t, tracker: { ...t.tracker, ...patch } }));
  const watch: AvailabilityWatch = tr.watch ?? { enabled: false, bookingUrl: '', everyHours: 6, log: [] };
  const setWatch = (patch: Partial<AvailabilityWatch>) => set({ watch: { ...watch, ...patch } });
  const stages = route.appointment === 'none' ? STAGES.filter((s) => s.id !== 'appointment') : STAGES;
  const current = stages.findIndex((s) => s.id === tr.status);
  const needsBooking = route.appointment && route.appointment !== 'none';

  const checkedNow = () => {
    const at = new Date().toISOString();
    setWatch({ lastCheckedAt: at, log: [{ at, note: 'Checked booking page' }, ...watch.log].slice(0, 30) });
    if (watch.bookingUrl) window.open(watch.bookingUrl, '_blank', 'noopener');
  };

  const nextCheck = watch.enabled ? new Date(new Date(watch.lastCheckedAt ?? Date.now()).getTime() + watch.everyHours * 3600_000) : null;

  const dates: Array<{ label: string; date: string; tone?: 'warn' | 'fail' | 'pass' }> = [];
  if (trip.input.departDate && route.applyEarliestMonthsBefore) {
    const opens = addMonths(trip.input.departDate, -route.applyEarliestMonthsBefore);
    dates.push({ label: daysUntil(opens) > 0 ? 'You can apply from' : 'Application window open since', date: opens, tone: daysUntil(opens) > 0 ? undefined : 'pass' });
  }
  if (trip.input.departDate) dates.push({ label: 'Travel', date: trip.input.departDate });
  if (tr.appointmentAt) dates.push({ label: `Appointment${tr.appointmentPlace ? ` at ${tr.appointmentPlace}` : ''}`, date: tr.appointmentAt });
  for (const t of trip.travellers) {
    if (t.passport?.expiryDate) {
      const tone = trip.input.returnDate && t.passport.expiryDate < trip.input.returnDate ? 'fail' : daysUntil(t.passport.expiryDate) < 180 ? 'warn' : undefined;
      dates.push({ label: `${t.label}: passport expires`, date: t.passport.expiryDate, tone });
    }
  }
  if (tr.permissionExpires) dates.push({ label: `${route.kind === 'eta' ? 'ETA' : 'Visa'} valid until`, date: tr.permissionExpires });
  dates.sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="grid gap-7">
      <SectionHeader title="Appointment and tracking" description="Book your appointment, keep watch for open slots, and track the application to a decision." />

      <div className="grid gap-2" role="group" aria-label="Application stage">
        <div className={cn('grid gap-2', stages.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
          {stages.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={i === current}
              onClick={() => set({ status: s.id })}
              className={cn(
                'rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                i === current ? 'border-primary bg-primary/10 font-semibold text-primary' : i < current ? 'border-transparent bg-success/12 text-success' : 'border-border bg-background/50 hover:border-primary/40',
              )}
            >
              {i < current && <Check className="mr-1 inline size-3.5" />}
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {needsBooking && <BookingAssistant trip={trip} route={route} update={update} />}

      {needsBooking && (
        <section className="grid gap-4 rounded-2xl border border-border p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <CalendarCheck2 className="size-5" />
            </span>
            <div>
              <h3 className="font-heading font-semibold">Your appointment</h3>
              <p className="text-sm text-muted-foreground">
                {route.bookingLabel ?? 'The official application tells you where to book an identity appointment.'} Paste the booking page for your country below. You book yourself; the app keeps
                everything you need in one place.
              </p>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="booking-url">Booking page</Label>
            <div className="flex flex-wrap gap-2">
              <Input id="booking-url" type="url" placeholder="https://…" className="h-10 min-w-0 flex-1 rounded-xl" value={watch.bookingUrl} onChange={(e) => setWatch({ bookingUrl: e.target.value })} />
              <Button variant="outline" disabled={!/^https:\/\//.test(watch.bookingUrl)} asChild={/^https:\/\//.test(watch.bookingUrl)}>
                {/^https:\/\//.test(watch.bookingUrl) ? (
                  <a href={watch.bookingUrl} target="_blank" rel="noreferrer">
                    Open <ArrowUpRight />
                  </a>
                ) : (
                  <span>Open</span>
                )}
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="appt-at">Appointment date and time</Label>
              <Input
                id="appt-at"
                type="datetime-local"
                className="h-10 rounded-xl"
                value={tr.appointmentAt ?? ''}
                onChange={(e) => set({ appointmentAt: e.target.value || undefined, status: e.target.value && current < 2 ? 'appointment' : tr.status })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="appt-place">Location</Label>
              <Input id="appt-place" className="h-10 rounded-xl" placeholder="Embassy or visa centre" value={tr.appointmentPlace ?? ''} onChange={(e) => set({ appointmentPlace: e.target.value })} />
            </div>
          </div>
        </section>
      )}

      {needsBooking && !tr.appointmentAt && (
        <section className="grid gap-4 rounded-2xl border border-border p-4">
          <div className="flex flex-wrap items-start gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Radar className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-heading font-semibold">Appointment availability tracking</h3>
              <p className="text-sm text-muted-foreground">
                Slots open and close quickly. Turn this on and the app reminds you on WhatsApp or desktop to check the booking page at a set interval. It does not log in to booking
                sites for you.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="watch-on" checked={watch.enabled} onCheckedChange={(v) => setWatch({ enabled: v, lastCheckedAt: v ? new Date().toISOString() : watch.lastCheckedAt })} />
              <Label htmlFor="watch-on">{watch.enabled ? 'On' : 'Off'}</Label>
            </div>
          </div>
          {watch.enabled && (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Label htmlFor="watch-every">Remind me every</Label>
                <Select value={String(watch.everyHours)} onValueChange={(v) => setWatch({ everyHours: Number(v) })}>
                  <SelectTrigger id="watch-every" className="h-9 w-36 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2, 4, 6, 12, 24].map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {h} hours
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {nextCheck && <span className="text-sm text-muted-foreground">Next reminder {fmtDateTime(nextCheck.toISOString())}</span>}
              </div>
              <div>
                <Button onClick={checkedNow}>
                  <Check /> I’m checking now{watch.bookingUrl ? ' (opens booking page)' : ''}
                </Button>
              </div>
              {watch.log.length > 0 && (
                <ul className="grid gap-1 text-sm text-muted-foreground">
                  {watch.log.slice(0, 5).map((l) => (
                    <li key={l.at}>
                      {fmtDateTime(l.at)}: {l.note}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      <section className="grid gap-3">
        <h3 className="font-heading font-semibold">Application details</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="submitted">Submitted on</Label>
            <Input
              id="submitted"
              type="date"
              className="h-10 rounded-xl"
              value={tr.submittedOn ?? ''}
              onChange={(e) => set({ submittedOn: e.target.value || undefined, status: e.target.value && tr.status === 'preparing' ? 'submitted' : tr.status })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reference">Application reference</Label>
            <Input id="reference" className="h-10 rounded-xl" placeholder="From your confirmation email" value={tr.reference ?? ''} onChange={(e) => set({ reference: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="decision">Decision</Label>
            <Select value={tr.decision || 'waiting'} onValueChange={(v) => set({ decision: v === 'waiting' ? '' : (v as Tracker['decision']), status: v === 'waiting' ? tr.status : 'decided' })}>
              <SelectTrigger id="decision" className="h-10 w-full rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="waiting">Waiting</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="refused">Refused</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="valid-until">{route.kind === 'eta' ? 'ETA' : 'Visa'} valid until</Label>
            <Input id="valid-until" type="date" className="h-10 rounded-xl" value={tr.permissionExpires ?? ''} onChange={(e) => set({ permissionExpires: e.target.value || undefined })} />
          </div>
        </div>
      </section>

      <section className="grid gap-2">
        <h3 className="font-heading font-semibold">Key dates</h3>
        {dates.length === 0 && <p className="text-sm text-muted-foreground">Add travel dates and passports to see your timeline.</p>}
        <ul className="divide-y divide-border rounded-xl border border-border">
          {dates.map((d) => {
            const n = daysUntil(d.date);
            return (
              <li key={d.label + d.date} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="flex-1">{d.label}</span>
                <span className="text-muted-foreground">{d.date.length > 10 ? fmtDateTime(d.date) : formatDate(d.date)}</span>
                <StatusPill status={d.tone ?? 'neutral'}>{n === 0 ? 'today' : n > 0 ? `in ${n} days` : `${-n} days ago`}</StatusPill>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
