import { describe, expect, it } from 'vitest';
import { DESTINATIONS, packageItems, serviceLabel } from './homeCards';

describe('home destination cards', () => {
  it('labels France and the Netherlands paperwork only, the rest full service', () => {
    expect(serviceLabel('FRA')).toBe('Paperwork only');
    expect(serviceLabel('NLD')).toBe('Paperwork only');
    for (const code of ['SWE', 'GBR', 'USA', 'HRV']) expect(serviceLabel(code), code).toBe('Full service');
    expect(DESTINATIONS.map((d) => d.code)).toEqual(['SWE', 'GBR', 'USA', 'FRA', 'NLD', 'HRV']);
  });

  it('marks the AI features as needing an API key when none is configured', () => {
    const off = packageItems(false).map((p) => p.text);
    expect(off.filter((t) => /\bAI\b/.test(t)).every((t) => /needs an API key/.test(t))).toBe(true);
    expect(off).toContain('Document checks against the requirement (AI reading needs an API key)');
    expect(off).toContain('Passport check-digit verification (photo reading needs an API key)');
  });

  it('treats an unknown key status (server not answered yet, or offline) as no key', () => {
    expect(packageItems(null).map((p) => p.text)).toEqual(packageItems(false).map((p) => p.text));
  });

  it('lists the AI features plainly when a key is configured', () => {
    const on = packageItems(true).map((p) => p.text);
    expect(on).toContain('AI document verification');
    expect(on).toContain('Passport reading with check-digit verification');
    expect(on.some((t) => /API key/.test(t))).toBe(false);
  });
});
