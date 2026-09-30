import { isBed, isFullBlock, isHazard, isMobHead, isNoteBlock, isWaterSource, jobSiteOf, blockName, type MaterialSpec } from '@mcda/catalog';
import type { ExpandedComponent } from './expand.js';

/**
 * Mechanik-Klassen für die Regel `containerOpen` (plan/01 §4.8, Faktencheck #2, In-Game T5 #6/T4):
 * Eine Truhe öffnet nur, wenn direkt darüber KEIN redstone-leitender Block liegt. Es blockieren Fass, Stein,
 * Planken, Bücherregal, Ofen … (leitfähige Vollblöcke) und die Decke; Truhe, Stufen, Treppen, Teppich, Laterne,
 * Falltür, Zaun, Topf, Kopf … blockieren nicht. Truhe über Truhe geht also, Fass über Truhe nicht; ein Fass
 * öffnet immer. Die Einrichtung kennt nur abstrakte Materialien (Rolle + Form oder feste Block-ID) und urteilt
 * deshalb konservativ: Was nicht sicher „kein Vollblock“ ist, gilt als Leiter.
 */

export const MECH_NEUTRAL = 0;
/** Truhe (auch Redstone-, Ender- und Kupfertruhe): darüber kein Leiter und nicht die Decke. */
export const MECH_CHEST = 1;
/** Redstone-Leiter (Vollblock): nie direkt über einer Truhe. */
export const MECH_CONDUCTOR = 2;
export type CellMechanics = typeof MECH_NEUTRAL | typeof MECH_CHEST | typeof MECH_CONDUCTOR;

const cache = new Map<string, CellMechanics>();

/** Mechanik-Klasse eines Katalog-Materials. */
export function cellMechanics(mat: MaterialSpec): CellMechanics {
  const key = mat.block ?? `${mat.role}.${mat.shape}`;
  let m = cache.get(key);
  if (m === undefined) {
    // Tabellen der Vollblöcke: `@mcda/catalog` (blocks.ts), gemeinsam mit den Katalog-Prüfungen
    const chest = mat.block !== undefined ? /chest$/.test(blockName(mat.block)) : mat.shape === 'chest';
    m = chest ? MECH_CHEST : isFullBlock(mat) ? MECH_CONDUCTOR : MECH_NEUTRAL;
    cache.set(key, m);
  }
  return m;
}

const perComponent = new WeakMap<ExpandedComponent, Uint8Array>();

/** Mechanik-Klasse je Zelle (Index wie `exp.cells`), einmal je expandierter Form berechnet. */
export function mechanicsOf(exp: ExpandedComponent): Uint8Array {
  let m = perComponent.get(exp);
  if (m === undefined) {
    m = Uint8Array.from(exp.cells.map((c) => cellMechanics(c.mat)));
    perComponent.set(exp, m);
  }
  return m;
}

/** Enthält die Form eine Truhe? (billiger Vorfilter für die Regel) */
export function hasChest(exp: ExpandedComponent): boolean {
  return mechanicsOf(exp).includes(MECH_CHEST);
}

/**
 * Rahmen-Freiraum (Vanilla `ItemFrame#survives`, Materialisierungs-Prüfung `entity_support`): Zaun, Mauer und
 * Zauntor sind 1,5 Blöcke hoch und ragen ½ Block in die Zelle darüber – ein Rahmen (oder Gemälde) direkt über
 * so einem Block hat keinen Platz und fällt ab.
 */
const TALL_SHAPES: ReadonlySet<string> = new Set(['fence', 'wall', 'fence_gate']);
const TALL_BLOCKS: readonly RegExp[] = [/_fence$/, /_fence_gate$/, /_wall$/];

/** Ragt der Block (Kollision 1,5 hoch) in die Zelle darüber? */
export function isTallCollision(mat: MaterialSpec): boolean {
  if (mat.block !== undefined) {
    const name = mat.block.slice(mat.block.indexOf(':') + 1);
    return TALL_BLOCKS.some((r) => r.test(name));
  }
  return TALL_SHAPES.has(mat.shape ?? '');
}

/** Entity-Typen, die an einer Fläche hängen (Rahmen, Leuchtrahmen, Gemälde). */
export const HANGING_ENTITIES: ReadonlySet<string> = new Set(['item_frame', 'glow_item_frame', 'painting']);

const tallCache = new WeakMap<ExpandedComponent, Uint8Array>();

/** 1 je Zelle, deren Block in die Zelle darüber ragt (Index wie `exp.cells`). */
export function tallOf(exp: ExpandedComponent): Uint8Array {
  let t = tallCache.get(exp);
  if (t === undefined) {
    t = Uint8Array.from(exp.cells.map((c) => (isTallCollision(c.mat) ? 1 : 0)));
    tallCache.set(exp, t);
  }
  return t;
}

/**
 * Zell-Merkmale für die Regeln aus research/17 §7.4 (Bitmaske je Zelle, Index wie `exp.cells`):
 * Bett (`bedObstructed`), Notenblock und Kopf (`noteBlockAirAbove`), Gefahr (`noHazardOnPath`), Arbeitsblock
 * (`jobSiteReachable`, `distinctJobBlocks`), Wasser-Quelle (`infiniteWater`), Portal-Rahmen (`portalClearance`).
 */
export const T_BED = 1;
export const T_NOTE = 2;
export const T_HEAD = 4;
export const T_HAZARD = 8;
export const T_JOB = 16;
export const T_WATER = 32;
export const T_PORTAL = 64;

const traitCache = new Map<string, number>();

/** Merkmale eines Katalog-Materials (0 = keine). */
export function cellTraits(mat: MaterialSpec): number {
  const key = mat.block !== undefined ? `${mat.block}|${mat.state?.['level'] ?? ''}` : `${mat.role}.${mat.shape}`;
  let t = traitCache.get(key);
  if (t === undefined) {
    const name = mat.block === undefined ? '' : blockName(mat.block);
    t = (isBed(mat) ? T_BED : 0) | (isNoteBlock(mat) ? T_NOTE : 0) | (isMobHead(mat) ? T_HEAD : 0) | (isHazard(mat) ? T_HAZARD : 0) |
      (jobSiteOf(mat) !== undefined ? T_JOB : 0) | (isWaterSource(mat) ? T_WATER : 0) | (name === 'obsidian' || name === 'nether_portal' ? T_PORTAL : 0);
    traitCache.set(key, t);
  }
  return t;
}

const traitsCache = new WeakMap<ExpandedComponent, { readonly cells: Uint8Array; readonly any: number }>();

/** Merkmale je Zelle und ihre Vereinigung (`any`), einmal je expandierter Form. */
export function traitsOf(exp: ExpandedComponent): { readonly cells: Uint8Array; readonly any: number } {
  let t = traitsCache.get(exp);
  if (t === undefined) {
    const cells = Uint8Array.from(exp.cells.map((c) => cellTraits(c.mat)));
    t = { cells, any: cells.reduce((a, b) => a | b, 0) };
    traitsCache.set(exp, t);
  }
  return t;
}

/**
 * Handels-Station (functionTag `trade`, Villager-Stand): ihr Arbeitsblock muss für Dorfbewohner erreichbar bleiben.
 * Stationen mit `work:*` (Werkstätten) sind bewusst (noch) nicht dabei: die Regel stellte im A/B-Lauf 3 von 750
 * Bestandsräumen um (Fass vor dem Braustand der Braustation) – Freigabe siehe plan/spikes/K3c_schema_solver.md.
 */
export const isJobStation = (exp: Pick<ExpandedComponent, 'functionTags'>): boolean => exp.functionTags?.includes('trade') === true;

const jobCache = new WeakMap<ExpandedComponent, readonly string[]>();

/** Arbeitsblöcke (Blocknamen) einer Form, sortiert und ohne Dubletten. */
export function jobBlocksOf(exp: ExpandedComponent): readonly string[] {
  let j = jobCache.get(exp);
  if (j === undefined) jobCache.set(exp, (j = [...new Set(exp.cells.flatMap((c) => jobSiteOf(c.mat) ?? []))].sort()));
  return j;
}

/**
 * Rauch (Faktencheck #13): Lagerfeuer-Rauch steigt nicht durch eine Falltür direkt darüber. Klassen je Zelle:
 * 1 = Lagerfeuer (Quelle), 2 = Falltür (Sperre), 0 = sonst. Eigene Tabelle statt `traitsOf`, damit die übrigen
 * Regeln (deren Vorfilter auf `traits.any` schauen) unverändert bleiben.
 */
export const SMOKE_SOURCE = 1;
export const SMOKE_BLOCKER = 2;
const smokeCache = new WeakMap<ExpandedComponent, Uint8Array>();

function smokeClass(mat: MaterialSpec): number {
  const name = mat.block === undefined ? '' : blockName(mat.block);
  if (name.endsWith('campfire') || mat.shape === 'campfire') return SMOKE_SOURCE;
  if (name.endsWith('_trapdoor') || mat.shape === 'trapdoor') return SMOKE_BLOCKER;
  return 0;
}

/** Rauch-Klasse je Zelle (Index wie `exp.cells`), einmal je expandierter Form. */
export function smokeOf(exp: ExpandedComponent): Uint8Array {
  let m = smokeCache.get(exp);
  if (m === undefined) smokeCache.set(exp, (m = Uint8Array.from(exp.cells.map((c) => smokeClass(c.mat)))));
  return m;
}
