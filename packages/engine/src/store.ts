/**
 * Dauerhafter Projektspeicher (D3): Port `ProjectStore` für gespeicherte Projekte je Mandant, dazu der Adapter
 * `persistentSessions`, der daraus einen `SessionStore` der Engine macht. Gespeichert wird das Engine-Format von
 * `project_save` (Event-Historien, Stil, Bauwerke) plus Redo-Stapel und App-Stand; der Zustand entsteht beim Laden per
 * Replay. Rein (keine I/O, Uhr von außen); die SQLite-Umsetzung liegt in `node/sqliteStore.ts`.
 */
import type { FileSettings, SurroundingsState } from '@mcda/projectfile';
import type { ProjectEvent } from '@mcda/blueprint';
import type { SiteEvent } from '@mcda/terrain';
import { engineFileOf, sessionFromEngineFile, type EngineFile } from './operations/project.js';
import type { AppFileState, ProjectSession, SessionStore } from './session.js';

/** Ein gespeichertes Projekt. `rev` steigt mit jeder Änderung (Abgleich mehrerer Prozesse am selben Speicher). */
export interface StoredProject {
  readonly data: string;
  readonly rev: number;
  readonly updatedAt: number;
  readonly accessedAt: number;
}

export interface ProjectStore {
  /** Art für Health und Log (z. B. `memory`, `sqlite`). */
  readonly kind: string;
  get(tenant: string, id: string): StoredProject | undefined;
  /** Nur die Revision (billig), `undefined` = nicht vorhanden. */
  rev(tenant: string, id: string): number | undefined;
  /**
   * Speichern mit optimistischer Sperre: nur wenn die gespeicherte Revision `expectedRev` ist (0 = noch nicht
   * vorhanden). Liefert die neue Revision oder `undefined` bei Konflikt (ein anderer Prozess war schneller).
   */
  put(tenant: string, id: string, data: string, now: number, expectedRev: number): number | undefined;
  /** Zugriff vermerken (für das Aufräumen nach TTL). */
  touch(tenant: string, id: string, now: number): void;
  delete(tenant: string, id: string): boolean;
  /** IDs eines Mandanten in Anlage-Reihenfolge. */
  ids(tenant: string): string[];
  /** Nächste laufende Nummer eines Mandanten (1, 2, …; nie wiederverwendet). */
  nextSeq(tenant: string): number;
  /** Projekte löschen, auf die seit `before` (ms) niemand zugegriffen hat; liefert die Anzahl. */
  sweep(before: number): number;
  close?(): void;
}

/** Speicher im Arbeitsspeicher (Tests, Standard ohne Konfiguration). */
export function memoryProjectStore(): ProjectStore {
  const rows = new Map<string, StoredProject>();
  const seqs = new Map<string, number>();
  const k = (tenant: string, id: string): string => `${tenant}\u0000${id}`;
  return {
    kind: 'memory',
    get: (tenant, id) => rows.get(k(tenant, id)),
    rev: (tenant, id) => rows.get(k(tenant, id))?.rev,
    put(tenant, id, data, now, expectedRev) {
      if ((rows.get(k(tenant, id))?.rev ?? 0) !== expectedRev) return undefined;
      const rev = expectedRev + 1;
      rows.set(k(tenant, id), { data, rev, updatedAt: now, accessedAt: now });
      return rev;
    },
    touch(tenant, id, now) {
      const r = rows.get(k(tenant, id));
      if (r !== undefined) rows.set(k(tenant, id), { ...r, accessedAt: now });
    },
    delete: (tenant, id) => rows.delete(k(tenant, id)),
    ids: (tenant) => [...rows.keys()].filter((key) => key.startsWith(`${tenant}\u0000`)).map((key) => key.slice(tenant.length + 1)),
    nextSeq(tenant) {
      const n = (seqs.get(tenant) ?? 0) + 1;
      seqs.set(tenant, n);
      return n;
    },
    sweep(before) {
      let n = 0;
      for (const [key, r] of rows) if (r.accessedAt < before && rows.delete(key)) n++;
      return n;
    },
  };
}

/** Anfang der Fehlermeldung bei gleichzeitiger Änderung (HTTP 409). */
export const PROJECT_CONFLICT = 'Projekt wurde gleichzeitig anderswo geändert';

/** Gespeicherte Form einer Session (Version 1). */
interface PersistedSession {
  readonly v: 1;
  readonly file: EngineFile;
  readonly redo: { readonly project: readonly ProjectEvent[]; readonly site: readonly SiteEvent[] };
  readonly app?: {
    readonly settings: Omit<FileSettings, 'density'> & { readonly density: readonly (readonly [string, number])[] };
    readonly surroundings: SurroundingsState | null;
    readonly keys: AppFileState['keys'];
  };
}

export function serializeSession(s: ProjectSession): string {
  const p: PersistedSession = {
    v: 1,
    file: engineFileOf(s) as unknown as EngineFile,
    redo: s.redo,
    ...(s.app !== undefined ? {
      app: { settings: { ...s.app.settings, density: [...s.app.settings.density] }, surroundings: s.app.surroundings ?? null, keys: s.app.keys },
    } : {}),
  };
  return JSON.stringify(p);
}

export function reviveSession(id: string, data: string): ProjectSession {
  const p = JSON.parse(data) as PersistedSession;
  if (p.v !== 1) throw new Error(`Gespeichertes Projekt '${id}': Version ${String(p.v)} unbekannt`);
  const s = sessionFromEngineFile(id, p.file);
  s.redo = { project: p.redo.project, site: p.redo.site };
  if (p.app !== undefined) {
    s.app = {
      settings: { ...p.app.settings, density: new Map(p.app.settings.density) } as FileSettings,
      surroundings: p.app.surroundings ?? undefined,
      keys: p.app.keys,
    };
  }
  return s;
}

export interface PersistentSessionOptions {
  /** Entpackte Sessions im Arbeitsspeicher (LRU; Standard 32). */
  readonly cacheLimit?: number;
  /** Höchstzahl Projekte je Mandant (Standard unbegrenzt). */
  readonly maxProjects?: number;
  /** Uhr in ms (Standard 0: rein; der Server gibt `Date.now` mit). */
  readonly now?: () => number;
}

/**
 * `SessionStore` eines Mandanten über einem `ProjectStore`. Operationen ändern Sessions an Ort und Stelle; `commit`
 * schreibt jede in diesem Aufruf berührte Session, deren Inhalt sich geändert hat (sonst nur Zugriffszeit).
 * Vor jedem Zugriff wird die Revision geprüft: Hat ein anderer Prozess das Projekt geändert, wird neu geladen.
 */
export function persistentSessions(store: ProjectStore, tenant: string, opts: PersistentSessionOptions = {}): SessionStore {
  const cacheLimit = Math.max(1, opts.cacheLimit ?? 32);
  const maxProjects = opts.maxProjects ?? Number.POSITIVE_INFINITY;
  const now = opts.now ?? ((): number => 0);
  const cache = new Map<string, { session: ProjectSession; rev: number; saved: string }>();
  const touched = new Set<string>();
  const bump = (id: string): void => {
    const e = cache.get(id);
    if (e !== undefined) {
      cache.delete(id);
      cache.set(id, e);
    }
  };
  return {
    get(id) {
      const rev = store.rev(tenant, id);
      if (rev === undefined) {
        // noch nicht gespeichert (im selben Aufruf angelegt) oder anderswo gelöscht
        if (!touched.has(id)) cache.delete(id);
        return cache.get(id)?.session;
      }
      let e = cache.get(id);
      if (e === undefined || e.rev !== rev) {
        const row = store.get(tenant, id)!;
        e = { session: reviveSession(id, row.data), rev: row.rev, saved: row.data };
        cache.set(id, e);
      }
      bump(id);
      touched.add(id);
      return e.session;
    },
    put(s) {
      if (!cache.has(s.id) && store.rev(tenant, s.id) === undefined && store.ids(tenant).length >= maxProjects) {
        throw new Error(`Höchstens ${maxProjects} Projekte je Schlüssel – erst alte mit project_delete löschen`);
      }
      const old = cache.get(s.id);
      cache.set(s.id, { session: s, rev: old?.rev ?? store.rev(tenant, s.id) ?? 0, saved: old?.saved ?? '' });
      bump(s.id);
      touched.add(s.id);
    },
    delete(id) {
      cache.delete(id);
      touched.delete(id);
      return store.delete(tenant, id);
    },
    ids: () => store.ids(tenant),
    nextId: () => `p${store.nextSeq(tenant)}`,
    commit() {
      const t = now();
      try {
        for (const id of touched) {
          const e = cache.get(id);
          if (e === undefined) continue;
          const data = serializeSession(e.session);
          if (data !== e.saved) {
            const rev = store.put(tenant, id, data, t, e.rev);
            if (rev === undefined) throw new Error(`${PROJECT_CONFLICT} ('${id}') – Änderung verworfen, bitte neu laden und erneut ausführen`);
            e.rev = rev;
            e.saved = data;
          } else {
            store.touch(tenant, id, t);
          }
        }
      } catch (err) {
        // Nicht gespeicherte Änderungen verwerfen: sonst schriebe ein späterer Aufruf sie doch noch (bzw. ein Retry
        // wendete den Befehl doppelt an). Beim nächsten Zugriff wird aus dem Speicher neu geladen.
        for (const id of touched) cache.delete(id);
        throw err;
      } finally {
        touched.clear();
        while (cache.size > cacheLimit) cache.delete(cache.keys().next().value!);
      }
    },
  };
}
