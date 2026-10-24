import { Check, ChevronsUpDown } from 'lucide-react';
import { useId, useState } from 'react';
import { Flag } from '@/components/app/Flag';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { COUNTRIES, countryName } from '@/data/countries';
import { cn } from '@/lib/utils';

const SORTED = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));

interface Props {
  label: string;
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  badge?: (code: string) => string | undefined;
  /** Shown first, above the full list. */
  featured?: string[];
}

export function CountryCombobox({ label, value, onChange, placeholder = 'Choose a country', badge, featured = [] }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const featuredSet = new Set(featured);
  const item = (code: string, name: string) => (
    <CommandItem
      key={code}
      value={`${name} ${code}`}
      onSelect={() => {
        onChange(code);
        setOpen(false);
      }}
    >
      <Check className={cn('size-4', value === code ? 'opacity-100' : 'opacity-0')} />
      <Flag code={code} className="h-4" />
      <span className="flex-1">{name}</span>
      {badge?.(code) && <span className="text-xs text-primary">{badge(code)}</span>}
    </CommandItem>
  );
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} variant="outline" role="combobox" aria-expanded={open} className="h-11 w-full justify-between rounded-xl px-3.5 text-base font-normal">
            <span className={cn('flex min-w-0 items-center gap-2.5', !value && 'text-muted-foreground')}>
              {value && <Flag code={value} className="h-4" />}
              <span className="truncate">{value ? countryName(value) : placeholder}</span>
            </span>
            <ChevronsUpDown className="size-4 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command>
            <CommandInput placeholder="Search countries…" aria-label={`Search ${label.toLowerCase()}`} />
            <CommandList className="max-h-72">
              <CommandEmpty>No country found.</CommandEmpty>
              {featured.length > 0 && (
                <CommandGroup heading="Fully supported">{featured.map((c) => item(c, countryName(c)))}</CommandGroup>
              )}
              <CommandGroup heading={featured.length ? 'All countries' : undefined}>
                {SORTED.filter((c) => !featuredSet.has(c.code)).map((c) => item(c.code, c.name))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
