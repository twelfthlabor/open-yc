import { Pencil, Plus, ScanLine, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { SectionHeader, StatusPill } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/drafts/templates';
import { newTraveller, travellerName } from '@/store/model';
import { checkPassport, overall } from '@/verify/checks';
import { PassportReader } from './PassportReader';
import type { PanelProps } from './Workspace';

const OVERALL_TEXT = { pass: 'Passport checks passed', warn: 'Check the warnings', fail: 'Passport problem', info: 'Not checked' } as const;

export function Travellers({ trip, route, update }: PanelProps) {
  const [reading, setReading] = useState<string | null>(trip.travellers.find((t) => !t.passport)?.id ?? null);

  const rename = (id: string, label: string) => update((t) => ({ ...t, travellers: t.travellers.map((x) => (x.id === id ? { ...x, label } : x)) }));
  const remove = (id: string) => update((t) => ({ ...t, travellers: t.travellers.filter((x) => x.id !== id) }));
  const add = () => {
    const next = newTraveller(`Traveller ${trip.travellers.length + 1}`);
    update((t) => ({ ...t, travellers: [...t.travellers, next] }));
    setReading(next.id);
  };

  return (
    <div className="grid gap-5">
      <SectionHeader
        title="Travellers and passports"
        description="Everyone on this application uses the same passport nationality. Read each passport once; the app fills their form answers from it."
        action={
          <Button variant="outline" onClick={add} disabled={trip.travellers.length >= 9}>
            <Plus /> Add traveller
          </Button>
        }
      />
      {trip.travellers.map((t, i) => {
        const checks = t.passport ? checkPassport(t.passport, trip, route, new Date()) : [];
        const status = t.passport ? overall(checks) : 'info';
        return (
          <div key={t.id} className="grid gap-4 rounded-2xl border border-border bg-background/50 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                <UserRound className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                {t.passport ? (
                  <div className="font-semibold">{travellerName(t)}</div>
                ) : (
                  <Input aria-label={`Name of traveller ${i + 1}`} className="h-9 max-w-xs rounded-lg" value={t.label} onChange={(e) => rename(t.id, e.target.value)} />
                )}
                <div className="text-xs text-muted-foreground">
                  {i === 0 ? 'Lead traveller' : `Traveller ${i + 1}`}
                  {t.passport && ` · passport expires ${formatDate(t.passport.expiryDate)}`}
                </div>
              </div>
              {t.passport && <StatusPill status={status}>{OVERALL_TEXT[status]}</StatusPill>}
              <Button variant={t.passport ? 'outline' : 'default'} size="sm" onClick={() => setReading(reading === t.id ? null : t.id)}>
                {t.passport ? <Pencil /> : <ScanLine />}
                {t.passport ? 'Edit passport' : 'Read passport'}
              </Button>
              {trip.travellers.length > 1 && (
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${travellerName(t)}`} onClick={() => remove(t.id)}>
                  <Trash2 />
                </Button>
              )}
            </div>
            {t.passport && reading !== t.id && (
              <ul className="grid gap-1.5 text-sm">
                {checks.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <StatusPill status={c.status}>{c.status === 'pass' ? 'OK' : c.status === 'fail' ? 'Problem' : c.status === 'warn' ? 'Check' : 'Info'}</StatusPill>
                    <span>{c.label}</span>
                    {c.detail && <span className="text-xs text-muted-foreground">{c.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
            {reading === t.id && (
              <PassportReader
                trip={trip}
                traveller={t}
                onCancel={t.passport ? () => setReading(null) : undefined}
                onSave={(p) => {
                  update((x) => ({ ...x, travellers: x.travellers.map((y) => (y.id === t.id ? { ...y, passport: p } : y)) }));
                  setReading(trip.travellers.find((y) => y.id !== t.id && !y.passport)?.id ?? null);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
