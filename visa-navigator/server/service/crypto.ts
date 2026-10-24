// At-rest encryption for the hosted service. Customer data (trip answers, passport images, documents,
// portal references) is sealed with AES-256-GCM under SERVICE_KEY before it reaches the database.
// Each value is bound to its record (the "aad"), so a sealed value copied onto another row will not open.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const IV = 12;
const TAG = 16;

export function keyFromEnv(value: string | undefined): Buffer {
  if (!value) throw new Error('SERVICE_KEY is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('SERVICE_KEY must be 32 bytes, base64-encoded.');
  return key;
}

/** Layout: nonce (12) | tag (16) | ciphertext. */
export function sealBytes(key: Buffer, data: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function openBytes(key: Buffer, sealed: Buffer, aad: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(sealed.subarray(IV, IV + TAG));
  return Buffer.concat([decipher.update(sealed.subarray(IV + TAG)), decipher.final()]);
}

export function sealJson(key: Buffer, value: unknown, aad: string): Buffer {
  return sealBytes(key, Buffer.from(JSON.stringify(value)), aad);
}

export function openJson<T = unknown>(key: Buffer, sealed: Buffer, aad: string): T {
  return JSON.parse(openBytes(key, sealed, aad).toString('utf8')) as T;
}

/** A random token for sign-in links and sessions. Only its hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
