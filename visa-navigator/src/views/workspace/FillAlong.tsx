import { ArrowLeft, ArrowRight, ArrowUpRight, ListChecks, MousePointerClick } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { CopyButton, ProgressRing, SectionHeader, SourceLink, StatusPill } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { allFields, fieldValue, formFor, formProgress, isDerived, type FormField } from '@/forms/forms';
import { cn } from '@/lib/utils';
import { travellerName, type Traveller, type Trip } from '@/store/model';
import { AutoFill } from './AutoFill';
import { portalFor } from '@/autofill/portals';
import type { PanelProps } from './Workspace';

export function FieldInput({ field, value, onChange, id, large }: { field: FormField; value: string; onChange: (v: string) => void; id: string; large?: boolean }) {
  if (field.type === 'select') {
    return (
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={id} className={cn('w-full rounded-xl', large ? 'h-12 text-base' : 'h-10')}>
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {field.options!.filter(Boolean).map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (field.type === 'textarea') return <Textarea id={id} className={cn('rounded-xl', large && 'min-h-28 text-base')} value={value} onChange={(e) => onChange(e.target.value)} />;
  return <Input id={id} type={field.type ?? 'text'} className={cn('rounded-xl', large ? 'h-12 text-base' : 'h-10')} value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function FillAlong({ trip, route, update }: PanelProps) {
  const form = formFor(route);
  const [tid, setTid] = useState(trip.travellers[0]?.id);
  const [mode, setMode] = useState<'all' | 'step'>('all');
  const [index, setIndex] = useState(0);
  const traveller = trip.travellers.find((t) => t.id === tid) ?? trip.travellers[0];
  const fields = useMemo(() => (form ? allFields(form) : []), [form]);

  useEffect(() => setIndex(0), [tid]);

  if (!form || !traveller) return <p className="text-sm text-muted-foreground">This route has no application form to prepare.</p>;

  const setAnswer = (fieldId: string, value: string) =>
    update((t) => ({ ...t, travellers: t.travellers.map((x) => (x.id === traveller.id ? { ...x, answers: { ...x.answers, [fieldId]: value } } : x)) }));
  const progress = formProgress(trip, traveller, form);

  return (
    <div className="grid gap-5">
      <SectionHeader
        title={form.title}
        description={
          <>
            {form.where}{' '}
            {form.official ? 'Numbers match the official form.' : 'These are common questions, not an official field list.'}
          </>
        }
        action={
          route.applyUrl && (
            <Button variant="outline" asChild>
              <a href={route.applyUrl} target="_blank" rel="noreferrer">
                {route.applyLabel ?? 'Open the official form'} <ArrowUpRight />
              </a>
            </Button>
          )
        }
      />
      {form.source && <SourceLink source={form.source} className="-mt-3" />}

      <div className="flex flex-wrap items-center gap-2">
        {trip.travellers.map((t) => {
          const p = formProgress(trip, t, form);
          return (
            <Button key={t.id} variant={t.id === traveller.id ? 'default' : 'outline'} size="sm" onClick={() => setTid(t.id)} aria-pressed={t.id === traveller.id}>
              {travellerName(t)}
              <span className="text-xs opacity-75 tabular-nums">
                {p.done}/{p.total}
              </span>
            </Button>
          );
        })}
        <div className="ml-auto flex rounded-xl border border-border p-0.5">
          <Button variant={mode === 'all' ? 'secondary' : 'ghost'} size="sm" onClick={() => setMode('all')} aria-pressed={mode === 'all'}>
            <ListChecks /> All answers
          </Button>
          <Button variant={mode === 'step' ? 'secondary' : 'ghost'} size="sm" onClick={() => setMode('step')} aria-pressed={mode === 'step'}>
            <MousePointerClick /> Fill-along
          </Button>
        </div>
      </div>

      {(() => {
        const portal = portalFor(form.id, trip.input.destination);
        return portal ? <AutoFill trip={trip} route={route} traveller={traveller} form={form} portal={portal} update={update} /> : null;
      })()}

      <div className="flex items-center gap-3 rounded-xl bg-primary/6 px-4 py-3">
        <ProgressRing value={progress.total ? progress.done / progress.total : 0} size={44} />
        <div className="text-sm">
          <div className="font-medium">
            {progress.done} of {progress.total} required answers ready for {travellerName(traveller)}
          </div>
          <div className="text-xs text-muted-foreground">
            Answers from the passport and trip are filled in for you. Shared answers (hotel, dates) are entered once on the lead traveller.
          </div>
        </div>
      </div>

      {mode === 'all' ? (
        <div className="grid gap-6">
          {form.sections.map((s) => (
            <section key={s.id} className="grid gap-3">
              <h3 className="font-heading font-semibold">{s.title}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {s.fields.map((f) => (
                  <AnswerRow key={f.id} trip={trip} traveller={traveller} field={f} onChange={(v) => setAnswer(f.id, v)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <StepMode trip={trip} traveller={traveller} fields={fields} index={index} setIndex={setIndex} setAnswer={setAnswer} />
      )}
    </div>
  );
}

function AnswerRow({ trip, traveller, field, onChange }: { trip: Trip; traveller: Traveller; field: FormField; onChange: (v: string) => void }) {
  const value = fieldValue(trip, traveller, field);
  const id = `f-${traveller.id}-${field.id}`;
  const sharedFromLead = field.shared && trip.travellers[0]?.id !== traveller.id && !traveller.answers[field.id] && Boolean(value);
  return (
    <div className={cn('grid gap-1.5', field.type === 'textarea' && 'sm:col-span-2')}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="flex flex-wrap items-center gap-1.5">
          {field.number && <span className="text-xs text-muted-foreground tabular-nums">{field.number}.</span>}
          {field.label}
          {isDerived(trip, traveller, field) && <StatusPill status="accent">auto</StatusPill>}
          {sharedFromLead && <StatusPill status="neutral">from lead</StatusPill>}
          {field.optional && <span className="text-xs font-normal text-muted-foreground">optional</span>}
        </Label>
        <CopyButton text={value} className="h-7" />
      </div>
      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
      <FieldInput id={id} field={field} value={value} onChange={onChange} />
    </div>
  );
}

function StepMode({
  trip,
  traveller,
  fields,
  index,
  setIndex,
  setAnswer,
}: {
  trip: Trip;
  traveller: Traveller;
  fields: FormField[];
  index: number;
  setIndex: (n: number) => void;
  setAnswer: (id: string, v: string) => void;
}) {
  const field = fields[Math.min(index, fields.length - 1)];
  const value = fieldValue(trip, traveller, field);
  const id = `step-${traveller.id}-${field.id}`;
  const next = () => setIndex(Math.min(index + 1, fields.length - 1));
  const prev = () => setIndex(Math.max(index - 1, 0));

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        Field {index + 1} of {fields.length}
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
          <motion.div className="h-full bg-primary" animate={{ width: `${((index + 1) / fields.length) * 100}%` }} transition={{ type: 'spring', stiffness: 160, damping: 24 }} />
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={field.id} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.18 }} className="grid gap-3 rounded-2xl border border-border bg-background/50 p-5">
          <Label htmlFor={id} className="flex flex-wrap items-center gap-2 text-base">
            {field.number && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary tabular-nums">Field {field.number}</span>}
            {field.label}
            {field.optional && <span className="text-xs font-normal text-muted-foreground">optional</span>}
          </Label>
          {field.hint && <p className="text-sm text-muted-foreground">{field.hint}</p>}
          <FieldInput id={id} field={field} value={value} onChange={(v) => setAnswer(field.id, v)} large />
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={value} label="Copy answer" />
            <span className="text-xs text-muted-foreground">Paste it into the official form, then go to the next field.</span>
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="flex justify-between gap-2">
        <Button variant="outline" onClick={prev} disabled={index === 0}>
          <ArrowLeft /> Previous
        </Button>
        <Button onClick={next} disabled={index >= fields.length - 1}>
          Next field <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
