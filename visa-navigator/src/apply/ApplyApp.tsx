// The customer side of the hosted service: sign in, then three steps, then a status page.
// 1. Where and when. 2. Passport and details. 3. Pick a time (and agree to the declaration).
// Everything else (itinerary, cover letter, filing, booking) is done for the customer after review.

import { ArrowLeft, ArrowRight, Check, CircleAlert, Download, FileUp, LogOut, Mail, Plus, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CountryCombobox } from '@/components/app/CountryCombobox';
import { FileDrop, GlassCard, prepareFile, StatusPill } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { countryName } from '@/data/countries';
import { buildCoverLetter, buildItinerary, formatDate, localISODate } from '@/drafts/templates';
import { allFields, fieldValue, formFor, isDerived, type FormField } from '@/forms/forms';
import { resolveRoute } from '@/rules/engine';
import { PURPOSE_LABELS, type Purpose, type Route, type TripInput } from '@/rules/types';
import { consentText, DECLARATIONS } from '@/service/declarations';
import { missingForReview } from '@/service/ready';
import { travellerName, type DocumentRecord, type PassportRecord, type Traveller, type Trip } from '@/store/model';
import { RouteSummary } from '@/views/RouteSummary';
import { FieldInput } from '@/views/workspace/FillAlong';
import { PassportForm, type PassportIO } from '@/views/workspace/PassportReader';
import { STATUS_TEXT, svc, SvcError, type Application } from './svc';

const DESTINATIONS = [
  { code: 'HRV', name: 'Croatia (Schengen)' },
  { code: 'GBR', name: 'United Kingdom' },
];
const PURPOSES: Purpose[] = ['tourism', 'business', 'family'];
const UPLOAD_HELPERS = new Set(['funds', 'insurance', 'accommodation', 'ticket', 'photo']);

type View = { name: 'loading' } | { name: 'signin' } | { name: 'home' } | { name: 'new' } | { name: 'app'; id: string; step: 2 | 3 | 'status' };

export function ApplyApp() {
  const [view, setView] = useState<View>({ name: 'loading' });
  const [email, setEmail] = useState('');

  useEffect(() => {
    svc
      .me()
      .then((me) => {
        if (me.role !== 'customer') return setView({ name: 'signin' });
        setEmail(me.email ?? '');
        setView({ name: 'home' });
      })
      .catch(() => setView({ name: 'signin' }));
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  const signOut = async () => {
    await svc.logout().catch(() => {});
    setEmail('');
    setView({ name: 'signin' });
  };

  return (
    <>
      <div className="aurora" aria-hidden="true" />
      <div className="mx-auto grid min-h-dvh max-w-3xl content-start gap-6 px-4 py-8 sm:py-12">
        <header className="flex items-center justify-between gap-3">
          <button className="font-heading text-lg font-semibold tracking-tight" onClick={() => email && setView({ name: 'home' })}>
            Visa Navigator
          </button>
          {email && (
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut /> Sign out
            </Button>
          )}
        </header>
        {view.name === 'signin' && <SignIn />}
        {view.name === 'home' && <Home onNew={() => setView({ name: 'new' })} onOpen={(a) => setView({ name: 'app', id: a.id, step: a.status === 'draft' ? 2 : 'status' })} />}
        {view.name === 'new' && <StepWhere onBack={() => setView({ name: 'home' })} onCreated={(a) => setView({ name: 'app', id: a.id, step: 2 })} />}
        {view.name === 'app' && <ApplicationView id={view.id} step={view.step} go={(step) => setView({ name: 'app', id: view.id, step })} home={() => setView({ name: 'home' })} />}
      </div>
    </>
  );
}

function Steps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Where and when', 'Passport and details', 'Pick a time'];
  return (
    <ol className="flex flex-wrap gap-2 text-sm" aria-label="Steps">
      {steps.map((s, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        return (
          <li
            key={s}
            aria-current={n === current ? 'step' : undefined}
            className={`flex items-center gap-2 rounded-full px-3 py-1 ${n === current ? 'bg-primary text-primary-foreground' : n < current ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground'}`}
          >
            <span className="tabular-nums">{n < current ? <Check className="size-3.5" /> : n}</span> {s}
          </li>
        );
      })}
    </ol>
  );
}

// ---- sign in ----

function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const expired = new URLSearchParams(location.search).get('signin') === 'expired';

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await svc.requestLink(email);
      setSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard className="grid gap-5 p-6 sm:p-8">
      <div className="grid gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Your visa, done for you</h1>
        <p className="text-muted-foreground">
          Three steps: tell us where you are going, add your passport and a few details, and pick a time. A person checks everything, then we fill in the official application and book your
          appointment. Free.
        </p>
      </div>
      {expired && <p className="rounded-xl bg-warning/15 px-3 py-2 text-sm">That sign-in link has expired or was already used. Send a new one.</p>}
      {sent ? (
        <p className="flex items-start gap-2 rounded-xl bg-primary/8 px-4 py-3">
          <Mail className="mt-0.5 size-4 shrink-0 text-primary" /> Check your email ({email}) for a sign-in link. It works once and expires in 15 minutes.
        </p>
      ) : (
        <form onSubmit={send} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoComplete="email" className="h-11 rounded-xl" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit" size="lg" disabled={busy}>
            Email me a sign-in link
          </Button>
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        Your passport and answers are encrypted on our server and deleted 30 days after your decision. Passport photos are read by AI (Anthropic) to save you typing. We do not give legal advice and
        cannot promise a decision.
      </p>
    </GlassCard>
  );
}

// ---- home ----

function Home({ onNew, onOpen }: { onNew: () => void; onOpen: (a: Application) => void }) {
  const [apps, setApps] = useState<Application[] | null>(null);
  useEffect(() => {
    svc
      .list()
      .then((list) => {
        setApps(list);
        if (!list.length) onNew();
      })
      .catch((err) => toast.error(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!apps) return null;
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Your applications</h1>
        <Button onClick={onNew}>
          <Plus /> New application
        </Button>
      </div>
      {apps.map((a) => (
        <button key={a.id} onClick={() => onOpen(a)} className="text-left">
          <GlassCard className="flex flex-wrap items-center gap-3 p-4 transition-colors hover:border-primary/40">
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {countryName(a.trip.input.destination)} · {formatDate(a.trip.input.departDate)}
              </div>
              <div className="text-sm text-muted-foreground">{a.trip.travellers.map(travellerName).join(', ')}</div>
            </div>
            <StatusPill status={a.status === 'returned' ? 'warn' : a.status === 'decided' || a.status === 'filed' || a.status === 'appointment' ? 'pass' : 'accent'}>{STATUS_TEXT[a.status].label}</StatusPill>
          </GlassCard>
        </button>
      ))}
    </div>
  );
}

// ---- step 1 ----

function StepWhere({ onBack, onCreated }: { onBack: () => void; onCreated: (a: Application) => void }) {
  const [input, setInput] = useState<TripInput>({ nationality: '', destination: 'HRV', purpose: 'tourism', passportType: 'national' });
  const [travellers, setTravellers] = useState(1);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<TripInput>) => setInput((i) => ({ ...i, ...p }));
  const complete = Boolean(input.nationality && input.destination && input.departDate && input.returnDate && input.returnDate >= input.departDate);
  const route = useMemo(() => (complete ? resolveRoute(input) : null), [complete, input]);
  const fileable = Boolean(route?.formId);

  const create = async () => {
    setBusy(true);
    try {
      onCreated(await svc.create(input, travellers));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the application.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <Steps current={1} />
      <GlassCard className="grid gap-5 p-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Where are you going?</h1>
        <div className="grid gap-2">
          <Label>Destination</Label>
          <div className="flex flex-wrap gap-2">
            {DESTINATIONS.map((d) => (
              <Button key={d.code} variant={input.destination === d.code ? 'default' : 'outline'} aria-pressed={input.destination === d.code} onClick={() => set({ destination: d.code })}>
                {d.name}
              </Button>
            ))}
          </div>
        </div>
        <CountryCombobox label="Your passport" value={input.nationality} onChange={(nationality) => set({ nationality })} />
        <div className="grid gap-2">
          <Label>Reason for the trip</Label>
          <div className="flex flex-wrap gap-2">
            {PURPOSES.map((p) => (
              <Button key={p} variant={input.purpose === p ? 'default' : 'outline'} size="sm" aria-pressed={input.purpose === p} onClick={() => set({ purpose: p })}>
                {PURPOSE_LABELS[p]}
              </Button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="depart">Leaving</Label>
            <Input id="depart" type="date" min={localISODate()} className="h-10 rounded-xl" value={input.departDate ?? ''} onChange={(e) => set({ departDate: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="return">Coming back</Label>
            <Input id="return" type="date" min={input.departDate ?? localISODate()} className="h-10 rounded-xl" value={input.returnDate ?? ''} onChange={(e) => set({ returnDate: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="people">Travellers</Label>
            <Input id="people" type="number" min={1} max={6} className="h-10 rounded-xl" value={travellers} onChange={(e) => setTravellers(Math.max(1, Math.min(6, Number(e.target.value) || 1)))} />
          </div>
        </div>
      </GlassCard>

      {route && (
        <GlassCard className="p-6">
          <RouteSummary route={route} compact />
          {!fileable && (
            <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-sm">
              {route.kind === 'visa_free' || route.kind === 'none' ? 'Good news: there is nothing for us to file for this trip.' : 'We cannot file this one for you yet.'}
            </p>
          )}
        </GlassCard>
      )}

      <div className="flex justify-between gap-2">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
        <Button size="lg" disabled={!complete || !fileable || busy} onClick={create}>
          Next: your passport <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

// ---- steps 2, 3 and status ----

function useApplication(id: string) {
  const [app, setApp] = useState<Application | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const pending = useRef<Trip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    svc
      .get(id)
      .then(setApp)
      .catch((err) => toast.error(err.message));
  }, [id]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const trip = pending.current;
    if (!trip) return;
    pending.current = null;
    setSaving('saving');
    try {
      await svc.saveTrip(id, trip);
      setSaving('saved');
    } catch (err) {
      setSaving('error');
      toast.error(err instanceof Error ? err.message : 'Could not save.');
    }
  }, [id]);

  const update = useCallback(
    (patch: (t: Trip) => Trip) => {
      setApp((a) => {
        if (!a) return a;
        const trip = patch(a.trip);
        pending.current = trip;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), 700);
        return { ...a, trip };
      });
    },
    [flush],
  );

  useEffect(() => () => void flush(), [flush]);
  return { app, setApp, update, flush, saving };
}

function ApplicationView({ id, step, go, home }: { id: string; step: 2 | 3 | 'status'; go: (s: 2 | 3 | 'status') => void; home: () => void }) {
  const { app, setApp, update, flush, saving } = useApplication(id);
  if (!app) return null;
  const route = resolveRoute(app.trip.input);
  const editable = app.status === 'draft' || app.status === 'returned';
  if (step === 'status' || !editable) return <StatusView app={app} route={route} onEdit={() => go(2)} home={home} />;
  if (step === 2) {
    return (
      <StepPassport
        app={app}
        route={route}
        update={update}
        saving={saving}
        next={async () => {
          await flush();
          go(3);
        }}
        back={async () => {
          await flush();
          home();
        }}
      />
    );
  }
  return (
    <StepTime
      app={app}
      route={route}
      back={() => go(2)}
      done={(a) => {
        setApp(a);
        go('status');
      }}
      flush={flush}
    />
  );
}

/** Questions this traveller answers: not worked out from the passport or trip; shared ones only on the lead traveller. */
function questionsFor(trip: Trip, t: Traveller, route: Route): FormField[] {
  const form = formFor(route);
  if (!form) return [];
  const lead = trip.travellers[0]?.id === t.id;
  return allFields(form).filter((f) => !isDerived(trip, t, f) && (lead || !f.shared));
}

function StepPassport({ app, route, update, saving, next, back }: { app: Application; route: Route; update: (p: (t: Trip) => Trip) => void; saving: string; next: () => void; back: () => void }) {
  const [tid, setTid] = useState(app.trip.travellers[0].id);
  const [ai, setAi] = useState<boolean | null>(null);
  const [editingPassport, setEditingPassport] = useState(false);
  const trip = app.trip;
  const traveller = trip.travellers.find((t) => t.id === tid) ?? trip.travellers[0];

  useEffect(() => {
    svc
      .config()
      .then((c) => setAi(c.ai))
      .catch(() => setAi(false));
  }, []);

  const io: PassportIO = {
    ai,
    saveImage: async (img) => (await svc.upload(app.id, { kind: 'passport', mediaType: img.mediaType, name: 'passport.jpg', data: img.base64, travellerId: traveller.id })).id,
    readImage: async (fileId) => svc.fileUrl(app.id, fileId),
    extract: (base64, mediaType) => svc.extractPassport(app.id, base64, mediaType),
    storageHint: 'Encrypted on our server; only you and the reviewer can see it.',
  };

  const setTraveller = (patch: (t: Traveller) => Traveller) => update((tr) => ({ ...tr, travellers: tr.travellers.map((x) => (x.id === traveller.id ? patch(x) : x)) }));
  const savePassport = (p: PassportRecord) => {
    setTraveller((t) => ({ ...t, passport: p }));
    setEditingPassport(false);
  };
  const setAnswer = (fieldId: string, v: string) => setTraveller((t) => ({ ...t, answers: { ...t.answers, [fieldId]: v } }));

  const questions = questionsFor(trip, traveller, route);
  const required = questions.filter((f) => !f.optional);
  const optional = questions.filter((f) => f.optional);
  const missing = missingForReview(trip, route);
  const docs = route.checklist.filter((c) => c.helper && UPLOAD_HELPERS.has(c.helper) && (c.perTraveller || traveller.id === trip.travellers[0].id));

  const upload = async (itemId: string, perTraveller: boolean, file: File) => {
    try {
      const f = await prepareFile(file);
      const { id: fileId } = await svc.upload(app.id, { kind: 'document', mediaType: f.mediaType, name: file.name.slice(0, 120), data: f.base64, travellerId: perTraveller ? traveller.id : undefined, itemId });
      const rec: DocumentRecord = { id: fileId, fileName: file.name, mediaType: f.mediaType, size: file.size, uploadedAt: new Date().toISOString() };
      if (perTraveller) setTraveller((t) => ({ ...t, documents: { ...t.documents, [itemId]: rec } }));
      else update((tr) => ({ ...tr, sharedDocuments: { ...tr.sharedDocuments, [itemId]: rec } }));
      toast.success('Uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not upload.');
    }
  };

  return (
    <div className="grid gap-5">
      <Steps current={2} />
      {app.status === 'returned' && app.note && (
        <p className="flex items-start gap-2 rounded-xl bg-warning/15 px-4 py-3">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>The reviewer asked:</strong> {app.note}
          </span>
        </p>
      )}
      {trip.travellers.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {trip.travellers.map((t) => (
            <Button key={t.id} variant={t.id === traveller.id ? 'default' : 'outline'} size="sm" onClick={() => setTid(t.id)} aria-pressed={t.id === traveller.id}>
              {travellerName(t)} {t.passport && <Check />}
            </Button>
          ))}
        </div>
      )}

      <GlassCard className="grid gap-4 p-6">
        <h2 className="font-heading text-xl font-semibold">Passport{trip.travellers.length > 1 ? `: ${travellerName(traveller)}` : ''}</h2>
        {traveller.passport && !editingPassport ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status="pass">
              <Check className="size-3" /> {travellerName(traveller)} · {traveller.passport.documentNumber} · expires {formatDate(traveller.passport.expiryDate)}
            </StatusPill>
            <Button variant="outline" size="sm" onClick={() => setEditingPassport(true)}>
              Change
            </Button>
          </div>
        ) : (
          <PassportForm key={traveller.id} trip={trip} traveller={traveller} onSave={savePassport} onCancel={traveller.passport ? () => setEditingPassport(false) : undefined} io={io} />
        )}
      </GlassCard>

      {traveller.passport && required.length > 0 && (
        <GlassCard className="grid gap-4 p-6">
          <div>
            <h2 className="font-heading text-xl font-semibold">A few more details</h2>
            <p className="text-sm text-muted-foreground">Only what the official form asks that your passport and trip do not already answer.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {required.map((f) => (
              <Question key={f.id} trip={trip} traveller={traveller} field={f} onChange={(v) => setAnswer(f.id, v)} />
            ))}
          </div>
          {optional.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">Optional questions ({optional.length})</summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {optional.map((f) => (
                  <Question key={f.id} trip={trip} traveller={traveller} field={f} onChange={(v) => setAnswer(f.id, v)} />
                ))}
              </div>
            </details>
          )}
        </GlassCard>
      )}

      {traveller.passport && docs.length > 0 && (
        <GlassCard className="grid gap-4 p-6">
          <div>
            <h2 className="font-heading text-xl font-semibold">Documents</h2>
            <p className="text-sm text-muted-foreground">Photos or PDFs. The reviewer checks them before anything is filed; bring the originals to the appointment.</p>
          </div>
          {docs.map((d) => {
            const have = d.perTraveller ? traveller.documents[d.id] : trip.sharedDocuments[d.id];
            return (
              <div key={d.id} className="grid gap-2 rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {d.label} {!d.required && <span className="text-xs font-normal text-muted-foreground">if it applies</span>}
                  </div>
                  {have && (
                    <StatusPill status="pass">
                      <FileUp className="size-3" /> {have.fileName}
                    </StatusPill>
                  )}
                </div>
                {d.detail && <p className="text-xs text-muted-foreground">{d.detail}</p>}
                <FileDrop compact onFile={(f) => void upload(d.id, Boolean(d.perTraveller), f)} label={have ? 'Replace' : 'Add a photo or PDF'} />
              </div>
            );
          })}
        </GlassCard>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={back}>
          <ArrowLeft /> Save and leave
        </Button>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Not saved' : ''}
        </span>
        <Button size="lg" disabled={missing.length > 0} onClick={next}>
          Next: pick a time <ArrowRight />
        </Button>
      </div>
      {missing.length > 0 && (
        <p className="text-right text-xs text-muted-foreground">
          Still needed: {missing.slice(0, 4).join('; ')}
          {missing.length > 4 ? ` and ${missing.length - 4} more` : ''}
        </p>
      )}
    </div>
  );
}

function Question({ trip, traveller, field, onChange }: { trip: Trip; traveller: Traveller; field: FormField; onChange: (v: string) => void }) {
  const id = `q-${traveller.id}-${field.id}`;
  return (
    <div className={`grid gap-1.5 ${field.type === 'textarea' ? 'sm:col-span-2' : ''}`}>
      <Label htmlFor={id}>{field.label}</Label>
      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
      <FieldInput id={id} field={field} value={fieldValue(trip, traveller, field)} onChange={onChange} />
    </div>
  );
}

function StepTime({ app, route, back, done, flush }: { app: Application; route: Route; back: () => void; done: (a: Application) => void; flush: () => Promise<void> }) {
  const formId = route.formId!;
  const declaration = DECLARATIONS[formId];
  const text = consentText(formId);
  const [dates, setDates] = useState<string[]>(app.preferences?.dates ?? ['']);
  const [place, setPlace] = useState(app.preferences?.place ?? '');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const tomorrow = localISODate(new Date(Date.now() + 86_400_000));
  const chosen = dates.filter(Boolean);

  const send = async () => {
    setBusy(true);
    setMissing([]);
    try {
      await flush();
      done(await svc.submit(app.id, { agreed: true, declarationText: text, preferences: { dates: chosen, place: place.trim() || undefined } }));
      toast.success('Sent for review');
    } catch (err) {
      if (err instanceof SvcError && err.missing) setMissing(err.missing);
      toast.error(err instanceof Error ? err.message : 'Could not send.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <Steps current={3} />
      <GlassCard className="grid gap-4 p-6">
        <div>
          <h2 className="font-heading text-xl font-semibold">When can you go to the appointment?</h2>
          <p className="text-sm text-muted-foreground">
            {route.appointment === 'none'
              ? 'This route has no appointment. Pick the day you would like it filed by.'
              : 'Pick up to three days that suit you. We book the first open slot on one of them and email you the details.'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {dates.map((d, i) => (
            <div key={i} className="grid gap-1.5">
              <Label htmlFor={`date-${i}`}>Choice {i + 1}</Label>
              <Input
                id={`date-${i}`}
                type="date"
                min={tomorrow}
                max={app.trip.input.departDate}
                className="h-10 rounded-xl"
                value={d}
                onChange={(e) => setDates((ds) => ds.map((x, j) => (j === i ? e.target.value : x)))}
              />
            </div>
          ))}
        </div>
        {dates.length < 3 && (
          <Button variant="outline" size="sm" className="w-fit" onClick={() => setDates((d) => [...d, ''])}>
            <Plus /> Another day
          </Button>
        )}
        {route.appointment !== 'none' && (
          <div className="grid gap-1.5 sm:max-w-sm">
            <Label htmlFor="place">City for the appointment</Label>
            <Input id="place" className="h-10 rounded-xl" placeholder="For example Mumbai" value={place} onChange={(e) => setPlace(e.target.value)} />
          </div>
        )}
      </GlassCard>

      <GlassCard className="grid gap-3 p-6">
        <h2 className="font-heading text-xl font-semibold">{declaration.title}</h2>
        <p className="text-xs text-muted-foreground">{declaration.origin}</p>
        <div className="max-h-64 overflow-auto rounded-xl border border-border bg-background/60 p-4 text-sm leading-relaxed whitespace-pre-line">{text}</div>
        <label className="flex items-start gap-3">
          <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" aria-label="I agree to the declaration" />
          <span className="text-sm">I have read this. Everyone on this application agrees to it, and I am allowed to agree for them.</span>
        </label>
      </GlassCard>

      {missing.length > 0 && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm">
          Still needed: {missing.join('; ')}.{' '}
          <button className="underline" onClick={back}>
            Go back to add them
          </button>
        </p>
      )}

      <div className="flex justify-between gap-2">
        <Button variant="outline" onClick={back}>
          <ArrowLeft /> Back
        </Button>
        <Button size="lg" disabled={!agreed || !chosen.length || busy} onClick={send}>
          <Send /> Send for review
        </Button>
      </div>
    </div>
  );
}

function StatusView({ app, route, onEdit, home }: { app: Application; route: Route; onEdit: () => void; home: () => void }) {
  const [current, setCurrent] = useState(app);
  useEffect(() => {
    const t = setInterval(() => {
      svc
        .get(app.id)
        .then(setCurrent)
        .catch(() => {});
    }, 20_000);
    return () => clearInterval(t);
  }, [app.id]);
  const s = STATUS_TEXT[current.status];
  const order = ['in_review', 'approved', 'filed', 'appointment', 'decided'];
  const reached = order.indexOf(current.status === 'filing' || current.status === 'filing_failed' ? 'approved' : current.status);

  return (
    <div className="grid gap-5">
      <GlassCard className="grid gap-4 p-6">
        <div className="text-sm text-muted-foreground">
          {route.title} · {current.trip.travellers.map(travellerName).join(', ')}
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{s.label}</h1>
        <p>{s.detail}</p>
        {current.status === 'returned' && (
          <>
            {current.note && <p className="rounded-xl bg-warning/15 px-4 py-3">{current.note}</p>}
            <Button className="w-fit" onClick={onEdit}>
              Fix and resend
            </Button>
          </>
        )}
        {current.status === 'draft' && (
          <Button className="w-fit" onClick={onEdit}>
            Continue
          </Button>
        )}
        {reached >= 0 && (
          <ol className="grid gap-2 sm:grid-cols-5">
            {['Review', 'Filing', 'Filed', 'Appointment', 'Decision'].map((label, i) => (
              <li key={label} className={`rounded-xl px-3 py-2 text-sm ${i <= reached ? 'bg-primary/12 font-medium text-primary' : 'bg-muted text-muted-foreground'}`}>
                {i < reached ? <Check className="mr-1 inline size-3.5" /> : null}
                {label}
              </li>
            ))}
          </ol>
        )}
      </GlassCard>

      {current.filing.travellers && Object.keys(current.filing.travellers).length > 0 && (
        <GlassCard className="grid gap-2 p-6">
          <h2 className="font-heading text-lg font-semibold">References</h2>
          {current.trip.travellers.map((t) => {
            const r = current.filing.travellers?.[t.id];
            if (!r) return null;
            return (
              <p key={t.id} className="text-sm">
                <strong>{travellerName(t)}:</strong> {[r.serial && `serial number ${r.serial}`, r.pin && `PIN ${r.pin}`, r.reference && `reference ${r.reference}`].filter(Boolean).join(', ')}
              </p>
            );
          })}
        </GlassCard>
      )}

      {['approved', 'filing', 'filing_failed', 'filed', 'appointment', 'decided'].includes(current.status) && <Documents app={current} route={route} />}

      {current.filing.appointment && (
        <GlassCard className="grid gap-1 p-6">
          <h2 className="font-heading text-lg font-semibold">Your appointment</h2>
          <p>
            {formatDate(current.filing.appointment.at.slice(0, 10))} at {current.filing.appointment.at.slice(11)}, {current.filing.appointment.place}
          </p>
          <p className="text-sm text-muted-foreground">Bring your passport, the originals of the documents you uploaded, and the printed, signed application.</p>
        </GlassCard>
      )}

      {current.filing.decision && (
        <GlassCard className="p-6">
          <h2 className="font-heading text-lg font-semibold">Decision: {current.filing.decision === 'approved' ? 'visa granted' : 'refused'}</h2>
        </GlassCard>
      )}

      <Button variant="outline" className="w-fit" onClick={home}>
        <ArrowLeft /> All applications
      </Button>
    </div>
  );
}

/** What a customer gets back: the filed form, the cover letter and itinerary written for them, and what to bring. */
function Documents({ app, route }: { app: Application; route: Route }) {
  const letter = app.trip.coverLetter || buildCoverLetter(app.trip, route.formId);
  const itinerary = app.trip.itineraryText || buildItinerary(app.trip);
  const textFile = (text: string) => URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const bring = route.checklist.filter((c) => c.required);

  return (
    <GlassCard className="grid gap-4 p-6">
      <h2 className="font-heading text-lg font-semibold">Your documents</h2>
      <div className="grid gap-2">
        {(app.filing.documents ?? []).map((d) => (
          <a key={d.fileId} className="flex items-center gap-2 text-sm underline" href={svc.fileUrl(app.id, d.fileId)} target="_blank" rel="noreferrer">
            <Download className="size-4" /> {d.name}
          </a>
        ))}
        {!app.filing.documents?.length && <p className="text-sm text-muted-foreground">The filed application form appears here once it is on the official site.</p>}
        <a className="flex items-center gap-2 text-sm underline" href={textFile(letter)} download="cover-letter.txt">
          <Download className="size-4" /> Cover letter
        </a>
        <a className="flex items-center gap-2 text-sm underline" href={textFile(itinerary)} download="itinerary.txt">
          <Download className="size-4" /> Day-by-day itinerary
        </a>
      </div>
      {route.appointment !== 'none' && (
        <div>
          <h3 className="mb-1 font-semibold">What to bring to the appointment</h3>
          <ul className="grid gap-1 text-sm">
            {route.checklist.some((c) => c.helper === 'form') ? null : <li>• The printed application form, signed</li>}
            {bring.map((c) => (
              <li key={c.id}>• {c.label}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">Bring originals and a copy of each.</p>
        </div>
      )}
    </GlassCard>
  );
}
