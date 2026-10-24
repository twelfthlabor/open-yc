import { ALPHA2 } from './alpha2';

// Codes the ISO alpha-3 table does not map. The MRZ uses these (D for Germany, RKS for Kosovo), so they stay as they are in the data.
const OVERRIDES: Record<string, string> = { D: 'DE', RKS: 'XK' };

// Countries that have no flag at all (stateless persons). The UI shows a code tile for these.
export const NO_FLAG_CODES: readonly string[] = ['XXA'];

// One lazily loaded URL per 3:2 flag file. Each flag is fetched only when it is shown.
const FILES = import.meta.glob<string>('/node_modules/country-flag-icons/3x2/*.svg', { query: '?url', import: 'default' });

/** Path of the 3:2 flag file for an alpha-3 code, or undefined when there is none. */
export function flagFile(alpha3: string): string | undefined {
  const alpha2 = OVERRIDES[alpha3] ?? ALPHA2[alpha3];
  return alpha2 ? `/node_modules/country-flag-icons/3x2/${alpha2}.svg` : undefined;
}

/** Loads the URL of a flag file. Undefined when the code has no flag. */
export function flagLoader(alpha3: string): (() => Promise<string>) | undefined {
  const file = flagFile(alpha3);
  return file ? FILES[file] : undefined;
}
