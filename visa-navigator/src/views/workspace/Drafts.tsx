import { Plus, Sparkles, Undo2, Wand2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { polish, suggestPlans, writeCoverLetter } from '@/api';
import { CopyButton, SectionHeader, StatusPill } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { assembleLetter, coverLetterFacts, factsPreview } from '@/drafts/coverLetter';
import { buildDayByDayItinerary, dayPlan, itineraryIssues } from '@/drafts/itinerary';
import { buildCoverLetter, formatDate, hasForbiddenPhrase } from '@/drafts/templates';
import { PURPOSE_LABELS } from '@/rules/types';
import { useHealth } from '@/hooks';
import { newId, type Flight, type ItineraryStop } from '@/store/model';
import type { PanelProps } from './Workspace';

function DraftEditor({
  kind,
  value,
  onChange,
  onBuild,
  buildLabel,
  generate,
}: {
  kind: 'itinerary' | 'cover_letter';
  value: string;
  onChange: (v: string) => void;
  onBuild: () => string;
  buildLabel: string;
  /** Optional AI writer: returns the new text. */
  generate?: { label: string; run: () => Promise<string>; preview: string };
}) {
  const health = useHealth();
  const [busy, setBusy] = useState(false);
  const [previous, setPrevious] = useState<string | null>(null);
  const placeholders = Array.from(new Set(value.match(/\[add [^\]]+\]/g) ?? []));

  async function runGenerate() {
    if (!generate) return;
    setBusy(true);
    try {
      const text = await generate.run();
      setPrevious(value);
      onChange(text);
      toast.success('Draft written from your facts. Read it and edit anything that is not right.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not write the draft.');
    } finally {
      setBusy(false);
    }
  }

  async function runPolish() {
    setBusy(true);
    try {
      const text = await polish(kind, value);
      setPrevious(value);
      onChange(text);
      toast.success('Wording polished. Facts and placeholders are unchanged.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not polish the draft.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => onChange(onBuild())}>{buildLabel}</Button>
        {health?.ai && generate && (
          <Button variant="outline" disabled={busy} onClick={runGenerate}>
            <Wand2 /> {busy ? 'Writing…' : generate.label}
          </Button>
        )}
        {health?.ai && (
          <Button variant="outline" disabled={!value.trim() || busy} onClick={runPolish}>
            <Sparkles /> {busy ? 'Polishing…' : 'Polish wording with AI'}
          </Button>
        )}
        {previous !== null && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(previous);
              setPrevious(null);
            }}
          >
            <Undo2 /> Undo AI change
          </Button>
        )}
        <span className="ml-auto">
          <CopyButton text={value} label="Copy text" />
        </span>
      </div>
      <Textarea aria-label={kind === 'itinerary' ? 'Itinerary text' : 'Cover letter text'} className="min-h-80 rounded-xl leading-relaxed" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Build a draft from your answers, then edit it here." />
      {placeholders.length > 0 && (
        <p className="rounded-xl bg-warning/15 px-3 py-2 text-sm">
          {placeholders.length} thing{placeholders.length > 1 ? 's' : ''} still to fill in: {placeholders.join(', ')}
        </p>
      )}
      {hasForbiddenPhrase(value) && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">Remove wording that promises or predicts a decision.</p>}
      {health?.ai && generate && (
        <details className="rounded-xl border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">What is sent to the AI</summary>
          <pre className="mt-2 text-xs whitespace-pre-wrap">{generate.preview}</pre>
          <p className="mt-1 text-xs text-muted-foreground">Passport number, home address and email are sent as {'{{TOKENS}}'} and filled in on this device.</p>
        </details>
      )}
      <p className="text-xs text-muted-foreground">
        Drafts only use facts you entered. AI changes wording, never facts, and keeps every [add …] placeholder; a letter with a number that is not in your facts is discarded.
        {!health?.ai && ' Without an API key, the template draft and your own edits work the same way.'}
      </p>
    </div>
  );
}

const row = { initial: { opacity: 0, height: 0 }, animate: { opacity: 1, height: 'auto' }, exit: { opacity: 0, height: 0 }, transition: { duration: 0.18 } };

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function Itinerary({ trip, update }: PanelProps) {
  const setStops = (fn: (s: ItineraryStop[]) => ItineraryStop[]) => update((t) => ({ ...t, stops: fn(t.stops) }));
  const setFlights = (fn: (f: Flight[]) => Flight[]) => update((t) => ({ ...t, flights: fn(t.flights) }));
  const editFlight = (id: string, patch: Partial<Flight>) => setFlights((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const editStop = (id: string, patch: Partial<ItineraryStop>) => setStops((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  return (
    <div className="grid gap-6">
      <SectionHeader title="Itinerary" description="Add flights and where you will be each day. The app turns it into a clean itinerary for the whole group." />
      <section className="grid gap-2">
        <h3 className="font-heading font-semibold">Flights</h3>
        <AnimatePresence initial={false}>
          {trip.flights.map((f) => (
            <motion.div key={f.id} {...row} className="overflow-hidden">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[9.5rem_1fr_1fr_7rem_auto]">
                <Input type="date" aria-label="Flight date" className="rounded-xl" value={f.date} onChange={(e) => editFlight(f.id, { date: e.target.value })} />
                <Input aria-label="From" placeholder="From (city or airport)" className="rounded-xl" value={f.from} onChange={(e) => editFlight(f.id, { from: e.target.value })} />
                <Input aria-label="To" placeholder="To" className="rounded-xl" value={f.to} onChange={(e) => editFlight(f.id, { to: e.target.value })} />
                <Input aria-label="Flight number" placeholder="Flight no." className="rounded-xl" value={f.flightNo} onChange={(e) => editFlight(f.id, { flightNo: e.target.value })} />
                <Button variant="ghost" size="icon" aria-label="Remove flight" onClick={() => setFlights((all) => all.filter((x) => x.id !== f.id))}>
                  <X />
                </Button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div>
          <Button variant="outline" size="sm" onClick={() => setFlights((all) => [...all, { id: newId(), date: all.length ? '' : trip.input.departDate ?? '', from: '', to: '', flightNo: '' }])}>
            <Plus /> Add flight
          </Button>
        </div>
      </section>

      <section className="grid gap-2">
        <h3 className="font-heading font-semibold">Days</h3>
        <AnimatePresence initial={false}>
          {trip.stops.map((s) => (
            <motion.div key={s.id} {...row} className="overflow-hidden">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[9.5rem_1fr_1fr_auto]">
                <Input type="date" aria-label="Date" className="rounded-xl" value={s.date} onChange={(e) => editStop(s.id, { date: e.target.value })} />
                <Input aria-label="City" placeholder="City" className="rounded-xl" value={s.city} onChange={(e) => editStop(s.id, { city: e.target.value })} />
                <Input aria-label="Where you are staying" placeholder="Where you are staying" className="rounded-xl" value={s.lodging} onChange={(e) => editStop(s.id, { lodging: e.target.value })} />
                <Button variant="ghost" size="icon" aria-label="Remove day" onClick={() => setStops((all) => all.filter((x) => x.id !== s.id))}>
                  <X />
                </Button>
                <Input aria-label="Plans" placeholder="Plans (optional)" className="col-span-2 rounded-xl sm:col-start-2 sm:col-end-4" value={s.plans} onChange={(e) => editStop(s.id, { plans: e.target.value })} />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setStops((all) => {
                const last = all[all.length - 1];
                const date = last?.date ? addDays(last.date, 1) : trip.input.departDate ?? '';
                return [...all, { id: newId(), date, city: last?.city ?? '', lodging: last?.lodging ?? '', plans: '' }];
              })
            }
          >
            <Plus /> Add day
          </Button>
        </div>
      </section>

      <DayByDay trip={trip} update={update} />

      <section className="grid gap-2">
        <h3 className="font-heading font-semibold">Itinerary document</h3>
        <DraftEditor
          kind="itinerary"
          value={trip.itineraryText}
          onChange={(v) => update((t) => ({ ...t, itineraryText: v }))}
          onBuild={() => buildDayByDayItinerary(trip)}
          buildLabel={trip.itineraryText ? 'Rebuild from my entries' : 'Build itinerary'}
        />
      </section>
    </div>
  );
}

export function CoverLetter({ trip, route, update, jump }: PanelProps) {
  return (
    <div className="grid gap-5">
      <SectionHeader
        title="Cover letter"
        description="Optional. It summarises the trip from the lead traveller’s form answers and mentions everyone travelling together."
        action={
          <Button variant="outline" onClick={() => jump('form')}>
            Open form answers
          </Button>
        }
      />
      <DraftEditor
        kind="cover_letter"
        value={trip.coverLetter}
        onChange={(v) => update((t) => ({ ...t, coverLetter: v }))}
        onBuild={() => buildCoverLetter(trip, route.formId)}
        buildLabel={trip.coverLetter ? 'Rebuild from my answers' : 'Draft from my answers'}
        generate={{
          label: 'Write with AI from my trip',
          preview: factsPreview(coverLetterFacts(trip, route)),
          run: async () => {
            const cf = coverLetterFacts(trip, route);
            return assembleLetter(await writeCoverLetter(cf.facts, cf.missing), cf);
          },
        }}
      />
    </div>
  );
}

/** One row per day of the trip, with the mismatches between days, flights and bookings. */
function DayByDay({ trip, update }: Pick<PanelProps, 'trip' | 'update'>) {
  const health = useHealth();
  const rows = dayPlan(trip);
  const issues = itineraryIssues(trip);
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<Record<string, string>>({});
  const empty = rows.filter((r) => r.city && !r.plans && r.day > 1 && r.day < rows.length);
  const drop = (date: string) =>
    setIdeas((all) => {
      const next = { ...all };
      delete next[date];
      return next;
    });

  async function suggest() {
    setBusy(true);
    try {
      const out = await suggestPlans(PURPOSE_LABELS[trip.input.purpose], empty.map((r) => ({ date: r.date, city: r.city })));
      setIdeas(Object.fromEntries(out.map((d) => [d.date, d.suggestion])));
      if (!out.length) toast.message('No suggestions came back.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not get suggestions.');
    } finally {
      setBusy(false);
    }
  }

  function accept(date: string) {
    const row = rows.find((r) => r.date === date);
    const text = ideas[date];
    if (!row || !text) return;
    update((t) => {
      const existing = t.stops.find((s) => s.date === date);
      const stops = existing
        ? t.stops.map((s) => (s.id === existing.id ? { ...s, plans: text, suggested: true } : s))
        : [...t.stops, { id: newId(), date, city: row.city, lodging: row.lodging, plans: text, suggested: true }];
      return { ...t, stops };
    });
    drop(date);
  }

  if (rows.length === 0) return <p className="rounded-xl bg-warning/15 px-3 py-2 text-sm">Add your travel dates to see the day-by-day plan.</p>;
  return (
    <section className="grid gap-2" aria-label="Day-by-day plan">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-heading font-semibold">Day by day</h3>
        <span className="text-sm text-muted-foreground">
          {rows.length} days, {rows.length - 1} nights. Cities and stays carry over from the last day you entered.
        </span>
        {health?.ai && empty.length > 0 && (
          <Button variant="outline" size="sm" className="ml-auto" disabled={busy} onClick={suggest}>
            <Sparkles /> {busy ? 'Asking…' : `Suggest plans for ${empty.length} free day${empty.length > 1 ? 's' : ''}`}
          </Button>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Day</th>
              <th className="px-3 py-2">City</th>
              <th className="px-3 py-2">Overnight</th>
              <th className="px-3 py-2">Plans and flights</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.date} className="border-t border-border/60 align-top">
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.day}. {formatDate(r.date)}
                </td>
                <td className={r.city ? 'px-3 py-2' : 'px-3 py-2 text-destructive'}>{r.city || 'missing'}</td>
                <td className={i < rows.length - 1 && !r.lodging ? 'px-3 py-2 text-destructive' : 'px-3 py-2'}>{i === rows.length - 1 ? 'departure' : r.lodging || 'missing'}</td>
                <td className="grid gap-1 px-3 py-2">
                  {r.flights.map((f) => (
                    <span key={f.id}>
                      Flight {f.flightNo} {f.from} → {f.to}
                    </span>
                  ))}
                  {r.plans && (
                    <span>
                      {r.plans} {r.suggested && <StatusPill status="accent">suggested</StatusPill>}
                    </span>
                  )}
                  {ideas[r.date] && (
                    <span className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/8 px-2 py-1">
                      <span className="italic">Suggestion: {ideas[r.date]}</span>
                      <Button size="xs" onClick={() => accept(r.date)}>
                        Use
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => drop(r.date)}>
                        Skip
                      </Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {issues.length > 0 ? (
        <ul className="grid gap-1 text-sm" aria-label="Itinerary issues">
          {issues.map((i) => (
            <li key={i.id} className="flex items-start gap-2">
              <StatusPill status={i.level}>{i.level === 'fail' ? 'fix' : 'check'}</StatusPill> {i.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-success">Every day and night is covered, and flights match the trip dates.</p>
      )}
      <p className="text-xs text-muted-foreground">Suggestions are ideas, not bookings: they only appear in your itinerary when you press Use, and they are marked as suggested.</p>
    </section>
  );
}
