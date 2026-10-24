// Official portals the autofill may work on, per form. The runner only reads and types on pages whose
// host is listed here; anywhere else (a payment provider, an appointment centre) it pauses.

import { allFields, fieldValue, type FormDef } from '../forms/forms';
import type { FormId } from '../rules/types';
import type { Traveller, Trip } from '../store/model';
import type { FillItem, PlanOptions } from './match';

export interface Portal extends PlanOptions {
  name: string;
  /** Where the run starts. Without one, the route's sourced apply link is used. */
  startUrl?: string;
  /** Host names, or suffixes starting with a dot. */
  hosts: string[];
  /**
   * Destinations whose application this portal takes. The Schengen form is shared by every Schengen state, but
   * CROVISA only takes applications for Croatia, so a Swedish or French application must never be typed into it.
   */
  destinations?: string[];
}

const UK: Portal = {
  name: 'gov.uk',
  hosts: ['www.gov.uk', '.service.gov.uk', '.homeoffice.gov.uk'],
  aliases: {
    host_address: ['address where you will stay', 'where will you stay'],
  },
};

// Forms without an entry (the DS-160) have no autofill: ceac.state.gov is filled along by hand.
export const PORTALS: Partial<Record<FormId, Portal>> = {
  schengen_c: {
    name: 'CROVISA',
    startUrl: 'https://crovisa.mvep.hr/NewVisaRequest?lang=en',
    hosts: ['crovisa.mvep.hr'],
    destinations: ['HRV'],
    dateFormat: 'dd.mm.yyyy',
    hints: { purpose: 'purpose' },
    aliases: {
      purpose: ['type of visa requested and the main purpose of travel', 'main purpose of travel', 'purpose of the journey'],
    },
  },
  uk_visitor: UK,
  uk_eta: UK,
  uk_youth_mobility: UK,
  uk_skilled_worker: UK,
};

/** The portal the autofill may use for this form and destination, if any. */
export function portalFor(formId: FormId, destination: string): Portal | undefined {
  const portal = PORTALS[formId];
  if (!portal) return undefined;
  if (portal.destinations && !portal.destinations.includes(destination)) return undefined;
  return portal;
}

/** Plain http is accepted only on this machine, where the tests serve local copies of the portal pages. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Whether the runner may act on this page: https on one of the portal's hosts. */
export function hostAllowed(url: string, hosts: string[]): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return false;
    host = u.hostname;
  } catch {
    return false;
  }
  return hosts.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
}

/** Every answer on the form for one traveller, ready to send to the runner. Empty answers are kept so
 * the matcher can claim their fields and leave them alone instead of filling them with something else. */
export function fillItems(trip: Trip, traveller: Traveller, form: FormDef): FillItem[] {
  return allFields(form).map((f) => ({
    id: f.id,
    label: f.label,
    number: f.number,
    value: fieldValue(trip, traveller, f),
    type: f.type,
  }));
}
