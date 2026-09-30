/**
 * Browser-Adapter für den Port `TextureCache`: IndexedDB (Datenbank `basen-generator-texturen`).
 * Die aus dem eigenen JAR gebauten Assets bleiben so nur auf diesem Gerät, der nächste Start braucht das JAR nicht.
 * Jeder Zugriff ist abgesichert: Ohne IndexedDB (privates Fenster, gesperrt, Speicher voll) arbeitet die App
 * ohne Cache weiter – `meta`/`load` liefern `undefined`, `save`/`clear` `false`.
 */
import { cachedMeta, memoryTextureCache, type CachedTextures, type TextureCache } from '../textures/assets.js';

const DB_NAME = 'basen-generator-texturen';
const STORE = 'assets';
const KEY_META = 'meta';
const KEY_DATA = 'data';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB-Fehler'));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB nicht verfügbar'));
    r.onblocked = () => reject(new Error('IndexedDB blockiert'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB-Transaktion fehlgeschlagen'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB-Transaktion abgebrochen'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, mode);
    const finished = done(tx); // vor dem ersten Request anhängen, damit `complete` nicht verpasst wird
    finished.catch(() => undefined);
    const result = await f(tx.objectStore(STORE));
    await finished;
    return result;
  } finally {
    db.close();
  }
}

export function indexedDbTextureCache(): TextureCache {
  let available: boolean;
  try {
    available = typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    available = false;
  }
  if (!available) return { ...memoryTextureCache(), save: async () => false };
  return {
    async meta() {
      try {
        // Nur nachsehen, nicht anlegen: ohne gespeichertes JAR entsteht keine Datenbank
        if (typeof indexedDB.databases === 'function' && !(await indexedDB.databases()).some((d) => d.name === DB_NAME)) return undefined;
        const rec = await withStore('readonly', (s) => request(s.get(KEY_META)));
        return cachedMeta(rec);
      } catch {
        return undefined;
      }
    },
    async load() {
      try {
        return await withStore('readonly', (s) => request(s.get(KEY_DATA)));
      } catch {
        return undefined;
      }
    },
    async save(rec: CachedTextures) {
      try {
        // Kurzinfo separat: Die App liest beim Start nur sie (die Daten sind einige MB groß).
        await withStore('readwrite', (s) => {
          s.put(rec, KEY_DATA);
          s.put({ format: rec.format, v: rec.v, meta: rec.meta }, KEY_META);
        });
        return true;
      } catch {
        return false;
      }
    },
    async clear() {
      try {
        await withStore('readwrite', (s) => {
          s.delete(KEY_DATA);
          s.delete(KEY_META);
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
