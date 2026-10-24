import { ArrowRight, Lock, Users } from 'lucide-react';
import { ProgressRing, StatusPill } from '@/components/app/bits';
import { Flag } from '@/components/app/Flag';
import { AnimatedShinyText } from '@/components/ui/animated-shiny-text';
import { BlurFade } from '@/components/ui/blur-fade';
import { BorderBeam } from '@/components/ui/border-beam';
import { Button } from '@/components/ui/button';
import { Marquee } from '@/components/ui/marquee';
import { MagicCard } from '@/components/ui/magic-card';
import { NumberTicker } from '@/components/ui/number-ticker';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { countryName } from '@/data/countries';
import { formatDate } from '@/drafts/templates';
import { flagLoader } from '@/flags/flags';
import { GlobeSlot } from '@/globe/GlobeSlot';
import { resolveRoute } from '@/rules/engine';
import { SCHENGEN_ANNEX_I } from '@/rules/schengen';
import { PURPOSE_LABELS } from '@/rules/types';
import { UK_VISA_NATIONALS } from '@/rules/uk';
import { useHealth } from '@/hooks';
import { useVault } from '@/state/VaultContext';
import { DESTINATIONS, packageItems, serviceLabel } from './homeCards';
import { tripProgress } from './workspace/progress';

const STATUS_LABEL = { preparing: 'Preparing', submitted: 'Submitted', appointment: 'Appointment booked', decided: 'Decision received' };

// Only nationalities that have a flag, so the strip never shows a bare code.
const SCHENGEN_FLAGS = [...SCHENGEN_ANNEX_I].filter((code) => flagLoader(code));

export function Home({ onNew, onOpen }: { onNew: (destination?: string) => void; onOpen: (id: string) => void }) {
  const { data } = useVault();
  const health = useHealth();
  const latest = data.trips[0];
  const features = packageItems(health?.ai ?? null);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-14">
      <section className="grid items-center gap-8 pt-4 md:grid-cols-[1.15fr_0.85fr]">
        <BlurFade>
          <div className="glass-subtle mb-5 inline-flex rounded-full px-1 py-1">
            <AnimatedShinyText className="inline-flex items-center gap-1.5 px-3 text-xs font-medium">
              <Lock className="size-3" /> Free · private · encrypted on your device
            </AnimatedShinyText>
          </div>
          <h1 className="font-heading text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl">
            Your visa, handled{' '}
            <span className="bg-gradient-to-r from-primary via-sky-500 to-violet-500 bg-clip-text text-transparent">calmly</span>.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-pretty text-muted-foreground">
            Tell us your passport and destination. Visa Navigator works out what you need, checks every document against the official requirement, prepares every form answer, and
            keeps you on top of appointments and deadlines.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <ShimmerButton background="var(--primary)" shimmerColor="#ffffff" className="h-12 px-6 text-base font-medium" onClick={() => onNew()}>
              Start an application <ArrowRight className="ml-2 size-4" />
            </ShimmerButton>
            <span className="text-sm text-muted-foreground">No account, no fees.</span>
          </div>
          <div className="mt-8 flex flex-wrap gap-6 text-sm">
            <div>
              <div className="font-heading text-2xl font-semibold tabular-nums">
                <NumberTicker value={SCHENGEN_ANNEX_I.size} />
              </div>
              <div className="text-muted-foreground">nationalities that need a Schengen visa</div>
            </div>
            <div>
              <div className="font-heading text-2xl font-semibold tabular-nums">
                <NumberTicker value={UK_VISA_NATIONALS.size} />
              </div>
              <div className="text-muted-foreground">visa nationalities for the UK</div>
            </div>
            <div>
              <div className="font-heading text-2xl font-semibold tabular-nums">
                <NumberTicker value={32} />
              </div>
              <div className="text-muted-foreground">Schengen form fields prepared</div>
            </div>
          </div>
        </BlurFade>
        <BlurFade delay={0.15} className="mx-auto w-full max-w-sm md:max-w-md">
          <GlobeSlot from={latest?.input.nationality} to={latest?.input.destination} />
        </BlurFade>
      </section>

      <section aria-hidden="true" className="grid min-w-0 gap-3 overflow-hidden -mx-4 sm:-mx-6">
        <p className="text-center text-xs font-medium tracking-widest text-muted-foreground uppercase">Passports that need a Schengen visa</p>
        <Marquee pauseOnHover repeat={2} className="[--duration:60s] [--gap:0.75rem]">
          {SCHENGEN_FLAGS.map((code) => (
            <span key={code} className="glass-subtle flex items-center gap-2 rounded-full py-1.5 pr-4 pl-2 text-sm font-medium">
              <Flag code={code} className="h-4" />
              {countryName(code)}
            </span>
          ))}
        </Marquee>
      </section>

      {data.trips.length > 0 && (
        <section className="grid gap-4">
          <h2 className="font-heading text-xl font-semibold tracking-tight">Your applications</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.trips.map((t, i) => {
              const route = resolveRoute(t.input);
              const pct = tripProgress(t, route);
              return (
                <BlurFade key={t.id} delay={0.04 * i}>
                  <button type="button" onClick={() => onOpen(t.id)} className="trip-card glass group grid w-full gap-3 rounded-2xl p-5 text-left transition-transform hover:-translate-y-0.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-xs text-muted-foreground">
                        {countryName(t.input.nationality)} → {countryName(t.input.destination)}
                      </div>
                      <ProgressRing value={pct} size={44} />
                    </div>
                    <div className="font-heading text-base font-semibold">{route.title}</div>
                    <div className="text-sm text-muted-foreground">
                      {PURPOSE_LABELS[t.input.purpose]}
                      {t.input.departDate && ` · ${formatDate(t.input.departDate)}`}
                    </div>
                    <div className="flex items-center justify-between">
                      <StatusPill status="accent">{STATUS_LABEL[t.tracker.status]}</StatusPill>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="size-3.5" /> {t.travellers.length}
                      </span>
                    </div>
                  </button>
                </BlurFade>
              );
            })}
          </div>
        </section>
      )}

      <section className="grid gap-5">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Destinations</h2>
          <p className="mt-1 text-muted-foreground">
            Every package is free. France and the Netherlands get the paperwork packet (answers, cover letter, itinerary and checklist); you make the booking on the official system. Apply together with family or friends in one application.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {DESTINATIONS.map((d, i) => (
            <BlurFade key={d.code} delay={0.05 * i}>
              <MagicCard className="relative h-full overflow-hidden rounded-3xl" gradientFrom="var(--primary)" gradientTo="var(--success)" gradientColor="color-mix(in oklab, var(--primary) 18%, transparent)">
                {d.popular && <BorderBeam size={160} duration={10} colorFrom="var(--primary)" colorTo="#38bdf8" />}
                <div className="grid h-full gap-5 p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Flag code={d.code} className="h-9" />
                      <div>
                        <div className="font-heading text-xl font-semibold">{d.name}</div>
                        <div className="text-sm text-muted-foreground">{d.tag}</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusPill status={serviceLabel(d.code) === 'Full service' ? 'accent' : 'neutral'}>{serviceLabel(d.code)}</StatusPill>
                      {d.popular && <StatusPill status="pass">Most popular</StatusPill>}
                    </div>
                  </div>
                  <div>
                    <span className="font-heading text-4xl font-semibold">Free</span>
                    <span className="ml-2 text-sm text-muted-foreground">per person</span>
                    <div className="text-xs text-muted-foreground">Embassy or government fees are paid separately to the official authority.</div>
                  </div>
                  <ul className="grid gap-2.5">
                    {features.map((p) => (
                      <li key={p.text} className="flex items-center gap-2.5 text-sm">
                        <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
                          <p.icon className="size-4" />
                        </span>
                        {p.text}
                      </li>
                    ))}
                  </ul>
                  <Button size="lg" className="mt-auto h-11 rounded-xl text-base" onClick={() => onNew(d.code)}>
                    Apply for {d.name}
                    <ArrowRight />
                  </Button>
                </div>
              </MagicCard>
            </BlurFade>
          ))}
        </div>
      </section>
    </div>
  );
}
