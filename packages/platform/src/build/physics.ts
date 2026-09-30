/**
 * Build: Physik-Klassen je Block (Komponentenmodell §3.1) aus PrismarineJS-Kollisionsformen.
 *
 * Klassen (je Zustand, Block-Klasse = Default-State):
 *   air   Luft   air/cave_air/void_air
 *   thin  dünn   keine Kollision
 *   flat  flach  Kollisionshöhe ≤ 1/8 (Teppich 1/16, Schnee-Schicht 2)
 *   half  halb   Höhe ≤ 1, aber kein voller Würfel (Stufe, Treppe, Bett, Truhe, Tür …)
 *   tall  hoch   Höhe > 1 (Zaun, Mauer, geschlossenes Zauntor)
 *   full  voll   voller Würfel
 * Flags: climbable (kletterbar, Tag #climbable), liquid (flüssig), hazard (Gefahr, manuell + Tag),
 *        falls (fällt) + needsSupport (braucht Stütze) (Faktencheck 15),
 *        signalSource (Signalquelle, Spawn-Blocker, Faktencheck 5), waterloggable (wasserfähig, Property `waterlogged`).
 * Laufzeit-Abfrage: ../physics.ts (`physicsOfState`).
 */
import { resolveTag } from '../tags.js';
import {
  PHYSICS_CLASSES,
  type BlockPhysics,
  type PhysicsClass,
  type PhysicsData,
  type PhysicsFlag,
  type RegistryData,
  type StatePhysics,
} from '../types.js';

// ------------------------------------------------------------------ Rohformate PrismarineJS

export interface PrismarineState {
  name: string;
  type: 'bool' | 'enum' | 'int';
  num_values: number;
  values?: string[];
}
export interface PrismarineBlock {
  name: string;
  minStateId: number;
  defaultState: number;
  states: PrismarineState[];
  emitLight?: number;
}
export interface PrismarineShapes {
  blocks: Record<string, number | number[]>;
  shapes: Record<string, number[][]>;
}
export interface CollisionSource {
  version: string;
  blocks: Map<string, PrismarineBlock>;
  shapes: PrismarineShapes;
}

export function collisionSource(version: string, blocks: PrismarineBlock[], shapes: PrismarineShapes): CollisionSource {
  return { version, blocks: new Map(blocks.map((b) => [b.name, b])), shapes };
}

// ------------------------------------------------------------------ manuelle Listen

type InTag = (tag: string, block: string) => boolean;

const AIR = new Set(['air', 'cave_air', 'void_air']);

/** Flag `hazard` (Gefahr) mit Begründung (manuell kuratiert). */
export const DANGER: Readonly<Record<string, string>> = {
  fire: 'Feuer',
  soul_fire: 'Feuer',
  campfire: 'Feuer (lit)',
  soul_campfire: 'Feuer (lit)',
  lava: 'Lava',
  lava_cauldron: 'Lava',
  magma_block: 'Schaden beim Betreten (ohne Schleichen)',
  cactus: 'Kontaktschaden',
  sweet_berry_bush: 'Kontaktschaden + bremst',
  wither_rose: 'Wither-Effekt',
  pointed_dripstone: 'Fallschaden ×2 / fallender Stalaktit',
  sulfur_spike: 'wie Tropfstein (FC 15, 26.2) – Schaden ungeprüft',
  powder_snow: 'Einsinken + Erfrieren',
  nether_portal: 'Teleport',
  end_portal: 'Teleport',
  end_gateway: 'Teleport',
};

/** Blöcke mit Fluid (immer bzw. per Definition). */
const FLUID = new Set(['water', 'lava', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);

/** Schwerkraft (FC 15). */
const FALLING = new Set([
  'sand', 'red_sand', 'gravel', 'anvil', 'chipped_anvil', 'damaged_anvil', 'dragon_egg',
  'suspicious_sand', 'suspicious_gravel',
  'scaffolding', // erst ab Abstand > 7
  'pointed_dripstone', // nur Stalaktiten
  'sulfur_spike', // 26.2, wie Tropfstein
]);

/**
 * Redstone-Signalquellen (Code: `isSignalSource()`); in der Spawn-Zelle verhindern sie Spawns (FC 5).
 * Muster zusätzlich: *_button, *_pressure_plate, *lightning_rod.
 */
const SIGNAL = new Set([
  'lever', 'redstone_wire', 'redstone_torch', 'redstone_wall_torch', 'redstone_block', 'repeater',
  'comparator', 'observer', 'daylight_detector', 'target', 'trapped_chest', 'lectern', 'tripwire_hook',
  'detector_rail', 'sculk_sensor', 'calibrated_sculk_sensor',
]);

/** Nicht als Spawn-Untergrund geeignet trotz voller Oberseite (FC 5). */
function spawnFloorDenied(name: string, inTag: InTag): boolean {
  if (/(^|_)glass($|_)/.test(name) || name === 'tinted_glass') return true;
  if (/trapdoor$/.test(name) || /copper_grate$/.test(name)) return true;
  if (['ice', 'packed_ice', 'blue_ice', 'frosted_ice', 'barrier', 'bedrock', 'chorus_flower', 'scaffolding', 'magma_block'].includes(name)) return true;
  if (inTag('leaves', name)) return true;
  return false;
}
/** Als Spawn-Untergrund geeignet trotz nicht vollflächiger Kollision (FC 5: Seelensand, Schlamm). */
const SPAWN_FLOOR_ALLOWED = new Set(['soul_sand', 'mud']);

/**
 * Braucht Stütze (FC 15). Blumentopf NICHT (Java), Wand-Hängeschild bricht laut Wiki nicht.
 * Kerzen NICHT: im Spiel bestätigt (Spike T3, 23.09.2026) – sie bleiben ohne Stütze stehen, auch nach Abbau des Blocks darunter.
 */
function needsSupport(name: string, inTag: InTag): boolean {
  if (name === 'flower_pot' || name.startsWith('potted_')) return false;
  if (name.endsWith('_wall_hanging_sign')) return false;
  if (/(^|_)torch$/.test(name)) return true;
  if (/(^|_)lantern$/.test(name) && name !== 'sea_lantern' && name !== 'jack_o_lantern') return true;
  if (/_carpet$/.test(name)) return true; // nur wenn darunter Luft
  if (['lever', 'ladder', 'redstone_wire', 'repeater', 'comparator', 'bell', 'spore_blossom', 'snow', 'vine', 'glow_lichen', 'sugar_cane', 'cactus', 'lily_pad', 'nether_wart', 'cocoa', 'sea_pickle', 'tripwire_hook'].includes(name)) return true;
  const tags = ['pressure_plates', 'buttons', 'all_signs', 'banners', 'flowers', 'small_flowers', 'saplings', 'crops', 'rails', 'doors', 'corals', 'wall_corals', 'cave_vines'];
  return tags.some((t) => inTag(t, name));
}

// ------------------------------------------------------------------ Geometrie

type Box = readonly number[]; // [x1,y1,z1,x2,y2,z2]
const EPS = 1e-6;

export function classifyBoxes(boxes: readonly Box[], isAir = false): StatePhysics {
  if (isAir) return { cls: 'air', h: 0, topFull: false };
  if (boxes.length === 0) return { cls: 'thin', h: 0, topFull: false };
  const h = Math.max(...boxes.map((b) => b[4] ?? 0));
  const topFull = coversTop(boxes);
  const vol = boxes.reduce((s, b) => s + ((b[3] ?? 0) - (b[0] ?? 0)) * ((b[4] ?? 0) - (b[1] ?? 0)) * ((b[5] ?? 0) - (b[2] ?? 0)), 0);
  const unit =
    Math.min(...boxes.map((b) => b[0] ?? 0)) <= EPS && Math.min(...boxes.map((b) => b[1] ?? 0)) <= EPS &&
    Math.min(...boxes.map((b) => b[2] ?? 0)) <= EPS && Math.max(...boxes.map((b) => b[3] ?? 0)) >= 1 - EPS &&
    Math.abs(h - 1) <= EPS && Math.max(...boxes.map((b) => b[5] ?? 0)) >= 1 - EPS;
  const hr = Math.round(h * 10000) / 10000;
  if (unit && vol >= 1 - 1e-4) return { cls: 'full', h: 1, topFull: true };
  if (h > 1 + EPS) return { cls: 'tall', h: hr, topFull };
  if (h <= 0.125 + EPS) return { cls: 'flat', h: hr, topFull };
  return { cls: 'half', h: hr, topFull };
}

/** Oberseite bei y=1 vollständig bedeckt? (16×16-Abtastung) */
function coversTop(boxes: readonly Box[]): boolean {
  const top = boxes.filter((b) => (b[4] ?? 0) >= 1 - EPS && (b[1] ?? 0) < 1 - EPS);
  if (top.length === 0) return false;
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      const x = (i + 0.5) / 16;
      const z = (j + 0.5) / 16;
      if (!top.some((b) => (b[0] ?? 0) <= x && x <= (b[3] ?? 0) && (b[2] ?? 0) <= z && z <= (b[5] ?? 0))) return false;
    }
  }
  return true;
}

// ------------------------------------------------------------------ Zustände dekodieren

function stateValues(s: PrismarineState): string[] {
  if (s.type === 'bool') return ['true', 'false']; // Prismarine-Reihenfolge: Index 0 = true
  return s.values ?? [];
}

/** Alle Zustände eines Prismarine-Blocks (letzte Property variiert am schnellsten). */
export function decodeStates(b: PrismarineBlock): Record<string, string>[] {
  const total = b.states.reduce((n, s) => n * s.num_values, 1);
  const res: Record<string, string>[] = [];
  for (let i = 0; i < total; i++) {
    let data = i;
    const props: Record<string, string> = {};
    for (let k = b.states.length - 1; k >= 0; k--) {
      const s = b.states[k] as PrismarineState;
      const vals = stateValues(s);
      props[s.name] = vals[data % s.num_values] ?? String(data % s.num_values);
      data = Math.floor(data / s.num_values);
    }
    res.push(props);
  }
  return res;
}

const keyOf = (p: StatePhysics): string => `${p.cls}|${p.h}|${p.topFull ? 1 : 0}`;

interface StateRow {
  props: Record<string, string>;
  phys: StatePhysics;
}

function statePhysics(src: CollisionSource, name: string): StateRow[] | undefined {
  const b = src.blocks.get(name);
  const sh = src.shapes.blocks[name];
  if (!b || sh === undefined) return undefined;
  const states = decodeStates(b);
  return states.map((props, i) => {
    const id = Array.isArray(sh) ? sh[i] : sh;
    const boxes = src.shapes.shapes[String(id)] ?? [];
    return { props, phys: classifyBoxes(boxes, AIR.has(name)) };
  });
}

/** Kleinste Property-Teilmenge (1 oder 2), die die Physik bestimmt. */
function findDriver(rows: StateRow[]): BlockPhysics['by'] | undefined {
  const props = Object.keys(rows[0]?.props ?? {});
  const tryProps = (ps: string[]): BlockPhysics['by'] | undefined => {
    const map: Record<string, StatePhysics> = {};
    for (const r of rows) {
      const k = ps.map((p) => r.props[p]).join(',');
      const prev = map[k];
      if (prev && keyOf(prev) !== keyOf(r.phys)) return undefined;
      map[k] = r.phys;
    }
    return { props: ps, map };
  };
  for (const p of props) {
    const r = tryProps([p]);
    if (r) return r;
  }
  for (let i = 0; i < props.length; i++) {
    for (let j = i + 1; j < props.length; j++) {
      const r = tryProps([props[i] as string, props[j] as string]);
      if (r) return r;
    }
  }
  return undefined;
}

// ------------------------------------------------------------------ Heuristik für unbekannte Blöcke

/** Manuelle Analogien (Block → bekannter Block mit gleicher Form) */
const MANUAL_ANALOG: Readonly<Record<string, string>> = {
  sulfur_spike: 'pointed_dripstone',
  straw_bed: 'white_bed',
  chain: 'iron_chain',
};

function tokens(n: string): string[] {
  return n.split('_');
}

/** Sucht einen bekannten Block mit gleicher Form (gleiches Namens-Suffix), bevorzugt mehr gemeinsame Token. */
export function findAnalog(name: string, known: readonly string[]): { block: string; reason: string } | undefined {
  const manual = MANUAL_ANALOG[name];
  if (manual && known.includes(manual)) return { block: manual, reason: `manuelle Analogie zu ${manual}` };
  const t = tokens(name);
  for (let cut = 1; cut < t.length; cut++) {
    const suffix = t.slice(cut).join('_');
    const cands = known.filter((k) => k === suffix || k.endsWith(`_${suffix}`));
    if (cands.length === 0) continue;
    const tset = new Set(t);
    const best = cands
      .map((c) => ({ c, shared: tokens(c).filter((x) => tset.has(x)).length, len: c.length }))
      .sort((a, b) => b.shared - a.shared || a.len - b.len || a.c.localeCompare(b.c))[0];
    if (best) return { block: best.c, reason: `Namens-Suffix „${suffix}“ wie ${best.c}` };
  }
  return undefined;
}

// ------------------------------------------------------------------ Hauptfunktion

type Known = { rows: StateRow[]; src: CollisionSource };

export function computePhysics(reg: RegistryData, primary: CollisionSource, supplement?: CollisionSource): PhysicsData {
  const blocks: Record<string, BlockPhysics> = {};
  const unknown: { block: string; suggestion: PhysicsClass; reason: string }[] = [];
  const tagCache = new Map<string, Set<string>>();
  const hasTag = (tag: string): boolean => Object.hasOwn(reg.blockTags, tag);
  const inTag: InTag = (tag, block) => {
    let s = tagCache.get(tag);
    if (!s) {
      s = new Set(resolveTag(reg.blockTags, tag));
      tagCache.set(tag, s);
    }
    return s.has(block);
  };

  const flagsFor = (name: string): PhysicsFlag[] => {
    const f: PhysicsFlag[] = [];
    if (inTag('climbable', name)) f.push('climbable');
    if (FLUID.has(name)) f.push('liquid');
    // manuell + (ab 26.x) datengetriebener Tag #dangerous_for_teleportation
    if (DANGER[name] || inTag('dangerous_for_teleportation', name)) f.push('hazard');
    if (FALLING.has(name) || name.endsWith('_concrete_powder')) f.push('falls');
    if (needsSupport(name, inTag)) f.push('needsSupport');
    if (SIGNAL.has(name) || /_button$|_pressure_plate$|lightning_rod$/.test(name)) f.push('signalSource');
    if (reg.blocks[name]?.properties['waterlogged']) f.push('waterloggable');
    return f;
  };

  const finish = (name: string, base: StatePhysics, src: string, extra: Partial<BlockPhysics>, emitLight = 0): BlockPhysics => {
    const flags = flagsFor(name);
    const rails = inTag('prevent_mob_spawning_inside', name);
    const spawnBlocked =
      base.cls !== 'air' &&
      (base.h > 0 || flags.includes('signalSource') || flags.includes('liquid') || flags.includes('hazard') || rails);
    const spawnFloor =
      SPAWN_FLOOR_ALLOWED.has(name) || (base.topFull && !spawnFloorDenied(name, inTag) && emitLight < 14);
    return { ...base, src, flags, spawnBlocked, spawnFloor, ...extra };
  };

  const cache = new Map<string, Known | null>();
  const lookup = (name: string): Known | undefined => {
    const c = cache.get(name);
    if (c !== undefined) return c ?? undefined;
    let res: Known | undefined;
    const rows = statePhysics(primary, name);
    if (rows) res = { rows, src: primary };
    else if (supplement) {
      const r2 = statePhysics(supplement, name);
      if (r2) res = { rows: r2, src: supplement };
    }
    cache.set(name, res ?? null);
    return res;
  };
  // Analogie-Kandidaten: alle Blöcke mit Kollisionsdaten (auch solche, die es in der Zielversion nicht gibt)
  const analogPool = [...new Set([...primary.blocks.keys(), ...(supplement ? supplement.blocks.keys() : [])])].filter(
    (n) => primary.shapes.blocks[n] !== undefined || supplement?.shapes.blocks[n] !== undefined,
  );

  for (const [name, def] of Object.entries(reg.blocks)) {
    const hit = lookup(name);
    if (hit) {
      const { rows, src } = hit;
      // Default-State der ZIEL-Version suchen (gemeinsame Properties vergleichen)
      const pb = src.blocks.get(name) as PrismarineBlock;
      const dflt =
        rows.find((r) => Object.entries(r.props).every(([k, v]) => (def.default[k] ?? v) === v)) ??
        rows[pb.defaultState - pb.minStateId] ??
        (rows[0] as StateRow);
      const distinct = new Set(rows.map((r) => keyOf(r.phys)));
      let extra: Partial<BlockPhysics> = {};
      if (distinct.size > 1) {
        const by = findDriver(rows);
        // Klassen in fachlicher Reihenfolge (air … full), nicht alphabetisch
        const classes = PHYSICS_CLASSES.filter((c) => rows.some((r) => r.phys.cls === c));
        extra = by ? { by } : { classes };
      }
      blocks[name] = finish(name, dflt.phys, `prismarine:${src.version}`, extra, pb.emitLight ?? 0);
      continue;
    }
    // unbekannt → Heuristik: 1. Analogie (manuell / Namens-Suffix), 2. Tags (#replaceable, 26.x #blocks_motion)
    const motionTag = hasTag('blocks_motion') ? inTag('blocks_motion', name) : undefined;
    const analog = findAnalog(name, analogPool);
    if (analog) {
      const a = lookup(analog.block) as Known;
      const pb = a.src.blocks.get(analog.block) as PrismarineBlock;
      const base = a.rows[pb.defaultState - pb.minStateId] ?? (a.rows[0] as StateRow);
      const distinct = new Set(a.rows.map((r) => keyOf(r.phys)));
      const by = distinct.size > 1 ? findDriver(a.rows) : undefined;
      const reason = analog.reason;
      blocks[name] = finish(name, base.phys, `heuristic:${analog.block}`, { guess: reason, ...(by ? { by } : {}) });
      unknown.push({ block: name, suggestion: base.phys.cls, reason });
    } else {
      let guess: StatePhysics = { cls: 'full', h: 1, topFull: true };
      let reason = 'keine Analogie – Vollblock angenommen, manuell prüfen';
      if (inTag('replaceable', name)) {
        guess = { cls: 'thin', h: 0, topFull: false };
        reason = 'Tag #replaceable → ohne Kollision';
      } else if (motionTag === false) {
        guess = { cls: 'thin', h: 0, topFull: false };
        reason = 'nicht in #blocks_motion (26.x) → vermutlich ohne Kollision (Tag stimmt nur zu ~84 % mit Kollision überein)';
      } else if (motionTag === true) {
        reason = 'in #blocks_motion (26.x) → vermutlich Kollision; Vollblock angenommen, Form prüfen';
      }
      blocks[name] = finish(name, guess, 'heuristic:tags', { guess: reason });
      unknown.push({ block: name, suggestion: guess.cls, reason });
    }
  }

  return {
    version: reg.version,
    collisionSource: `PrismarineJS/minecraft-data pc/${primary.version}${supplement ? ` (+ pc/${supplement.version} für fehlende)` : ''}`,
    blocks,
    unknown: unknown.sort((a, b) => a.block.localeCompare(b.block)),
    dangerReasons: DANGER,
  };
}
