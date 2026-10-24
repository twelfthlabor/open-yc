import { Check, Copy, ExternalLink, FileUp } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Source } from '@/rules/types';
import type { CheckStatus } from '@/store/model';

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          // Clipboard blocked; the value stays visible to select by hand.
        }
      }}
    >
      {done ? <Check /> : <Copy />}
      {done ? 'Copied' : label}
    </Button>
  );
}

const STALE_DAYS = 30;

export function daysSince(iso: string, today = new Date()): number {
  return Math.floor((today.getTime() - new Date(iso + 'T00:00:00Z').getTime()) / 86_400_000);
}

export function SourceLink({ source, className }: { source: Source; className?: string }) {
  const stale = daysSince(source.retrievedOn) > STALE_DAYS;
  return (
    <div className={cn('text-xs text-muted-foreground', className)}>
      <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
        {source.label}
        <ExternalLink className="size-3" />
      </a>{' '}
      · checked {source.retrievedOn}
      {stale && <StatusPill status="warn" className="ml-1.5">re-check: over {STALE_DAYS} days old</StatusPill>}
    </div>
  );
}

const PILL: Record<CheckStatus | 'neutral' | 'accent', string> = {
  pass: 'bg-success/15 text-success',
  fail: 'bg-destructive/12 text-destructive',
  warn: 'bg-warning/20 text-warning-foreground dark:text-warning',
  info: 'bg-muted text-muted-foreground',
  neutral: 'bg-muted text-muted-foreground',
  accent: 'bg-primary/12 text-primary',
};

export function StatusPill({ status, children, className }: { status: keyof typeof PILL; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', PILL[status], className)}>{children}</span>;
}

export function ProgressRing({ value, size = 56, label }: { value: number; size?: number; label?: string }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label ?? `${Math.round(pct * 100)}% complete`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-border" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className={pct >= 1 ? 'stroke-success' : 'stroke-primary'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-xs font-semibold tabular-nums">{Math.round(pct * 100)}%</span>
    </div>
  );
}

export function SectionHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function FileDrop({
  onFile,
  accept = 'image/*,application/pdf',
  label = 'Drop a file or click to choose',
  hint,
  compact,
}: {
  onFile: (f: File) => void;
  accept?: string;
  label?: string;
  hint?: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={cn(
        'flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border text-center transition-colors hover:border-primary hover:bg-primary/5',
        over && 'border-primary bg-primary/5',
        compact ? 'px-3 py-2.5 text-sm' : 'flex-col px-6 py-8',
      )}
    >
      <FileUp className={cn('text-muted-foreground', compact ? 'size-4' : 'size-6')} />
      <div>
        <div className="font-medium">{label}</div>
        {hint && !compact && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Shrinks photos before they are stored or sent, keeping text readable. PDFs pass through. */
export async function prepareFile(file: File, maxSide = 1800): Promise<{ dataUrl: string; base64: string; mediaType: string }> {
  if (file.type === 'application/pdf') {
    const dataUrl = await readAsDataUrl(file);
    return { dataUrl, base64: dataUrl.split(',')[1], mediaType: 'application/pdf' };
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  return { dataUrl, base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
}

export function GlassCard({ className, children, ...rest }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('glass rounded-2xl p-5 sm:p-6', className)} {...rest}>
      {children}
    </div>
  );
}
