/**
 * Beleuchtete Geometrie (rein, ohne WebGL): deepslate-Meshdaten (Blockmodelle + Spezialrenderer, Culling wie
 * deepslates ChunkBuilder) → verschränkte Vertex-Puffer mit Licht je Vertex (Blocklicht, Himmelslicht, AO,
 * Flächenschattierung) und Markierung für Spawn-Stellen. Grundlage für `createLitRenderer` (WebGL2).
 *
 * Schnell bei Neuaufbau (Schnitthöhe, Spawn-Markierung): Block-Meshes werden je Zustand und Culling-Maske in
 * lokalen Koordinaten zwischengespeichert (`LitMeshCache`), pro Block bleibt nur das Verschieben und das Licht.
 */
import { BlockState, Direction, Mesh, SpecialRenderers, type BlockFlags as DsBlockFlags, type Cull, type Structure } from 'deepslate';
import { MAX_LIGHT, cellIndex, type LightField } from './lighting.js';
import type { DeepslateResources } from './resources.js';
import { bilinear, centerLight, dominantAxis, faceCorners, faceShade, isOpaqueCell, sampleCell, tangentAxes, type VertexLight } from './smooth-light.js';
import { SYNTHETIC_NAMESPACE } from './synthetic.js';

/**
 * Vertex-Layout (Float32, verschränkt):
 * 0–2 Position (Strukturkoordinaten) · 3–4 UV · 5–8 Texturgrenzen · 9–11 Tönung · 12 Blocklicht (0–15) ·
 * 13 Himmelslicht (0–15) · 14 AO (0–1) · 15 Flächenschattierung (0–1) · 16 Flags (bit 0: Spawn-Stelle)
 */
export const LIT_VERTEX_FLOATS = 17;
export const LIT_OFFSETS = { pos: 0, uv: 3, texLimit: 5, tint: 9, light: 12, flags: 16 } as const;
export const LIT_FLAG_SPAWN = 1;

export interface LitBuffers {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly quads: number;
}

export interface LitGeometry {
  readonly opaque: LitBuffers;
  /** halbtransparente Blöcke (Flag `semi_transparent`), zweiter Durchgang */
  readonly transparent: LitBuffers;
  readonly quads: number;
  /** Anzahl markierter Spawn-Flächen */
  readonly spawnQuads: number;
  /** Blöcke, deren Mesh nicht gebaut werden konnte */
  readonly errors: readonly string[];
}

export interface LitMeshOptions {
  /** Zellindizes (des Lichtfelds) mit Spawn-Gefahr: Oberseiten, die in diese Zellen zeigen, werden markiert. */
  readonly spawnCells?: ReadonlySet<number>;
  /** Weiches Licht + AO (Standard: true); false = flach je Fläche wie Minecraft ohne „Smooth Lighting“. */
  readonly smooth?: boolean;
  /** Cache für Block-Meshes (über Neuaufbauten hinweg wiederverwenden). */
  readonly cache?: LitMeshCache;
  /** Modell-JSON (`ViewerResources.models`) für `ambientocclusion: false`, wenn kein Cache übergeben wird. */
  readonly models?: Readonly<Record<string, unknown>>;
  /**
   * Schnitthöhe (lokales y, inklusive) der Struktur. Flächen, die in eine Zelle darüber zeigen, sind
   * Schnittflächen: Sie bekommen flach das Licht der Umgebung ihres eigenen Blocks (sonst wären Mauerkronen
   * unter der weggeschnittenen Decke schwarz). Das Lichtfeld bleibt das des ganzen Volumens.
   */
  readonly cutY?: number;
}

/** Je Quad im Block-Template: 4 × (x, y, z, u, v), Texturgrenzen 4, Tönung 3, Normale 3, flach 1. */
const TQ = 31;

interface BlockTemplate {
  readonly data: Float32Array;
  readonly quads: number;
  readonly transparent: boolean;
  readonly error?: string;
}

/** Modelle mit `ambientocclusion: false` (über die Eltern aufgelöst). */
function modelAoLookup(models: Readonly<Record<string, unknown>> | undefined): (model: string) => boolean {
  const memo = new Map<string, boolean>();
  const key = (id: string): string => (id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id);
  const ao = (id: string, depth: number): boolean => {
    const k = key(id);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const json = models?.[k] as { ambientocclusion?: unknown; parent?: unknown } | undefined;
    let v = true;
    if (json !== undefined) {
      if (typeof json.ambientocclusion === 'boolean') v = json.ambientocclusion;
      else if (typeof json.parent === 'string' && depth < 32) v = ao(json.parent, depth + 1);
    }
    memo.set(k, v);
    return v;
  };
  return (model) => ao(model, 0);
}

/** Zwischenspeicher der Block-Meshes je Zustand und Culling-Maske (gehört zu genau einem Ressourcen-Satz). */
export class LitMeshCache {
  private readonly templates = new Map<string, BlockTemplate>();
  private readonly modelAo: (model: string) => boolean;

  constructor(readonly resources: DeepslateResources, models?: Readonly<Record<string, unknown>>) {
    this.modelAo = modelAoLookup(models);
  }

  get size(): number {
    return this.templates.size;
  }

  template(state: BlockState, stateKey: string, cullMask: number): BlockTemplate {
    const key = `${stateKey}|${cullMask}`;
    let t = this.templates.get(key);
    if (t === undefined) {
      t = this.build(state, cullMask);
      this.templates.set(key, t);
    }
    return t;
  }

  private build(state: BlockState, cullMask: number): BlockTemplate {
    const res = this.resources;
    const id = state.getName();
    const cull: Cull = {};
    DIRS.forEach((d, k) => {
      if ((cullMask & (1 << k)) !== 0) cull[d.name] = true;
    });
    const props = { ...(res.getDefaultBlockProperties(id) ?? {}), ...state.getProperties() };
    const transparent = res.getBlockFlags(id)?.semi_transparent === true;
    try {
      const def = res.getBlockDefinition(id);
      const model = def === null ? new Mesh() : def.getMesh(id, props, res, res, cull);
      const special = SpecialRenderers.getBlockMesh(new BlockState(id, props), undefined, res, cull);
      // Block-Entities (Spezialrenderer), eigene Näherungen (mcda:) und Modelle ohne AO: flach wie im Spiel
      const flatModel = id.namespace === SYNTHETIC_NAMESPACE
        || (def !== null && def.getModelVariants(props).some((v) => !this.modelAo(v.model)));
      const quads = model.quads.length + special.quads.length;
      const data = new Float32Array(quads * TQ);
      let o = 0;
      const put = (mesh: Mesh, flat: boolean): void => {
        for (const q of mesh.quads) {
          const vs = q.vertices();
          for (const v of vs) {
            data[o++] = v.pos.x; data[o++] = v.pos.y; data[o++] = v.pos.z;
            data[o++] = v.texture?.[0] ?? 0; data[o++] = v.texture?.[1] ?? 0;
          }
          const lim = vs[0]!.textureLimit ?? [0, 0, 0, 0];
          data[o++] = lim[0]; data[o++] = lim[1]; data[o++] = lim[2]; data[o++] = lim[3];
          const c = vs[0]!.color;
          data[o++] = c[0] ?? 1; data[o++] = c[1] ?? 1; data[o++] = c[2] ?? 1;
          const n = q.normal(); // entartete Quads (Fläche 0) → Normale nach oben
          const ok = Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z);
          data[o++] = ok ? n.x : 0; data[o++] = ok ? n.y : 1; data[o++] = ok ? n.z : 0;
          data[o++] = flat ? 1 : 0;
        }
      };
      put(model, flatModel);
      put(special, true);
      return { data, quads, transparent };
    } catch (e) {
      return { data: new Float32Array(0), quads: 0, transparent, error: `${state.toString()}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}

/** Richtungen in Bit-Reihenfolge der Culling-Maske (deepslate-Namen, Versatz). */
const DIRS: readonly { name: Direction; dx: number; dy: number; dz: number }[] = [
  { name: Direction.NORTH, dx: 0, dy: 0, dz: -1 }, { name: Direction.EAST, dx: 1, dy: 0, dz: 0 }, { name: Direction.SOUTH, dx: 0, dy: 0, dz: 1 },
  { name: Direction.WEST, dx: -1, dy: 0, dz: 0 }, { name: Direction.UP, dx: 0, dy: 1, dz: 0 }, { name: Direction.DOWN, dx: 0, dy: -1, dz: 0 },
];
const UP = 4;

interface PaletteEntry {
  readonly state: BlockState;
  readonly key: string;
  readonly name: string;
  readonly flags: DsBlockFlags | null;
  readonly waterlogged: boolean;
}

/** deepslate ChunkBuilder.needsCull, auf Paletten-Einträgen. */
function needsCull(a: PaletteEntry, dir: number, b: PaletteEntry | undefined): boolean {
  if (b === undefined) return false;
  if (a.name === b.name && b.flags?.self_culling) return true;
  if (b.flags?.opaque) return !(dir === UP && a.waterlogged);
  return a.waterlogged && b.waterlogged;
}

class Writer {
  vertices: Float32Array;
  indices: Uint32Array;
  quads = 0;

  constructor(quads: number) {
    this.vertices = new Float32Array(quads * 4 * LIT_VERTEX_FLOATS);
    this.indices = new Uint32Array(quads * 6);
  }

  finish(): LitBuffers {
    return { vertices: this.vertices, indices: this.indices, quads: this.quads };
  }
}

/**
 * Geometrie einer Struktur mit Licht aus `field`. Struktur und Feld teilen die lokalen Koordinaten
 * (`toStructure` und `computeLightField` desselben Volumens).
 */
export function buildLitGeometry(structure: Structure, resources: DeepslateResources, field: LightField, opts: LitMeshOptions = {}): LitGeometry {
  const cache = opts.cache ?? new LitMeshCache(resources, opts.models);
  const smooth = opts.smooth ?? true;
  const [sx, sy, sz] = structure.getSize();
  const fsize = field.input.size;

  // Paletten-Gitter der Struktur (für Culling)
  const palette: PaletteEntry[] = [];
  const byState = new Map<BlockState, number>();
  const grid = new Int32Array(sx * sy * sz).fill(-1);
  const blocks = structure.getBlocks();
  const blockEntry = new Int32Array(blocks.length);
  blocks.forEach((b, k) => {
    let e = byState.get(b.state);
    if (e === undefined) {
      const id = b.state.getName();
      e = palette.length;
      palette.push({ state: b.state, key: b.state.toString(), name: id.toString(), flags: resources.getBlockFlags(id), waterlogged: b.state.isWaterlogged() });
      byState.set(b.state, e);
    }
    grid[b.pos[0] + sx * (b.pos[2] + sz * b.pos[1])] = e;
    blockEntry[k] = e;
  });
  const entryAt = (x: number, y: number, z: number): PaletteEntry | undefined => {
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return undefined;
    const e = grid[x + sx * (z + sz * y)]!;
    return e < 0 ? undefined : palette[e];
  };

  // 1. Templates auflösen und zählen
  const templates: BlockTemplate[] = new Array(blocks.length);
  let opaqueQuads = 0, transparentQuads = 0;
  const errors: string[] = [];
  blocks.forEach((b, k) => {
    const entry = palette[blockEntry[k]!]!;
    let mask = 0;
    for (let d = 0; d < 6; d++) {
      const dir = DIRS[d]!;
      if (needsCull(entry, d, entryAt(b.pos[0] + dir.dx, b.pos[1] + dir.dy, b.pos[2] + dir.dz))) mask |= 1 << d;
    }
    const t = cache.template(entry.state, entry.key, mask);
    templates[k] = t;
    if (t.error !== undefined && !errors.includes(t.error)) errors.push(t.error);
    if (t.transparent) transparentQuads += t.quads;
    else opaqueQuads += t.quads;
  });

  // 2. Schreiben: Position + Licht je Vertex
  const opaque = new Writer(opaqueQuads);
  const transparent = new Writer(transparentQuads);
  const corners = new Float32Array(12);
  const vl: VertexLight = { block: 0, sky: 0, ao: 1 };
  const spawnCells = opts.spawnCells;
  let spawnQuads = 0;
  const inField = (c: readonly number[]): boolean => c[0]! >= 0 && c[1]! >= 0 && c[2]! >= 0 && c[0]! < fsize[0] && c[1]! < fsize[1] && c[2]! < fsize[2];

  blocks.forEach((b, k) => {
    const t = templates[k]!;
    if (t.quads === 0) return;
    const w = t.transparent ? transparent : opaque;
    const bx = b.pos[0], by = b.pos[1], bz = b.pos[2];
    const blockPos: [number, number, number] = [bx, by, bz];
    const inside = inField(blockPos);
    const emissive = inside && field.input.emission[cellIndex(fsize, bx, by, bz)]! > 0;
    const d = t.data;
    for (let q = 0; q < t.quads; q++) {
      const base = q * TQ;
      const nx = d[base + 27]!, ny = d[base + 28]!, nz = d[base + 29]!;
      const { axis, sign } = dominantAxis(nx, ny, nz);
      const [t1, t2] = tangentAxes(axis);
      // Ebene der Fläche in Normalenrichtung (Mittel der vier Vertices, relativ zum Block)
      const plane = (d[base + axis]! + d[base + 5 + axis]! + d[base + 10 + axis]! + d[base + 15 + axis]!) / 4;
      const cell = sampleCell([0, 0, 0], plane, axis, sign);
      cell[0] += bx; cell[1] += by; cell[2] += bz;
      const cap = opts.cutY !== undefined && cell[1] > opts.cutY;
      const flat = cap || !smooth || d[base + 30] === 1 || emissive || isOpaqueCell(field, cell);
      let flatBlock = 0, flatSky = 0;
      if (flat) {
        const c = centerLight(field, cell[0], cell[1], cell[2]);
        flatBlock = c & 15;
        flatSky = (c >> 4) & 15;
        if (cap) {
          // Schnittfläche: hellstes aus Umgebung des Blocks und der Zelle darüber; ganz eingeschlossen → offen
          const own = centerLight(field, bx, by, bz);
          flatBlock = Math.max(flatBlock, own & 15);
          flatSky = Math.max(flatSky, (own >> 4) & 15);
          if (flatBlock === 0 && flatSky === 0) flatSky = MAX_LIGHT;
        }
      } else {
        faceCorners(field, cell, axis, corners);
      }
      let flags = 0;
      if (spawnCells !== undefined && axis === 1 && sign > 0 && inField(cell) && spawnCells.has(cellIndex(fsize, cell[0], cell[1], cell[2]))) {
        flags |= LIT_FLAG_SPAWN;
        spawnQuads++;
      }
      const shade = faceShade(nx, ny, nz);
      const vbase = w.quads * 4;
      let o = vbase * LIT_VERTEX_FLOATS;
      const out = w.vertices;
      for (let v = 0; v < 4; v++) {
        const p = base + v * 5;
        const lx = d[p]!, ly = d[p + 1]!, lz = d[p + 2]!;
        if (flat) {
          vl.block = flatBlock; vl.sky = flatSky; vl.ao = 1;
        } else {
          const local = [lx, ly, lz];
          const u = local[t1]!, vv = local[t2]!;
          bilinear(corners, u < 0 ? 0 : u > 1 ? 1 : u, vv < 0 ? 0 : vv > 1 ? 1 : vv, vl);
        }
        out[o++] = lx + bx; out[o++] = ly + by; out[o++] = lz + bz;
        out[o++] = d[p + 3]!; out[o++] = d[p + 4]!;
        out[o++] = d[base + 20]!; out[o++] = d[base + 21]!; out[o++] = d[base + 22]!; out[o++] = d[base + 23]!;
        out[o++] = d[base + 24]!; out[o++] = d[base + 25]!; out[o++] = d[base + 26]!;
        out[o++] = vl.block; out[o++] = vl.sky; out[o++] = vl.ao; out[o++] = shade;
        out[o++] = flags;
      }
      const ib = w.quads * 6;
      w.indices[ib] = vbase; w.indices[ib + 1] = vbase + 1; w.indices[ib + 2] = vbase + 2;
      w.indices[ib + 3] = vbase; w.indices[ib + 4] = vbase + 2; w.indices[ib + 5] = vbase + 3;
      w.quads++;
    }
  });

  return { opaque: opaque.finish(), transparent: transparent.finish(), quads: opaqueQuads + transparentQuads, spawnQuads, errors };
}
