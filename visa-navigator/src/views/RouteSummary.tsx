import { ArrowUpRight, ChevronDown } from 'lucide-react';
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

export function RouteSummary({ route, compact = false, headless = false }: { route: Route; compact?: boolean; headless?: boolean }) {
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
      {!headless && (
        <>
          <div>
            <StatusPill status={pill.status}>{pill.text}</StatusPill>
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">{route.title}</h2>
        </>
      )}
      <p className="text-sm text-muted-foreground">{route.summary}</p>
      {facts.length > 0 && (
        // flex-wrap with grow, so a last row with one tile fills the width instead of leaving a hole
        <div className="flex flex-wrap gap-2">
          {facts.map((f) => (
            <div key={f.k + f.v} className="min-w-0 flex-[1_1_10rem] rounded-xl bg-foreground/[0.04] px-3 py-2.5 dark:bg-white/[0.04]">
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

/** One line for the top of a workspace section: status, title and a toggle for the full summary. */
export function RouteHeadline({ route, expanded, onToggle }: { route: Route; expanded: boolean; onToggle: () => void }) {
  const pill = KIND[route.kind];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <StatusPill status={pill.status}>{pill.text}</StatusPill>
      <h2 className="min-w-0 font-heading text-lg font-semibold tracking-tight">{route.title}</h2>
      <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" aria-expanded={expanded} onClick={onToggle}>
        {expanded ? 'Hide visa details' : 'Visa details'}
        <ChevronDown className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </Button>
    </div>
  );
}
