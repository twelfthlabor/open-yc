import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashToken, keyFromEnv, newToken, openBytes, openJson, sealBytes, sealJson } from './crypto';

const key = randomBytes(32);

describe('at-rest encryption', () => {
  it('round-trips bytes and JSON', () => {
    const data = Buffer.from('passport bytes');
    expect(openBytes(key, sealBytes(key, data, 'file:1'), 'file:1').equals(data)).toBe(true);
    expect(openJson(key, sealJson(key, { a: 1, b: ['x'] }, 'app:1'), 'app:1')).toEqual({ a: 1, b: ['x'] });
  });

  it('uses a fresh nonce every time', () => {
    const data = Buffer.from('same');
    expect(sealBytes(key, data, 'x').equals(sealBytes(key, data, 'x'))).toBe(false);
  });

  it('rejects tampering, a wrong key, and a sealed value moved to another record', () => {
    const sealed = sealBytes(key, Buffer.from('secret'), 'file:1');
    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 1] ^= 1;
    expect(() => openBytes(key, flipped, 'file:1')).toThrow();
    expect(() => openBytes(randomBytes(32), sealed, 'file:1')).toThrow();
    expect(() => openBytes(key, sealed, 'file:2')).toThrow();
  });

  it('reads the key from the environment and refuses a weak one', () => {
    expect(keyFromEnv(randomBytes(32).toString('base64')).length).toBe(32);
    expect(() => keyFromEnv(undefined)).toThrow(/SERVICE_KEY/);
    expect(() => keyFromEnv(Buffer.from('short').toString('base64'))).toThrow(/32 bytes/);
  });

  it('makes long random tokens and stores only their hash', () => {
    const t = newToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(newToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });
});
