import { ArrowUpRight } from 'lucide-react';
import { SourceLink, StatusPill } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import type { Route } from '@/rules/types';

const KIND: Record<Route['kind'], { status: 'pass' | 'accent' | 'warn' | 'neutral' | 'fail'; text: string }> = {
  none: { status: 'pass', text: 'Nothing to apply for' },
  visa_free: { status: 'pass', text: 'No visa needed' },
  eta: { status: 'accent', text: 'Travel authorisation' },
  visa: { status: 'warn', text: 'Visa required' },
  restricted: { status: 'fail', text: 'Entry may be restricted' },
  not_covered: { status: 'neutral', text: 'Not covered yet' },
  not_eligible: { status: 'fail', text: 'Not eligible for this route' },
};

export function RouteSummary({ route, compact = false }: { route: Route; compact?: boolean }) {
  const pill = KIND[route.kind];
  const facts = [
    route.fee && { k: 'Fee', v: route.fee },
    route.decisionTime && { k: 'Decision', v: route.decisionTime },
    route.maxStay && { k: 'Stay', v: route.maxStay },
    route.applyWindow && { k: 'When', v: route.applyWindow },
    ...(route.extraCosts ?? []).map((v) => ({ k: 'Also', v })),
  ].filter(Boolean) as Array<{ k: string; v: string }>;

  return (
    <div className="grid gap-3">
      <div>
        <StatusPill status={pill.status}>{pill.text}</StatusPill>
      </div>
      <h2 className="font-heading text-2xl font-semibold tracking-tight">{route.title}</h2>
      <p className="text-sm text-muted-foreground">{route.summary}</p>
      {facts.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
          {facts.map((f) => (
            <div key={f.k + f.v} className="rounded-xl bg-foreground/[0.04] px-3 py-2.5 dark:bg-white/[0.04]">
              <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{f.k}</div>
              <div className="mt-0.5 text-sm">{f.v}</div>
            </div>
          ))}
        </div>
      )}
      {!compact && route.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {route.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {route.applyUrl && (
        <div>
          <Button variant="outline" size="sm" asChild>
            <a href={route.applyUrl} target="_blank" rel="noreferrer">
              {route.applyLabel ?? 'Official page'}
              <ArrowUpRight />
            </a>
          </Button>
        </div>
      )}
      {!compact && route.sources.length > 0 && (
        <div className="grid gap-1 pt-1">
          {route.sources.map((s) => (
            <SourceLink key={s.url} source={s} />
          ))}
        </div>
      )}
    </div>
  );
}
