import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Flag } from '@/components/app/Flag';
import { countryName } from '@/data/countries';
import { hasWebGL, useReducedMotion } from '@/hooks';
import { cn } from '@/lib/utils';

const TripGlobe = lazy(() => import('./TripGlobe'));

/**
 * Lazy-loads the 3D globe; shows a static disc when WebGL is missing or before the globe has been on screen.
 * The globe is not downloaded for a slot that never shows (for example the workspace globe on a phone, which is hidden),
 * and its render loop stops while the slot is scrolled out of view.
 */
export function GlobeSlot({ from, to, className }: { from?: string; to?: string; className?: string }) {
  const reduced = useReducedMotion();
  const webgl = useMemo(hasWebGL, []);
  const ref = useRef<HTMLDivElement>(null);
  const [everVisible, setEverVisible] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !webgl) return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (entry.isIntersecting) setEverVisible(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [webgl]);

  const label = from && to ? `Route from ${countryName(from)} to ${countryName(to)}` : 'Globe';
  const fallback = <div className="size-full rounded-full bg-[radial-gradient(circle_at_35%_30%,#2b56b8,#0a1638_60%,#060c20)] shadow-[0_0_90px_-12px_rgba(79,141,255,0.55)]" />;
  return (
    <div ref={ref} className={cn('relative aspect-square w-full', className)} role="img" aria-label={label}>
      {webgl && everVisible ? (
        <Suspense fallback={fallback}>
          <TripGlobe from={from} to={to} reduced={reduced} active={visible} />
        </Suspense>
      ) : (
        fallback
      )}
      {from && to && (
        <div
          aria-hidden="true"
          className="glass-subtle absolute bottom-[3%] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap"
        >
          <Flag code={from} className="h-3.5" />
          {countryName(from)}
          <span className="text-muted-foreground">→</span>
          <Flag code={to} className="h-3.5" />
          {countryName(to)}
        </div>
      )}
    </div>
  );
}
