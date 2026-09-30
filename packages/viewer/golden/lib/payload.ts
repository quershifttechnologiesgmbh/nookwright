/**
 * Goldene Galerie (P0-A): Szene für den Browser (JSON) aus Raster, Kameras und Tabellen je Zustand (rein).
 */
import type { Box } from './analyze.js';
import type { ProjectionSpec, VariantSpec, ViewLook, ViewSpec } from './cameras.js';
import type { GoldenState, Grid, Vec3 } from './grid.js';

export interface VariantPayload {
  readonly key: string;
  readonly box: Box;
}

export interface ViewPayload {
  readonly name: string;
  readonly variant: string;
  readonly projection: ProjectionSpec;
  readonly orbit: { readonly target: Vec3; readonly yaw: number; readonly pitch: number; readonly distance: number };
  readonly look?: ViewLook;
}

export interface ScenePayload {
  readonly id: string;
  readonly size: Vec3;
  readonly palette: readonly GoldenState[];
  /** flach: x, y, z, Paletten-Index je Block (ohne Luft) */
  readonly cells: readonly number[];
  readonly frames: ReadonlyArray<readonly [number, number, number, string, number]>;
  /** je Paletten-Index: Emission, undurchsichtig, sperrende Flächen, Abschwächung, AO */
  readonly light: ReadonlyArray<readonly [number, number, number, number, number]>;
  readonly blockInfo: Readonly<Record<string, { readonly properties: Readonly<Record<string, readonly string[]>>; readonly default: Readonly<Record<string, string>> }>>;
  readonly variants: readonly VariantPayload[];
  readonly views: readonly ViewPayload[];
  readonly lighting: { readonly dayTime: number; readonly brightness: number };
}

export interface PayloadTables {
  lightRow(s: GoldenState): readonly [number, number, number, number, number];
  blockInfo(name: string): { readonly properties: Readonly<Record<string, readonly string[]>>; readonly default: Readonly<Record<string, string>> } | undefined;
}

/** Tageslicht: Mittag, Helligkeit 50 % (Minecraft-Standard). */
export const GOLDEN_LIGHTING = { dayTime: 6000, brightness: 0.5 } as const;

export function scenePayload(id: string, g: Grid, variants: readonly VariantSpec[], views: readonly ViewSpec[], tables: PayloadTables): ScenePayload {
  const cells: number[] = [];
  const [sx, sy, sz] = g.size;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const p = g.cells[x + sx * (z + sz * y)]!;
    if (p !== 0) cells.push(x, y, z, p);
  }
  const blockInfo: Record<string, ReturnType<PayloadTables['blockInfo']> & object> = {};
  for (const s of g.palette.slice(1)) {
    if (blockInfo[s.name] !== undefined) continue;
    const bi = tables.blockInfo(s.name);
    if (bi !== undefined) blockInfo[s.name] = bi;
  }
  const used = new Set(views.map((v) => v.variant));
  return {
    id,
    size: g.size,
    palette: g.palette,
    cells,
    frames: g.frames.map((f) => [f.pos[0], f.pos[1], f.pos[2], f.kind, f.facing] as const),
    light: g.palette.map((s, i) => (i === 0 ? [0, 0, 0, 0, 0] as const : tables.lightRow(s))),
    blockInfo,
    variants: variants.filter((v) => used.has(v.key)).map((v) => ({ key: v.key, box: v.box })),
    views: views.map((v) => ({ name: v.name, variant: v.variant, projection: v.projection, orbit: v.orbit, ...(v.look !== undefined ? { look: v.look } : {}) })),
    lighting: GOLDEN_LIGHTING,
  };
}
