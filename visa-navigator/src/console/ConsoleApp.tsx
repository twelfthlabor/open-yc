// The operator console: the review queue, the review screen (passport photo beside what was read,
// every answer, documents, drafts, the customer's recorded declaration), and the actions after filing.
// The operator files by hand on the official site and records the references here.

import { ArrowLeft, ArrowUpRight, Check, CornerUpLeft, FileCheck2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { STATUS_TEXT, svc, type AppStatus, type OperatorDetail, type OperatorSummary } from '@/apply/svc';
import { CopyButton, FileDrop, GlassCard, prepareFile, StatusPill } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { countryName } from '@/data/countries';
import { buildCoverLetter, buildItinerary, formatDate } from '@/drafts/templates';
import { allFields, fieldValue, formFor } from '@/forms/forms';
import { resolveRoute } from '@/rules/engine';
import { travellerName } from '@/store/model';

const TABS: Array<{ status?: AppStatus; label: string }> = [
  { status: 'in_review', label: 'To review' },
  { status: 'filing_failed', label: 'Filing failed' },
  { status: 'approved', label: 'To file' },
  { status: 'filed', label: 'To book' },
  { status: 'appointment', label: 'Booked' },
  { status: 'returned', label: 'Returned' },
  { label: 'All' },
];

export function ConsoleApp() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    svc
      .me()
      .then((me) => setSignedIn(me.role === 'operator'))
      .catch(() => setSignedIn(false));
  }, []);

  return (
    <>
      <div className="aurora" aria-hidden="true" />
      <div className="mx-auto grid min-h-dvh max-w-6xl content-start gap-6 px-4 py-8">
        <header className="flex items-center justify-between">
          <button className="font-heading text-lg font-semibold tracking-tight" onClick={() => setOpen(null)}>
            Visa Navigator · Console
          </button>
        </header>
        {signedIn === false && <Login onDone={() => setSignedIn(true)} />}
        {signedIn && (open ? <Review id={open} back={() => setOpen(null)} /> : <Queue onOpen={setOpen} />)}
      </div>
    </>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await svc.operatorLogin(password);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sign in.');
    }
  };
  return (
    <GlassCard className="mx-auto grid w-full max-w-sm gap-3 p-6">
      <h1 className="font-heading text-xl font-semibold">Operator sign-in</h1>
      <form onSubmit={submit} className="grid gap-3">
        <Label htmlFor="pw">Password</Label>
        <Input id="pw" type="password" autoComplete="current-password" className="h-10 rounded-xl" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit">Sign in</Button>
      </form>
    </GlassCard>
  );
}

function Queue({ onOpen }: { onOpen: (id: string) => void }) {
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState<OperatorSummary[] | null>(null);
  const load = useCallback(() => {
    svc
      .queue(TABS[tab].status)
      .then(setRows)
      .catch((err) => toast.error(err.message));
  }, [tab]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t, i) => (
          <Button key={t.label} size="sm" variant={i === tab ? 'default' : 'outline'} aria-pressed={i === tab} onClick={() => setTab(i)}>
            {t.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={load}>
          <RefreshCw /> Refresh
        </Button>
      </div>
      {rows?.length === 0 && <p className="text-muted-foreground">Nothing here.</p>}
      <div className="grid gap-2">
        {rows?.map((r) => (
          <button key={r.id} className="text-left" onClick={() => onOpen(r.id)}>
            <GlassCard className="grid gap-1 p-4 transition-colors hover:border-primary/40 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <div className="font-medium">{r.names.join(', ')}</div>
                <div className="text-sm text-muted-foreground">
                  {countryName(r.nationality)} → {countryName(r.destination)} · leaves {formatDate(r.departDate)} · {r.email}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <StatusPill status="accent">{STATUS_TEXT[r.status].label}</StatusPill>
                {new Date(r.updatedAt).toLocaleString()}
              </div>
            </GlassCard>
          </button>
        ))}
      </div>
    </div>
  );
}

function Review({ id, back }: { id: string; back: () => void }) {
  const [d, setD] = useState<OperatorDetail | null>(null);
  const [note, setNote] = useState('');
  const [at, setAt] = useState('');
  const [place, setPlace] = useState('');
  const load = useCallback(() => {
    svc
      .review(id)
      .then(setD)
      .catch((err) => toast.error(err.message));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  if (!d) return null;

  const route = resolveRoute(d.trip.input);
  const form = formFor(route);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed.');
    }
  };
  const fileName = (fileId: string) => d.files.find((f) => f.id === fileId)?.name ?? 'file';
  const itinerary = d.trip.itineraryText || buildItinerary(d.trip);
  const letter = d.trip.coverLetter || buildCoverLetter(d.trip, form?.id);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={back}>
          <ArrowLeft /> Queue
        </Button>
        <StatusPill status="accent">{STATUS_TEXT[d.status].label}</StatusPill>
        <span className="text-sm text-muted-foreground">
          {route.title} · {d.email} · leaves {formatDate(d.trip.input.departDate)}, back {formatDate(d.trip.input.returnDate)}
        </span>
      </div>

      {d.trip.travellers.map((t) => (
        <GlassCard key={t.id} className="grid gap-4 p-5">
          <h2 className="font-heading text-xl font-semibold">{travellerName(t)}</h2>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
            <div className="grid content-start gap-2">
              {t.passport?.imageDocId ? (
                <a href={svc.fileUrl(d.id, t.passport.imageDocId)} target="_blank" rel="noreferrer">
                  <img src={svc.fileUrl(d.id, t.passport.imageDocId)} alt={`Passport of ${travellerName(t)}`} className="w-full rounded-xl border border-border" />
                </a>
              ) : (
                <p className="rounded-xl bg-warning/15 px-3 py-2 text-sm">No passport photo uploaded; the details were typed.</p>
              )}
              {t.passport && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {(
                    [
                      ['Name', `${t.passport.givenNames} ${t.passport.surname}`],
                      ['Number', t.passport.documentNumber],
                      ['Nationality', t.passport.nationality],
                      ['Born', t.passport.birthDate],
                      ['Sex', t.passport.sex],
                      ['Issued', t.passport.issueDate ?? '—'],
                      ['Expires', t.passport.expiryDate],
                      ['MRZ check digits', t.passport.mrzValid ? 'valid' : 'not checked or failed'],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className={k === 'MRZ check digits' && !t.passport!.mrzValid ? 'font-medium text-destructive' : ''}>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <div className="grid content-start gap-1 text-sm">
              {form &&
                allFields(form).map((f) => {
                  const v = fieldValue(d.trip, t, f);
                  return (
                    <div key={f.id} className="grid grid-cols-[minmax(0,14rem)_1fr] gap-3 border-b border-border/60 py-1">
                      <span className="text-muted-foreground">
                        {f.number && `${f.number}. `}
                        {f.label}
                      </span>
                      <span className="flex items-start justify-between gap-2">
                        <span className={!v && !f.optional ? 'font-medium text-destructive' : 'whitespace-pre-line'}>{v || (f.optional ? '—' : 'missing')}</span>
                        {v && <CopyButton text={v} label="" className="h-6 shrink-0 px-1.5" />}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
          {Object.entries(t.documents).length > 0 && (
            <div className="flex flex-wrap gap-3 text-sm">
              {Object.entries(t.documents).map(([item, doc]) => (
                <a key={item} className="underline" href={svc.fileUrl(d.id, doc.id)} target="_blank" rel="noreferrer">
                  {route.checklist.find((c) => c.id === item)?.label ?? item}: {fileName(doc.id)}
                </a>
              ))}
            </div>
          )}
        </GlassCard>
      ))}

      <div className="grid gap-5 lg:grid-cols-2">
        <GlassCard className="grid content-start gap-2 p-5">
          <h3 className="font-semibold">Shared documents</h3>
          {Object.entries(d.trip.sharedDocuments).length === 0 && <p className="text-sm text-muted-foreground">None uploaded.</p>}
          {Object.entries(d.trip.sharedDocuments).map(([item, doc]) => (
            <a key={item} className="text-sm underline" href={svc.fileUrl(d.id, doc.id)} target="_blank" rel="noreferrer">
              {route.checklist.find((c) => c.id === item)?.label ?? item}: {fileName(doc.id)}
            </a>
          ))}
          <h3 className="mt-3 font-semibold">Declaration</h3>
          {d.consent ? (
            <div className="text-sm">
              Agreed {new Date(d.consent.agreedAt).toLocaleString()} by {d.email}.
              <details>
                <summary className="cursor-pointer text-muted-foreground">Text they agreed to</summary>
                <p className="mt-1 whitespace-pre-line">{d.consent.text}</p>
              </details>
            </div>
          ) : (
            <p className="text-sm text-destructive">Not agreed yet.</p>
          )}
          <h3 className="mt-3 font-semibold">Appointment wishes</h3>
          <p className="text-sm">
            {d.preferences?.dates.map((x) => formatDate(x)).join(', ') || '—'}
            {d.preferences?.place ? ` · ${d.preferences.place}` : ''}
          </p>
        </GlassCard>
        <GlassCard className="grid content-start gap-2 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Itinerary (drafted)</h3>
            <CopyButton text={itinerary} />
          </div>
          <pre className="max-h-40 overflow-auto rounded-xl bg-muted/60 p-3 text-xs whitespace-pre-wrap">{itinerary}</pre>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Cover letter (drafted)</h3>
            <CopyButton text={letter} />
          </div>
          <pre className="max-h-40 overflow-auto rounded-xl bg-muted/60 p-3 text-xs whitespace-pre-wrap">{letter}</pre>
        </GlassCard>
      </div>

      <GlassCard className="grid gap-3 p-5">
        {d.status === 'in_review' && (
          <>
            <h3 className="font-semibold">Decision</h3>
            <Button className="w-fit" onClick={() => act(() => svc.decide(d.id, { action: 'approve' }), 'Approved. It is in the To file tab.')}>
              <Check /> Approve for filing
            </Button>
            <Label htmlFor="note">Or send it back to the customer with a note</Label>
            <Textarea id="note" className="rounded-xl" placeholder="For example: the passport photo is blurred, please upload a sharper one." value={note} onChange={(e) => setNote(e.target.value)} />
            <Button variant="outline" className="w-fit" disabled={!note.trim()} onClick={() => act(() => svc.decide(d.id, { action: 'return', note: note.trim() }), 'Returned to the customer.')}>
              <CornerUpLeft /> Return with this note
            </Button>
          </>
        )}
        {['approved', 'filing', 'filing_failed', 'filed'].includes(d.status) && <FileIt d={d} applyUrl={route.applyUrl} applyLabel={route.applyLabel} onDone={load} />}
        {(d.status === 'filed' || d.status === 'appointment') && (
          <>
            <h3 className="font-semibold">Book the appointment</h3>
            {route.bookingUrl && (
              <Button variant="outline" className="w-fit" asChild>
                <a href={route.bookingUrl} target="_blank" rel="noreferrer">
                  {route.bookingLabel ?? 'Open the booking page'} <ArrowUpRight />
                </a>
              </Button>
            )}
            <p className="text-sm text-muted-foreground">
              Customer wishes: {d.preferences?.dates.map((x) => formatDate(x)).join(', ')}
              {d.preferences?.place ? ` in ${d.preferences.place}` : ''}.
            </p>
            <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="at">Date and time</Label>
                <Input id="at" type="datetime-local" className="h-10 rounded-xl" value={at} onChange={(e) => setAt(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="place">Place</Label>
                <Input id="place" className="h-10 rounded-xl" value={place} onChange={(e) => setPlace(e.target.value)} />
              </div>
              <Button disabled={!at || !place.trim()} onClick={() => act(() => svc.appointment(d.id, at, place.trim()), 'Appointment saved; the customer can see it.')}>
                Save appointment
              </Button>
            </div>
          </>
        )}
        {d.status === 'appointment' && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => act(() => svc.decided(d.id, 'approved'), 'Recorded.')}>
              Visa granted
            </Button>
            <Button variant="outline" onClick={() => act(() => svc.decided(d.id, 'refused'), 'Recorded.')}>
              Refused
            </Button>
          </div>
        )}
        {d.filing.travellers && (
          <p className="text-sm">
            References:{' '}
            {d.trip.travellers
              .map((t) => {
                const r = d.filing.travellers?.[t.id];
                return r && `${travellerName(t)}: ${[r.serial, r.pin && `PIN ${r.pin}`, r.reference].filter(Boolean).join(' ')}`;
              })
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </GlassCard>

      <GlassCard className="p-5">
        <h3 className="mb-2 font-semibold">History</h3>
        <ol className="grid gap-1 text-sm">
          {d.events.map((e, i) => (
            <li key={i}>
              <span className="text-muted-foreground tabular-nums">{new Date(e.at).toLocaleString()}</span> · {e.actor} · {e.text}
            </li>
          ))}
        </ol>
      </GlassCard>
    </div>
  );
}

/** Filing by hand: open the official form, paste the answers (copy buttons above), then record what the portal gave back. */
function FileIt({ d, applyUrl, applyLabel, onDone }: { d: OperatorDetail; applyUrl?: string; applyLabel?: string; onDone: () => void }) {
  const [refs, setRefs] = useState<Record<string, { serial?: string; pin?: string; reference?: string }>>(() => structuredClone(d.filing.travellers ?? {}));
  const [docs, setDocs] = useState<Array<{ fileId: string; name: string }>>(d.filing.documents ?? []);
  const [busy, setBusy] = useState(false);
  const setRef = (tid: string, k: 'serial' | 'pin' | 'reference', v: string) => setRefs((r) => ({ ...r, [tid]: { ...r[tid], [k]: v || undefined } }));

  const upload = async (file: File) => {
    try {
      const f = await prepareFile(file);
      const { id } = await svc.operatorUpload(d.id, { kind: 'filed_form', mediaType: f.mediaType, name: file.name.slice(0, 120), data: f.base64 });
      setDocs((x) => [...x, { fileId: id, name: file.name }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not upload.');
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await svc.markFiled(d.id, refs, docs.map((x) => x.fileId));
      toast.success('Marked as filed. The customer can see the references and documents.');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <h3 className="font-semibold">{d.status === 'filed' ? 'Filing details' : 'File it'}</h3>
      {d.status !== 'filed' && (
        <p className="text-sm text-muted-foreground">Open the official form and paste the answers with the copy buttons above. When it is done, enter what the site gave back and upload the filed form.</p>
      )}
      {applyUrl && (
        <Button variant="outline" className="w-fit" asChild>
          <a href={applyUrl} target="_blank" rel="noreferrer">
            {applyLabel ?? 'Open the official form'} <ArrowUpRight />
          </a>
        </Button>
      )}
      {d.trip.travellers.map((t) => (
        <div key={t.id} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr_1fr] sm:items-end">
          <span className="text-sm font-medium">{travellerName(t)}</span>
          {(['serial', 'pin', 'reference'] as const).map((k) => (
            <div key={k} className="grid gap-1">
              <Label htmlFor={`${t.id}-${k}`} className="text-xs">
                {k === 'serial' ? 'Serial number' : k === 'pin' ? 'PIN' : 'Other reference'}
              </Label>
              <Input id={`${t.id}-${k}`} className="h-9 rounded-xl" value={refs[t.id]?.[k] ?? ''} onChange={(e) => setRef(t.id, k, e.target.value.trim())} />
            </div>
          ))}
        </div>
      ))}
      <FileDrop compact onFile={(f) => void upload(f)} label="Upload the filed form or confirmation (PDF or image)" />
      {docs.length > 0 && <p className="text-sm">For the customer: {docs.map((x) => x.name).join(', ')}</p>}
      <Button className="w-fit" disabled={busy} onClick={save}>
        <FileCheck2 /> {d.status === 'filed' ? 'Save changes' : 'Mark as filed'}
      </Button>
    </div>
  );
}
