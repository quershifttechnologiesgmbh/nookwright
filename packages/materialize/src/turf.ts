/**
 * W13-B Dekorateur „Torfdach“ (additiv, plan/spikes/W13B_nordisch_dach.md): Soden auf der Dachhaut nordischer
 * Blockhäuser. Vorbild: Birkenrinde + Grassoden, am Giebel von Windbrettern gehalten, an der Traufe vom Traufbalken
 * (en.wikipedia.org/wiki/Sod_roof, lokalhistoriewiki.no „Torvtekking“); Minecraft-Tutorials legen dafür Gras- oder
 * Moosblöcke über ein Treppendach und lassen die Holzkante stehen.
 *
 * Geometrie (je oberste Dachzelle der Spalte, Rolle aus `decor.turfRoof.roles`):
 *  - **innere** Zelle (beide Nachbarn längs der Traufe/des Firsts sind Dachzellen gleicher Höhe) → Soden darüber
 *    (Gras- oder Moosblock, Vollblock: im Spiel ohne Stütze haltbar). Eine **untere Platte** (halbe Firststufe eines
 *    einreihigen Firsts) wird selbst zum Soden, sonst bliebe zwischen den Soden eine Rinne;
 *  - **Giebelkante** einer Brett-Rolle (`boards`, ein Nachbar längs fehlt: Ortgang) → eine zweite, gleiche Treppe darüber – das Windbrett steht
 *    über dem Torf und hält ihn (die gekreuzten Windbretter am First setzt `exterior/ridge_cross`);
 *  - **Firstzier** (`mount: roof_peak`, gekreuzte Windbretter) direkt auf der Dachzelle → eine gleiche Treppe obendrauf, damit
 *    die Spitzen über dem Torf stehen;
 *  - Traufreihe (`roof_t` unter `minRoofT`) bleibt frei und liest sich als Traufbrett; steile Flächen (Nachbarspalte
 *    bergauf ≥ 2 höher) tragen keine Soden (wie der Schnee, keine Balken je Reihe).
 * Auf einigen Grassoden wächst Gras oder eine Blume (Bodenpflanze auf Erde: Physik gültig).
 *
 * Ob das Projekt ein Torfdach bekommt, entscheidet der Seed (`share`); ohne Theme-Feld oder bei `share: 0` ist der
 * Pass aus und alles bleibt bitgleich. Rein und deterministisch (Seed + Position, nie `Math.random`).
 */
import type { Shell, ShellCell } from '@mcda/blueprint';
import type { ResolvedTheme } from '@mcda/catalog';
import { hash01, hashSeed, key3, type Vec3 } from '@mcda/core';
import { Layer, isAir, type BlockState, type VoxelVolume } from '@mcda/voxel';
import { colKey, type CellContext } from './context.js';

/** Schalter/Übersteuerung in `MaterializeOptions.turfRoof`: `false` aus, `true` immer (Vorgabe statt Seed). */
export type TurfRoofOption = boolean | {
  readonly share?: number;
  readonly moss?: number;
  readonly plants?: number;
  readonly minRoofT?: number;
};

export interface TurfRoofSettings {
  readonly roles: ReadonlySet<string>;
  /** Rollen, deren Giebelkante (Ortgang) als Windbrett angehoben wird; andere Giebelkanten tragen Soden. */
  readonly boards: ReadonlySet<string>;
  readonly moss: number;
  readonly plants: number;
  readonly minRoofT: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Einstellungen aus Theme (`decor.turfRoof`), Option und Seed; `undefined` = Pass aus. Ohne Theme-Feld passiert nichts
 * (auch nicht mit Option). Der Seed würfelt einmal je Projekt: Torf- oder Holzdach.
 */
export function turfRoofSettings(theme: ResolvedTheme, seed: number, option?: TurfRoofOption): TurfRoofSettings | undefined {
  if (option === false) return undefined;
  const t = theme.decor.turfRoof;
  if (t === undefined) return undefined;
  const o = typeof option === 'object' ? option : undefined;
  const share = option === true ? 1 : clamp(o?.share ?? t.share ?? 1, 0, 1);
  if (share <= 0) return undefined;
  if (share < 1 && hash01(hashSeed(seed, 'turf-roof'), 0, 0) >= share) return undefined;
  return {
    roles: new Set(t.roles),
    boards: new Set(t.boards ?? []),
    moss: clamp(o?.moss ?? t.moss ?? 0.25, 0, 1),
    plants: clamp(o?.plants ?? t.plants ?? 0.08, 0, 1),
    minRoofT: clamp(o?.minRoofT ?? t.minRoofT ?? 0.01, 0, 1),
  };
}

/** Geplante Änderung: Soden über der Zelle, Soden statt der Platte, Windbrett über der Ortgangtreppe. */
export interface TurfCandidate {
  readonly pos: Vec3;
  readonly role: string;
  readonly kind: 'sod' | 'ridge' | 'board' | 'lift';
}

export interface TurfPlanInput {
  readonly shell: Shell;
  readonly contexts: readonly CellContext[];
  readonly roles: readonly string[];
  readonly settings: TurfRoofSettings;
  /** Oberste belegte Zelle je Spalte (`colKey` → y), Komponenten eingeschlossen (Schornsteine). */
  readonly topOf: ReadonlyMap<number, number>;
  /** Zellen der Firstzier (`mount: roof_peak`, z. B. gekreuzte Windbretter), `key3`: sie wird mit angehoben. */
  readonly peaks?: ReadonlySet<string>;
}

type Axis = readonly [number, number];
const X: Axis = [1, 0];
const Z: Axis = [0, 1];

/** Achse längs der Traufe einer Dachtreppe (quer zum Gefälle). */
const alongAxis = (c: ShellCell): Axis | undefined => {
  const f = c.orient?.facing;
  return f === 'north' || f === 'south' ? X : f === 'east' || f === 'west' ? Z : undefined;
};

export function planTurfRoof(input: TurfPlanInput): TurfCandidate[] {
  const { shell, contexts, roles, settings, topOf, peaks } = input;
  const roof = new Map<string, ShellCell>();
  const roofTop = new Map<number, number>();
  for (const c of shell.cells) {
    if (c.kind !== 'roof') continue;
    roof.set(key3(c.pos), c);
    const k = colKey(c.pos[0], c.pos[2]);
    if ((roofTop.get(k) ?? -Infinity) < c.pos[1]) roofTop.set(k, c.pos[1]);
  }
  const isRoof = (x: number, y: number, z: number): boolean => roof.has(key3([x, y, z]));
  const inner = (c: ShellCell, a: Axis): boolean => {
    const [x, y, z] = c.pos;
    return isRoof(x + a[0], y, z + a[1]) && isRoof(x - a[0], y, z - a[1]);
  };
  /**
   * Giebelende: längs fehlt ein Nachbar, und in dieser Spalte liegt auch eine Höhe darüber kein Dach (freier Ortgang;
   * ein tieferer Überstand davor zählt nicht). Kehlen (Nachbar eine Höhe darüber: das andere Dach) tragen Soden.
   */
  const openEnd = (c: ShellCell, a: Axis): boolean => {
    const [x, y, z] = c.pos;
    return [1, -1].some((k) => {
      const nx = x + k * a[0];
      const nz = z + k * a[1];
      return !isRoof(nx, y, nz) && !isRoof(nx, y + 1, nz);
    });
  };
  const out: TurfCandidate[] = [];
  shell.cells.forEach((c, i) => {
    if (c.kind !== 'roof') return;
    const role = roles[i];
    const ctx = contexts[i];
    if (role === undefined || ctx === undefined || !settings.roles.has(role)) return;
    if ((ctx.t['roof_t'] ?? 1) < settings.minRoofT) return;
    const [x, y, z] = c.pos;
    const top = topOf.get(colKey(x, z));
    // Luft-Masken der Dachkomponenten (Schornsteinfuß) gelten nicht: Soden liegen auf der Dachhaut, nicht davor
    const above: Vec3 = [x, y + 1, z];
    // Firstzier direkt auf der Dachzelle (gekreuzte Windbretter): eine gleiche Treppe obendrauf, damit ihre Spitzen über
    // dem Torf stehen bleiben (der Torf hebt die Dachhaut um einen Block)
    if (top === y + 1 && peaks?.has(key3(above)) === true) {
      out.push({ pos: above, role, kind: 'lift' });
      return;
    }
    if (top !== y) return;
    if (c.shape === 'stairs') {
      const a = alongAxis(c);
      if (a === undefined) return;
      if (settings.boards.has(role) && !inner(c, a) && openEnd(c, a)) {
        // Ortgang: nur eine Kante, deren Nachbar nach innen Dach ist (keine freistehende Einzeltreppe)
        if (isRoof(x + a[0], y, z + a[1]) || isRoof(x - a[0], y, z - a[1])) out.push({ pos: above, role, kind: 'board' });
        return;
      }
      // steile Fläche: Nachbarspalte bergauf ≥ 2 höher → keine Soden (wie Schnee, W2)
      const steep = [X, Z].some(([dx, dz]) => (roofTop.get(colKey(x + dx, z + dz)) ?? -Infinity) >= y + 2
        || (roofTop.get(colKey(x - dx, z - dz)) ?? -Infinity) >= y + 2);
      if (steep) return;
      out.push({ pos: above, role, kind: 'sod' });
      return;
    }
    if (!inner(c, X) && !inner(c, Z)) return;
    if (c.shape === 'slab' && c.orient?.half !== 'top') out.push({ pos: c.pos, role, kind: 'ridge' });
    else out.push({ pos: above, role, kind: 'sod' });
  });
  return out;
}

/** Blockzustände der Soden (vollständig, für die Zielversion aufgelöst); Pflanzen nur, wenn es sie dort gibt. */
export interface TurfBlocks {
  readonly grass: BlockState;
  readonly moss: BlockState;
  readonly plants: readonly BlockState[];
}

/** Moos in Flecken: Entscheidung je 2×2-Feld plus etwas Einzelrauschen (kein Schachbrett, keine Windräder). */
function isMoss(seed: number, p: Vec3, share: number): boolean {
  if (share <= 0) return false;
  const patch = hash01(hashSeed(seed, 'turf-moss', p[1]), Math.floor(p[0] / 2), Math.floor(p[2] / 2));
  const cell = hash01(hashSeed(seed, 'turf-moss-cell', p[1]), p[0], p[2]);
  return 0.7 * patch + 0.3 * cell < share;
}

/**
 * Setzt die geplanten Soden, Firstsoden und Windbretter ins Volumen (nach dem Merge, vor Schnee/Autotiling/Physik).
 * Soden nur in Luft, Firstsoden ersetzen die Platte, Windbretter kopieren die Ortgangtreppe darunter.
 */
export function applyTurfRoof(
  volume: VoxelVolume, candidates: readonly TurfCandidate[], settings: TurfRoofSettings, blocks: TurfBlocks, seed: number,
  owner = 'decor:turf',
): Array<{ pos: Vec3; role: string }> {
  const placed: Array<{ pos: Vec3; role: string }> = [];
  const free = (p: Vec3): boolean => volume.contains(p) && isAir(volume.stateAt(p));
  for (const c of candidates) {
    if (c.kind === 'ridge') {
      if (!volume.contains(c.pos) || isAir(volume.stateAt(c.pos))) continue;
      volume.replaceState(c.pos, isMoss(seed, c.pos, settings.moss) ? blocks.moss : blocks.grass);
      placed.push({ pos: c.pos, role: c.role });
      continue;
    }
    if (c.kind === 'board') {
      const below: Vec3 = [c.pos[0], c.pos[1] - 1, c.pos[2]];
      if (!free(c.pos) || isAir(volume.stateAt(below))) continue;
      volume.place(c.pos, { state: volume.stateAt(below), owner, layer: Layer.Attachment });
      placed.push({ pos: c.pos, role: c.role });
      continue;
    }
    if (c.kind === 'lift') {
      const up: Vec3 = [c.pos[0], c.pos[1] + 1, c.pos[2]];
      if (!volume.contains(c.pos) || isAir(volume.stateAt(c.pos)) || !free(up)) continue;
      volume.place(up, { state: volume.stateAt(c.pos), owner, layer: Layer.Attachment });
      placed.push({ pos: up, role: c.role });
      continue;
    }
    if (!free(c.pos)) continue;
    const moss = isMoss(seed, c.pos, settings.moss);
    volume.place(c.pos, { state: moss ? blocks.moss : blocks.grass, owner, layer: Layer.Attachment });
    placed.push({ pos: c.pos, role: c.role });
  }
  // Bewuchs: Gras/Blume auf einzelnen Grassoden (oberste Soden-Zelle mit Luft darüber)
  if (settings.plants > 0 && blocks.plants.length > 0) {
    for (const c of candidates) {
      if (c.kind === 'board' || c.kind === 'lift') continue;
      const top: Vec3 = [c.pos[0], c.pos[1] + 1, c.pos[2]];
      if (!volume.contains(c.pos) || volume.stateAt(c.pos).name !== blocks.grass.name || !free(top)) continue;
      const h = hashSeed(seed, 'turf-plant', ...c.pos);
      if (hash01(h, 0, 0) >= settings.plants) continue;
      const plant = blocks.plants[Math.floor(hash01(h, 1, 0) * blocks.plants.length)]!;
      volume.place(top, { state: plant, owner, layer: Layer.Attachment });
    }
  }
  return placed;
}

/** Positionen, die der Pass höchstens belegt (für die Volumengrenzen): Soden und Bewuchs darüber. */
export function turfBounds(candidates: readonly TurfCandidate[]): Vec3[] {
  return candidates.flatMap((c) => [c.pos, [c.pos[0], c.pos[1] + 1, c.pos[2]] as Vec3]);
}
