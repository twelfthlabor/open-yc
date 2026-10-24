import { Lock, Monitor, Moon, Plane, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTheme, type ThemeChoice } from '@/components/app/theme';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useVault } from '@/state/VaultContext';

export function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2.5 font-heading text-[15px] font-semibold tracking-tight">
      <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
        <Plane className="size-4" />
      </span>
      Visa Navigator
    </button>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme">
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeChoice)}>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Shell({ children, onHome }: { children: ReactNode; onHome: () => void }) {
  const vault = useVault();
  return (
    <div className="min-h-dvh">
      <header className="no-print sticky top-0 z-40 px-3 pt-3 sm:px-5">
        <div className="glass mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-2xl px-3 py-2 sm:px-4">
          <Brand onClick={onHome} />
          <div className="flex items-center gap-1.5">
            <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">
              {vault.saving ? 'Saving…' : 'Saved · encrypted on this device'}
            </span>
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={() => vault.lock()}>
              <Lock />
              Lock
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-20 sm:px-6">{children}</main>
    </div>
  );
}
