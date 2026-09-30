import type { ExportBlock, ExportEntity, ExportVolume } from '@mcda/export';
import { isAir } from './blockstate.js';
import type { VoxelVolume } from './volume.js';

/** Was das Voxel-Volumen selbst nicht weiß: Name, Autor und Zielversion. */
export interface ExportMeta {
  readonly name: string;
  readonly author?: string;
  readonly dataVersion: number;
}

/**
 * Übersetzt ein Voxel-Volumen in die Published Language des Exports.
 * Positionen werden relativ zu `volume.origin`; Luft (auch explizit geschriebene) entfällt,
 * denn im `ExportVolume` bedeutet „fehlend“ Luft. Herkunft und Schicht gehen nicht in die Datei.
 */
export function toExportVolume(volume: VoxelVolume, meta: ExportMeta): ExportVolume {
  const [ox, oy, oz] = volume.origin;
  const blocks: ExportBlock[] = [];
  for (const c of volume.cells()) {
    if (isAir(c.state)) continue;
    blocks.push({
      pos: [c.pos[0] - ox, c.pos[1] - oy, c.pos[2] - oz],
      name: c.state.name,
      ...(Object.keys(c.state.properties).length > 0 ? { properties: c.state.properties } : {}),
      ...(c.blockEntity ? { blockEntity: c.blockEntity } : {}),
    });
  }
  const entities: ExportEntity[] = volume.entities().map((e) => ({
    pos: [e.pos[0] - ox, e.pos[1] - oy, e.pos[2] - oz],
    blockPos: [e.blockPos[0] - ox, e.blockPos[1] - oy, e.blockPos[2] - oz],
    nbt: e.nbt,
  }));
  return {
    name: meta.name,
    ...(meta.author !== undefined ? { author: meta.author } : {}),
    dataVersion: meta.dataVersion,
    size: volume.size,
    blocks,
    entities,
  };
}
