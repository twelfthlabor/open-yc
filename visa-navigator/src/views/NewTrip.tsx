import { ArrowLeft, ArrowRight, Minus, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { CountryCombobox } from '@/components/app/CountryCombobox';
import { GlassCard } from '@/components/app/bits';
import { Flag } from '@/components/app/Flag';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { countryName } from '@/data/countries';
import { cn } from '@/lib/utils';
import { isSupportedDestination, resolveRoute } from '@/rules/engine';

// Shown as tiles; every other supported destination (all Schengen states) is in the search with a badge.
const FEATURED = ['SWE', 'GBR', 'USA', 'FRA', 'NLD', 'HRV'];
import { needsBiometricQuestion } from '@/rules/schengen';
import { isSchengenDestination } from '@/rules/schengen-states';
import { PURPOSE_LABELS, type Purpose, type TripInput } from '@/rules/types';
import { useVault } from '@/state/VaultContext';
import { newTrip } from '@/store/model';
import { RouteSummary } from './RouteSummary';

const STEPS = ['Destination', 'Passport', 'Trip', 'Travellers', 'Your route'];
const PURPOSES = Object.keys(PURPOSE_LABELS) as Purpose[];

const slide = {
  initial: (dir: number) => ({ opacity: 0, x: dir * 32 }),
  animate: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -32 }),
};

function Choice({ pressed, onClick, children, className }: { pressed: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'rounded-xl border border-border bg-background/60 px-4 py-3 text-left text-sm transition-colors hover:border-primary/60',
        pressed && 'border-primary bg-primary/10 ring-2 ring-primary/20',
        className,
      )}
    >
      {children}
    </button>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex gap-2">
        <Choice pressed={value === true} onClick={() => onChange(true)} className="min-w-20 text-center">
          Yes
        </Choice>
        <Choice pressed={value === false} onClick={() => onChange(false)} className="min-w-20 text-center">
          No
        </Choice>
      </div>
    </fieldset>
  );
}

export function NewTrip({ initialDestination, onCancel, onCreated }: { initialDestination?: string; onCancel: () => void; onCreated: (id: string) => void }) {
  const vault = useVault();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [input, setInput] = useState<TripInput>({ nationality: '', destination: initialDestination ?? '', purpose: 'tourism', passportType: 'national' });
  const [names, setNames] = useState<string[]>(['']);
  const set = (patch: Partial<TripInput>) => setInput((i) => ({ ...i, ...patch }));

  const route = useMemo(() => (step === 4 ? resolveRoute(input) : null), [step, input]);
  const askBiometric = isSchengenDestination(input.destination) && needsBiometricQuestion(input.nationality);
  const datesValid = !input.departDate || !input.returnDate || input.returnDate >= input.departDate;
  const isVisit = ['tourism', 'business', 'family', 'transit'].includes(input.purpose);

  const canNext = [
    Boolean(input.destination),
    Boolean(input.nationality) && (input.nationality !== 'TWN' || input.taiwanIdOnPassport !== undefined) && (!askBiometric || input.biometricPassport !== undefined),
    Boolean(input.departDate) && datesValid && (input.purpose !== 'youth_mobility' || (Boolean(input.birthDate) && input.hasDependentChildren !== undefined)),
    names.length > 0,
    true,
  ][step];

  const go = (n: number) => {
    setDir(n > step ? 1 : -1);
    setStep(n);
  };

  const create = () => {
    const labels = names.map((n, i) => n.trim() || `Traveller ${i + 1}`);
    const trip = newTrip(input, labels);
    vault.addTrip(trip);
    onCreated(trip.id);
  };

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <ol className="flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={cn('h-1.5 rounded-full bg-border transition-colors', i <= step && 'bg-primary')} />
            <div className={cn('mt-1.5 hidden text-xs text-muted-foreground sm:block', i === step && 'font-medium text-foreground')}>{s}</div>
          </li>
        ))}
      </ol>

      <GlassCard className="overflow-hidden p-6 sm:p-8">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div key={step} custom={dir} variants={slide} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.22, ease: 'easeOut' }} className="grid gap-5">
            {step === 0 && (
              <>
                <div>
                  <h1 className="font-heading text-2xl font-semibold tracking-tight">Where are you going?</h1>
                  <p className="mt-1 text-sm text-muted-foreground">Fully supported destinations have sourced checklists, forms and document checks.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {FEATURED.map((code) => (
                    <Choice key={code} pressed={input.destination === code} onClick={() => set({ destination: code })} className="flex items-center gap-3 p-4">
                      <Flag code={code} className="h-8" />
                      <span>
                        <span className="block font-medium">{countryName(code)}</span>
                        <span className="text-xs text-muted-foreground">Fully supported</span>
                      </span>
                    </Choice>
                  ))}
                </div>
                <CountryCombobox
                  label="Or pick another destination"
                  value={FEATURED.includes(input.destination) ? '' : input.destination}
                  onChange={(destination) => set({ destination })}
                  placeholder="Search all countries"
                  badge={(c) => (isSupportedDestination(c) ? 'Supported' : undefined)}
                />
                {input.destination && !isSupportedDestination(input.destination) && (
                  <p className="rounded-xl bg-warning/15 px-3 py-2 text-sm">
                    {countryName(input.destination)} is not covered yet. You can continue, but the app will not list requirements it cannot source.
                  </p>
                )}
              </>
            )}

            {step === 1 && (
              <>
                <div>
                  <h1 className="font-heading text-2xl font-semibold tracking-tight">Which passport will you travel on?</h1>
                  <p className="mt-1 text-sm text-muted-foreground">Requirements depend on the passport, not where you live. If your group has different passports, create one application per passport.</p>
                </div>
                <CountryCombobox label="Passport country" value={input.nationality} onChange={(nationality) => set({ nationality, biometricPassport: undefined, taiwanIdOnPassport: undefined })} />
                <fieldset className="grid gap-2">
                  <legend className="mb-2 text-sm font-medium">Type of document</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Choice pressed={input.passportType === 'national'} onClick={() => set({ passportType: 'national' })}>
                      <b>National passport</b>
                      <div className="text-xs text-muted-foreground">The usual passport issued by your country.</div>
                    </Choice>
                    <Choice pressed={input.passportType === 'other'} onClick={() => set({ passportType: 'other' })}>
                      <b>Other travel document</b>
                      <div className="text-xs text-muted-foreground">Refugee travel document, emergency passport, or similar.</div>
                    </Choice>
                  </div>
                </fieldset>
                {input.nationality === 'TWN' && (
                  <YesNo label="Does your passport include your national ID card number?" value={input.taiwanIdOnPassport} onChange={(v) => set({ taiwanIdOnPassport: v })} />
                )}
                {askBiometric && (
                  <YesNo
                    label="Is your passport biometric? (It has the chip symbol on the cover.)"
                    value={input.biometricPassport}
                    onChange={(v) => set({ biometricPassport: v })}
                  />
                )}
              </>
            )}

            {step === 2 && (
              <>
                <div>
                  <h1 className="font-heading text-2xl font-semibold tracking-tight">What is the trip for?</h1>
                  <p className="mt-1 text-sm text-muted-foreground">The reason and dates decide which permission you need.</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PURPOSES.map((p) => (
                    <Choice key={p} pressed={input.purpose === p} onClick={() => set({ purpose: p })}>
                      {PURPOSE_LABELS[p]}
                    </Choice>
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="depart">{isVisit ? 'Arrival date' : 'Planned start date'}</Label>
                    <Input id="depart" type="date" className="h-11 rounded-xl" value={input.departDate ?? ''} onChange={(e) => set({ departDate: e.target.value || undefined })} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="return">{isVisit ? 'Departure date' : 'Planned end date (optional)'}</Label>
                    <Input id="return" type="date" className="h-11 rounded-xl" value={input.returnDate ?? ''} onChange={(e) => set({ returnDate: e.target.value || undefined })} />
                  </div>
                </div>
                {!datesValid && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">The end date is before the start date.</p>}
                {input.purpose === 'youth_mobility' && (
                  <>
                    <div className="grid gap-2">
                      <Label htmlFor="dob">Date of birth</Label>
                      <Input id="dob" type="date" className="h-11 rounded-xl" value={input.birthDate ?? ''} onChange={(e) => set({ birthDate: e.target.value || undefined })} />
                    </div>
                    <YesNo
                      label="Do you have children under 18 who live with you, or that you are financially responsible for?"
                      value={input.hasDependentChildren}
                      onChange={(v) => set({ hasDependentChildren: v })}
                    />
                  </>
                )}
              </>
            )}

            {step === 3 && (
              <>
                <div>
                  <h1 className="font-heading text-2xl font-semibold tracking-tight">Who is travelling?</h1>
                  <p className="mt-1 text-sm text-muted-foreground">Apply together: shared answers like hotel and dates are entered once for everyone.</p>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="icon" aria-label="Remove a traveller" disabled={names.length <= 1} onClick={() => setNames((n) => n.slice(0, -1))}>
                    <Minus />
                  </Button>
                  <span className="min-w-24 text-center text-lg font-semibold tabular-nums">
                    {names.length} traveller{names.length > 1 ? 's' : ''}
                  </span>
                  <Button variant="outline" size="icon" aria-label="Add a traveller" disabled={names.length >= 9} onClick={() => setNames((n) => [...n, ''])}>
                    <Plus />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {names.map((n, i) => (
                    <div key={i} className="grid gap-2">
                      <Label htmlFor={`traveller-${i}`}>{i === 0 ? 'Lead traveller' : `Traveller ${i + 1}`}</Label>
                      <Input
                        id={`traveller-${i}`}
                        className="h-11 rounded-xl"
                        placeholder={`Traveller ${i + 1}`}
                        value={n}
                        onChange={(e) => setNames((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {step === 4 && route && (
              <>
                <div className="text-xs text-muted-foreground">
                  {countryName(input.nationality)} passport → {countryName(input.destination)} · {PURPOSE_LABELS[input.purpose]} · {names.length} traveller
                  {names.length > 1 ? 's' : ''}
                </div>
                <RouteSummary route={route} />
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </GlassCard>

      <div className="flex justify-between gap-3">
        <Button variant="outline" size="lg" className="rounded-xl" onClick={() => (step === 0 ? onCancel() : go(step - 1))}>
          <ArrowLeft />
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {step < 4 ? (
          <Button size="lg" className="rounded-xl" disabled={!canNext} onClick={() => go(step + 1)}>
            {step === 3 ? 'See what we need' : 'Continue'}
            <ArrowRight />
          </Button>
        ) : (
          route &&
          route.features.length > 0 && (
            <Button size="lg" className="rounded-xl" onClick={create}>
              Start this application
              <ArrowRight />
            </Button>
          )
        )}
      </div>
    </div>
  );
}
