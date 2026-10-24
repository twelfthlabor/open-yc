import { ArrowUpRight, Check } from 'lucide-react';
import { CopyButton, SourceLink, StatusPill } from '@/components/app/bits';
import { CountryCombobox } from '@/components/app/CountryCombobox';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { bookingGuide, bookingSheet, refKey, refLooksRight } from '@/booking/booking';
import { travellerName, type BookingProgress } from '@/store/model';
import type { PanelProps } from './Workspace';

/** Step-by-step hand-off to the official booking system, with a copy sheet of what it asks. */
export function BookingAssistant({ trip, route, update }: Pick<PanelProps, 'trip' | 'route' | 'update'>) {
  const booking: BookingProgress = trip.tracker.booking ?? { done: {}, refs: {} };
  const residence = booking.residence || trip.input.nationality;
  const guide = bookingGuide(route, trip, residence);
  if (!guide) return null;
  const set = (patch: Partial<BookingProgress>) => update((t) => ({ ...t, tracker: { ...t.tracker, booking: { ...booking, ...patch } } }));
  const sheet = bookingSheet(route, trip, booking, guide);
  const doneCount = guide.steps.filter((s) => booking.done[s.id]).length;

  return (
    <section className="grid gap-4 rounded-2xl border border-border p-4" aria-label="Booking steps">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-heading font-semibold">Book with {guide.system}</h3>
          <p className="text-sm text-muted-foreground">{guide.urlNote}</p>
        </div>
        <StatusPill status={doneCount === guide.steps.length ? 'pass' : 'neutral'}>
          {doneCount}/{guide.steps.length} steps
        </StatusPill>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <CountryCombobox label="Country where you apply (where you live)" value={residence} onChange={(code) => set({ residence: code })} />
        {guide.url && (
          <Button asChild>
            <a href={guide.url} target="_blank" rel="noreferrer">
              Open booking site <ArrowUpRight />
            </a>
          </Button>
        )}
      </div>

      <ol className="grid gap-2">
        {guide.steps.map((s, i) => (
          <li key={s.id} className="grid gap-2 rounded-xl border border-border bg-background/40 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <Checkbox checked={Boolean(booking.done[s.id])} onCheckedChange={(v) => set({ done: { ...booking.done, [s.id]: v === true } })} />
              <span className="text-muted-foreground">{i + 1}.</span> {s.label}
              {booking.done[s.id] && <Check className="size-4 text-success" />}
            </label>
            {s.ref &&
              (s.ref.perTraveller ? trip.travellers : [undefined]).map((t) => {
                const key = refKey(s.ref!.id, t?.id);
                const value = booking.refs[key] ?? '';
                const id = `ref-${key}`;
                return (
                  <div key={key} className="grid gap-1 pl-8 sm:grid-cols-[14rem_1fr] sm:items-center">
                    <Label htmlFor={id} className="text-xs">
                      {s.ref!.label}
                      {t && ` (${travellerName(t)})`}
                    </Label>
                    <div className="grid gap-1">
                      <Input id={id} className="h-9 rounded-xl" placeholder={s.ref!.hint} value={value} onChange={(e) => set({ refs: { ...booking.refs, [key]: e.target.value } })} />
                      {!refLooksRight(s, value) && <span className="text-xs text-warning-foreground dark:text-warning">That does not look like {s.ref!.hint}. Copy it exactly from the portal.</span>}
                    </div>
                  </div>
                );
              })}
          </li>
        ))}
      </ol>

      <div className="grid gap-2">
        <Label htmlFor="preferred">Dates that suit you</Label>
        <Input id="preferred" className="h-10 rounded-xl" placeholder="For example: weekdays from 3 to 14 November" value={booking.preferredDates ?? ''} onChange={(e) => set({ preferredDates: e.target.value })} />
      </div>

      <details className="rounded-xl border border-border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Copy sheet for the booking form</summary>
        <div className="mt-2 grid gap-3">
          {sheet.map((p) => (
            <div key={p.traveller} className="grid gap-1">
              <div className="text-sm font-semibold">{p.traveller}</div>
              {p.rows.map((r) => (
                <div key={r.label} className="grid grid-cols-[1fr_auto] items-center gap-2 border-t border-border/60 py-1 text-sm sm:grid-cols-[14rem_1fr_auto]">
                  <span className="col-span-2 text-xs text-muted-foreground sm:col-span-1">{r.label}</span>
                  <span className={r.value ? '' : 'text-muted-foreground'}>{r.value || 'not entered'}</span>
                  {r.value ? <CopyButton text={r.value} className="h-7" /> : <span />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </details>

      <p className="text-xs text-muted-foreground">{guide.limits}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {guide.sources.map((s) => (
          <SourceLink key={s.url + s.label} source={s} />
        ))}
      </div>
    </section>
  );
}
