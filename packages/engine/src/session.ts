/**
 * Projekt-Sessions: Aggregate (`Project`, optional `Site`) plus Stil und Bauwerke, über mehrere API-Aufrufe
 * bearbeitbar („füge eine Etage hinzu“, „mach die Küche größer“). Speicher als Port (`SessionStore`), Standard im
 * Speicher. Die Aggregate bleiben die Wahrheit; alles andere (Hülle, Einrichtung, Welt) ist abgeleitet (ADR 10).
 */
import type { Project, ProjectEvent } from '@mcda/blueprint';
import type { AttachedTower, BaseOptions } from '@mcda/pipeline';
import type { StructuresInput } from '@mcda/structures';
import type { FileSettings, SurroundingsState } from '@mcda/projectfile';
import type { Site, SiteEvent } from '@mcda/terrain';

/** Stil der Session = Optionen des Anwendungsdienstes ohne Gelände/Bauwerke (die liegen in `site`/`structures`). */
export type SessionBuild = Omit<BaseOptions, 'site' | 'terrainStyle' | 'structures' | 'structureSeed' | 'attachedTowers' | 'extraCells'>;

export interface ProjectSession {
  readonly id: string;
  project: Project;
  site: Site | undefined;
  build: SessionBuild;
  structures: StructuresInput | undefined;
  attachedTowers: readonly AttachedTower[];
  /**
   * Nur bei Projekten aus einer App-Datei (`project_load` mit `.projekt.json`): Einstellungen und Umgebung der Datei,
   * die die Engine nicht abbildet (Dichte je Raum, Gelände aus, Rand, Bauwerks-IDs), und der Stand beim Laden.
   * `project_save` mit `format: 'app'` schreibt sie zurück, solange der jeweilige Teil per API unverändert ist.
   */
  app?: AppFileState | undefined;
  /** Rückgängig gemachte Events je Aggregat (für Redo); jeder neue Befehl leert sie. */
  redo: { project: readonly ProjectEvent[]; site: readonly SiteEvent[] };
}

/** Stand einer App-Datei beim Laden (siehe `ProjectSession.app`, `src/appFile.ts`). */
export interface AppFileState {
  readonly settings: FileSettings;
  readonly surroundings: SurroundingsState | undefined;
  /** Vergleichsschlüssel von Stil, Gelände und Bauwerken beim Laden. */
  readonly keys: { readonly build: string; readonly site: string; readonly structures: string };
}

export const NO_REDO = { project: [], site: [] } as const;

export interface SessionStore {
  get(id: string): ProjectSession | undefined;
  put(session: ProjectSession): void;
  delete(id: string): boolean;
  ids(): string[];
  /** Neue, eindeutige ID (deterministisch je Store: p1, p2, …). */
  nextId(): string;
  /**
   * Optional: Änderungen dauerhaft machen. Operationen ändern Sessions an Ort und Stelle; die Engine ruft `commit` nach
   * jeder zustandsbehafteten Operation (auch nach Fehlern, deren Rollback ebenfalls an Ort und Stelle geschieht).
   */
  commit?(): void;
}

/** Anfang der Fehlermeldung für ein unbekanntes (oder fremdes) Projekt; der HTTP-Server antwortet dann 404. */
export const UNKNOWN_PROJECT = 'Unbekanntes Projekt';

/** Sessions im Speicher; über `limit` wird die am längsten unbenutzte verdrängt. */
export function memorySessions(limit = 32): SessionStore {
  const map = new Map<string, ProjectSession>();
  let seq = 0;
  return {
    get(id) {
      const s = map.get(id);
      if (s !== undefined) {
        map.delete(id);
        map.set(id, s);
      }
      return s;
    },
    put(s) {
      map.delete(s.id);
      map.set(s.id, s);
      while (map.size > limit) map.delete(map.keys().next().value!);
    },
    delete: (id) => map.delete(id),
    ids: () => [...map.keys()],
    nextId: () => `p${++seq}`,
  };
}

export function requireSession(store: SessionStore, id: string): ProjectSession {
  const s = store.get(id);
  if (s === undefined) throw new Error(`${UNKNOWN_PROJECT} '${id}' (offen: ${store.ids().join(', ') || 'keins'}) – erst project_create`);
  return s;
}
