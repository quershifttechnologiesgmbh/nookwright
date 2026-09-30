/**
 * Weiches Licht und Umgebungsverdeckung (AO) je Vertex wie Minecrafts „Smooth Lighting“ (rein).
 *
 * Für eine Fläche mit Normale d wird die Zellschicht L davor abgetastet: bei Flächen auf der Blockgrenze die
 * Nachbarzelle (Block + d), bei inneren Flächen (Stufen-Oberseite, Laterne …) die Zelle des Blocks selbst.
 * Jede Gitterecke der Fläche mittelt vier Zellen aus L: Mitte, zwei Seiten, Diagonale.
 *  - **Licht:** Mittelwert; Nachbarn ohne Licht (0/0, also undurchsichtig) zählen wie die Mitte (Minecraft `blend`).
 *  - **AO:** Mittelwert der Schattierung (0,2 je verdeckendem Block, sonst 1). Verdecken beide Seiten, zählt
 *    die Diagonale wie eine Seite (Minecraft) → Werte 1 (frei), 0,8 (Kante oder Ecke), 0,6, 0,4 (Innenecke).
 * Vertices innerhalb der Fläche (Teilflächen) werden bilinear zwischen den vier Ecken gewichtet.
 * Flach (ohne AO): Leuchtende Blöcke, Modelle mit `ambientocclusion: false` und Block-Entities (Truhe, Bett …)
 * nehmen wie Minecraft den Lichtwert von L.
 */
import { MAX_LIGHT, cellIndex, type LightField } from './lighting.js';

/** Schattierung eines verdeckenden Nachbarn (Minecraft `getShadeBrightness`). */
export const AO_OCCLUDED = 0.2;

/** Licht einer Zelle, gepackt: bit 0–3 Block, 4–7 Himmel, 8 AO-Verdecker, 9 undurchsichtig. */
export function packedCell(field: LightField, x: number, y: number, z: number): number {
  const { size } = field.input;
  if (x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2]) {
    const o = field.options;
    if (y < 0) return o.ground ? 0x300 : o.openSides ? MAX_LIGHT << 4 : 0;
    const sky = y >= size[1] ? (o.openSky ? MAX_LIGHT : 0) : o.openSides ? MAX_LIGHT : 0;
    return sky << 4;
  }
  const i = cellIndex(size, x, y, z);
  return field.block[i]! | (field.sky[i]! << 4) | (field.input.aoOccluder[i]! << 8) | (field.input.opaque[i]! << 9);
}

const blockOf = (p: number): number => p & 15;
const skyOf = (p: number): number => (p >> 4) & 15;
const occludes = (p: number): boolean => (p & 0x100) !== 0;
const isOpaque = (p: number): boolean => (p & 0x200) !== 0;

/**
 * AO-Wert einer Gitterecke aus den Nachbarn in der Flächenebene (true = verdeckt).
 * Minecraft: Mittelwert der Schattierung von Seite 1, Seite 2, Diagonale und Mitte.
 */
export function aoCorner(side1: boolean, side2: boolean, corner: boolean, center = false): number {
  const s = (o: boolean): number => (o ? AO_OCCLUDED : 1);
  const diag = side1 && side2 ? s(side1) : s(corner);
  return (s(side1) + s(side2) + diag + s(center)) / 4;
}

/**
 * Licht der Mitte L. Ist L undurchsichtig (z. B. Schnittfläche unter einer weggeschnittenen Wand oder ein
 * Block mit Innenflächen), zählt der hellste nicht undurchsichtige Nachbar.
 */
export function centerLight(field: LightField, x: number, y: number, z: number): number {
  const p = packedCell(field, x, y, z);
  if (!isOpaque(p) || blockOf(p) > 0) return p;
  let block = 0, sky = 0;
  const probe = (q: number): void => {
    if (isOpaque(q)) return;
    block = Math.max(block, blockOf(q));
    sky = Math.max(sky, skyOf(q));
  };
  probe(packedCell(field, x + 1, y, z));
  probe(packedCell(field, x - 1, y, z));
  probe(packedCell(field, x, y + 1, z));
  probe(packedCell(field, x, y - 1, z));
  probe(packedCell(field, x, y, z + 1));
  probe(packedCell(field, x, y, z - 1));
  return block | (sky << 4) | (p & 0x300);
}

/** Tangentialachsen je Normalenachse (x → y, z; y → x, z; z → x, y). */
const TANGENTS: readonly (readonly [number, number])[] = [[1, 2], [0, 2], [0, 1]];

/**
 * Eckwerte einer Fläche: `out` = 4 × (Block, Himmel, AO) für die Ecken (u,v) = (0,0), (1,0), (0,1), (1,1)
 * über den Tangentialachsen. `cell` = Schicht L (lokale Zelle vor der Fläche), `axis` = Normalenachse.
 */
export function faceCorners(field: LightField, cell: readonly [number, number, number], axis: number, out: Float32Array | number[]): void {
  const [t1, t2] = TANGENTS[axis]!;
  const center = centerLight(field, cell[0], cell[1], cell[2]);
  const cb = blockOf(center), cs = skyOf(center);
  const cOcc = occludes(center);
  const at = (du: number, dv: number): number => {
    const p = [cell[0], cell[1], cell[2]];
    p[t1]! += du;
    p[t2]! += dv;
    return packedCell(field, p[0]!, p[1]!, p[2]!);
  };
  let k = 0;
  for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const s1 = at(su, 0), s2 = at(0, sv);
    const o1 = occludes(s1), o2 = occludes(s2);
    const d = o1 && o2 ? s1 : at(su, sv);
    // Licht: Nachbarn ohne jedes Licht (undurchsichtig/dunkel) zählen wie die Mitte (Minecraft `blend`)
    let block = cb, sky = cs;
    for (const q of [s1, s2, d]) {
      const dark = (q & 0xff) === 0;
      block += dark ? cb : blockOf(q);
      sky += dark ? cs : skyOf(q);
    }
    out[k++] = block / 4;
    out[k++] = sky / 4;
    out[k++] = aoCorner(o1, o2, occludes(d), cOcc);
  }
}

/** Ergebnis je Vertex */
export interface VertexLight {
  block: number;
  sky: number;
  ao: number;
}

/** Bilineare Mischung der vier Eckwerte an (u, v) ∈ [0,1]². */
export function bilinear(corners: ArrayLike<number>, u: number, v: number, out: VertexLight): VertexLight {
  const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
  out.block = corners[0]! * w00 + corners[3]! * w10 + corners[6]! * w01 + corners[9]! * w11;
  out.sky = corners[1]! * w00 + corners[4]! * w10 + corners[7]! * w01 + corners[10]! * w11;
  out.ao = corners[2]! * w00 + corners[5]! * w10 + corners[8]! * w01 + corners[11]! * w11;
  return out;
}

const EPS = 1e-4;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Normalenachse und Vorzeichen (dominante Komponente). */
export function dominantAxis(nx: number, ny: number, nz: number): { axis: number; sign: number } {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ay >= ax && ay >= az) return { axis: 1, sign: ny >= 0 ? 1 : -1 };
  if (ax >= az) return { axis: 0, sign: nx >= 0 ? 1 : -1 };
  return { axis: 2, sign: nz >= 0 ? 1 : -1 };
}

/**
 * Zelle L vor einer Fläche: Liegt die Fläche auf der Blockgrenze (lokale Koordinate 0 bzw. 1 in Normalenrichtung),
 * ist es der Nachbar, sonst der Block selbst. `local` = Punkt der Fläche relativ zum Block (0..1).
 */
export function sampleCell(block: readonly [number, number, number], local: number, axis: number, sign: number): [number, number, number] {
  const cubic = sign > 0 ? local >= 1 - EPS : local <= EPS;
  const c: [number, number, number] = [block[0], block[1], block[2]];
  if (cubic) c[axis]! += sign;
  return c;
}

/**
 * Licht eines Vertex (lokale Zellkoordinaten; `pos` in Blockeinheiten, Normale beliebig). `smooth = false`
 * liefert flaches Licht (Wert von L, AO 1).
 */
export function vertexLight(
  field: LightField,
  block: readonly [number, number, number],
  pos: readonly [number, number, number],
  normal: readonly [number, number, number],
  smooth = true,
): VertexLight {
  const { axis, sign } = dominantAxis(normal[0], normal[1], normal[2]);
  const cell = sampleCell(block, pos[axis]! - block[axis]!, axis, sign);
  if (!smooth) {
    const c = centerLight(field, cell[0], cell[1], cell[2]);
    return { block: blockOf(c), sky: skyOf(c), ao: 1 };
  }
  const corners = new Float32Array(12);
  faceCorners(field, cell, axis, corners);
  const [t1, t2] = TANGENTS[axis]!;
  return bilinear(corners, clamp01(pos[t1]! - block[t1]!), clamp01(pos[t2]! - block[t2]!), { block: 0, sky: 0, ao: 1 });
}

/** Tangentialachsen einer Normalenachse (für den Mesher). */
export function tangentAxes(axis: number): readonly [number, number] {
  return TANGENTS[axis]!;
}

/** Minecraft-Richtungsschattierung (`Level.getShade`): oben 1, unten 0,5, Nord/Süd 0,8, Ost/West 0,6. */
export function faceShade(nx: number, ny: number, nz: number): number {
  return Math.min(1, nx * nx * 0.6 + nz * nz * 0.8 + ny * ny * (ny > 0 ? 1 : 0.5));
}

/** Ist L undurchsichtig (Schnittfläche)? Dann flach beleuchten. */
export function isOpaqueCell(field: LightField, cell: readonly [number, number, number]): boolean {
  return isOpaque(packedCell(field, cell[0], cell[1], cell[2]));
}
