import { ArrowUpRight, Printer } from 'lucide-react';
import { CopyButton, SectionHeader } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { countryName } from '@/data/countries';
import { formatDate } from '@/drafts/templates';
import { allFields, fieldValue, formFor } from '@/forms/forms';
import { PURPOSE_LABELS, type Route } from '@/rules/types';
import { doneKey, travellerName, type Trip } from '@/store/model';
import { REVIEW_ITEMS, sectionDone, type SectionId } from './progress';
import type { PanelProps } from './Workspace';

const GAP_LABEL: Partial<Record<SectionId, string>> = {
  travellers: 'Passports',
  documents: 'Documents',
  form: 'Form answers',
  itinerary: 'Itinerary',
};

export function Review({ trip, route, update, jump }: PanelProps) {
  const form = formFor(route);
  const gaps = (Object.keys(GAP_LABEL) as SectionId[]).filter((s) => route.features.includes(s as never) && !sectionDone(trip, route, s));
  const toggle = (id: string, v: boolean) => update((t) => ({ ...t, reviewDone: { ...t.reviewDone, [id]: v } }));

  return (
    <div className="grid gap-6">
      <SectionHeader
        title="Review and export"
        description="Go through the list yourself before you submit. You are the final reviewer: the app prepares and checks, you confirm."
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => window.print()}>
              <Printer /> Print or save as PDF
            </Button>
            {route.applyUrl && (
              <Button variant="outline" asChild>
                <a href={route.applyUrl} target="_blank" rel="noreferrer">
                  {route.applyLabel ?? 'Official page'} <ArrowUpRight />
                </a>
              </Button>
            )}
          </div>
        }
      />

      {gaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warning/15 px-4 py-3 text-sm">
          Still to finish:
          {gaps.map((g) => (
            <Button key={g} variant="outline" size="sm" onClick={() => jump(g)}>
              {GAP_LABEL[g]}
            </Button>
          ))}
        </div>
      )}

      <ul className="grid gap-2">
        {REVIEW_ITEMS.map((r) => (
          <li key={r.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-background/40 px-4 py-3 text-sm has-[[data-state=checked]]:border-success/40 has-[[data-state=checked]]:bg-success/8">
              <Checkbox checked={Boolean(trip.reviewDone[r.id])} onCheckedChange={(v) => toggle(r.id, v === true)} />
              {r.label}
            </label>
          </li>
        ))}
      </ul>

      {form && (
        <section className="grid gap-4">
          <h3 className="font-heading font-semibold">Copy sheet</h3>
          {trip.travellers.map((t) => (
            <div key={t.id} className="grid gap-1 rounded-xl border border-border p-3">
              <div className="mb-1 text-sm font-semibold">{travellerName(t)}</div>
              {allFields(form)
                .map((f) => ({ f, v: fieldValue(trip, t, f) }))
                .filter((x) => x.v)
                .map(({ f, v }) => (
                  <div key={f.id} className="grid grid-cols-[1fr_auto] items-center gap-2 border-t border-border/60 py-1.5 text-sm sm:grid-cols-[14rem_1fr_auto]">
                    <span className="col-span-2 text-xs text-muted-foreground sm:col-span-1">
                      {f.number && `${f.number}. `}
                      {f.label}
                    </span>
                    <span className="break-words whitespace-pre-wrap">{v}</span>
                    <CopyButton text={v} className="h-7" />
                  </div>
                ))}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** Rendered only when printing, so the browser's "Save as PDF" produces the application packet. */
export function PrintPacket({ trip, route }: { trip: Trip; route: Route }) {
  const form = formFor(route);
  return (
    <div className="print-only packet">
      <section>
        <h1>{route.title}</h1>
        <p>
          {countryName(trip.input.nationality)} passport → {countryName(trip.input.destination)} · {PURPOSE_LABELS[trip.input.purpose]}
          <br />
          {formatDate(trip.input.departDate)} – {formatDate(trip.input.returnDate)}
          <br />
          Travellers: {trip.travellers.map(travellerName).join(', ')}
        </p>
        {route.fee && <p>Fee: {route.fee}</p>}
        {route.applyUrl && <p>Apply at: {route.applyUrl}</p>}
      </section>

      <section>
        <h2>Document checklist</h2>
        <ul>
          {route.checklist.map((c) => {
            const who = c.perTraveller ? trip.travellers : [undefined];
            return who.map((t) => {
              const done = trip.checklistDone[doneKey(c.id, t?.id)];
              const doc = t ? t.documents[c.id] : trip.sharedDocuments[c.id];
              return (
                <li key={`${c.id}-${t?.id ?? 'shared'}`}>
                  [{done ? 'x' : ' '}] {c.label}
                  {t && ` (${travellerName(t)})`}
                  {doc?.verification && ` — check: ${doc.verification.overall}`}
                  {' — '}source: {c.source.url} (checked {c.source.retrievedOn})
                </li>
              );
            });
          })}
        </ul>
      </section>

      {form &&
        trip.travellers.map((t) => (
          <section key={t.id}>
            <h2>
              {form.title}: {travellerName(t)}
            </h2>
            <table>
              <tbody>
                {allFields(form)
                  .map((f) => ({ f, v: fieldValue(trip, t, f) }))
                  .filter((x) => x.v)
                  .map(({ f, v }) => (
                    <tr key={f.id}>
                      <td style={{ paddingRight: 16, verticalAlign: 'top' }}>
                        {f.number && `${f.number}. `}
                        {f.label}
                      </td>
                      <td style={{ whiteSpace: 'pre-wrap' }}>{v}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))}

      {trip.itineraryText && (
        <section>
          <h2>Itinerary</h2>
          <pre>{trip.itineraryText}</pre>
        </section>
      )}

      {trip.coverLetter && route.features.includes('cover_letter') && (
        <section style={{ breakBefore: 'page' }}>
          <pre>{trip.coverLetter}</pre>
        </section>
      )}
    </div>
  );
}
