import { ArrowRight, Eye, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { extractDocument } from '@/api';
import { FileDrop, prepareFile, SectionHeader, SourceLink, StatusPill } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHealth } from '@/hooks';
import type { ChecklistItem } from '@/rules/types';
import { useVault } from '@/state/VaultContext';
import { doneKey, travellerName, type DocumentRecord, type Traveller, type Trip, type Verification } from '@/store/model';
import { checkPassport, docKindFor, overall, runChecks, type DocKind } from '@/verify/checks';
import type { SectionId } from './progress';
import type { PanelProps } from './Workspace';

type FieldKind = 'text' | 'number' | 'date' | 'list' | 'bool';
const MANUAL_FIELDS: Record<Exclude<DocKind, 'other'>, Array<{ id: string; label: string; kind: FieldKind }>> = {
  funds: [
    { id: 'holder_name', label: 'Account holder', kind: 'text' },
    { id: 'bank_name', label: 'Bank', kind: 'text' },
    { id: 'currency', label: 'Currency (e.g. EUR)', kind: 'text' },
    { id: 'closing_balance', label: 'Closing balance', kind: 'number' },
    { id: 'statement_end_date', label: 'Statement end date', kind: 'date' },
  ],
  insurance: [
    { id: 'insured_names', label: 'Insured names (comma separated)', kind: 'list' },
    { id: 'coverage_amount', label: 'Medical cover amount', kind: 'number' },
    { id: 'currency', label: 'Currency', kind: 'text' },
    { id: 'start_date', label: 'Policy start', kind: 'date' },
    { id: 'end_date', label: 'Policy end', kind: 'date' },
    { id: 'territory', label: 'Territory (as worded)', kind: 'text' },
    { id: 'covers_emergency', label: 'Covers emergency treatment', kind: 'bool' },
    { id: 'covers_repatriation', label: 'Covers repatriation', kind: 'bool' },
  ],
  accommodation: [
    { id: 'guest_names', label: 'Guest names (comma separated)', kind: 'list' },
    { id: 'property_name', label: 'Property', kind: 'text' },
    { id: 'address', label: 'Address', kind: 'text' },
    { id: 'check_in', label: 'Check-in', kind: 'date' },
    { id: 'check_out', label: 'Check-out', kind: 'date' },
  ],
  ticket: [
    { id: 'passenger_names', label: 'Passenger names (comma separated)', kind: 'list' },
    { id: 'outbound_date', label: 'Outbound date', kind: 'date' },
    { id: 'return_date', label: 'Return date', kind: 'date' },
    { id: 'from', label: 'From', kind: 'text' },
    { id: 'to', label: 'To', kind: 'text' },
  ],
  photo: [
    { id: 'is_single_face_photo', label: 'One face, looking at the camera', kind: 'bool' },
    { id: 'plain_light_background', label: 'Plain, light background', kind: 'bool' },
  ],
};

const JUMP: Partial<Record<NonNullable<ChecklistItem['helper']>, { section: SectionId; label: string }>> = {
  form: { section: 'form', label: 'Prepare form answers' },
  itinerary: { section: 'itinerary', label: 'Build itinerary' },
  cover_letter: { section: 'cover_letter', label: 'Draft cover letter' },
};

function coerce(kind: FieldKind, raw: string): string | number | boolean | null | string[] {
  if (kind === 'number') return raw.trim() === '' ? null : Number(raw.replace(/[^\d.-]/g, ''));
  if (kind === 'bool') return raw === 'yes' ? true : raw === 'no' ? false : null;
  if (kind === 'list') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return raw.trim();
}

async function openFile(dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob();
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
}

function withoutKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = obj;
  void _removed;
  return rest;
}

function DocRow({ trip, route, item, traveller, update }: { trip: Trip; route: PanelProps['route']; item: ChecklistItem; traveller?: Traveller; update: PanelProps['update'] }) {
  const vault = useVault();
  const health = useHealth();
  const kind = docKindFor(item.helper);
  const doc: DocumentRecord | undefined = traveller ? traveller.documents[item.id] : trip.sharedDocuments[item.id];
  const key = doneKey(item.id, traveller?.id);
  const done = Boolean(trip.checklistDone[key]);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<Record<string, string> | null>(null);
  const subject = traveller ?? trip.travellers[0];

  const setDoc = (rec: DocumentRecord | undefined) =>
    update((t) => {
      const apply = (docs: Record<string, DocumentRecord>) => (rec ? { ...docs, [item.id]: rec } : withoutKey(docs, item.id));
      if (!traveller) return { ...t, sharedDocuments: apply(t.sharedDocuments) };
      return { ...t, travellers: t.travellers.map((x) => (x.id === traveller.id ? { ...x, documents: apply(x.documents) } : x)) };
    });
  const setDone = (v: boolean) => update((t) => ({ ...t, checklistDone: { ...t.checklistDone, [key]: v } }));

  const record = (base: DocumentRecord, extracted: Record<string, unknown>, method: Verification['method']) => {
    const checks = runChecks(kind, extracted, { trip, route, traveller: subject });
    const verification: Verification = { verifiedAt: new Date().toISOString(), method, extracted: extracted as Verification['extracted'], checks, overall: overall(checks) };
    setDoc({ ...base, verification });
    if (verification.overall === 'pass') setDone(true);
    toast[verification.overall === 'pass' ? 'success' : verification.overall === 'fail' ? 'error' : 'warning'](
      verification.overall === 'pass' ? `${item.label}: all checks passed` : `${item.label}: ${verification.checks.filter((c) => c.status !== 'pass').length} thing(s) to look at`,
    );
  };

  async function onFile(file: File) {
    setBusy(true);
    try {
      const f = await prepareFile(file);
      if (doc) await vault.removeFile(doc.id);
      const id = await vault.saveFile(f.dataUrl);
      const base: DocumentRecord = { id, fileName: file.name, mediaType: f.mediaType, size: file.size, uploadedAt: new Date().toISOString() };
      setDoc(base);
      if (kind === 'other') {
        setDone(true);
        return;
      }
      if (health?.ai) {
        try {
          record(base, await extractDocument(kind, f.base64, f.mediaType), 'ai');
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Could not read the document.');
          setManual({});
        }
      } else {
        setManual({});
      }
    } finally {
      setBusy(false);
    }
  }

  const fields = kind !== 'other' ? MANUAL_FIELDS[kind] : [];

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-background/40 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Checkbox checked={done} onCheckedChange={(v) => setDone(v === true)} aria-label={`${item.label}${traveller ? ` for ${travellerName(traveller)}` : ''} is ready`} />
        <span className="text-sm font-medium">{traveller ? travellerName(traveller) : 'For the whole application'}</span>
        {doc?.verification && <StatusPill status={doc.verification.overall}>{doc.verification.overall === 'pass' ? 'Verified' : doc.verification.overall === 'fail' ? 'Problem found' : 'Check'}</StatusPill>}
        {doc && <span className="truncate text-xs text-muted-foreground">{doc.fileName}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {doc && (
            <>
              <Button variant="ghost" size="icon-sm" aria-label="View file" onClick={async () => openFile((await vault.readFile(doc.id)) ?? '')}>
                <Eye />
              </Button>
              {kind !== 'other' && (
                <Button variant="outline" size="sm" onClick={() => setManual(Object.fromEntries(fields.map((f) => [f.id, stringify(doc.verification?.extracted[f.id])])))}>
                  <ShieldCheck /> {doc.verification ? 'Correct details' : 'Enter details'}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove file"
                onClick={async () => {
                  await vault.removeFile(doc.id);
                  setDoc(undefined);
                  setDone(false);
                }}
              >
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </div>
      {busy ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2 className="size-4 animate-spin" /> {health?.ai ? 'Reading and checking the document…' : 'Saving…'}
        </div>
      ) : (
        <FileDrop compact onFile={onFile} label={doc ? 'Replace file' : 'Upload (photo or PDF)'} />
      )}
      {manual && (
        <form
          className="grid gap-3 rounded-xl bg-muted/50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!doc) return;
            const extracted = Object.fromEntries(fields.map((f) => [f.id, coerce(f.kind, manual[f.id] ?? '')]));
            record(doc, extracted, doc.verification?.method === 'ai' ? 'ai' : 'manual');
            setManual(null);
          }}
        >
          <p className="text-xs text-muted-foreground">Type the details exactly as they appear on the document. The app checks them against the requirement.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.id} className="grid gap-1">
                <Label htmlFor={`${item.id}-${traveller?.id ?? 'shared'}-${f.id}`} className="text-xs">
                  {f.label}
                </Label>
                {f.kind === 'bool' ? (
                  <select
                    id={`${item.id}-${traveller?.id ?? 'shared'}-${f.id}`}
                    className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                    value={manual[f.id] ?? ''}
                    onChange={(e) => setManual((m) => ({ ...m, [f.id]: e.target.value }))}
                  >
                    <option value="">Not stated</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                ) : (
                  <Input
                    id={`${item.id}-${traveller?.id ?? 'shared'}-${f.id}`}
                    type={f.kind === 'date' ? 'date' : 'text'}
                    inputMode={f.kind === 'number' ? 'decimal' : undefined}
                    className="h-9 rounded-lg"
                    value={manual[f.id] ?? ''}
                    onChange={(e) => setManual((m) => ({ ...m, [f.id]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Check details
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setManual(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {doc?.verification && !manual && (
        <ul className="grid gap-1.5 text-sm">
          {doc.verification.checks.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-2">
              <StatusPill status={c.status}>{c.status === 'pass' ? 'OK' : c.status === 'fail' ? 'Problem' : c.status === 'warn' ? 'Check' : 'Info'}</StatusPill>
              <span>{c.label}</span>
              {c.detail && <span className="text-xs text-muted-foreground">{c.detail}</span>}
            </li>
          ))}
          <li className="text-xs text-muted-foreground">{doc.verification.method === 'ai' ? 'Details read by AI, checked by the app.' : 'Details entered by you, checked by the app.'}</li>
        </ul>
      )}
    </div>
  );
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

export function Documents({ trip, route, update, jump }: PanelProps) {
  const required = route.checklist.filter((c) => c.required);
  const readyCount = required.filter((c) => (c.perTraveller ? trip.travellers.every((t) => trip.checklistDone[doneKey(c.id, t.id)]) : trip.checklistDone[doneKey(c.id)])).length;

  return (
    <div className="grid gap-5">
      <SectionHeader
        title="Documents"
        description={`${readyCount} of ${required.length} required items ready. Upload each document and it is checked against the official requirement.`}
      />
      {route.checklist.map((item) => {
        const jumpTo = item.helper ? JUMP[item.helper] : undefined;
        return (
          <section key={item.id} className="grid gap-3 rounded-2xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{item.label}</h3>
                  {!item.required && <StatusPill status="neutral">Optional</StatusPill>}
                  {item.perTraveller && trip.travellers.length > 1 && <StatusPill status="accent">Each traveller</StatusPill>}
                </div>
                {item.detail && <p className="text-sm text-muted-foreground">{item.detail}</p>}
                <SourceLink source={item.source} />
              </div>
              {jumpTo && route.features.includes(jumpTo.section as never) && (
                <Button variant="outline" size="sm" onClick={() => jump(jumpTo.section)}>
                  {jumpTo.label} <ArrowRight />
                </Button>
              )}
            </div>

            {item.helper === 'passport' ? (
              <div className="grid gap-2">
                {trip.travellers.map((t) => {
                  const checks = checkPassport(t.passport, trip, route, new Date());
                  const st = t.passport ? overall(checks) : 'warn';
                  const key = doneKey(item.id, t.id);
                  return (
                    <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/40 p-3 text-sm">
                      <Checkbox
                        checked={Boolean(trip.checklistDone[key])}
                        onCheckedChange={(v) => update((x) => ({ ...x, checklistDone: { ...x.checklistDone, [key]: v === true } }))}
                        aria-label={`Passport for ${travellerName(t)} is ready`}
                      />
                      <span className="font-medium">{travellerName(t)}</span>
                      <StatusPill status={st}>{!t.passport ? 'Not read yet' : st === 'pass' ? 'Checks passed' : st === 'fail' ? 'Problem found' : 'Check'}</StatusPill>
                      <Button variant="link" size="sm" className="ml-auto" onClick={() => jump('travellers')}>
                        {t.passport ? 'See checks' : 'Read passport'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : jumpTo ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-3 text-sm">
                <Checkbox
                  checked={Boolean(trip.checklistDone[doneKey(item.id)])}
                  onCheckedChange={(v) => update((x) => ({ ...x, checklistDone: { ...x.checklistDone, [doneKey(item.id)]: v === true } }))}
                  aria-label={`${item.label} is ready`}
                />
                <span>Prepared in this app. Tick when printed or attached.</span>
              </div>
            ) : (
              <div className="grid gap-2">
                {item.perTraveller ? trip.travellers.map((t) => <DocRow key={t.id} trip={trip} route={route} item={item} traveller={t} update={update} />) : <DocRow trip={trip} route={route} item={item} update={update} />}
              </div>
            )}
          </section>
        );
      })}
      <p className="text-xs text-muted-foreground">Verification checks documents against the requirement; it cannot confirm a document is genuine or that the authority will accept it.</p>
    </div>
  );
}
