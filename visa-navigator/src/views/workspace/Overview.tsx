import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { SectionHeader, SourceLink } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/drafts/templates';
import { addMonths } from '@/verify/checks';
import { sectionDone, type SectionId } from './progress';
import type { PanelProps } from './Workspace';

const STEP_LABEL: Partial<Record<SectionId, string>> = {
  travellers: 'Read each traveller’s passport',
  documents: 'Collect and check your documents',
  form: 'Prepare every form answer',
  itinerary: 'Build your itinerary',
  cover_letter: 'Draft a cover letter (optional)',
  appointment: 'Book your appointment and track the decision',
  notifications: 'Turn on reminders',
  review: 'Review and export your packet',
};

export function Overview({ trip, route, jump }: PanelProps) {
  const steps = route.features.filter((f) => STEP_LABEL[f]);
  const next = steps.find((s) => !sectionDone(trip, route, s));
  const opens = trip.input.departDate && route.applyEarliestMonthsBefore ? addMonths(trip.input.departDate, -route.applyEarliestMonthsBefore) : undefined;

  return (
    <div className="grid gap-6">
      <SectionHeader
        title="Your plan"
        description="Work through these in order. Everything is saved and encrypted as you go."
        action={
          next && (
            <Button onClick={() => jump(next)}>
              Continue: {STEP_LABEL[next]}
              <ArrowRight />
            </Button>
          )
        }
      />
      <ol className="grid gap-2">
        {steps.map((s, i) => {
          const done = sectionDone(trip, route, s);
          return (
            <li key={s}>
              <button
                type="button"
                onClick={() => jump(s)}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-background/50 px-4 py-3 text-left transition-colors hover:border-primary/50"
              >
                {done ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <span className={done ? 'text-muted-foreground line-through decoration-1' : ''}>{STEP_LABEL[s]}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {(opens || trip.input.departDate) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {opens && (
            <div className="rounded-xl bg-primary/8 px-4 py-3">
              <div className="text-xs text-muted-foreground">You can apply from</div>
              <div className="font-semibold">{formatDate(opens)}</div>
            </div>
          )}
          {trip.input.departDate && (
            <div className="rounded-xl bg-primary/8 px-4 py-3">
              <div className="text-xs text-muted-foreground">Travel</div>
              <div className="font-semibold">
                {formatDate(trip.input.departDate)}
                {trip.input.returnDate && ` – ${formatDate(trip.input.returnDate)}`}
              </div>
            </div>
          )}
        </div>
      )}

      {route.steps.length > 0 && (
        <div className="grid gap-2">
          <h3 className="font-heading font-semibold">How this application works</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            {route.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {route.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {route.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-1">
        {route.sources.map((s) => (
          <SourceLink key={s.url} source={s} />
        ))}
      </div>
    </div>
  );
}
