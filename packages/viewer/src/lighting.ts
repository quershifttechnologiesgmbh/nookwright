/**
 * Minecraft-artiges Lichtfeld für die Vorschau (rein, ohne DOM): je Zelle Blocklicht und Himmelslicht (0–15).
 *
 * - **Blocklicht:** BFS von den Lichtquellen, −1 je Schritt (plus Abschwächung, z. B. Blätter), undurchsichtige
 *   Blöcke schlucken, volle Flächen sperren in ihrer Richtung – dieselbe Regel wie der Licht-Pass in
 *   @mcda/materialize (light.ts), damit Vorschau und Spawn-Report übereinstimmen.
 * - **Himmelslicht:** senkrecht von oben ungeschwächt 15 bis zum ersten sperrenden Block (Dach), seitlich aus der
 *   offenen Umgebung (außerhalb des Volumens = freie Luft über dem Boden) mit 14, dann −1 je Schritt.
 *   Luft, Glas, Scheiben und (je nach Regeln) Türen lassen es durch.
 *
 * Welche Blöcke leuchten, sperren oder abschwächen, kommt über den Port `LightRules` von außen: Die Vorschau
 * bleibt generisch (Domain Design §2.1), die Demo übergibt Emissionstabelle und Flächenmodell aus
 * @mcda/materialize – nichts davon wird hier dupliziert. Ohne Regeln: `blockFlagLightRules` (nur Block-Flags).
 *
 * Aufteilung für inkrementelle Neuberechnung: `lightInput` (Zellen → Eigenschaften, ein Durchlauf über das
 * Volumen) und `propagateLight` (BFS). Sind die Eigenschaften gleich (`sameLightInput`), bleibt das Feld gültig.
 */
import type { BlockFlags } from './assets/extract.js';
import type { Vec3 } from './port.js';
import type { VoxelSource } from './structure.js';

export type LightFace = 'north' | 'east' | 'south' | 'west' | 'up' | 'down';

/** Reihenfolge der Richtungen (Index = Bitposition in den Flächenmasken). */
export const LIGHT_FACES: readonly LightFace[] = ['north', 'east', 'south', 'west', 'up', 'down'];
export const FACE_BIT: Readonly<Record<LightFace, number>> = { north: 1, east: 2, south: 4, west: 8, up: 16, down: 32 };
/** Versatz je Richtung (x, y, z) in LIGHT_FACES-Reihenfolge. */
export const FACE_OFFSET: readonly Vec3[] = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
const OPPOSITE = [2, 3, 0, 1, 5, 4];

export const MAX_LIGHT = 15;

/** Blockzustand, wie ihn die Regeln sehen (Form von `BlockState` aus @mcda/voxel, Name ohne `minecraft:`). */
export interface LightBlockState {
  readonly name: string;
  readonly properties: Readonly<Record<string, string>>;
}

/** Port: Lichtverhalten je Blockzustand. Wird je Zustand einmal abgefragt (Cache). */
export interface LightRules {
  /** Blocklicht-Emission 0–15. */
  emission(s: LightBlockState): number;
  /** Schluckt der Block Licht ganz (undurchsichtiger Vollblock)? */
  opaque(s: LightBlockState): boolean;
  /** Sperrt die Fläche `face` des Blocks Licht (volle Fläche: Stufe, Treppe …)? Standard: nein. */
  blocksFace?(s: LightBlockState, face: LightFace): boolean;
  /** Wie `blocksFace`, nur für Himmelslicht (z. B. Türen durchlässig). Standard: `blocksFace`. */
  skyBlocksFace?(s: LightBlockState, face: LightFace): boolean;
  /** Zusätzliche Abschwächung beim Eintritt (Blätter, Wasser: 1). Standard: 0. */
  attenuation?(s: LightBlockState): number;
  /** Verdeckt der Block für die Umgebungsverdeckung (AO)? Standard: `opaque`. */
  occludesAo?(s: LightBlockState): boolean;
}

/**
 * Regeln nur aus den Block-Flags des Asset-Bündels (`opaque`): keine Emission, keine Teilflächen.
 * Himmelslicht und AO funktionieren damit; Lampen leuchten erst mit echten Regeln (z. B. aus @mcda/materialize).
 */
export function blockFlagLightRules(flags: Readonly<Record<string, BlockFlags>> | undefined, emission: (s: LightBlockState) => number = () => 0): LightRules {
  return {
    emission,
    opaque: (s) => flags?.[plainName(s.name)]?.opaque === true,
  };
}

export interface LightFieldOptions {
  /** Himmel über dem Volumen offen (Standard: true). */
  readonly openSky?: boolean;
  /** Umgebung neben dem Volumen offene Luft mit Himmelslicht 15 (Standard: true). */
  readonly openSides?: boolean;
  /** Unter dem Volumen fester Boden (für AO; Standard: true). */
  readonly ground?: boolean;
}

/** Lichteigenschaften je Zelle (Index `cellIndex`). */
export interface LightInput {
  readonly origin: Vec3;
  readonly size: Vec3;
  /** 1 = Block vorhanden (nicht Luft) */
  readonly occupied: Uint8Array;
  /** 1 = schluckt Licht ganz */
  readonly opaque: Uint8Array;
  /** 1 = verdeckt für AO */
  readonly aoOccluder: Uint8Array;
  readonly emission: Uint8Array;
  readonly attenuation: Uint8Array;
  /** sperrende Flächen (FACE_BIT) für Blocklicht */
  readonly blockFaces: Uint8Array;
  /** sperrende Flächen (FACE_BIT) für Himmelslicht */
  readonly skyFaces: Uint8Array;
}

export interface LightField {
  readonly input: LightInput;
  /** Blocklicht 0–15 je Zelle */
  readonly block: Uint8Array;
  /** Himmelslicht 0–15 je Zelle */
  readonly sky: Uint8Array;
  readonly options: Required<LightFieldOptions>;
}

/** Zellindex im Feld (lokale Koordinaten ab 0): x schnell, dann z, dann y. */
export function cellIndex(size: Vec3, x: number, y: number, z: number): number {
  return x + size[0] * (z + size[2] * y);
}

const plainName = (name: string): string => (name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name);
const isAirName = (name: string): boolean => {
  const n = plainName(name);
  return n === 'air' || n === 'cave_air' || n === 'void_air';
};

interface CellProps {
  readonly opaque: number;
  readonly ao: number;
  readonly emission: number;
  readonly attenuation: number;
  readonly blockFaces: number;
  readonly skyFaces: number;
}

const clampLevel = (v: number): number => Math.max(0, Math.min(MAX_LIGHT, Math.round(v)));

function propsOf(rules: LightRules, s: LightBlockState): CellProps {
  let blockFaces = 0;
  let skyFaces = 0;
  for (const f of LIGHT_FACES) {
    const blocks = rules.blocksFace?.(s, f) ?? false;
    if (blocks) blockFaces |= FACE_BIT[f];
    if (rules.skyBlocksFace ? rules.skyBlocksFace(s, f) : blocks) skyFaces |= FACE_BIT[f];
  }
  const opaque = rules.opaque(s);
  return {
    opaque: opaque ? 1 : 0,
    ao: (rules.occludesAo ? rules.occludesAo(s) : opaque) ? 1 : 0,
    emission: clampLevel(rules.emission(s)),
    attenuation: clampLevel(rules.attenuation?.(s) ?? 0),
    blockFaces,
    skyFaces,
  };
}

const stateKeyOf = (s: LightBlockState): string => {
  const keys = Object.keys(s.properties).sort();
  return keys.length === 0 ? s.name : `${s.name}[${keys.map((k) => `${k}=${s.properties[k]}`).join(',')}]`;
};

/**
 * Cache der Regel-Auswertung je Blockzustand: erst über die Objektidentität (Paletten-Zustände von
 * VoxelVolume sind geteilt), sonst über den Zustandsschlüssel. Über mehrere Volumen hinweg nutzbar.
 */
export class LightRuleCache {
  private readonly byObject = new WeakMap<object, CellProps>();
  private readonly byKey = new Map<string, CellProps>();

  constructor(readonly rules: LightRules) {}

  get(s: LightBlockState): CellProps {
    let p = this.byObject.get(s);
    if (p === undefined) {
      const key = stateKeyOf(s);
      p = this.byKey.get(key);
      if (p === undefined) {
        p = propsOf(this.rules, s);
        this.byKey.set(key, p);
      }
      this.byObject.set(s, p);
    }
    return p;
  }
}

/** Ein Durchlauf über die Zellen des Volumens: Lichteigenschaften je Zelle. */
export function lightInput(src: VoxelSource, rules: LightRules | LightRuleCache): LightInput {
  const cache = rules instanceof LightRuleCache ? rules : new LightRuleCache(rules);
  const size: Vec3 = [src.size[0], src.size[1], src.size[2]];
  const [w, h, l] = size;
  const [ox, oy, oz] = src.origin;
  const n = w * h * l;
  const input: LightInput = {
    origin: [ox, oy, oz], size,
    occupied: new Uint8Array(n), opaque: new Uint8Array(n), aoOccluder: new Uint8Array(n),
    emission: new Uint8Array(n), attenuation: new Uint8Array(n), blockFaces: new Uint8Array(n), skyFaces: new Uint8Array(n),
  };
  for (const c of src.cells()) {
    if (isAirName(c.state.name)) continue;
    const x = c.pos[0] - ox, y = c.pos[1] - oy, z = c.pos[2] - oz;
    if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= l) continue;
    const i = cellIndex(size, x, y, z);
    const p = cache.get(c.state);
    input.occupied[i] = 1;
    input.opaque[i] = p.opaque;
    input.aoOccluder[i] = p.ao;
    input.emission[i] = p.emission;
    input.attenuation[i] = p.attenuation;
    input.blockFaces[i] = p.blockFaces;
    input.skyFaces[i] = p.skyFaces;
  }
  return input;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Gleiche Lichteigenschaften (Größe, Ursprung, alle Zellen)? Dann bleibt ein berechnetes Feld gültig. */
export function sameLightInput(a: LightInput, b: LightInput): boolean {
  return a.size.every((v, k) => v === b.size[k]) && a.origin.every((v, k) => v === b.origin[k])
    && sameBytes(a.opaque, b.opaque) && sameBytes(a.emission, b.emission) && sameBytes(a.attenuation, b.attenuation)
    && sameBytes(a.blockFaces, b.blockFaces) && sameBytes(a.skyFaces, b.skyFaces)
    && sameBytes(a.aoOccluder, b.aoOccluder) && sameBytes(a.occupied, b.occupied);
}

/** Eimer-Warteschlange je Lichtstufe: jede Zelle wird mit ihrem endgültigen (höchsten) Wert verarbeitet. */
function spread(levels: Uint8Array, faces: Uint8Array, input: LightInput, buckets: number[][]): void {
  const [w, h, l] = input.size;
  const layer = w * l;
  const { opaque, attenuation } = input;
  for (let lvl = MAX_LIGHT; lvl >= 2; lvl--) {
    const bucket = buckets[lvl]!;
    while (bucket.length > 0) {
      const i = bucket.pop()!;
      if (levels[i] !== lvl) continue; // inzwischen heller geworden (veraltet)
      const x = i % w;
      const z = Math.floor(i / w) % l;
      const y = Math.floor(i / layer);
      const here = faces[i]!;
      for (let d = 0; d < 6; d++) {
        let j: number;
        switch (d) {
          case 0: if (z === 0) continue; j = i - w; break;
          case 1: if (x === w - 1) continue; j = i + 1; break;
          case 2: if (z === l - 1) continue; j = i + w; break;
          case 3: if (x === 0) continue; j = i - 1; break;
          case 4: if (y === h - 1) continue; j = i + layer; break;
          default: if (y === 0) continue; j = i - layer; break;
        }
        if (opaque[j] === 1) continue;
        if ((here & (1 << d)) !== 0 || (faces[j]! & (1 << OPPOSITE[d]!)) !== 0) continue;
        const next = lvl - 1 - attenuation[j]!;
        if (next > levels[j]!) {
          levels[j] = next;
          if (next >= 2) buckets[next]!.push(j);
        }
      }
    }
  }
}

const emptyBuckets = (): number[][] => Array.from({ length: MAX_LIGHT + 1 }, () => []);

/** Block- und Himmelslicht aus den Zelleigenschaften. */
export function propagateLight(input: LightInput, opts: LightFieldOptions = {}): LightField {
  const options: Required<LightFieldOptions> = { openSky: opts.openSky ?? true, openSides: opts.openSides ?? true, ground: opts.ground ?? true };
  const [w, h, l] = input.size;
  const n = w * h * l;
  const layer = w * l;
  const block = new Uint8Array(n);
  const sky = new Uint8Array(n);
  const { opaque, attenuation, skyFaces } = input;

  // Blocklicht: Quellen (auch undurchsichtige wie Glowstone leuchten in ihre Nachbarn)
  let buckets = emptyBuckets();
  for (let i = 0; i < n; i++) {
    const e = input.emission[i]!;
    if (e > 0) {
      block[i] = e;
      if (e >= 2) buckets[e]!.push(i);
    }
  }
  spread(block, input.blockFaces, input, buckets);

  // Himmelslicht: Säulen von oben (ungeschwächt 15), dann Ränder zur offenen Umgebung (14)
  buckets = emptyBuckets();
  const seed = (i: number, lvl: number): void => {
    if (lvl > sky[i]!) {
      sky[i] = lvl;
      if (lvl >= 2) buckets[lvl]!.push(i);
    }
  };
  if (options.openSky) {
    for (let z = 0; z < l; z++) {
      for (let x = 0; x < w; x++) {
        for (let y = h - 1; y >= 0; y--) {
          const i = x + w * z + layer * y;
          if (opaque[i] === 1 || (skyFaces[i]! & FACE_BIT.up) !== 0) break;
          if (y < h - 1 && (skyFaces[i + layer]! & FACE_BIT.down) !== 0) break;
          const a = attenuation[i]!;
          seed(i, MAX_LIGHT - a);
          if (a > 0) break; // ab hier nicht mehr ungeschwächt; den Rest erledigt die Ausbreitung
        }
      }
    }
  }
  if (options.openSides) {
    const side = (x: number, y: number, z: number, faceBit: number): void => {
      const i = x + w * z + layer * y;
      if (opaque[i] === 1 || (skyFaces[i]! & faceBit) !== 0) return;
      seed(i, MAX_LIGHT - 1 - attenuation[i]!);
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        side(x, y, 0, FACE_BIT.north);
        side(x, y, l - 1, FACE_BIT.south);
      }
      for (let z = 0; z < l; z++) {
        side(0, y, z, FACE_BIT.west);
        side(w - 1, y, z, FACE_BIT.east);
      }
    }
  }
  spread(sky, skyFaces, input, buckets);
  return { input, block, sky, options };
}

/** Lichtfeld eines Volumens in einem Schritt. */
export function computeLightField(src: VoxelSource, rules: LightRules | LightRuleCache, opts: LightFieldOptions = {}): LightField {
  return propagateLight(lightInput(src, rules), opts);
}

/** Welt-Position → Zellindex (oder -1 außerhalb). */
export function fieldIndex(field: LightField, pos: Vec3): number {
  const { origin, size } = field.input;
  const x = pos[0] - origin[0], y = pos[1] - origin[1], z = pos[2] - origin[2];
  if (x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2]) return -1;
  return cellIndex(size, x, y, z);
}

/** Blocklicht an einer Welt-Position (außerhalb: 0). */
export function blockLightAt(field: LightField, pos: Vec3): number {
  const i = fieldIndex(field, pos);
  return i < 0 ? 0 : field.block[i]!;
}

/** Himmelslicht an einer Welt-Position (außerhalb: offene Umgebung 15, unter dem Volumen Boden 0). */
export function skyLightAt(field: LightField, pos: Vec3): number {
  const i = fieldIndex(field, pos);
  if (i >= 0) return field.sky[i]!;
  const y = pos[1] - field.input.origin[1];
  if (y < 0) return field.options.ground ? 0 : field.options.openSides ? MAX_LIGHT : 0;
  if (y >= field.input.size[1]) return field.options.openSky ? MAX_LIGHT : 0;
  return field.options.openSides ? MAX_LIGHT : 0;
}

/**
 * Näherung der Spawn-Stellen ohne Spawn-Report (Zellindizes): Blocklicht 0, Füße und Kopf leer (Luft),
 * darunter ein undurchsichtiger Block oder eine sperrende Oberseite, und kein freier Himmel (Himmelslicht < 15,
 * also überdacht). Genauer ist der Spawn-Report aus @mcda/materialize (Physik-Klassen, Räume).
 */
export function estimateSpawnCells(field: LightField): number[] {
  const { size, occupied, opaque, blockFaces } = field.input;
  const [w, h, l] = size;
  const layer = w * l;
  const out: number[] = [];
  for (let y = 1; y < h; y++) {
    for (let z = 0; z < l; z++) {
      for (let x = 0; x < w; x++) {
        const i = x + w * z + layer * y;
        if (occupied[i] === 1 || field.block[i] !== 0 || field.sky[i] === MAX_LIGHT) continue;
        if (y + 1 < h && occupied[i + layer] === 1) continue;
        const below = i - layer;
        if (opaque[below] === 1 || (blockFaces[below]! & FACE_BIT.up) !== 0) out.push(i);
      }
    }
  }
  return out;
}
