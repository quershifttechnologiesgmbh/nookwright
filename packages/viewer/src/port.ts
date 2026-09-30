/**
 * Port `ViewerResources` (Domain Design §4.3): alles, was die Vorschau an Mojang-Daten braucht.
 *
 * Laden ist Sache des Aufrufers (Adapter): die Dev-Seite holt die mit `scripts/extract-assets.ts` erzeugten
 * Dateien aus `local/mc-assets/…`; die App wird später das JAR des Nutzers lokal verarbeiten.
 * Das Paket selbst liefert keine Mojang-Datei aus und macht kein I/O.
 */
import type { AtlasIndex, BlockFlags } from './assets/extract.js';

/** Punkt/Größe in Blockeinheiten (Form wie `Vec3` aus @mcda/core). */
export type Vec3 = readonly [number, number, number];

/** RGBA-Bild des Atlas. Im Browser am besten ein echtes `ImageData` (sonst wird kopiert). */
export interface AtlasImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray | Uint8Array;
}

/** Registry-Fakten eines Blocks (Form wie `BlockDef` aus @mcda/platform). */
export interface BlockInfo {
  readonly properties: Readonly<Record<string, readonly string[]>>;
  readonly default: Readonly<Record<string, string>>;
}

export interface ViewerResources {
  /** Minecraft-Version der Assets (Anzeige, Plausibilität). */
  readonly version: string;
  readonly atlas: AtlasImage;
  /** Inhalt von atlas.json */
  readonly atlasIndex: AtlasIndex;
  /** Blockname ohne Namensraum → Blockstate-JSON (blockstates.json) */
  readonly blockstates: Readonly<Record<string, unknown>>;
  /** `block/…` → Modell-JSON (models.json) */
  readonly models: Readonly<Record<string, unknown>>;
  /** block-flags.json; ohne Flags verdeckt kein Block einen anderen (korrekt, nur langsamer). */
  readonly blockFlags?: Readonly<Record<string, BlockFlags>>;
  /** Registry je Block (ohne Namensraum); ergänzt fehlende Properties um die Default-Werte. */
  readonly blockInfo?: (name: string) => BlockInfo | undefined;
}
