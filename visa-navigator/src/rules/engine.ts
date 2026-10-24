import { countryName } from '../data/countries';
import type { DestinationRules, Route, TripInput } from './types';
import { SCHENGEN_RULES } from './schengen-states';
import { ukRules } from './uk';
import { usRules } from './us';

const REGISTRY: Record<string, DestinationRules> = {
  GBR: ukRules,
  USA: usRules,
  ...Object.fromEntries(SCHENGEN_RULES.map((r) => [r.code, r])),
};

export const SUPPORTED_DESTINATIONS = Object.keys(REGISTRY);

export function isSupportedDestination(code: string): boolean {
  return Object.hasOwn(REGISTRY, code);
}

export function resolveRoute(input: TripInput, today: Date = new Date()): Route {
  const rules = REGISTRY[input.destination];
  if (!rules) {
    return {
      id: 'unsupported-destination',
      kind: 'not_covered',
      title: `${countryName(input.destination)} is not covered yet`,
      summary:
        'This app only gives requirements it can source from official pages. Check the destination government’s official website for what you need.',
      checklist: [],
      steps: [],
      notes: ['Avoid third-party sites that imitate government services.'],
      sources: [],
      features: [],
    };
  }
  return rules.resolve(input, today);
}
