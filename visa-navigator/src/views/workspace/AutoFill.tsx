import { Bot, CircleStop, Hand, Loader2, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { autofillStatus, startAutofill, stopAutofill, type AutofillStatus, type AutofillWait } from '@/api';
import { fillItems, type Portal } from '@/autofill/portals';
import { StatusPill } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { localISODate } from '@/drafts/templates';
import type { FormDef } from '@/forms/forms';
import type { Route } from '@/rules/types';
import { travellerName, type Traveller, type Trip } from '@/store/model';

const LIVE = new Set<AutofillStatus['state']>(['starting', 'running', 'waiting']);

const WAIT_TITLE: Record<AutofillWait, string> = {
  captcha: 'Your turn: security code',
  login: 'Your turn: sign in',
  needs_you: 'Your turn: a few answers',
  declaration: 'Your turn: the declaration',
  submit: 'Your turn: press Submit',
  payment: 'Your turn: payment',
  other_site: 'Paused',
  stuck: 'Check the page',
  nothing_to_do: 'Waiting for the next page',
};

/** Fills the official online form in a Chrome window from the prepared answers, and hands over at the steps that are the user's. */
export function AutoFill({ trip, route, traveller, form, portal, update }: { trip: Trip; route: Route; traveller: Traveller; form: FormDef; portal: Portal; update: (patch: (t: Trip) => Trip) => void }) {
  const [allowSubmit, setAllowSubmit] = useState(true);
  const [status, setStatus] = useState<AutofillStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = useRef('');

  const running = status ? LIVE.has(status.state) : false;
  const polling = running || status?.state === 'submitted';

  useEffect(() => {
    if (!polling) return;
    const t = setInterval(() => {
      autofillStatus()
        .then(setStatus)
        .catch(() => {});
    }, 1000);
    return () => clearInterval(t);
  }, [polling]);

  // Saves the portal's serial number, PIN or reference into the tracker as soon as the page shows one.
  useEffect(() => {
    if (!status) return;
    const { serial, pin, reference } = status.captured;
    const text = [serial && `${portal.name} serial ${serial}`, pin && `PIN ${pin}`, reference && `Reference ${reference}`].filter(Boolean).join(', ');
    // CROVISA only saves the form online; the application itself is handed in at the consulate or visa centre.
    const submittedOnline = status.state === 'submitted' && form.id !== 'schengen_c';
    const key = `${text}|${submittedOnline}`;
    if ((!text && !submittedOnline) || saved.current === key) return;
    saved.current = key;
    update((t) => ({
      ...t,
      tracker: {
        ...t.tracker,
        ...(text ? { reference: text } : {}),
        ...(submittedOnline ? { status: 'submitted' as const, submittedOn: t.tracker.submittedOn ?? localISODate() } : {}),
      },
    }));
    if (text) toast.success(`Saved to the tracker: ${text}`);
  }, [status, portal.name, form.id, update]);

  const start = async () => {
    setBusy(true);
    try {
      saved.current = '';
      setStatus(await startAutofill({ formId: form.id, applyUrl: route.applyUrl, destination: trip.input.destination, allowSubmit, items: fillItems(trip, traveller, form) }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start.');
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      setStatus(await stopAutofill());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not stop.');
    } finally {
      setBusy(false);
    }
  };

  const yourTurn = status?.state === 'waiting' ? status.waitingFor : undefined;
  const captured = status ? [status.captured.serial && `Serial number ${status.captured.serial}`, status.captured.pin && `PIN ${status.captured.pin}`, status.captured.reference && `Reference ${status.captured.reference}`].filter(Boolean) : [];

  return (
    <div className="grid gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
          <Bot className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-heading font-semibold">Fill {portal.name} for me</div>
          <p className="text-sm text-muted-foreground">
            Opens the official form in a Chrome window and fills it with {travellerName(traveller)}’s answers, page by page. It stops for the parts that are yours: the security code, signing in,
            anything it has no answer for, the declaration and payment. It never makes up an answer.
          </p>
        </div>
        {running ? (
          <Button variant="outline" onClick={stop} disabled={busy}>
            <CircleStop /> Stop
          </Button>
        ) : (
          <Button onClick={start} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />} Start
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Switch id="af-submit" checked={allowSubmit} onCheckedChange={setAllowSubmit} disabled={running} />
        <Label htmlFor="af-submit" className="text-sm font-normal">
          Press Submit for me once I have ticked the declaration
        </Label>
      </div>

      {status && status.state !== 'idle' && (
        <div className="grid gap-2 rounded-xl bg-background/70 p-3 text-sm" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            {yourTurn ? (
              <StatusPill status="warn">
                <Hand className="size-3" /> {WAIT_TITLE[yourTurn]}
              </StatusPill>
            ) : status.state === 'submitted' ? (
              <StatusPill status="pass">Submitted</StatusPill>
            ) : status.state === 'error' ? (
              <StatusPill status="fail">Problem</StatusPill>
            ) : status.state === 'stopped' ? (
              <StatusPill status="neutral">Stopped</StatusPill>
            ) : (
              <StatusPill status="accent">
                <Loader2 className="size-3 animate-spin" /> Working
              </StatusPill>
            )}
            <span className="text-xs text-muted-foreground tabular-nums">{status.filled.length} fields filled</span>
          </div>
          <p>{status.message}</p>
          {captured.length > 0 && (
            <p className="font-medium">
              {captured.join(' · ')} <span className="font-normal text-muted-foreground">(saved to the tracker)</span>
            </p>
          )}
          {status.log.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">Activity</summary>
              <ol className="mt-1 max-h-40 overflow-auto text-xs text-muted-foreground">
                {status.log.slice(-40).map((l, i) => (
                  <li key={i}>
                    <span className="tabular-nums">{new Date(l.at).toLocaleTimeString()}</span> {l.text}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
