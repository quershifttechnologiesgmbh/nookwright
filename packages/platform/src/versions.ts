/**
 * Versionsliste (Glossar: Zielversion = `TargetVersion`). Einzige Quelle für die Generierung:
 * scripts/fetch.ts und scripts/generate.ts erzeugen genau diese Versionen, der Generator prüft die DataVersion.
 */

export interface VersionInfo {
  /** Minecraft-Version, z. B. `1.21.11` oder `26.3` */
  readonly id: string;
  /** DataVersion laut Mojang (`version.json`) */
  readonly dataVersion: number;
}

/** Versionen mit generierten Daten in data/ (älteste zuerst). 1.21.1 bleibt als Vergleichsversion. */
export const PLATFORM_VERSIONS: readonly VersionInfo[] = [
  { id: '1.21.1', dataVersion: 3955 },
  { id: '1.21.11', dataVersion: 4671 },
  { id: '26.3', dataVersion: 5023 },
];

/** Zielversionen des MVP (Domain Design, ADR 2). */
export const TARGET_VERSIONS = ['1.21.11', '26.3'] as const;
export type TargetVersionId = (typeof TARGET_VERSIONS)[number];

export function findVersion(id: string): VersionInfo | undefined {
  return PLATFORM_VERSIONS.find((v) => v.id === id);
}

/** DataVersion einer bekannten Version; wirft bei unbekannter Version. */
export function dataVersionOf(id: string): number {
  const v = findVersion(id);
  if (v === undefined) throw new Error(`Unbekannte Minecraft-Version '${id}'`);
  return v.dataVersion;
}
