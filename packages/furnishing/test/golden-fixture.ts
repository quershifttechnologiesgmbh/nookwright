/**
 * Fester, synthetischer Katalog + Räume für den Vorher/Nachher-Test (K3c): unabhängig vom wachsenden Katalog in
 * `catalog/`. Deckt Reihe, Zonen, Sockets (adjacent/pairWith, surface, face, hang, above), Wandhöhen, Dehnung,
 * Truhen-Stapel, Betten, abgedecktes Lagerfeuer und Läufer ab. Die Prüfsumme im Test stammt aus dem Solver VOR
 * K3c; ohne die neuen Raumtyp-Felder muss das Ergebnis bitgleich bleiben.
 */
import { createHash } from 'node:crypto';
import { Catalog, ComponentDefSchema, RoomTypeSchema, type ComponentDef, type RoomTypeDef } from '@mcda/catalog';
import { CellSet, type HorizontalDir } from '@mcda/core';
import type { FurnishResult, RoomGeometry } from '../src/index.js';

const W = (o: Record<string, unknown>): ComponentDef => ComponentDefSchema.parse({ kind: 'static', obtainability: 'survival', ...o });

const DEFS: ComponentDef[] = [
  W({ id: 'g/bed', category: 'furniture', tags: ['bed'], mount: 'floor', rotations: 'backToWall',
    layers: [['H', 'F']], legend: { H: { block: 'minecraft:red_bed', orient: { part: 'head', back: 'back' } }, F: { block: 'minecraft:red_bed', orient: { part: 'foot', back: 'back' } } },
    sockets: [
      { id: 'l', type: 'adjacent', at: [-1, 0, 0], accepts: ['nightstand'], pairWith: 'r', prob: 0.8 },
      { id: 'r', type: 'adjacent', at: [1, 0, 0], accepts: ['nightstand'], prob: 0.8 },
    ],
    masks: { use: [{ side: 'front' }, { side: 'left' }, { side: 'right' }] } }),
  W({ id: 'g/nightstand', category: 'storage', tags: ['nightstand'], mount: 'floor', rotations: 'backToWall',
    layers: [['B']], legend: { B: { block: 'minecraft:barrel', orient: { front: 'up' } } },
    sockets: [{ id: 'top', type: 'surface', at: [0, 1, 0], accepts: ['candle'], prob: 0.6 }] }),
  W({ id: 'g/candle', category: 'light', tags: ['candle'], mount: 'surface', rotations: [0], layers: [['C']], legend: { C: { block: 'minecraft:white_candle' } }, light: 3 }),
  W({ id: 'g/chest', category: 'storage', tags: ['chest', 'stackable'], mount: 'floor', rotations: 'backToWall',
    layers: [['C']], legend: { C: { block: 'minecraft:chest', orient: { front: 'front' } } },
    sockets: [{ id: 'up', type: 'above', at: [0, 1, 0], accepts: ['stackable'], prob: 0.6 }],
    masks: { use: [{ side: 'front' }] } }),
  W({ id: 'g/crate', category: 'storage', tags: ['stackable', 'crate'], mount: 'floor', rotations: [0], layers: [['B']], legend: { B: { block: 'minecraft:barrel', orient: { front: 'up' } } } }),
  W({ id: 'g/table', category: 'furniture', tags: ['table'], mount: 'floor', rotations: 'all',
    layers: [['SS']], legend: { S: { role: 'furniture_wood', shape: 'slab', orient: { upsideDown: true } } },
    sockets: [
      { id: 'c1', type: 'adjacent', at: [0, 0, 1], accepts: ['chair'], facing: 'toParent' },
      { id: 'c2', type: 'adjacent', at: [1, 0, -1], accepts: ['chair'], facing: 'toParent', prob: 0.7 },
      { id: 'lamp', type: 'hang', at: [0, 2, 0], accepts: ['lamp'], prob: 0.7 },
    ] }),
  W({ id: 'g/chair', category: 'furniture', tags: ['chair'], mount: 'floor', rotations: 'all', layers: [['S']], legend: { S: { role: 'furniture_wood', shape: 'stairs', orient: { back: 'back' } } } }),
  W({ id: 'g/lamp', category: 'light', tags: ['lamp', 'light_ceiling'], mount: 'ceiling', rotations: [0],
    layers: [['L'], ['K']], legend: { L: { block: 'minecraft:lantern', orient: { hanging: true } }, K: { block: 'minecraft:chain' } },
    stretch: { layer: 1, max: 4, fill: 'drop' }, light: 15 }),
  W({ id: 'g/shelf', category: 'decor', tags: ['shelf'], mount: 'wall', rotations: 'backToWall', wallHeights: [2, 1, -1],
    layers: [['SS']], legend: { S: { role: 'furniture_wood', shape: 'slab', orient: { upsideDown: true } } },
    sockets: [{ id: 'f', type: 'face', at: [0, 0, 0], side: 'back', accepts: ['frame'], prob: 0.4 }] }),
  W({ id: 'g/banner', category: 'decor', tags: ['banner', 'frame'], mount: 'wall', rotations: 'backToWall', wallHeight: 1,
    layers: [['V']], legend: { V: { role: 'textile_primary', shape: 'wall_banner', orient: { attachTo: 'back' } } } }),
  W({ id: 'g/wardrobe', category: 'storage', tags: ['wardrobe', 'big'], mount: 'floor', rotations: 'backToWall',
    layers: [['PP'], ['PP']], legend: { P: { role: 'furniture_wood', shape: 'planks' } }, masks: { use: [{ side: 'front' }] },
    variants: [{ id: 'tall', layers: [['PP'], ['PP'], ['PP']], legend: { P: { role: 'furniture_wood', shape: 'planks' } }, minRoomHeight: 4 }, { id: 'low', weight: 2 }] }),
  W({ id: 'g/hearth', category: 'work', tags: ['hearth', 'big'], mount: 'floor', rotations: 'backToWall',
    layers: [['MCM', 'S_S'], ['MKM', '...'], ['MMM', '...']],
    legend: { M: { block: 'minecraft:bricks' }, S: { block: 'minecraft:brick_slab' }, C: { block: 'minecraft:campfire' }, K: { block: 'minecraft:cauldron' } } }),
  W({ id: 'g/rug', category: 'decor', tags: ['rug'], mount: 'floor', rotations: [0, 1], walkable: true, layers: [['RRR', 'RRR']], legend: { R: { role: 'textile_primary', shape: 'carpet' } } }),
];

const RT = (o: Record<string, unknown>): RoomTypeDef => RoomTypeSchema.parse({ minArea: 1, optional: [], ...o });

export const ROOM_TYPES: RoomTypeDef[] = [
  RT({ id: 'g_dorm', name: 'Schlafsaal', coverage: { target: 0.4 },
    required: [{ tags: ['bed'], count: { perArea: 10, min: 2, max: 5 }, signature: true, placement: { zones: ['edge'] }, pattern: { kind: 'row', gap: 1 } }],
    optional: [
      { tags: ['chest'], count: [1, 3], weight: 3, placement: { zones: ['edge', 'corner'] } },
      { tags: ['rug'], count: [0, 1], weight: 2, placement: { zones: ['center'] } },
      { tags: ['shelf', 'banner'], count: [1, 3], weight: 2 },
      { tags: ['lamp'], count: [1, 2], weight: 3 },
    ] }),
  RT({ id: 'g_hall', name: 'Halle', coverage: { target: 0.45 }, zones: [{ id: 'cook', doorAffinity: 'far' }, { id: 'eat', doorAffinity: 'near' }],
    required: [{ tags: ['hearth'], count: [1, 1], zone: 'cook', placement: { zones: ['edge'], doorAffinity: 'far' } }],
    optional: [
      { tags: ['table'], count: [1, 3], weight: 4, zone: 'eat', placement: { zones: ['center'] } },
      { tags: ['wardrobe'], count: [0, 2], weight: 2, placement: { zones: ['edge'] } },
      { tags: ['chest', 'crate'], count: [1, 4], weight: 3, placement: { zones: ['corner', 'edge'] } },
      { tags: ['banner'], count: [0, 2], weight: 1 },
      { tags: ['lamp'], count: [1, 3], weight: 2 },
    ] }),
  RT({ id: 'g_store', name: 'Lager', coverage: { target: 0.5 },
    required: [{ tags: ['big'], count: [1, 2], placement: { zones: ['edge'] } }],
    optional: [{ tags: ['chest'], count: [2, 6], weight: 4, placement: { zones: ['edge', 'corner'] } }, { tags: ['shelf'], count: [0, 3], weight: 2 }] }),
];

export const goldenCatalog = Catalog.of(DEFS, ROOM_TYPES);

function room(id: string, iw: number, id_: number, height: number, door: HorizontalDir, windows: boolean): RoomGeometry {
  const at = door === 'south' ? [Math.floor(iw / 2), id_ - 1] : door === 'north' ? [Math.floor(iw / 2), 0] : door === 'east' ? [iw - 1, 1] : [0, Math.floor(id_ / 2)];
  return {
    roomId: id,
    baseY: 1,
    height,
    interior: CellSet.rect(0, 0, iw - 1, id_ - 1),
    doors: [{ inside: at as [number, number], toward: door, isMain: true }],
    windows: windows ? [{ inside: [1, 0], toward: 'north' }, { inside: [iw - 2, 0], toward: 'north' }, { inside: [0, 1], toward: 'west' }] : [],
  };
}

export const goldenRooms: RoomGeometry[] = [
  room('a', 5, 4, 3, 'south', true),
  room('b', 8, 6, 3, 'south', false),
  room('c', 8, 6, 5, 'east', true),
  room('d', 12, 10, 4, 'south', true),
  room('e', 4, 9, 2, 'west', false),
  {
    roomId: 'L', baseY: 1, height: 3,
    interior: CellSet.rect(0, 0, 9, 3).union(CellSet.rect(0, 4, 3, 8)),
    doors: [{ inside: [1, 8], toward: 'south', isMain: true }, { inside: [9, 2], toward: 'east', isMain: false }],
    windows: [{ inside: [4, 0], toward: 'north' }],
  },
];

export const GOLDEN_SEEDS = [0, 1, 2] as const;

/** Prüfsumme über alle Ergebnisse (Platzierungen, Warnungen, Qualität, Zonen). */
export function goldenDigest(furnish: (g: RoomGeometry, rt: RoomTypeDef, seed: number) => FurnishResult): string {
  const h = createHash('sha256');
  for (const rt of ROOM_TYPES) {
    for (const g of goldenRooms) {
      for (const seed of GOLDEN_SEEDS) {
        const r = furnish(g, rt, seed);
        h.update(JSON.stringify({ p: r.placements, w: r.warnings, q: r.quality, z: r.zones.map((z) => [z.id, z.center, z.dDoor]) }));
      }
    }
  }
  return h.digest('hex').slice(0, 16);
}
