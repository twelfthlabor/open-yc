import { openDB } from 'idb';
import type { SealedBlob } from '../crypto/vault';

const DB_NAME = 'visa-navigator';
const KV = 'kv';
const DOCS = 'docs';
const VAULT_KEY = 'vault';

const dbPromise = () =>
  openDB(DB_NAME, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) db.createObjectStore(KV);
      if (oldVersion < 2) db.createObjectStore(DOCS);
    },
  });

export async function readSealed(): Promise<SealedBlob | undefined> {
  return (await dbPromise()).get(KV, VAULT_KEY);
}

export async function writeSealed(blob: SealedBlob): Promise<void> {
  await (await dbPromise()).put(KV, blob, VAULT_KEY);
}

/** Uploaded files, each encrypted on its own so saving answers does not re-encrypt every file. */
export async function readDoc(id: string): Promise<SealedBlob | undefined> {
  return (await dbPromise()).get(DOCS, id);
}

export async function writeDoc(id: string, blob: SealedBlob): Promise<void> {
  await (await dbPromise()).put(DOCS, blob, id);
}

export async function listDocs(): Promise<Array<[string, SealedBlob]>> {
  const db = await dbPromise();
  const [keys, values] = await Promise.all([db.getAllKeys(DOCS), db.getAll(DOCS)]);
  return keys.map((k, i) => [String(k), values[i] as SealedBlob]);
}

export async function deleteDoc(id: string): Promise<void> {
  await (await dbPromise()).delete(DOCS, id);
}

export async function deleteVault(): Promise<void> {
  const db = await dbPromise();
  await db.delete(KV, VAULT_KEY);
  await db.clear(DOCS);
}
