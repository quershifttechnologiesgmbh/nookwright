/**
 * Published Language des Kontexts „Export“ (aus Spike T1, typisiert nach Bericht §7.2).
 * Upstream-Kontexte (z. B. `@mcda/voxel` über `toExportVolume`) liefern ein `ExportVolume`;
 * die Writer machen daraus `.nbt`, `.schem` oder `.litematic`.
 *
 * Konventionen:
 * - Alle Positionen sind relativ zur Minimum-Ecke des Volumens (0..size-1).
 * - `name` mit oder ohne `minecraft:`-Präfix; der Exporter normalisiert.
 * - `properties` sollten VOLLSTÄNDIG sein (alle Properties des Blocks laut Registry), weil
 *   Minecraft fehlende Properties mit dem Default der LADENDEN Version auffüllt
 *   (Beispiel: Banner/Schild `rotation` ist seit 26.1 standardmäßig 8 statt 0).
 * - `blockEntity`: Block-Entity-NBT OHNE x/y/z, MIT `id` (z. B. "minecraft:chest").
 *   Die Block-Entity-ID ist nicht die Block-ID (`oak_sign` → `sign`); sie kommt aus der Registry.
 * - `ExportEntity.nbt`: Entity-NBT MIT `id`, OHNE Pos/UUID/block_pos/TileX..Z –
 *   Positionsfelder setzt der Exporter pro Format und Version aus `pos`/`blockPos`.
 * - Fehlende Positionen sind Luft.
 */
import type { NbtCompound } from './nbt/tag.js';

/** Koordinatentripel (x, y, z); bei `ExportEntity.pos` Kommazahlen, sonst ganzzahlig. */
export type Vec3 = readonly [x: number, y: number, z: number];

export interface ExportBlock {
  readonly pos: Vec3;
  readonly name: string;
  readonly properties?: Readonly<Record<string, string>>;
  /** Block-Entity-NBT inkl. `id`, ohne x/y/z. */
  readonly blockEntity?: NbtCompound;
}

export interface ExportEntity {
  /** Position (double) relativ zur Minimum-Ecke. */
  readonly pos: Vec3;
  /** Ankerblock; für hängende Entities muss `floor(pos) == blockPos` gelten (siehe `attachedPos`). */
  readonly blockPos: Vec3;
  /** Entity-NBT inkl. `id`, ohne Positions-/UUID-Felder. */
  readonly nbt: NbtCompound;
}

export interface ExportVolume {
  readonly name: string;
  readonly author?: string;
  /**
   * Optionaler Hinweistext (z. B. der Pflicht-Disclaimer aus HANDOFF §1), den die Writer in ein Textfeld schreiben,
   * das Litematica, WorldEdit und Minecraft tolerieren (additiv; fehlt er oder ist er leer, sind die Bytes unverändert):
   * - `.litematic`: `Metadata.Description` (an eine vorhandene Beschreibung angehängt, NBT-Längengrenze beachtet),
   * - `.schem` (Sponge v3): eigenes Feld `Metadata.Disclaimer` (Name/Author bleiben unverändert),
   * - `.nbt` (Vanilla-Struktur): bewusst **nicht** – das Format hat kein Textfeld (Begründung in `formats/structure.ts`).
   */
  readonly disclaimer?: string;
  readonly dataVersion: number;
  readonly size: Vec3;
  /** Nicht aufgeführte Positionen sind Luft. */
  readonly blocks: readonly ExportBlock[];
  readonly entities: readonly ExportEntity[];
}
