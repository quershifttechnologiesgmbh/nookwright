/**
 * Dekorateur „Schneeauflage“ (additiv, research/24 §7.4): legt auf die oberste Zelle einer Hüllspalte eine
 * Schneeauflage – Dachfläche, Flachdach-Decke oder Mauerkrone. **Rein und deterministisch**: die Entscheidung
 * je Zelle kommt aus `hashSeed` (Projekt-Seed + Position), nie aus `Math.random` oder `Math.sin`.
 *
 * Warum zwei Blöcke? Ein `minecraft:snow`-Layer braucht laut Spiel eine **volle** Auflage
 * (`SnowLayerBlock#canSurvive`); auf der unteren Hälfte einer Treppe (unser Regeldach) fällt er sofort wieder
 * ab. Deshalb gilt:
 *   - volle Oberseite darunter (Vollblock, obere Stufe/Platte, Flachdach) → dünne `minecraft:snow`-Schicht
 *     mit `layers` (Standard 1) – die Silhouette bleibt,
 *   - sonst (geneigtes Treppendach) → voller `minecraft:snow_block` (Vollblöcke brauchen keine Stütze und
 *     erzeugen daher keine harte Physik-Meldung). W2 (Prüfbericht X3): Schnee bildet eine geschlossene Schicht über
 *     der Dachfläche – bei 1:1 liegt jeder Schneeblock bündig vor der nächsten Treppenreihe (durchgehend weiß). Auf
 *     steilen Flächen (die Nachbarspalte bergauf liegt ≥ 2 höher) ergab je Reihe ein Block weiße Balken wie
 *     Leitersprossen mit dunklen Treppen dazwischen; dort liegt Schnee nur als tragende Schicht und auf dem First.
 *
 * Nur die **oberste** Zelle einer Spalte ist geeignet (`topOf`): so bekommt der Dachstuhl/Innenraum keinen
 * Schnee, und die Fläche liegt wirklich unter freiem Himmel. Tür-/Fensterspalten und ihre Nachbarn bleiben frei
 * (kein Schnee über dem Eingang), ebenso die Luft-Masken der Komponenten.
 *
 * Ohne `decor.snowCover` im Theme ist der Pass aus (`undefined`) – andere Themes bleiben bitgleich.
 */
import type { Shell, ShellCell, ShellKind } from '@mcda/blueprint';
import type { ResolvedTheme } from '@mcda/catalog';
import { hash01, hashSeed, key3, type Vec3 } from '@mcda/core';
import { Layer, blockState, isAir, type BlockState, type VoxelVolume } from '@mcda/voxel';
import { colKey, type CellContext } from './context.js';
import type { FaceSupport, WorldView } from './world.js';

/** Schalter/Übersteuerung in `MaterializeOptions.snowCover` (Vorbild: `WeatheringOption`). */
export type SnowCoverOption = false | {
  readonly roles?: readonly string[];
  readonly layers?: number;
  readonly chance?: number;
  readonly minRoofT?: number;
};

export interface SnowCoverSettings {
  readonly roles: ReadonlySet<string>;
  /** Schichthöhe, wo eine Schicht tragen kann (1–8). */
  readonly layers: number;
  /** Wahrscheinlichkeit je Zelle (0–1); 1 = jede geeignete Zelle. */
  readonly chance: number;
  /** Nur Dächer ab diesem `roof_t` (0 = Traufe, 1 = First); 0 = ganzes Dach. */
  readonly minRoofT: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Einstellungen aus Theme (`decor.snowCover`) und Option; `undefined` = Pass aus. Wie bei der Verwitterung
 * genügt die Option allein nicht: **ohne das Theme-Feld passiert nichts** (Vertrag „bitgleich“).
 */
export function snowCoverSettings(theme: ResolvedTheme, option?: SnowCoverOption): SnowCoverSettings | undefined {
  if (option === false) return undefined;
  const s = theme.decor.snowCover;
  if (s === undefined) return undefined;
  const chance = clamp(option?.chance ?? s.chance ?? 1, 0, 1);
  if (chance <= 0) return undefined;
  return {
    roles: new Set(option?.roles ?? s.roles),
    layers: clamp(Math.round(option?.layers ?? s.layers ?? 1), 1, 8),
    chance,
    minRoofT: clamp(option?.minRoofT ?? s.minRoofT ?? 0, 0, 1),
  };
}

/** Eine geplante Auflage: Position (über der Hüllzelle) und die tragende Zelle. */
export interface SnowCandidate {
  readonly pos: Vec3;
  readonly below: Vec3;
  readonly role: string;
  /** Additiv (W2): steile Dachfläche (Nachbarspalte bergauf ≥ 2 höher) – dort nur eine tragende Schicht. */
  readonly slope?: boolean;
}

export interface SnowPlanInput {
  readonly shell: Shell;
  /** Kontext je Hüllzelle (gleiche Reihenfolge wie `shell.cells`). */
  readonly contexts: readonly CellContext[];
  /** Aufgelöste Rolle je Hüllzelle (nach Flächen-Mustern/Rollen-Ersatz), gleiche Reihenfolge. */
  readonly roles: readonly string[];
  readonly settings: SnowCoverSettings;
  readonly seed: number;
  /** Oberste belegte Zelle je Spalte (`colKey` → y); nur sie liegt unter freiem Himmel. */
  readonly topOf: ReadonlyMap<number, number>;
  /** Spalten (`colKey`) mit Tür- oder Fensterzelle. */
  readonly openings: ReadonlySet<number>;
  /** Zellen, die freibleiben müssen (Luft-Masken der Komponenten, `key3`). */
  readonly keepFree: ReadonlySet<string>;
}

/** Zellen einer Spalte plus die Spalte selbst (Tür/Fenster sperren den Eingang samt Nachbarschaft). */
const NEAR: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Wandartige Kinds, deren **oberste** Zelle eine Mauerkrone ist (`topStorey`). */
const WALL_TOP: ReadonlySet<ShellKind> = new Set<ShellKind>(['wall', 'pillar', 'lintel', 'facade']);

/** Würfelt die Zelle aus? `chance >= 1` lässt jede geeignete Zelle stehen (kein Hash nötig). */
function chanceMiss(seed: number, pos: Vec3, chance: number): boolean {
  if (chance >= 1) return false;
  return hash01(hashSeed(seed, 'snow', pos[0], pos[1], pos[2]), pos[0], pos[2]) >= chance;
}

/**
 * Plant die Auflagen (rein): geeignete Kind/Rolle, oberste Zelle der Spalte, kein Eingang in der Nähe,
 * Wahrscheinlichkeit. Die Stütze wird erst beim Setzen geprüft (sie entscheidet nur die Blockwahl).
 */
export function planSnowCover(input: SnowPlanInput): SnowCandidate[] {
  const { shell, contexts, roles, settings, seed, topOf, openings, keepFree } = input;
  const out: SnowCandidate[] = [];
  // W2: oberste Dachzelle je Spalte der Hülle (Komponenten wie Schornsteine zählen nicht) – für die Steilheit
  const roofTop = new Map<number, number>();
  for (const c of shell.cells) {
    if (c.kind !== 'roof') continue;
    const k = colKey(c.pos[0], c.pos[2]);
    if ((roofTop.get(k) ?? -Infinity) < c.pos[1]) roofTop.set(k, c.pos[1]);
  }
  shell.cells.forEach((cell: ShellCell, i) => {
    const ctx = contexts[i];
    if (ctx === undefined) return;
    const kind = cell.kind;
    const roof = kind === 'roof';
    const flat = kind === 'ceiling';
    const wallTop = ctx.topStorey === true && WALL_TOP.has(kind);
    if (!roof && !flat && !wallTop) return;
    const role = roles[i];
    if (role === undefined || !settings.roles.has(role)) return;
    if (roof && (ctx.t['roof_t'] ?? 1) < settings.minRoofT) return;
    const [x, y, z] = cell.pos;
    // Nur die oberste Zelle der Spalte: darüber ist Luft (Dachfläche/Flachdach/Mauerkrone, kein Dachstuhl).
    if (topOf.get(colKey(x, z)) !== y) return;
    // Nie über oder neben einer Tür/einem Fenster – der Eingang bleibt schneefrei.
    if (NEAR.some(([dx, dz]) => openings.has(colKey(x + dx, z + dz)))) return;
    const pos: Vec3 = [x, y + 1, z];
    if (keepFree.has(key3(pos))) return;
    if (chanceMiss(seed, pos, settings.chance)) return;
    const slope = roof && NEAR.slice(1, 5).some(([dx, dz]) => (roofTop.get(colKey(x + dx, z + dz)) ?? -Infinity) >= y + 2);
    out.push({ pos, below: [x, y, z], role, ...(slope ? { slope } : {}) });
  });
  return out;
}

/** Block der Auflage: dünne Schicht bei voller Fläche darunter, sonst voller Schneeblock. */
export function snowCoverBlock(support: FaceSupport, layers: number): BlockState {
  return support === 'full' ? blockState('snow', { layers: String(layers) }) : blockState('snow_block');
}

/** Setzt die geplanten Auflagen ins Volumen (nach dem Merge, vor Autotiling/Vanilla/Physik). */
export function applySnowCover(
  volume: VoxelVolume,
  view: WorldView,
  candidates: readonly SnowCandidate[],
  settings: SnowCoverSettings,
  owner = 'decor:snow',
): SnowCandidate[] {
  const placed: SnowCandidate[] = [];
  for (const c of candidates) {
    if (!volume.contains(c.pos) || !isAir(volume.stateAt(c.pos))) continue;
    const support = view.face(c.below, 'up');
    // W2: auf steiler Dachfläche nur eine tragende Schicht, kein Schneeblock (keine weißen Balken je Reihe)
    if (c.slope === true && support !== 'full') continue;
    const state = snowCoverBlock(support, settings.layers);
    volume.place(c.pos, { state, owner, layer: Layer.Attachment });
    placed.push(c);
  }
  return placed;
}
