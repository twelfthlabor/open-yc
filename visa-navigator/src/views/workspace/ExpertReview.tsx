import { Download, ScanSearch, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { preReview } from '@/api';
import { SectionHeader, StatusPill } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useHealth } from '@/hooks';
import { buildReviewPacket, NOT_ADVICE } from '@/review/packet';
import { aiReviewInput, RUBRIC, rubricSummary, runRubric, type RubricArea } from '@/review/rubric';
import type { SectionId } from './progress';
import type { PanelProps } from './Workspace';

const FIX: Partial<Record<RubricArea, SectionId>> = {
  passports: 'travellers',
  documents: 'documents',
  form: 'form',
  itinerary: 'itinerary',
  cover_letter: 'cover_letter',
  booking: 'appointment',
};

function download(name: string, html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Pre-review by a fixed rubric (code), optional AI comments, and a packet for a human reviewer. */
export function ExpertReview({ trip, route, update, jump }: PanelProps) {
  const health = useHealth();
  const items = useMemo(() => runRubric(trip, route), [trip, route]);
  const sum = rubricSummary(items);
  const review = trip.expertReview ?? {};
  const [personal, setPersonal] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<NonNullable<typeof trip.expertReview>>) => update((t) => ({ ...t, expertReview: { ...t.expertReview, ...patch } }));
  const areas = (Object.keys(RUBRIC) as RubricArea[]).filter((a) => items.some((i) => i.area === a));

  async function runAi() {
    setBusy(true);
    try {
      const findings = await preReview(aiReviewInput(trip, route, items));
      set({ aiFindings: findings, aiAt: new Date().toISOString() });
      toast.success(findings.length ? `${findings.length} comment${findings.length > 1 ? 's' : ''} added.` : 'No extra comments.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not run the AI pre-review.');
    } finally {
      setBusy(false);
    }
  }

  function exportPacket() {
    const html = buildReviewPacket(trip, route, items, { includePersonal: personal, findings: review.aiFindings });
    download(`review-packet-${trip.input.destination.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.html`, html);
    set({ exportedAt: new Date().toISOString() });
  }

  return (
    <div className="grid gap-6">
      <SectionHeader
        title="Expert review"
        description="Check the application against a fixed rubric, then send a packet to a person you trust to review it: a lawyer, an accredited adviser or an experienced friend."
      />

      <p className="flex items-start gap-2 rounded-xl bg-warning/15 px-4 py-3 text-sm" role="note">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          {NOT_ADVICE} The rubric checks completeness and consistency only. It gives no score and says nothing about your chances.
        </span>
      </p>

      <section className="grid gap-3" aria-label="Rubric">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-heading font-semibold">Pre-review rubric</h3>
          <StatusPill status="fail">{sum.fail} to fix</StatusPill>
          <StatusPill status="warn">{sum.warn} to check</StatusPill>
          <StatusPill status="pass">{sum.pass} fine</StatusPill>
        </div>
        {areas.map((a) => (
          <div key={a} className="grid gap-1.5 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{RUBRIC[a].title}</span>
              <span className="text-xs text-muted-foreground">{RUBRIC[a].asks}</span>
              {FIX[a] && route.features.includes(FIX[a] as never) && items.some((i) => i.area === a && (i.status === 'fail' || i.status === 'warn')) && (
                <Button variant="outline" size="xs" className="ml-auto" onClick={() => jump(FIX[a]!)}>
                  Fix
                </Button>
              )}
            </div>
            <ul className="grid gap-1 text-sm">
              {items
                .filter((i) => i.area === a)
                .map((i, n) => (
                  <li key={n} className="flex items-start gap-2">
                    <StatusPill status={i.status}>{i.status}</StatusPill>
                    <span>{i.text}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="grid gap-2" aria-label="AI comments">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-heading font-semibold">AI comments</h3>
          {health?.ai ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={runAi}>
              <ScanSearch /> {busy ? 'Reading…' : review.aiAt ? 'Run again' : 'Ask AI for a second look'}
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">Add ANTHROPIC_API_KEY to .env for AI comments. The rubric works without it.</span>
          )}
        </div>
        {review.aiFindings && review.aiFindings.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {review.aiFindings.map((f, n) => (
              <li key={n} className="flex items-start gap-2">
                <StatusPill status={f.severity}>{f.severity}</StatusPill>
                <span>
                  <b>{f.area}:</b> {f.comment}
                </span>
              </li>
            ))}
          </ul>
        )}
        {review.aiFindings && review.aiFindings.length === 0 && <p className="text-sm text-muted-foreground">The AI found nothing beyond the rubric.</p>}
        <p className="text-xs text-muted-foreground">The AI sees the rubric results, itinerary and cover letter, with passport numbers, your home address, email and phone, and anything shaped like an email or phone number removed. No images or documents are sent.</p>
      </section>

      <section className="grid gap-3 rounded-2xl border border-border p-4" aria-label="Reviewer packet">
        <h3 className="font-heading font-semibold">Packet for a human reviewer</h3>
        <p className="text-sm text-muted-foreground">
          One HTML file with the rubric, checklist and sources, every answer, the itinerary and the cover letter, plus a space for the reviewer’s notes. It is made on this device; you
          choose how to send it. Passport images and uploaded documents are never included.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Switch id="packet-personal" checked={personal} onCheckedChange={setPersonal} />
          <Label htmlFor="packet-personal">Include passport numbers and contact details</Label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={exportPacket}>
            <Download /> Download review packet
          </Button>
          {review.exportedAt && <span className="text-sm text-muted-foreground">Last exported {new Date(review.exportedAt).toLocaleString()}</span>}
        </div>
      </section>

      <section className="grid gap-2" aria-label="Reviewer feedback">
        <h3 className="font-heading font-semibold">Reviewer feedback</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="reviewer">Reviewer</Label>
            <Input id="reviewer" className="h-10 rounded-xl" placeholder="Name or role" value={review.reviewer ?? ''} onChange={(e) => set({ reviewer: e.target.value })} />
          </div>
        </div>
        <Label htmlFor="reviewer-notes">Notes from the reviewer</Label>
        <Textarea
          id="reviewer-notes"
          className="min-h-28 rounded-xl"
          placeholder="Paste the reviewer’s notes here, then fix each point in its section."
          value={review.reviewerNotes ?? ''}
          onChange={(e) => set({ reviewerNotes: e.target.value, receivedAt: review.receivedAt ?? new Date().toISOString() })}
        />
      </section>
    </div>
  );
}
