// What the home page's destination cards say. Kept apart from Home.tsx so the wording can be tested:
// France and the Netherlands are paperwork-only (rules/schengen-states.ts), and AI features are only
// offered as such when the local server has an API key (useHealth().ai).
import { BadgeCheck, BellRing, CalendarSearch, FileCheck2, FilePenLine, Mail, Map as MapIcon, ScanLine, Sparkles, type LucideIcon } from 'lucide-react';
import { stateProfile } from '@/rules/schengen-states';

export const DESTINATIONS = [
  { code: 'SWE', name: 'Sweden', tag: 'Schengen short-stay visa', popular: false },
  { code: 'GBR', name: 'United Kingdom', tag: 'ETA, visitor, youth and work visas', popular: false },
  { code: 'USA', name: 'United States', tag: 'ESTA or B-1/B-2 visitor visa with interview', popular: false },
  { code: 'FRA', name: 'France', tag: 'Schengen visa paperwork packet', popular: false },
  { code: 'NLD', name: 'Netherlands', tag: 'Schengen visa paperwork packet', popular: false },
  { code: 'HRV', name: 'Croatia', tag: 'Schengen visa with CROVISA autofill', popular: false },
];

export function serviceLabel(code: string): 'Full service' | 'Paperwork only' {
  return stateProfile(code)?.service === 'paperwork' ? 'Paperwork only' : 'Full service';
}

export interface PackageItem {
  icon: LucideIcon;
  text: string;
}

/** The package list. `ai` is whether an API key is configured; null (not known yet, or server offline) counts as no. */
export function packageItems(ai: boolean | null): PackageItem[] {
  return [
    { icon: FilePenLine, text: 'Visa application filled in with you, field by field' },
    { icon: CalendarSearch, text: 'Appointment booking assistant' },
    { icon: BellRing, text: 'Appointment availability tracking' },
    { icon: Sparkles, text: 'WhatsApp and desktop reminders' },
    { icon: FileCheck2, text: ai ? 'AI document verification' : 'Document checks against the requirement (AI reading needs an API key)' },
    { icon: Mail, text: 'Cover letter written from your trip facts' },
    { icon: MapIcon, text: 'Day-by-day itinerary checked against your bookings' },
    { icon: BadgeCheck, text: 'Rubric pre-review and a packet for a human reviewer' },
    { icon: ScanLine, text: ai ? 'Passport reading with check-digit verification' : 'Passport check-digit verification (photo reading needs an API key)' },
  ];
}
