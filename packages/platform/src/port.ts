/**
 * Port `PlatformData` (Domain Design §4.3): lädt Registry, Familien und Physik je Version.
 * Adapter: `nodePlatformData()` in `@mcda/platform/node` (Dateisystem); im Browser genügt
 * `createPlatformData(file => fetch(...)/import(...))` mit derselben Dateikonvention.
 */
import { Registry } from './registry.js';
import type { FamilyData, PhysicsData, RegistryData } from './types.js';
import type { VersionInfo } from './versions.js';

/** Inhalt von data/index.json */
export interface PlatformIndex {
  readonly versions: readonly VersionInfo[];
}

export interface PlatformData {
  /** Versionen, für die Daten vorliegen (älteste zuerst). */
  versions(): Promise<readonly VersionInfo[]>;
  registry(version: string): Promise<Registry>;
  families(version: string): Promise<FamilyData>;
  physics(version: string): Promise<PhysicsData>;
}

/** Dateinamen der generierten Daten – gemeinsame Konvention für Generator und alle Adapter. */
export const DATA_FILES = {
  index: 'index.json',
  registry: (version: string): string => `registry-${version}.json`,
  families: (version: string): string => `families-${version}.json`,
  physics: (version: string): string => `physics-${version}.json`,
} as const;

/** Lädt eine Datei aus dem Datenverzeichnis und liefert das geparste JSON. */
export type JsonLoader = (file: string) => Promise<unknown>;

function expectVersion<T extends { readonly version: string }>(raw: unknown, version: string, file: string): T {
  if (typeof raw !== 'object' || raw === null || (raw as { version?: unknown }).version !== version) {
    throw new Error(`${file}: erwartet Plattform-Daten für Version '${version}'`);
  }
  return raw as T;
}

/**
 * Generischer Adapter über eine Ladefunktion. Prüft die Version gegen index.json,
 * lädt jede Datei höchstens einmal (fehlgeschlagene Ladevorgänge werden nicht gecacht).
 */
export function createPlatformData(load: JsonLoader): PlatformData {
  const cache = new Map<string, Promise<unknown>>();
  const memo = <T>(key: string, make: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key) as Promise<T> | undefined;
    if (hit) return hit;
    const p = make();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    return p;
  };

  const versions = (): Promise<readonly VersionInfo[]> =>
    memo(DATA_FILES.index, async () => {
      const raw = (await load(DATA_FILES.index)) as Partial<PlatformIndex> | null;
      if (!raw || !Array.isArray(raw.versions)) throw new Error(`${DATA_FILES.index}: keine Versionsliste`);
      return raw.versions;
    });

  const fileFor = async (file: string, version: string): Promise<unknown> => {
    const known = await versions();
    if (!known.some((v) => v.id === version)) {
      throw new Error(`Keine Plattform-Daten für Minecraft ${version} (vorhanden: ${known.map((v) => v.id).join(', ')})`);
    }
    return load(file);
  };

  return {
    versions,
    registry: (version) =>
      memo(`registry:${version}`, async () => {
        const file = DATA_FILES.registry(version);
        return new Registry(expectVersion<RegistryData>(await fileFor(file, version), version, file));
      }),
    families: (version) =>
      memo(`families:${version}`, async () => {
        const file = DATA_FILES.families(version);
        return expectVersion<FamilyData>(await fileFor(file, version), version, file);
      }),
    physics: (version) =>
      memo(`physics:${version}`, async () => {
        const file = DATA_FILES.physics(version);
        return expectVersion<PhysicsData>(await fileFor(file, version), version, file);
      }),
  };
}
