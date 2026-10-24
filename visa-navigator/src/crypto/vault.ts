// Passphrase-encrypted storage. The key never leaves memory; only ciphertext is stored.
// PBKDF2-SHA256 -> AES-GCM-256, random salt per vault, random IV per write.
// Each blob records its iteration count, so vaults made with the earlier 310,000 still open and are
// re-sealed with the current count on unlock (upgradeVault).

/** OWASP's 2023 figure for PBKDF2-HMAC-SHA256. */
export const ITERATIONS = 600_000;
/** Shortest passphrase accepted for a new vault. */
export const MIN_PASSPHRASE = 12;

/** Why a new passphrase is not accepted, or '' when it is. */
export function newPassphraseError(pass: string, confirm: string): string {
  if (pass.length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`;
  if (pass !== confirm) return 'The two passphrases do not match.';
  return '';
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface SealedBlob {
  v: 1;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64 ciphertext
  iterations: number;
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations = ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface VaultKey {
  key: CryptoKey;
  salt: Uint8Array<ArrayBuffer>;
  iterations: number;
}

export async function newVaultKey(passphrase: string, iterations = ITERATIONS): Promise<VaultKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { key: await deriveKey(passphrase, salt, iterations), salt, iterations };
}

export async function openVaultKey(passphrase: string, blob: SealedBlob): Promise<VaultKey> {
  const salt = fromB64(blob.salt);
  return { key: await deriveKey(passphrase, salt, blob.iterations), salt, iterations: blob.iterations };
}

export async function seal(value: unknown, vk: VaultKey): Promise<SealedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = enc.encode(JSON.stringify(value));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vk.key, plain));
  return { v: 1, salt: toB64(vk.salt), iv: toB64(iv), data: toB64(cipher), iterations: vk.iterations };
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('That passphrase does not open this vault.');
  }
}

export async function unseal<T>(blob: SealedBlob, vk: VaultKey): Promise<T> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, vk.key, fromB64(blob.data));
    return JSON.parse(dec.decode(plain)) as T;
  } catch {
    throw new WrongPassphraseError();
  }
}

export interface VaultIo {
  listDocs(): Promise<Array<[string, SealedBlob]>>;
  writeDoc(id: string, blob: SealedBlob): Promise<void>;
  writeSealed(blob: SealedBlob): Promise<void>;
}

/**
 * Moves a vault made with fewer iterations to the current count: every file first, then the vault itself.
 * The new key keeps the vault's salt, so it comes out the same on a retry, and an upgrade that stopped
 * halfway finishes on the next unlock (files already re-sealed are skipped). Returns the key to use from now on.
 */
export async function upgradeVault(passphrase: string, vk: VaultKey, value: unknown, io: VaultIo, iterations = ITERATIONS): Promise<VaultKey> {
  if (vk.iterations >= iterations) return vk;
  const next: VaultKey = { key: await deriveKey(passphrase, vk.salt, iterations), salt: vk.salt, iterations };
  for (const [id, doc] of await io.listDocs()) {
    if (doc.iterations === iterations) continue;
    await io.writeDoc(id, await seal(await unseal(doc, vk), next));
  }
  await io.writeSealed(await seal(value, next));
  return next;
}
