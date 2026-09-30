/**
 * Goldene Galerie (P0-A): Welt → dichtes Raster mit Palette (rein, ohne I/O).
 *
 * Eingabe ist die Form von `ExportVolume` aus @mcda/export (Positionen relativ zur Minimum-Ecke, fehlend = Luft) –
 * egal ob aus einer `.nbt`-Datei gelesen oder direkt aus dem Generator. Beide Wege landen hier und liefern bei
 * gleicher Welt dasselbe Raster (Palette nach Zustandsschlüssel sortiert, nicht nach Lesereihenfolge). Alles
 * Weitere (Analyse, Kameras) hängt nur vom Raster ab: gleiche Welt → gleiche Bilder, gleich welcher Weg.
 *
 * Merkmale je Zustand (`StateTraits`) kommen über einen Klassifizierer von außen (Node: Plattform-Physik und
 * Block-Tags, siehe node/classify.ts; Tests: kleine Tabellen).
 */

export type Vec3 = readonly [number, number, number];

export interface GoldenState {
  /** Blockname ohne `minecraft:` */
  readonly name: string;
  readonly properties: Readonly<Record<string, string>>;
}

/** Physik-Klasse wie @mcda/platform (`air`, `thin`, `flat`, `half`, `tall`, `full`). */
export type PhysClass = 'air' | 'thin' | 'flat' | 'half' | 'tall' | 'full';

export interface StateTraits {
  readonly cls: PhysClass;
  /** Gelände oder Bewuchs (Erde, Gras, Sand, Kies, Wasser, Schnee, Blätter, Blumen …) – kein Bauwerk */
  readonly natural: boolean;
  /** Lichtquelle (Blocklicht > 0) – kennzeichnet bewohnte Etagen */
  readonly emits: boolean;
  /** Naturgestein (Stein, Andesit, Diorit, Granit, Tuff, Tiefenschiefer): unter Erde Untergrund, sonst Baustoff */
  readonly mineral: boolean;
}

export type Classifier = (s: GoldenState) => StateTraits;

/** Lesesicht auf ein `ExportVolume` (strukturell erfüllt). */
export interface VolumeLike {
  readonly size: Vec3;
  readonly blocks: ReadonlyArray<{ readonly pos: Vec3; readonly name: string; readonly properties?: Readonly<Record<string, string>> }>;
  readonly entities?: ReadonlyArray<{ readonly blockPos: Vec3; readonly nbt: { readonly type: string; readonly value: unknown } }>;
}

/** Rahmen-Entity (Item Frame) – die Vorschau zeigt sie als synthetische Blöcke. */
export interface GoldenFrame {
  readonly pos: Vec3;
  readonly kind: 'item_frame' | 'glow_item_frame';
  /** Minecraft `Facing` (0 unten, 1 oben, 2 Nord, 3 Süd, 4 West, 5 Ost) */
  readonly facing: number;
}

export interface Grid {
  readonly size: Vec3;
  /** Index 0 ist immer Luft; danach nach Zustandsschlüssel sortiert */
  readonly palette: readonly GoldenState[];
  readonly traits: readonly StateTraits[];
  /** Paletten-Index je Zelle, Reihenfolge wie `cellIndex` der Vorschau: x schnell, dann z, dann y */
  readonly cells: Uint32Array;
  readonly frames: readonly GoldenFrame[];
}

export const AIR_STATE: GoldenState = { name: 'air', properties: {} };
const AIR_TRAITS: StateTraits = { cls: 'air', natural: false, emits: false, mineral: false };
const AIR_NAMES = new Set(['air', 'cave_air', 'void_air', 'structure_void']);

export const plainName = (name: string): string => (name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name);

/** Zustandsschlüssel `name[k=v,…]` (Eigenschaften sortiert) – wie die Vorschau (lighting.ts). */
export function stateKey(s: GoldenState): string {
  const keys = Object.keys(s.properties).sort();
  return keys.length === 0 ? s.name : `${s.name}[${keys.map((k) => `${k}=${s.properties[k]}`).join(',')}]`;
}

export function gridIndex(size: Vec3, x: number, y: number, z: number): number {
  return x + size[0] * (z + size[2] * y);
}

const compareKeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function frameOf(e: { readonly blockPos: Vec3; readonly nbt: { readonly type: string; readonly value: unknown } }): GoldenFrame | undefined {
  if (e.nbt.type !== 'compound') return undefined;
  const v = e.nbt.value as Readonly<Record<string, { readonly value: unknown } | undefined>>;
  const id = typeof v['id']?.value === 'string' ? plainName(v['id'].value as string) : '';
  if (id !== 'item_frame' && id !== 'glow_item_frame') return undefined;
  if (v['Invisible']?.value === 1) return undefined;
  const facing = typeof v['Facing']?.value === 'number' ? (v['Facing'].value as number) : 2;
  return { pos: [e.blockPos[0], e.blockPos[1], e.blockPos[2]], kind: id, facing };
}

/** Volumen → Raster. Unbekannte Positionen außerhalb der Größe sind ein Fehler (kaputte Datei). */
export function gridFromVolume(v: VolumeLike, classify: Classifier): Grid {
  const size: Vec3 = [v.size[0], v.size[1], v.size[2]];
  const byKey = new Map<string, GoldenState>();
  const keyOf: string[] = new Array(v.blocks.length);
  v.blocks.forEach((b, i) => {
    const name = plainName(b.name);
    if (AIR_NAMES.has(name)) return;
    const s: GoldenState = { name, properties: { ...(b.properties ?? {}) } };
    const key = stateKey(s);
    keyOf[i] = key;
    if (!byKey.has(key)) byKey.set(key, s);
  });
  const keys = [...byKey.keys()].sort(compareKeys);
  const index = new Map(keys.map((k, i) => [k, i + 1]));
  const palette = [AIR_STATE, ...keys.map((k) => byKey.get(k)!)];
  const traits = palette.map((s, i) => (i === 0 ? AIR_TRAITS : classify(s)));
  const cells = new Uint32Array(size[0] * size[1] * size[2]);
  v.blocks.forEach((b, i) => {
    const key = keyOf[i];
    if (key === undefined) return;
    const [x, y, z] = b.pos;
    if (x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2]) throw new RangeError(`Block außerhalb der Größe: ${b.pos.join(',')}`);
    cells[gridIndex(size, x, y, z)] = index.get(key)!;
  });
  const frames = (v.entities ?? []).map(frameOf).filter((f): f is GoldenFrame => f !== undefined)
    .sort((a, b) => a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0] || a.facing - b.facing);
  return { size, palette, traits, cells, frames };
}

/** Blockzahl ohne Luft und die häufigsten Blöcke (für das Manifest). */
export function blockCounts(g: Grid, top = 20): { readonly total: number; readonly natural: number; readonly byName: ReadonlyArray<readonly [string, number]> } {
  const perState = new Uint32Array(g.palette.length);
  for (let i = 0; i < g.cells.length; i++) perState[g.cells[i]!]!++;
  const byName = new Map<string, number>();
  let total = 0, natural = 0;
  for (let p = 1; p < g.palette.length; p++) {
    const n = perState[p]!;
    if (n === 0) continue;
    total += n;
    if (g.traits[p]!.natural) natural += n;
    byName.set(g.palette[p]!.name, (byName.get(g.palette[p]!.name) ?? 0) + n);
  }
  const sorted = [...byName.entries()].sort((a, b) => b[1] - a[1] || compareKeys(a[0], b[0])).slice(0, top);
  return { total, natural, byName: sorted };
}

/** Stabiler Fingerabdruck der Welt (FNV-1a über Größe und Zustandsschlüssel je Zelle) – gleich bei gleicher Welt. */
export function gridDigest(g: Grid): string {
  let h = 0x811c9dc5;
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  mix(g.size.join('x'));
  const keys = g.palette.map(stateKey);
  for (let i = 0; i < g.cells.length; i++) {
    const p = g.cells[i]!;
    if (p !== 0) mix(`${i}:${keys[p]};`);
  }
  for (const f of g.frames) mix(`f${f.pos.join(',')}${f.kind}${f.facing};`);
  return h.toString(16).padStart(8, '0');
}
