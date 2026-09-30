import { RESERVED_AIR, RESERVED_EMPTY, type ComponentDef, type EntitySpec, type Masks, type MaterialSpec, type SocketDef, type StretchDef, type VariantDef } from '@mcda/catalog';
import type { Quarter, Rng, Vec3 } from '@mcda/core';

export interface ExpandedCell {
  readonly at: Vec3;
  readonly mat: MaterialSpec;
}

/** Komponente nach Variantenwahl, in lokalen (kanonischen) Koordinaten. Ab hier ist jede Art gleich. */
export interface ExpandedComponent {
  readonly defId: string;
  /** Varianten-ID wie in der Platzierung, bei gedehnten Formen mit Länge (`<variante>~<n>`). */
  readonly variantId: string | undefined;
  readonly mount: ComponentDef['mount'];
  readonly size: Vec3;
  readonly cells: readonly ExpandedCell[];
  /** Zellen, die Luft bleiben müssen (Maske `air`, inkl. '_' aus den Schichten). */
  readonly air: readonly Vec3[];
  readonly entities: readonly EntitySpec[];
  readonly sockets: readonly SocketDef[];
  readonly masks: Masks;
  /** Durchlaufbar (Katalog-Feld `walkable`): belegt keinen Boden für Laufwege und Konnektivität. */
  readonly walkable: boolean;
  /** Funktions-Tags der Komponente (Regeln: Arbeitsblock-Station, Wasser-Quelle; research/17 §7.4). */
  readonly functionTags?: readonly string[];
  /** Höhen-Auswahl (V3; Variante vor Komponente): nur für Räume mit dieser lichten Höhe gedacht. */
  readonly minRoomHeight?: number;
  readonly maxRoomHeight?: number;
  /** Vertikale Dehnung (V3): Spezifikation und gewählte Zahl der Zusatz-Schichten. */
  readonly stretch?: { readonly spec: StretchDef; readonly n: number };
}

/** Trenner zwischen Varianten-ID und Dehnungslänge (Varianten-IDs selbst sind `[a-z0-9_]+`). */
export const STRETCH_SEP = '~';

/** Varianten-ID → Basis-Variante + Dehnungslänge (`tall~3` → tall, 3; `~2` → keine Variante, 2). */
export function parseVariantId(id: string | undefined): { readonly base: string | undefined; readonly n: number } {
  if (id === undefined) return { base: undefined, n: 0 };
  const i = id.lastIndexOf(STRETCH_SEP);
  if (i < 0) return { base: id, n: 0 };
  const n = Number(id.slice(i + 1));
  if (!Number.isInteger(n) || n < 0) throw new Error(`Varianten-ID '${id}': Dehnung muss eine ganze Zahl ≥ 0 sein`);
  return { base: i === 0 ? undefined : id.slice(0, i), n };
}

/** Basis-Variante + Dehnungslänge → Varianten-ID (n = 0 ohne Zusatz, damit alte Platzierungen gleich bleiben). */
export function formatVariantId(base: string | undefined, n: number): string | undefined {
  return n <= 0 ? base : `${base ?? ''}${STRETCH_SEP}${n}`;
}

export function pickVariant(def: ComponentDef, rng: Rng): VariantDef | undefined {
  if (def.variants === undefined) return undefined;
  return rng.weighted(def.variants, (v) => v.weight ?? 1);
}

/** Variante zur Basis-ID einer (evtl. gedehnten) Varianten-ID. */
function variantOf(def: ComponentDef, variantId: string | undefined): VariantDef | undefined {
  const { base } = parseVariantId(variantId);
  return base === undefined ? undefined : def.variants?.find((v) => v.id === base);
}

/** Passt die lichte Höhe zur Form (Grenzen der Variante vor denen der Komponente)? Auswahl, keine harte Regel. */
export function fitsRoomHeight(def: ComponentDef, variantId: string | undefined, height: number): boolean {
  const v = variantOf(def, variantId);
  const min = v?.minRoomHeight ?? def.minRoomHeight;
  const max = v?.maxRoomHeight ?? def.maxRoomHeight;
  return (min === undefined || height >= min) && (max === undefined || height <= max);
}

/** Gewichtete Variantenwahl unter den Varianten, die zur lichten Höhe passen (undefined: keine passt). */
export function pickFittingVariant(def: ComponentDef, rng: Rng, height: number): { readonly id: string | undefined } | undefined {
  if (def.variants === undefined) return fitsRoomHeight(def, undefined, height) ? { id: undefined } : undefined;
  const ok = def.variants.filter((v) => fitsRoomHeight(def, v.id, height));
  return ok.length === 0 ? undefined : { id: rng.weighted(ok, (v) => v.weight ?? 1).id };
}

/** Höhe (relativ zum Boden) der untersten Zelle eines hängenden, gedehnten Objekts: etwa halbe Raumhöhe, ≥ 2. */
export const dropLevel = (height: number): number => Math.max(2, Math.floor(height / 2));

/**
 * Varianten-ID mit der Dehnung, die zur lichten Höhe passt (V3, adaptiv): `ceiling` füllt bis unter die Decke,
 * `drop` lässt die unterste Zelle auf `dropLevel` hängen. Ohne `stretch` bleibt die ID unverändert.
 */
export function adaptVariant(def: ComponentDef, variantId: string | undefined, height: number): string | undefined {
  const { base } = parseVariantId(variantId);
  const spec = variantOf(def, variantId)?.stretch ?? def.stretch;
  if (spec === undefined) return base;
  const s0 = expandComponent(def, base).size[1];
  const want = spec.fill === 'ceiling' ? height - s0 : height - dropLevel(height) - s0;
  return formatVariantId(base, Math.max(0, Math.min(spec.max, want)));
}

export function allowedRotations(def: Pick<ComponentDef, 'rotations'>): Quarter[] {
  return def.rotations === 'all' || def.rotations === 'backToWall' ? [0, 1, 2, 3] : [...new Set(def.rotations as Quarter[])];
}

function parseLayers(layers: readonly (readonly string[])[], legend: Record<string, MaterialSpec>): { cells: ExpandedCell[]; air: Vec3[]; size: Vec3 } {
  const cells: ExpandedCell[] = [];
  const air: Vec3[] = [];
  const rows = layers[0]?.length ?? 0;
  const width = layers[0]?.[0]?.length ?? 0;
  layers.forEach((layer, y) =>
    layer.forEach((row, z) => {
      [...row].forEach((ch, x) => {
        if (ch === RESERVED_EMPTY) return;
        if (ch === RESERVED_AIR) {
          air.push([x, y, z]);
          return;
        }
        const mat = legend[ch];
        if (mat === undefined) throw new Error(`Zeichen '${ch}' fehlt in legend`);
        cells.push({ at: [x, y, z], mat });
      });
    }),
  );
  return { cells, air, size: [width, layers.length, rows] };
}

function boundsOf(points: readonly Vec3[]): Vec3 {
  let sx = 0, sy = 0, sz = 0;
  for (const [x, y, z] of points) {
    sx = Math.max(sx, x + 1);
    sy = Math.max(sy, y + 1);
    sz = Math.max(sz, z + 1);
  }
  return [sx, sy, sz];
}

/** Schichten mit n eingeschobenen Zusatz-Schichten über `spec.layer`. */
function stretchLayers(defId: string, layers: readonly (readonly string[])[], spec: StretchDef, n: number): (readonly string[])[] {
  const src = layers[spec.layer];
  if (src === undefined) throw new Error(`${defId}: stretch.layer ${spec.layer} gibt es nicht (${layers.length} Schichten)`);
  const insert = spec.rows ?? src;
  if (insert.length !== src.length || insert.some((r, z) => r.length !== src[z]!.length)) {
    throw new Error(`${defId}: stretch.rows muss so viele und so breite Zeilen haben wie die Schichten`);
  }
  return [...layers.slice(0, spec.layer + 1), ...Array.from({ length: n }, () => insert), ...layers.slice(spec.layer + 1)];
}

/**
 * Expandiert eine (statische) Komponente. Varianten überschreiben die Basis feldweise:
 * Inhalt (layers/cells), Sockets, Masken und Entities. Gedehnte Formen (`<variante>~<n>`) bekommen n
 * Zusatz-Schichten über `stretch.layer`; alles darüber (Zellen, Masken, Sockets, Entities) rückt um n nach oben.
 */
export function expandComponent(def: ComponentDef, variantId?: string): ExpandedComponent {
  const { base, n } = parseVariantId(variantId);
  let variant: VariantDef | undefined;
  if (base !== undefined) {
    variant = def.variants?.find((v) => v.id === base);
    if (variant === undefined) throw new Error(`${def.id}: unbekannte Variante '${base}'`);
  } else if (def.variants !== undefined && def.layers === undefined && def.cells === undefined) {
    throw new Error(`${def.id}: Komponente hat nur Varianten – variantId angeben (pickVariant)`);
  }
  const spec = variant?.stretch ?? def.stretch;
  if (n > 0 && (spec === undefined || n > spec.max)) throw new Error(`${def.id}: Dehnung ${n} nicht erlaubt (max ${spec?.max ?? 0})`);
  const lift = (v: Vec3): [number, number, number] => [v[0], n > 0 && v[1] > spec!.layer ? v[1] + n : v[1], v[2]];

  const src = variant !== undefined && (variant.layers !== undefined || variant.cells !== undefined) ? variant : def;
  let cells: ExpandedCell[];
  let air: Vec3[] = [];
  let size: Vec3;
  if (src.layers !== undefined) {
    const layers = n > 0 ? stretchLayers(def.id, src.layers, spec!, n) : src.layers;
    ({ cells, air, size } = parseLayers(layers, src.legend ?? {}));
  } else if (src.cells !== undefined) {
    if (n > 0 && spec!.rows !== undefined) throw new Error(`${def.id}: stretch.rows gibt es nur für layers`);
    const copies = n > 0 ? src.cells.filter((c) => c.at[1] === spec!.layer) : [];
    cells = [
      ...src.cells.map((c) => ({ at: lift(c.at), mat: c.mat })),
      ...copies.flatMap((c) => Array.from({ length: n }, (_, k): ExpandedCell => ({ at: [c.at[0], c.at[1] + k + 1, c.at[2]], mat: c.mat }))),
    ];
    size = boundsOf(cells.map((c) => c.at));
  } else {
    throw new Error(`${def.id}: kein Inhalt`);
  }

  const rawMasks: Masks = variant?.masks ?? def.masks ?? {};
  const masks: Masks =
    n > 0
      ? {
          ...rawMasks,
          ...(rawMasks.air !== undefined ? { air: rawMasks.air.map(lift) } : {}),
          ...(rawMasks.support !== undefined ? { support: rawMasks.support.map((s) => ({ ...s, at: lift(s.at) })) } : {}),
        }
      : rawMasks;
  air = [...air, ...(masks.air ?? [])];
  const entities = (variant?.entities ?? def.entities ?? []).map((e) => (n > 0 ? { ...e, at: lift(e.at) } : e));
  const sockets = (variant?.sockets ?? def.sockets ?? []).map((s) => (n > 0 && s.at !== undefined ? { ...s, at: lift(s.at) } : s));
  const extent = boundsOf([...cells.map((c) => c.at), ...entities.map((e) => e.at)]);
  size = [Math.max(size[0], extent[0]), Math.max(size[1], extent[1]), Math.max(size[2], extent[2])];
  const minRoomHeight = variant?.minRoomHeight ?? def.minRoomHeight;
  const maxRoomHeight = variant?.maxRoomHeight ?? def.maxRoomHeight;

  return {
    defId: def.id,
    variantId: base === undefined && n === 0 ? undefined : formatVariantId(variant?.id, n),
    mount: def.mount,
    size,
    cells,
    air,
    entities,
    sockets,
    masks,
    walkable: def.walkable === true,
    ...(def.functionTags !== undefined ? { functionTags: def.functionTags } : {}),
    ...(minRoomHeight !== undefined ? { minRoomHeight } : {}),
    ...(maxRoomHeight !== undefined ? { maxRoomHeight } : {}),
    ...(spec !== undefined ? { stretch: { spec, n } } : {}),
  };
}
