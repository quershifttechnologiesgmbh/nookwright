/**
 * Synthetische Blöcke im Namensraum `mcda:` – Näherungen für das, was deepslate 0.27.1 nicht selbst zeichnet.
 * Sie bestehen nur aus eigenen Geometrie-/UV-Angaben (keine Mojang-Daten) und verweisen auf Vanilla-Texturen
 * bzw. -Modelle, die zur Laufzeit aus den `ViewerResources` kommen.
 *
 * - Doppeltruhe: deepslate kennt nur die Einzeltruhe (`type` wird ignoriert → zwei Einzeltruhen mit Fuge).
 *   `mcda:double_chest_<textur>` zeichnet je Hälfte den Korpus bis zur Fuge mit `entity/chest/<textur>_left|_right`.
 * - Rahmen (Entity `item_frame`/`glow_item_frame`): als Block mit dem Vanilla-Modell `block/item_frame`
 *   (das Spiel nutzt es ebenfalls für die Entity), gedreht nach `Facing`. Der Gegenstand im Rahmen fehlt.
 */

export const SYNTHETIC_NAMESPACE = 'mcda';

/** Truhenblock → Textur-Stamm unter `entity/chest/` (Hälften: `<stamm>_left`, `<stamm>_right`). */
export const DOUBLE_CHEST_TEXTURES: Readonly<Record<string, string>> = {
  chest: 'normal',
  trapped_chest: 'trapped',
  copper_chest: 'copper',
  exposed_copper_chest: 'copper_exposed',
  weathered_copper_chest: 'copper_weathered',
  oxidized_copper_chest: 'copper_oxidized',
  waxed_copper_chest: 'copper',
  waxed_exposed_copper_chest: 'copper_exposed',
  waxed_weathered_copper_chest: 'copper_weathered',
  waxed_oxidized_copper_chest: 'copper_oxidized',
};

const HORIZONTAL_Y: Readonly<Record<string, number>> = { north: 0, east: 90, south: 180, west: 270 };
/** Rahmen: Rückseite im Modell bei z = 16 (Süden) → Blick nach Norden ist die Grundstellung. */
const FRAME_ROT: Readonly<Record<string, { x?: number; y?: number }>> = {
  north: {}, east: { y: 90 }, south: { y: 180 }, west: { y: 270 }, up: { x: 270 }, down: { x: 90 },
};

type Px = readonly [number, number, number, number];
/** Fläche mit UV in Texturpixeln einer 64×64-Textur (Modell-UV 0..16 = ganze Textur). */
const f = (px: Px, rotation?: 180): Record<string, unknown> => ({
  uv: px.map((v) => v / 4),
  texture: '#0',
  ...(rotation !== undefined ? { rotation } : {}),
});

/**
 * Eine Hälfte der Doppeltruhe, Front nach Norden (wie deepslates Einzeltruhe). Abgeleitet aus dem
 * Vanilla-Kastenlayout der Doppeltruhe (Korpus 15×10×14 ab (0,19), Deckel 15×5×14 ab (0,0),
 * Schloss 1×4×1 ab (0,0)), um 180° gedreht, weil Vanilla die Truhe nach Süden blickend modelliert.
 * `left`: Partner im Osten (Uhrzeigersinn von Norden), `right`: Partner im Westen.
 */
export function doubleChestModel(stem: string, half: 'left' | 'right'): Record<string, unknown> {
  const left = half === 'left';
  const [x0, x1] = left ? [1, 16] : [0, 15];
  const outer = left ? 'west' : 'east';
  // Kastenlayout (u): WEST 0..14, NORTH 14..29, EAST 29..43, SOUTH 43..58; oben/unten 29..44 / 14..29
  const outerU: readonly [number, number] = left ? [29, 43] : [0, 14];
  const lockOuterU: readonly [number, number] = left ? [2, 3] : [0, 1];
  const [lx0, lx1] = left ? [15, 16] : [0, 1];
  return {
    textures: { 0: `minecraft:entity/chest/${stem}_${half}`, particle: 'minecraft:block/oak_planks' },
    elements: [
      {
        from: [x0, 0, 1], to: [x1, 10, 15],
        faces: {
          north: f([43, 33, 58, 43], 180),
          south: f([14, 33, 29, 43], 180),
          [outer]: f([outerU[0], 33, outerU[1], 43], 180),
          up: f([29, 19, 44, 33], 180),
          down: f([14, 19, 29, 33], 180),
        },
      },
      {
        from: [x0, 10, 1], to: [x1, 14, 15],
        faces: {
          north: f([43, 15, 58, 19], 180),
          south: f([14, 15, 29, 19], 180),
          [outer]: f([outerU[0], 15, outerU[1], 19], 180),
          up: f([29, 0, 44, 14], 180),
          down: f([14, 0, 29, 14], 180),
        },
      },
      {
        from: [lx0, 7, 0], to: [lx1, 11, 1],
        faces: {
          north: f([3, 1, 4, 5], 180),
          south: f([1, 1, 2, 5], 180),
          [outer]: f([lockOuterU[0], 1, lockOuterU[1], 5], 180),
          up: f([2, 0, 3, 1], 180),
          down: f([1, 0, 2, 1], 180),
        },
      },
    ],
  };
}

export interface SyntheticAssets {
  /** Pfad im Namensraum `mcda` → Blockstate-JSON */
  readonly blockstates: Readonly<Record<string, unknown>>;
  /** `block/…` im Namensraum `mcda` → Modell-JSON */
  readonly models: Readonly<Record<string, unknown>>;
}

function buildSynthetic(): SyntheticAssets {
  const blockstates: Record<string, unknown> = {};
  const models: Record<string, unknown> = {};
  for (const stem of new Set(Object.values(DOUBLE_CHEST_TEXTURES))) {
    const variants: Record<string, unknown> = {};
    for (const half of ['left', 'right'] as const) {
      const model = `block/double_chest_${stem}_${half}`;
      models[model] = doubleChestModel(stem, half);
      for (const [facing, y] of Object.entries(HORIZONTAL_Y)) {
        variants[`facing=${facing},type=${half}`] = { model: `${SYNTHETIC_NAMESPACE}:${model}`, ...(y !== 0 ? { y } : {}) };
      }
    }
    blockstates[`double_chest_${stem}`] = { variants };
  }
  for (const kind of ['item_frame', 'glow_item_frame'] as const) {
    const variants: Record<string, unknown> = {};
    for (const [facing, rot] of Object.entries(FRAME_ROT)) variants[`facing=${facing}`] = { model: `minecraft:block/${kind}`, ...rot };
    blockstates[kind] = { variants };
  }
  return { blockstates, models };
}

let cached: SyntheticAssets | undefined;

/** Blockstates und Modelle der synthetischen Blöcke (einmal gebaut). */
export function syntheticAssets(): SyntheticAssets {
  cached ??= buildSynthetic();
  return cached;
}

/** Richtung aus dem Entity-Tag `Facing` (0 = unten … 5 = Osten, wie `Direction.get3DDataValue`). */
export const FACING_BY_ID: readonly string[] = ['down', 'up', 'north', 'south', 'west', 'east'];
