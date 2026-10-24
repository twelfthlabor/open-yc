import { describe, expect, it } from 'vitest';
import { ITERATIONS, MIN_PASSPHRASE, newPassphraseError, newVaultKey, openVaultKey, seal, unseal, upgradeVault, WrongPassphraseError, type SealedBlob } from './vault';

describe('vault encryption', () => {
  it('round-trips data with the right passphrase', async () => {
    const vk = await newVaultKey('correct horse battery', 1000);
    const blob = await seal({ passport: 'L898902C3', names: ['Anna'] }, vk);
    expect(blob.data).not.toContain('L898902C3');
    const reopened = await openVaultKey('correct horse battery', blob);
    expect(await unseal(blob, reopened)).toEqual({ passport: 'L898902C3', names: ['Anna'] });
  });

  it('rejects the wrong passphrase', async () => {
    const vk = await newVaultKey('right', 1000);
    const blob = await seal({ a: 1 }, vk);
    const wrong = await openVaultKey('wrong', blob);
    await expect(unseal(blob, wrong)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('uses a fresh IV for every write', async () => {
    const vk = await newVaultKey('x', 1000);
    const a = await seal({ same: true }, vk);
    const b = await seal({ same: true }, vk);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });
});

describe('key strength upgrade', () => {
  it('makes new vaults with 600,000 PBKDF2 iterations and opens them again', async () => {
    expect(ITERATIONS).toBe(600_000);
    const vk = await newVaultKey('correct horse battery');
    const blob = await seal({ a: 1 }, vk);
    expect(blob.iterations).toBe(600_000);
    expect(await unseal(blob, await openVaultKey('correct horse battery', blob))).toEqual({ a: 1 });
  });

  it('still opens a vault sealed with the old 310,000 iterations', async () => {
    const old = await seal({ trips: ['old'] }, await newVaultKey('correct horse battery', 310_000));
    expect(old.iterations).toBe(310_000);
    expect(await unseal(old, await openVaultKey('correct horse battery', old))).toEqual({ trips: ['old'] });
  });

  function memoryStore(vault: SealedBlob, docs: Record<string, SealedBlob>) {
    const state = { vault, docs: { ...docs } };
    return {
      state,
      io: {
        listDocs: async () => Object.entries(state.docs),
        writeDoc: async (id: string, blob: SealedBlob) => void (state.docs[id] = blob),
        writeSealed: async (blob: SealedBlob) => void (state.vault = blob),
      },
    };
  }

  it('re-seals an old vault and its files with the stronger key; files still open afterwards', async () => {
    const oldKey = await newVaultKey('pass phrase', 1000);
    const { state, io } = memoryStore(await seal({ trips: ['t'] }, oldKey), { f1: await seal({ dataUrl: 'data:a' }, oldKey), f2: await seal({ dataUrl: 'data:b' }, oldKey) });

    const vk = await upgradeVault('pass phrase', oldKey, { trips: ['t'] }, io, 2000);
    expect(vk.iterations).toBe(2000);
    expect(state.vault.iterations).toBe(2000);
    expect(Object.values(state.docs).map((d) => d.iterations)).toEqual([2000, 2000]);

    const reopened = await openVaultKey('pass phrase', state.vault);
    expect(await unseal(state.vault, reopened)).toEqual({ trips: ['t'] });
    expect(await unseal(state.docs.f1, reopened)).toEqual({ dataUrl: 'data:a' });
    expect(await unseal(state.docs.f2, reopened)).toEqual({ dataUrl: 'data:b' });
  });

  it('finishes an upgrade that stopped halfway (some files already re-sealed)', async () => {
    const oldKey = await newVaultKey('pass phrase', 1000);
    const first = memoryStore(await seal({ n: 1 }, oldKey), { f1: await seal({ dataUrl: 'one' }, oldKey), f2: await seal({ dataUrl: 'two' }, oldKey) });
    // Simulate a crash: f1 was re-sealed, the vault and f2 were not.
    const crashed = { ...first.io, writeDoc: async (id: string, blob: SealedBlob) => { if (id === 'f2') throw new Error('crash'); first.state.docs[id] = blob; } };
    await expect(upgradeVault('pass phrase', oldKey, { n: 1 }, crashed, 2000)).rejects.toThrow('crash');
    expect(first.state.vault.iterations).toBe(1000);
    expect(first.state.docs.f1.iterations).toBe(2000);

    const again = await openVaultKey('pass phrase', first.state.vault);
    const vk = await upgradeVault('pass phrase', again, { n: 1 }, first.io, 2000);
    expect(await unseal(first.state.docs.f1, vk)).toEqual({ dataUrl: 'one' });
    expect(await unseal(first.state.docs.f2, vk)).toEqual({ dataUrl: 'two' });
    expect(await unseal(first.state.vault, vk)).toEqual({ n: 1 });
  });

  it('leaves a vault that is already strong enough alone', async () => {
    const vk = await newVaultKey('pass phrase', 2000);
    const vault = await seal({ n: 1 }, vk);
    const { state, io } = memoryStore(vault, {});
    expect(await upgradeVault('pass phrase', vk, { n: 1 }, io, 2000)).toBe(vk);
    expect(state.vault).toBe(vault);
  });
});

describe('new passphrase rules', () => {
  it('asks for at least 12 characters and a matching confirmation', () => {
    expect(MIN_PASSPHRASE).toBe(12);
    expect(newPassphraseError('elevenchars', 'elevenchars')).toBe('Use at least 12 characters.');
    expect(newPassphraseError('twelve chars', 'twelve charz')).toBe('The two passphrases do not match.');
    expect(newPassphraseError('twelve chars', 'twelve chars')).toBe('');
  });
});
