import { describe, expect, it } from 'vitest';
import { newVaultKey, seal, unseal, type SealedBlob, type VaultKey } from './vault';

const bytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const b64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));

async function sealed(): Promise<{ blob: SealedBlob; vk: VaultKey }> {
  const vk = await newVaultKey('correct horse battery', 1000);
  return { blob: await seal({ names: ['Anna'] }, vk), vk };
}

describe('vault tamper detection', () => {
  it('rejects ciphertext with one byte changed', async () => {
    const { blob, vk } = await sealed();
    const data = bytes(blob.data);
    data[0] ^= 0x01;
    await expect(unseal({ ...blob, data: b64(data) }, vk)).rejects.toThrow();
  });

  it('rejects ciphertext that has been cut short', async () => {
    const { blob, vk } = await sealed();
    await expect(unseal({ ...blob, data: blob.data.slice(0, -4) }, vk)).rejects.toThrow();
  });

  it('rejects a changed IV', async () => {
    const { blob, vk } = await sealed();
    const iv = bytes(blob.iv);
    iv[0] ^= 0x80;
    await expect(unseal({ ...blob, iv: b64(iv) }, vk)).rejects.toThrow();
  });
});
