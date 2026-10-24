import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';
import { extractPassport, type PassportExtraction } from '@/api';
import { FileDrop, prepareFile, StatusPill } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { countryName } from '@/data/countries';
import { formatDate, localISODate } from '@/drafts/templates';
import { useHealth, useReducedMotion } from '@/hooks';
import { parseMrz } from '@/mrz/mrz';
import { useVault } from '@/state/VaultContext';
import type { PassportRecord, Traveller, Trip } from '@/store/model';

gsap.registerPlugin(useGSAP);

interface Draft {
  surname: string;
  givenNames: string;
  documentNumber: string;
  nationality: string;
  issuingState: string;
  birthDate: string;
  sex: string;
  expiryDate: string;
  issueDate: string;
  placeOfBirth: string;
  issuingAuthority: string;
}

const EMPTY: Draft = { surname: '', givenNames: '', documentNumber: '', nationality: '', issuingState: '', birthDate: '', sex: '', expiryDate: '', issueDate: '', placeOfBirth: '', issuingAuthority: '' };

const FIELDS: Array<{ key: keyof Draft; label: string; type?: string }> = [
  { key: 'givenNames', label: 'Given names' },
  { key: 'surname', label: 'Family name' },
  { key: 'documentNumber', label: 'Passport number' },
  { key: 'nationality', label: 'Nationality code' },
  { key: 'birthDate', label: 'Date of birth', type: 'date' },
  { key: 'sex', label: 'Sex' },
  { key: 'issueDate', label: 'Issue date', type: 'date' },
  { key: 'expiryDate', label: 'Expiry date', type: 'date' },
  { key: 'placeOfBirth', label: 'Place of birth' },
  { key: 'issuingAuthority', label: 'Issuing authority' },
];

function fromRecord(p?: PassportRecord): Draft {
  if (!p) return EMPTY;
  return { ...EMPTY, ...p, issueDate: p.issueDate ?? '', placeOfBirth: p.placeOfBirth ?? '', issuingAuthority: p.issuingAuthority ?? '' };
}

/** Where the photo is kept and how it is read: the local vault in the personal app, the server in the hosted service. */
export interface PassportIO {
  /** null while unknown. */
  ai: boolean | null;
  saveImage: (img: { dataUrl: string; base64: string; mediaType: string }) => Promise<string>;
  readImage: (id: string) => Promise<string | undefined>;
  extract: (base64: string, mediaType: string) => Promise<PassportExtraction>;
  storageHint: string;
}

interface ReaderProps {
  trip: Trip;
  traveller: Traveller;
  onSave: (p: PassportRecord) => void;
  onCancel?: () => void;
}

export function PassportReader(props: ReaderProps) {
  const vault = useVault();
  const health = useHealth();
  const io: PassportIO = {
    ai: health ? health.ai : null,
    saveImage: (img) => vault.saveFile(img.dataUrl),
    readImage: (id) => vault.readFile(id),
    extract: extractPassport,
    storageHint: 'Stored encrypted on this device.',
  };
  return <PassportForm {...props} io={io} />;
}

export function PassportForm({ trip, traveller, onSave, onCancel, io }: ReaderProps & { io: PassportIO }) {
  const ai = io.ai ?? false;
  const reduced = useReducedMotion();
  const saved = traveller.passport;
  const [image, setImage] = useState<string | undefined>();
  const [imageDocId, setImageDocId] = useState<string | undefined>(saved?.imageDocId);
  const [line1, setLine1] = useState(saved?.mrzLine1 ?? '');
  const [line2, setLine2] = useState(saved?.mrzLine2 ?? '');
  const [draft, setDraft] = useState<Draft>(() => fromRecord(saved));
  const [uncertain, setUncertain] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const scope = useRef<HTMLDivElement>(null);
  const scanTl = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    if (saved?.imageDocId) io.readImage(saved.imageDocId).then(setImage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved?.imageDocId]);

  const mrz = useMemo(() => (line1.trim() || line2.trim() ? parseMrz(line1, line2) : null), [line1, line2]);
  const { contextSafe } = useGSAP({ scope });

  const startScan = contextSafe(() => {
    if (reduced) return;
    scanTl.current?.kill();
    scanTl.current = gsap.timeline({ repeat: -1, yoyo: true }).set('.scan-line', { opacity: 1, top: '0%' }).to('.scan-line', { top: '100%', duration: 1.3, ease: 'sine.inOut' });
  });
  const stopScan = contextSafe(() => {
    scanTl.current?.kill();
    scanTl.current = null;
    gsap.to('.scan-line', { opacity: 0, duration: 0.2 });
    if (!reduced) gsap.from('.pp-field', { opacity: 0, y: 8, stagger: 0.035, duration: 0.3, ease: 'power2.out' });
  });
  useEffect(() => () => void scanTl.current?.kill(), []);

  const applyMrz = () => {
    if (!mrz?.valid) return;
    setDraft((d) => ({ ...d, surname: mrz.surname, givenNames: mrz.givenNames, documentNumber: mrz.documentNumber, nationality: mrz.nationality, issuingState: mrz.issuingState, birthDate: mrz.birthDate, sex: mrz.sex, expiryDate: mrz.expiryDate }));
  };

  async function onFile(file: File) {
    setError('');
    setNotice('');
    if (!file.type.startsWith('image/')) return setError('Choose a photo or scan of the passport page (JPG, PNG or WebP).');
    const img = await prepareFile(file);
    setImage(img.dataUrl);
    setImageDocId(await io.saveImage(img));
    if (!ai) {
      // Without a key the photo is only stored, so say so and point to the fields that need typing.
      setNotice('Photo saved. Reading it needs an AI key, so type the two MRZ lines below the photo to fill in the details.');
      return;
    }
    setBusy(true);
    startScan();
    try {
      const x = await io.extract(img.base64, img.mediaType);
      if (!x.readable) {
        setError('That does not look like a readable passport photo page. Try a sharper photo, or type the two MRZ lines below.');
      } else {
        setLine1(x.mrz_line1);
        setLine2(x.mrz_line2);
        setDraft({
          surname: x.surname,
          givenNames: x.given_names,
          documentNumber: x.passport_number,
          nationality: x.nationality,
          issuingState: '',
          birthDate: x.birth_date,
          sex: x.sex,
          expiryDate: x.expiry_date,
          issueDate: x.issue_date,
          placeOfBirth: x.place_of_birth,
          issuingAuthority: x.issuing_authority,
        });
        setUncertain(x.uncertain_fields.map((u) => u.toLowerCase()));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the image.');
    } finally {
      setBusy(false);
      stopScan();
    }
  }

  const mismatches = useMemo(() => {
    if (!mrz?.valid) return [];
    const out: string[] = [];
    if (draft.documentNumber && draft.documentNumber !== mrz.documentNumber) out.push('Passport number differs from the MRZ.');
    if (draft.birthDate && draft.birthDate !== mrz.birthDate) out.push('Date of birth differs from the MRZ.');
    if (draft.expiryDate && draft.expiryDate !== mrz.expiryDate) out.push('Expiry date differs from the MRZ.');
    if (draft.surname && draft.surname.toUpperCase().replace(/[^A-Z]/g, '') !== mrz.surname.replace(/[^A-Z]/g, ''))
      out.push('Family name differs from the MRZ (accents and transliteration can cause this; check the printed page).');
    return out;
  }, [draft, mrz]);

  const warnings: string[] = [];
  if (draft.nationality && draft.nationality !== trip.input.nationality)
    warnings.push(`This passport says ${countryName(draft.nationality)}, but the application is for a ${countryName(trip.input.nationality)} passport.`);
  if (draft.expiryDate && trip.input.returnDate && draft.expiryDate < trip.input.returnDate) warnings.push(`The passport expires (${formatDate(draft.expiryDate)}) before the trip ends.`);
  if (draft.expiryDate && draft.expiryDate < localISODate()) warnings.push('This passport has expired.');

  const canSave = Boolean(draft.surname && draft.documentNumber && draft.birthDate && draft.expiryDate);
  const save = () =>
    onSave({
      ...draft,
      mrzLine1: line1.trim() || undefined,
      mrzLine2: line2.trim() || undefined,
      mrzValid: Boolean(mrz?.valid),
      imageDocId,
      confirmedAt: new Date().toISOString(),
    });

  const isUncertain = (label: string) => uncertain.some((u) => u.includes(label.toLowerCase().split(' ')[0]));

  return (
    <div className="grid gap-5" ref={scope}>
      <p className="text-sm text-muted-foreground">
        {ai
          ? 'Upload a photo of the photo page. AI reads it, then the app verifies the machine-readable lines with their check digits. You confirm every field.'
          : 'Type or paste the two lines of characters at the bottom of the photo page (the MRZ). The app verifies them and fills in the details.'}
      </p>
      {io.ai === false && (
        <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
          AI reading is off (no API key in <span className="mono">.env</span>). Manual entry works fully.
        </p>
      )}
      {image ? (
        <div className="relative overflow-hidden rounded-xl border border-border bg-muted/40">
          <img src={image} alt="Passport photo page" className="mx-auto max-h-72 object-contain" />
          <div className="scan-line pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent opacity-0 shadow-[0_0_18px_4px] shadow-primary/40" />
        </div>
      ) : null}
      <FileDrop onFile={onFile} accept="image/*" label={image ? 'Replace photo' : 'Drop a photo of the passport photo page'} hint={io.storageHint} compact={Boolean(image)} />
      {busy && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Reading the passport…
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-muted px-3 py-2 text-sm">
          {notice}
        </p>
      )}

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold">Machine-readable zone (MRZ)</h3>
        <Input className="mono h-10 rounded-xl tracking-wider uppercase" placeholder="P<CANSMITH<<JANE<<<<<<<<<<<<<<<<<<<<<<<<<<<<" value={line1} onChange={(e) => setLine1(e.target.value)} aria-label="MRZ line 1" spellCheck={false} />
        <Input className="mono h-10 rounded-xl tracking-wider uppercase" placeholder="AB1234567<CAN9001011F3001014<<<<<<<<<<<<<<00" value={line2} onChange={(e) => setLine2(e.target.value)} aria-label="MRZ line 2" spellCheck={false} />
        {mrz && (
          <div className="flex flex-wrap items-center gap-1.5">
            {Object.entries(mrz.checks).map(([k, ok]) => (
              <StatusPill key={k} status={ok ? 'pass' : 'fail'}>
                {ok ? '✓' : '✕'} {k.replace(/([A-Z])/g, ' $1').toLowerCase()}
              </StatusPill>
            ))}
            {mrz.valid ? (
              <Button size="sm" variant="secondary" onClick={applyMrz}>
                Fill fields from MRZ
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">{mrz.errors[0]}</span>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className="pp-field grid gap-1.5">
            <Label htmlFor={`pp-${traveller.id}-${f.key}`} className="flex items-center gap-1.5">
              {f.label}
              {isUncertain(f.label) && <StatusPill status="warn">check</StatusPill>}
            </Label>
            <Input id={`pp-${traveller.id}-${f.key}`} type={f.type ?? 'text'} className="h-10 rounded-xl" value={draft[f.key]} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
          </div>
        ))}
      </div>

      {[...mismatches, ...warnings].map((w) => (
        <p key={w} className="rounded-xl bg-warning/15 px-3 py-2 text-sm">
          {w}
        </p>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button disabled={!canSave} onClick={save}>
          I checked these against the passport: save
        </Button>
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
