import { useEffect, useState } from 'react';
import { flagLoader } from '@/flags/flags';
import { cn } from '@/lib/utils';

/**
 * A real flag at its true 3:2 ratio. The box owns the shape, so the flag fills it with no crop or letterbox.
 * Pass a height (for example `h-8`); the width follows from the ratio.
 */
export function Flag({ code, className = 'h-8' }: { code: string; className?: string }) {
  const loader = flagLoader(code);
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    let live = true;
    loader?.().then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [loader]);

  return (
    <span className={cn('inline-flex aspect-[3/2] shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-black/10 dark:ring-white/10', className)} aria-hidden="true">
      {!loader ? (
        <span className="grid size-full place-items-center text-[0.6rem] font-semibold text-muted-foreground">{code}</span>
      ) : (
        src && <img src={src} alt="" className="size-full object-cover" />
      )}
    </span>
  );
}
