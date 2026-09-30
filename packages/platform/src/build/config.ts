/**
 * Build-Konfiguration (nur fetch/generate, nicht Teil der öffentlichen API).
 * Die zu generierenden Minecraft-Versionen stehen in ../versions.ts (PLATFORM_VERSIONS), fest gepinnt:
 * mcmeta-Branches zeigen immer auf die neueste Version (auch Snapshots), deshalb wird nur über Tags geladen.
 */
import { PLATFORM_VERSIONS } from '../versions.js';

/** Versionen, für die Rohdaten geladen und Daten generiert werden (älteste zuerst). */
export const BUILD_VERSIONS: readonly string[] = PLATFORM_VERSIONS.map((v) => v.id);

/** Neueste Version: Referenz für Versions-Fallbacks der Familien und Quelle des Textur-Atlas. */
export const LATEST_VERSION: string = BUILD_VERSIONS[BUILD_VERSIONS.length - 1] ?? '';

/**
 * PrismarineJS-Versionen für Kollisionsformen.
 * Primär: neueste 1.21.x (1.21.11). Ergänzend: 26.1 (nur für Blöcke, die in 1.21.11 fehlen).
 * Stand 22.09.2026 gibt es bei PrismarineJS weder 26.2 noch 26.3.
 */
export const PRISMARINE_PRIMARY = '1.21.11';
export const PRISMARINE_SUPPLEMENT = '26.1';
export const PRISMARINE_VERSIONS = [PRISMARINE_PRIMARY, PRISMARINE_SUPPLEMENT] as const;
