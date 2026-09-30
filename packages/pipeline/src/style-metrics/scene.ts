/**
 * Szene für die Stil-Kennzahlen: dichtes Raster über das Voxel-Volumen (Name, Schicht, Herkunft), die Außenluft
 * (Flutfüllung von außen), die Baukörper (zusammenhängende Grundrisse der Hülle) und die sichtbaren Außenflächen.
 * Rein: liest nur `Shell` und `VoxelVolume`, verändert nichts.
 */
import type { HorizontalDir } from '@mcda/core';
import type { RoomShellInfo, Shell, ShellCell } from '@mcda/blueprint';
import { Layer, type VoxelVolume } from '@mcda/voxel';
import { isSoftDecor } from './blocks.js';

/** Herkunft einer Zelle, grob (aus der Owner-Kennung). */
/** Herkunft: `shell:*` Hülle (Gelände-Schicht ausgenommen), `lining:*` Innenhaut, `x<n>:*` Außenteile, `p<n>` Möbel, sonst Umgebung (`q<n>:*` …). */
export const OwnerKind = { None: 0, Shell: 1, Lining: 2, Exterior: 3, Placed: 4, Other: 5, Terrain: 6 } as const;
export type OwnerKind = (typeof OwnerKind)[keyof typeof OwnerKind];

/** Eine Einrichtungs-Platzierung (Teilmenge von `Project.state.placements`; nur was die Messung braucht). */
export interface StylePlacement {
  readonly id: string;
  readonly componentId: string;
  readonly roomId?: string;
  readonly pose: { readonly pos: readonly [number, number, number] };
}

/** Eingang jeder Messung: Hülle + fertiges Volumen (+ optional Platzierungen, Raumarten, Lichtbericht). */
export interface StyleInput {
  readonly id: string;
  readonly label?: string;
  readonly buildingType?: string;
  readonly themeId?: string;
  readonly seed?: number;
  readonly shell: Shell;
  readonly volume: VoxelVolume;
  readonly placements?: readonly StylePlacement[];
  /** Raum-ID → Raumart-ID (für Blickfang und Hauptraum). */
  readonly roomTypes?: Readonly<Record<string, string>>;
  /** Lichtbericht der Materialisierung (`World.materialized.light`): dunkle und begehbare Zellen. */
  readonly light?: { readonly darkCells: readonly unknown[]; readonly walkableCells: number };
  /** Prüfbericht der Weg-Planung (`World.surroundings.site.pathAudit`): Türen ohne Wegverbindung. */
  readonly pathAudit?: { readonly unconnectedDoors: readonly unknown[] };
}

export const DIRS: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
export const DIR_LIST: readonly HorizontalDir[] = ['north', 'east', 'south', 'west'];

/** Laufkoordinate einer Zelle an einer Außenseite (x bei Nord/Süd, sonst z). */
export const alongOf = (d: HorizontalDir, x: number, z: number): number => (d === 'north' || d === 'south' ? x : z);
/** Wandebene (z bei Nord/Süd, sonst x). */
export const planeOf = (d: HorizontalDir, x: number, z: number): number => (d === 'north' || d === 'south' ? z : x);

/** Dichtes Raster über ein Volumen. */
export class Vox {
  readonly ox: number; readonly oy: number; readonly oz: number;
  readonly w: number; readonly h: number; readonly l: number;
  private readonly names: string[] = [];
  private readonly nameIds = new Map<string, number>();
  private readonly nm: Int32Array;
  private readonly ly: Uint8Array;
  private readonly ok: Uint8Array;
  private readonly po: Int32Array;
  readonly placeIds: string[] = [];
  private readonly placeIdx = new Map<string, number>();
  readonly volume: VoxelVolume;

  constructor(volume: VoxelVolume) {
    this.volume = volume;
    [this.ox, this.oy, this.oz] = volume.origin;
    [this.w, this.h, this.l] = volume.size;
    const n = this.w * this.h * this.l;
    this.nm = new Int32Array(n).fill(-1);
    this.ly = new Uint8Array(n);
    this.ok = new Uint8Array(n);
    this.po = new Int32Array(n).fill(-1);
    for (const c of volume.cells()) {
      const name = c.state.name;
      if (name === 'air' || name === 'cave_air' || name === 'void_air') continue;
      const i = this.idx(c.pos[0], c.pos[1], c.pos[2]);
      let id = this.nameIds.get(name);
      if (id === undefined) { id = this.names.length; this.names.push(name); this.nameIds.set(name, id); }
      this.nm[i] = id;
      this.ly[i] = c.layer;
      const o = c.owner;
      if (c.layer === Layer.Terrain) this.ok[i] = OwnerKind.Terrain;
      else if (o.startsWith('shell:')) this.ok[i] = OwnerKind.Shell;
      else if (o.startsWith('lining:')) this.ok[i] = OwnerKind.Lining;
      else if (/^x\d+:/.test(o)) this.ok[i] = OwnerKind.Exterior;
      else if (/^p\d+$/.test(o)) {
        this.ok[i] = OwnerKind.Placed;
        let p = this.placeIdx.get(o);
        if (p === undefined) { p = this.placeIds.length; this.placeIds.push(o); this.placeIdx.set(o, p); }
        this.po[i] = p;
      } else this.ok[i] = OwnerKind.Other;
    }
  }

  private idx(x: number, y: number, z: number): number {
    return x - this.ox + (z - this.oz) * this.w + (y - this.oy) * this.w * this.l;
  }
  inside(x: number, y: number, z: number): boolean {
    return x >= this.ox && x < this.ox + this.w && y >= this.oy && y < this.oy + this.h && z >= this.oz && z < this.oz + this.l;
  }
  /** Blockname oder `air` (auch außerhalb des Volumens). */
  name(x: number, y: number, z: number): string {
    if (!this.inside(x, y, z)) return 'air';
    const v = this.nm[this.idx(x, y, z)]!;
    return v < 0 ? 'air' : this.names[v]!;
  }
  solid(x: number, y: number, z: number): boolean {
    return this.inside(x, y, z) && this.nm[this.idx(x, y, z)]! >= 0;
  }
  layer(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.ly[this.idx(x, y, z)]! : 0;
  }
  owner(x: number, y: number, z: number): OwnerKind {
    return this.inside(x, y, z) ? (this.ok[this.idx(x, y, z)]! as OwnerKind) : OwnerKind.None;
  }
  /** Platzierungs-Kennung (`p14`) der Zelle oder `undefined`. */
  placement(x: number, y: number, z: number): string | undefined {
    if (!this.inside(x, y, z)) return undefined;
    const p = this.po[this.idx(x, y, z)]!;
    return p < 0 ? undefined : this.placeIds[p];
  }
  /** Blockzustands-Property (`hanging` …) oder `undefined`. */
  prop(x: number, y: number, z: number, key: string): string | undefined {
    if (!this.solid(x, y, z)) return undefined;
    return this.volume.stateAt([x, y, z]).properties[key];
  }
  /** Alle belegten Zellen. */
  *solids(): IterableIterator<{ x: number; y: number; z: number; name: string; layer: number; owner: OwnerKind }> {
    for (let y = 0; y < this.h; y++) {
      for (let z = 0; z < this.l; z++) {
        for (let x = 0; x < this.w; x++) {
          const i = x + z * this.w + y * this.w * this.l;
          const v = this.nm[i]!;
          if (v >= 0) yield { x: x + this.ox, y: y + this.oy, z: z + this.oz, name: this.names[v]!, layer: this.ly[i]!, owner: this.ok[i]! as OwnerKind };
        }
      }
    }
  }
}

/** Außenluft: alles, was von den Rändern des Volumens über Luftzellen erreichbar ist. */
export function exteriorAir(vox: Vox): Uint8Array {
  const { w, h, l } = vox;
  const seen = new Uint8Array(w * h * l);
  const stack: number[] = [];
  const push = (x: number, y: number, z: number): void => {
    if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= l) return;
    const i = x + z * w + y * w * l;
    if (seen[i]) return;
    if (vox.solid(x + vox.ox, y + vox.oy, z + vox.oz)) return;
    seen[i] = 1;
    stack.push(i);
  };
  for (let y = 0; y < h; y++) for (let z = 0; z < l; z++) { push(0, y, z); push(w - 1, y, z); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { push(x, y, 0); push(x, y, l - 1); }
  for (let z = 0; z < l; z++) for (let x = 0; x < w; x++) { push(x, h - 1, z); push(x, 0, z); }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % w, z = Math.floor(i / w) % l, y = Math.floor(i / (w * l));
    push(x + 1, y, z); push(x - 1, y, z); push(x, y + 1, z); push(x, y - 1, z); push(x, y, z + 1); push(x, y, z - 1);
  }
  return seen;
}

/** Sichtbare Außenfläche einer Hüllzelle. */
export interface Face {
  readonly building: number;
  readonly dir: HorizontalDir;
  readonly plane: number;
  readonly a: number;
  readonly y: number;
  readonly x: number;
  readonly z: number;
  readonly cell: ShellCell;
  readonly storey: number;
  /** Vorsprung vor der Wandebene in Blöcken (0 = bündig, höchstens 3): zusammenhängend belegte Zellen davor. */
  readonly depth: number;
  /** Block in der Wandebene. */
  readonly wallName: string;
  /** Vorderster Block (bei `depth` 0 gleich `wallName`). */
  readonly frontName: string;
  /** Block direkt vor der Wandzelle (`air` bei freier Luft); Bewuchs und Anbauten der Wand. */
  readonly k1Name: string;
}

/** Ein Baukörper: zusammenhängender Grundriss der Hülle. */
export interface Building {
  readonly index: number;
  readonly columns: ReadonlySet<number>;
  readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number;
  readonly cells: readonly ShellCell[];
  readonly rooms: readonly RoomShellInfo[];
  /** Y der untersten Wohn-Etage über dem Gelände (Boden der Etage 0, sonst der tiefste Raum). */
  readonly groundY: number;
  /** Böden der Etagen (`baseY`), aufsteigend. */
  readonly floors: readonly number[];
  readonly faces: readonly Face[];
  readonly roofCells: readonly ShellCell[];
}

const BUILDING_KINDS: ReadonlySet<ShellCell['kind']> = new Set(['floor', 'wall', 'pillar', 'door', 'window', 'lintel', 'ceiling', 'roof', 'stairs', 'railing', 'fort']);
const FACE_KINDS: ReadonlySet<ShellCell['kind']> = new Set(['wall', 'pillar', 'window', 'door', 'lintel']);

/** Mindestgröße eines Baukörpers (Grundrisssäulen), damit Zäune und lose Treppen nicht als Haus zählen. */
const MIN_COLUMNS = 16;

export interface Scene {
  readonly vox: Vox;
  readonly ext: Uint8Array;
  readonly shell: Shell;
  readonly buildings: readonly Building[];
  /** Ist die Zelle Außenluft? (außerhalb des Volumens: ja) */
  isExteriorAir(x: number, y: number, z: number): boolean;
}

export function buildScene(input: StyleInput): Scene {
  const vox = new Vox(input.volume);
  const ext = exteriorAir(vox);
  const isExteriorAir = (x: number, y: number, z: number): boolean => {
    if (!vox.inside(x, y, z)) return true;
    return ext[x - vox.ox + (z - vox.oz) * vox.w + (y - vox.oy) * vox.w * vox.l] === 1;
  };
  /** Belegte Zelle grenzt (außer zurück zur Wand) an Außenluft: sichtbarer Vorsprung. */
  const exposed = (x: number, y: number, z: number, d: HorizontalDir): boolean => {
    const back = DIRS[d];
    for (const [ex, ey, ez] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      if (ex === -back[0] && ez === -back[1] && ey === 0) continue;
      if (isExteriorAir(x + ex, y + ey, z + ez)) return true;
    }
    return false;
  };
  const shell = input.shell;
  // Wandzellen der Hülle: eine Wandzelle vor einer Wand ist der Nachbarflügel, kein Vorsprung
  const wallAt = new Set<string>();
  for (const c of shell.cells) if (FACE_KINDS.has(c.kind)) wallAt.add(`${c.pos[0]},${c.pos[1]},${c.pos[2]}`);
  // Spalten der Hülle → Baukörper (8er-Nachbarschaft)
  const colKey = (x: number, z: number): number => x - vox.ox + (z - vox.oz) * vox.w;
  const parent = new Map<number, number>();
  const find = (k: number): number => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const c of shell.cells) {
    if (!BUILDING_KINDS.has(c.kind)) continue;
    const k = colKey(c.pos[0], c.pos[2]);
    if (!parent.has(k)) parent.set(k, k);
  }
  for (const k of parent.keys()) {
    const x = k % vox.w, z = Math.floor(k / vox.w);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= vox.w || nz >= vox.l) continue;
        const nk = nx + nz * vox.w;
        if (parent.has(nk)) { const a = find(k), b = find(nk); if (a !== b) parent.set(Math.max(a, b), Math.min(a, b)); }
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (const k of parent.keys()) {
    const r = find(k);
    const g = groups.get(r);
    if (g) g.push(k); else groups.set(r, [k]);
  }
  const roots = [...groups.entries()].filter(([, cols]) => cols.length >= MIN_COLUMNS).sort((a, b) => a[0] - b[0]);
  const rootIndex = new Map<number, number>();
  roots.forEach(([r], i) => rootIndex.set(r, i));
  const cellLists: ShellCell[][] = roots.map(() => []);
  for (const c of shell.cells) {
    if (!BUILDING_KINDS.has(c.kind)) continue;
    const bi = rootIndex.get(find(colKey(c.pos[0], c.pos[2])));
    if (bi !== undefined) cellLists[bi]!.push(c);
  }
  const roomLists: RoomShellInfo[][] = roots.map(() => []);
  for (const r of shell.rooms.values()) {
    const first = r.interior.toArray()[0];
    if (!first) continue;
    const bi = rootIndex.get(find(colKey(first[0], first[1])));
    if (bi !== undefined) roomLists[bi]!.push(r);
  }
  const buildings: Building[] = roots.map(([, cols], bi) => {
    const cells = cellLists[bi]!;
    const rooms = roomLists[bi]!;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const k of cols) {
      const x = (k % vox.w) + vox.ox, z = Math.floor(k / vox.w) + vox.oz;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const floors = [...new Set(rooms.map((r) => r.baseY))].sort((a, b) => a - b);
    const ground = rooms.filter((r) => r.floorIndex === 0);
    const groundY = ground.length > 0 ? Math.min(...ground.map((r) => r.baseY)) : floors[0] ?? 0;
    const storeyOf = (y: number): number => {
      let s = 0;
      for (let i = 0; i < floors.length; i++) if (y >= floors[i]! - 1) s = i;
      return s;
    };
    const faces: Face[] = [];
    for (const cell of cells) {
      if (!FACE_KINDS.has(cell.kind)) continue;
      const [x, y, z] = cell.pos;
      if (!vox.solid(x, y, z)) continue;
      for (const d of DIR_LIST) {
        const [dx, dz] = DIRS[d];
        const k1 = vox.name(x + dx, y, z + dz);
        let depth = 0;
        if (!isExteriorAir(x + dx, y, z + dz)) {
          // belegte Zelle davor, die selbst an Außenluft grenzt (nicht die Wand eines Nachbarn)
          if (k1 === 'air' || wallAt.has(`${x + dx},${y},${z + dz}`) || !exposed(x + dx, y, z + dz, d)) continue;
          if (!isSoftDecor(k1)) {
            depth = 1;
            const more = (k: number): boolean => vox.solid(x + dx * k, y, z + dz * k) && !isSoftDecor(vox.name(x + dx * k, y, z + dz * k)) && !wallAt.has(`${x + dx * k},${y},${z + dz * k}`);
            while (depth < 3 && more(depth + 1)) depth++;
          }
        }
        faces.push({
          building: bi, dir: d, plane: planeOf(d, x, z), a: alongOf(d, x, z), y, x, z, cell, storey: storeyOf(y), depth,
          wallName: vox.name(x, y, z), frontName: vox.name(x + dx * depth, y, z + dz * depth), k1Name: k1,
        });
      }
    }
    return {
      index: bi, columns: new Set(cols), minX, maxX, minZ, maxZ, cells, rooms, groundY, floors, faces,
      roofCells: cells.filter((c) => c.kind === 'roof'),
    };
  });
  return { vox, ext, shell, buildings, isExteriorAir };
}

/** Oberkante der Geländeschicht je Spalte (Gelände-Schicht, Wasser und Pflanzen ausgenommen); `undefined` ohne Gelände. */
export function surfaceY(vox: Vox, x: number, z: number): number | undefined {
  for (let y = vox.oy + vox.h - 1; y >= vox.oy; y--) {
    if (vox.layer(x, y, z) === Layer.Terrain && vox.solid(x, y, z) && vox.name(x, y, z) !== 'water') return y;
  }
  return undefined;
}
