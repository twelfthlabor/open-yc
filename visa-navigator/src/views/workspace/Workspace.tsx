import { ArrowLeft, BadgeCheck, BellRing, CalendarClock, ClipboardCheck, FileCheck2, FilePenLine, LayoutDashboard, Mail, Map, Trash2, Users } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState, type ComponentType } from 'react';
import { GlassCard, ProgressRing } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { countryName } from '@/data/countries';
import { GlobeSlot } from '@/globe/GlobeSlot';
import { cn } from '@/lib/utils';
import { resolveRoute } from '@/rules/engine';
import { PURPOSE_LABELS, type Route } from '@/rules/types';
import { useVault } from '@/state/VaultContext';
import type { Trip } from '@/store/model';
import { RouteSummary } from '../RouteSummary';
import { Appointment } from './Appointment';
import { Documents } from './Documents';
import { ExpertReview } from './ExpertReview';
import { CoverLetter, Itinerary } from './Drafts';
import { FillAlong } from './FillAlong';
import { Notifications } from './Notifications';
import { Overview } from './Overview';
import { sectionDone, tripProgress, type SectionId } from './progress';
import { PrintPacket, Review } from './Review';
import { Travellers } from './Travellers';

export interface PanelProps {
  trip: Trip;
  route: Route;
  update: (patch: (t: Trip) => Trip) => void;
  jump: (s: SectionId) => void;
}

const SECTIONS: Record<SectionId, { label: string; icon: ComponentType<{ className?: string }>; panel: ComponentType<PanelProps> }> = {
  overview: { label: 'Overview', icon: LayoutDashboard, panel: Overview },
  travellers: { label: 'Travellers & passports', icon: Users, panel: Travellers },
  documents: { label: 'Documents', icon: FileCheck2, panel: Documents },
  form: { label: 'Application form', icon: FilePenLine, panel: FillAlong },
  itinerary: { label: 'Itinerary', icon: Map, panel: Itinerary },
  cover_letter: { label: 'Cover letter', icon: Mail, panel: CoverLetter },
  appointment: { label: 'Appointment & tracking', icon: CalendarClock, panel: Appointment },
  notifications: { label: 'Reminders', icon: BellRing, panel: Notifications },
  review: { label: 'Review & export', icon: ClipboardCheck, panel: Review },
  expert_review: { label: 'Expert review', icon: BadgeCheck, panel: ExpertReview },
};

export function Workspace({ tripId, onBack }: { tripId: string; onBack: () => void }) {
  const vault = useVault();
  const trip = vault.data.trips.find((t) => t.id === tripId);
  const route = useMemo(() => (trip ? resolveRoute(trip.input) : null), [trip]);
  const [section, setSection] = useState<SectionId>('overview');
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!trip || !route) {
    return (
      <GlassCard>
        This application no longer exists.{' '}
        <Button variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
      </GlassCard>
    );
  }

  const update = (patch: (t: Trip) => Trip) => vault.updateTrip(trip.id, patch);
  // Expert review follows the self-review on every route that has one.
  const ids: SectionId[] = ['overview', ...route.features.flatMap((f): SectionId[] => (f === 'review' ? ['review', 'expert_review'] : [f]))];
  const Panel = SECTIONS[section].panel;
  const pct = tripProgress(trip, route);

  return (
    <>
      <div className="no-print grid gap-5">
        <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>
          <ArrowLeft /> All applications
        </Button>
        <section className="grid items-center gap-5 md:grid-cols-[1fr_15rem]">
          <GlassCard className="grid gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                {countryName(trip.input.nationality)} passport → {countryName(trip.input.destination)} · {PURPOSE_LABELS[trip.input.purpose]} · {trip.travellers.length}{' '}
                traveller{trip.travellers.length > 1 ? 's' : ''}
              </div>
              <ProgressRing value={pct} label={`${Math.round(pct * 100)}% ready`} />
            </div>
            <RouteSummary route={route} compact />
          </GlassCard>
          <GlobeSlot from={trip.input.nationality} to={trip.input.destination} className="hidden md:block" />
        </section>

        <section className="grid items-start gap-5 md:grid-cols-[15rem_1fr]">
          <nav aria-label="Application sections" className="glass flex gap-1 overflow-x-auto rounded-2xl p-2 md:sticky md:top-24 md:flex-col">
            {ids.map((id) => {
              const s = SECTIONS[id];
              const done = sectionDone(trip, route, id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={section === id ? 'page' : undefined}
                  onClick={() => setSection(id)}
                  className={cn('relative flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm whitespace-nowrap transition-colors hover:bg-foreground/5', section === id && 'font-medium text-primary')}
                >
                  {section === id && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-xl bg-primary/10" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                  <s.icon className="relative size-4" />
                  <span className="relative flex-1">{s.label}</span>
                  {done && <span className="relative size-2 rounded-full bg-success" aria-label="done" />}
                </button>
              );
            })}
            <div className="mt-1 border-t border-border pt-1 md:mt-2 md:pt-2">
              {confirmDelete ? (
                <div className="grid gap-2 p-2 text-xs">
                  <span>Delete this application and its documents?</span>
                  <div className="flex gap-1.5">
                    <Button
                      variant="destructive"
                      size="xs"
                      onClick={() => {
                        vault.removeTrip(trip.id);
                        onBack();
                      }}
                    >
                      Delete
                    </Button>
                    <Button variant="outline" size="xs" onClick={() => setConfirmDelete(false)}>
                      Keep
                    </Button>
                  </div>
                </div>
              ) : (
                <button type="button" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-3.5" /> Delete application
                </button>
              )}
            </div>
          </nav>

          <GlassCard className="min-h-[24rem]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={section} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                <Panel trip={trip} route={route} update={update} jump={setSection} />
              </motion.div>
            </AnimatePresence>
          </GlassCard>
        </section>
      </div>
      <PrintPacket trip={trip} route={route} />
    </>
  );
}
