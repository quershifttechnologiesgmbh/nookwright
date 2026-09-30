/**
 * Build: Material-Familien & Formen – automatisch aus Blocknamen abgeleitet.
 *
 *  - wood:     aus `*_planks` (Sonderfälle: Nether `stem`/`hyphae`, Bambus `bamboo_block`, Pappel-Laub in 3 Farben)
 *  - copper:   4 Oxidationsstufen × gewachst/ungewachst (unregelmäßige Namen: copper_block, lightning_rod …)
 *  - wool/concrete/terracotta/glass: je Farbstoff; `color`: Farb-Sicht über alle Farbblöcke
 *  - stone:    generisch über Form-Suffixe (stairs/slab/wall/…) + Block-Form (stone_brick_stairs → stone_bricks)
 *              + kuratierte Liste reiner Vollblöcke (Kalzit, Tiefenschiefer …) für die Lücken-Erkennung
 *  - other:    Rest mit Form-Suffix (Eisen: Tür/Falltür/Gitter/Kette/Laterne, Moos-Teppich, Strohbett …)
 *
 * Danach: Lücken je Familie (Kern-Formen der Art) + Fallback-Kette (gleiche Familie → ähnliche Familie
 * gleicher Art nach Namens-Token und mittlerer Texturfarbe). Die Auflösung zur Laufzeit: ../families.ts.
 */
import { DYE_COLORS } from '../families.js';
import type { FallbackStep, Family, FamilyData, FamilyKind, Gap } from '../types.js';
import { colorDistance, fromHex, type RGB } from './colors.js';

export const CORE_SHAPES: Readonly<Record<FamilyKind, readonly string[]>> = {
  wood: [
    'planks', 'log', 'stripped_log', 'wood', 'stripped_wood', 'stairs', 'slab', 'fence', 'fence_gate',
    'door', 'trapdoor', 'button', 'pressure_plate', 'sign', 'wall_sign', 'hanging_sign',
    'wall_hanging_sign', 'shelf', 'leaves', 'sapling',
  ],
  stone: ['block', 'stairs', 'slab', 'wall'],
  copper: [
    'block', 'cut', 'cut_stairs', 'cut_slab', 'chiseled', 'grate', 'door', 'trapdoor', 'bulb',
    'bars', 'chain', 'lantern', 'chest', 'golem_statue', 'lightning_rod',
  ],
  wool: ['block', 'stairs', 'slab', 'carpet', 'bed', 'banner', 'wall_banner'],
  concrete: ['block', 'stairs', 'slab', 'powder'],
  terracotta: ['block', 'glazed'],
  glass: ['block', 'pane'],
  color: [
    'wool', 'wool_stairs', 'wool_slab', 'carpet', 'bed', 'banner', 'wall_banner', 'candle',
    'candle_cake', 'concrete', 'concrete_stairs', 'concrete_slab', 'concrete_powder', 'terracotta',
    'glazed_terracotta', 'stained_glass', 'stained_glass_pane', 'shulker_box',
  ],
  other: [],
};

/** Reine Vollblöcke, die als Stein-Familie gelten sollen (für Lücken wie „Kalzit ohne Treppe“). */
export const BLOCK_ONLY_STONE = [
  'calcite', 'dripstone_block', 'deepslate', 'basalt', 'polished_basalt', 'smooth_basalt', 'end_stone',
  'netherrack', 'obsidian', 'crying_obsidian', 'packed_mud', 'amethyst_block', 'quartz_bricks',
  'gilded_blackstone',
] as const;

/** Bewusst ignorierte Form-Blöcke */
const IGNORE: Readonly<Record<string, string>> = {
  petrified_oak_slab: 'Legacy-Block (nur per Befehl), sieht aus wie oak_slab',
};

/** Basis-Aliase für Blöcke ohne eigene Block-Form */
const BASE_ALIAS: Readonly<Record<string, string>> = {
  heavy_weighted: 'iron_block',
  light_weighted: 'gold_block',
};

/** Generische Form-Suffixe (längste zuerst matchen) */
const GENERIC_SUFFIXES = [
  'pressure_plate', 'fence_gate', 'trapdoor', 'button', 'carpet', 'stairs', 'fence', 'chain', 'slab',
  'wall', 'door', 'bars', 'bed',
] as const;

/** Innerhalb derselben Familie sinnvolle Ersatz-Formen */
const INTRA_FALLBACK: Readonly<Record<string, readonly string[]>> = {
  wood: ['log'],
  stripped_wood: ['stripped_log'],
  stripped_log: ['log'],
  hanging_sign: ['sign'],
  wall_hanging_sign: ['wall_sign'],
  leaves: [],
  cut: ['block'],
  cut_stairs: [],
};

/** Namens-Token, die nur Bearbeitung ausdrücken (schwächerer Ähnlichkeitsbonus) */
const MODIFIER_TOKENS = new Set([
  'polished', 'smooth', 'cut', 'chiseled', 'cracked', 'mossy', 'bricks', 'brick', 'tiles', 'tile',
  'cobbled', 'block', 'waxed', 'stripped',
]);

type MutableFamily = {
  id: string;
  kind: FamilyKind;
  shapes: Record<string, string>;
  alternates?: Record<string, string[]>;
  core?: string[];
  dye?: string;
  color?: string;
};

function firstExisting(names: ReadonlySet<string>, cands: readonly string[]): string | undefined {
  return cands.find((c) => names.has(c));
}

function setIf(f: MutableFamily, shape: string, names: ReadonlySet<string>, cands: readonly string[], claimed: Set<string>): void {
  const hit = firstExisting(names, cands);
  if (hit) {
    f.shapes[shape] = hit;
    claimed.add(hit);
  }
}

// ------------------------------------------------------------------ Holz

function woodFamilies(names: ReadonlySet<string>, claimed: Set<string>): MutableFamily[] {
  const woods = [...names].filter((n) => n.endsWith('_planks')).map((n) => n.slice(0, -'_planks'.length)).sort();
  const res: MutableFamily[] = [];
  for (const w of woods) {
    const f: MutableFamily = { id: w, kind: 'wood', shapes: {} };
    setIf(f, 'planks', names, [`${w}_planks`], claimed);
    f.shapes['block'] = `${w}_planks`; // Alias, damit Rollen mit shape "block" auch Holz auflösen
    setIf(f, 'log', names, [`${w}_log`, `${w}_stem`, `${w}_block`], claimed);
    setIf(f, 'stripped_log', names, [`stripped_${w}_log`, `stripped_${w}_stem`, `stripped_${w}_block`], claimed);
    setIf(f, 'wood', names, [`${w}_wood`, `${w}_hyphae`], claimed);
    setIf(f, 'stripped_wood', names, [`stripped_${w}_wood`, `stripped_${w}_hyphae`], claimed);
    for (const s of [
      'stairs', 'slab', 'fence', 'fence_gate', 'door', 'trapdoor', 'button', 'pressure_plate', 'sign',
      'wall_sign', 'hanging_sign', 'wall_hanging_sign', 'shelf', 'mosaic',
    ]) {
      setIf(f, s, names, [`${w}_${s}`], claimed);
    }
    // Laub: normal `<w>_leaves`; Pappel (26.3) nur farbig; Nether: Warzenblock als Laub-Äquivalent
    const leafAlts = [...names].filter((n) => n.endsWith(`_${w}_leaves`) && !names.has(`${w}_leaves`)).sort();
    const netherLeaf: Record<string, string> = { crimson: 'nether_wart_block', warped: 'warped_wart_block' };
    const leafCands = [`${w}_leaves`, ...(leafAlts[0] ? [leafAlts[0]] : []), ...(netherLeaf[w] ? [netherLeaf[w]] : [])];
    setIf(f, 'leaves', names, leafCands, claimed);
    if (leafAlts.length > 1) {
      f.alternates = { leaves: leafAlts };
      for (const a of leafAlts) claimed.add(a);
    }
    setIf(f, 'sapling', names, [`${w}_sapling`, `${w}_propagule`, `${w}_fungus`], claimed);
    res.push(f);
  }
  return res;
}

// ------------------------------------------------------------------ Kupfer

const COPPER_STAGES = ['', 'exposed_', 'weathered_', 'oxidized_'] as const;

function copperFamilies(names: ReadonlySet<string>, claimed: Set<string>): MutableFamily[] {
  const res: MutableFamily[] = [];
  for (const waxed of ['', 'waxed_']) {
    for (const stage of COPPER_STAGES) {
      const p = `${waxed}${stage}`;
      const f: MutableFamily = { id: `${p}copper`, kind: 'copper', shapes: {} };
      setIf(f, 'block', names, [stage === '' ? `${waxed}copper_block` : `${p}copper`], claimed);
      setIf(f, 'cut', names, [`${p}cut_copper`], claimed);
      setIf(f, 'cut_stairs', names, [`${p}cut_copper_stairs`], claimed);
      setIf(f, 'cut_slab', names, [`${p}cut_copper_slab`], claimed);
      setIf(f, 'chiseled', names, [`${p}chiseled_copper`], claimed);
      for (const s of ['grate', 'door', 'trapdoor', 'bulb', 'bars', 'chain', 'lantern', 'chest', 'golem_statue']) {
        setIf(f, s, names, [`${p}copper_${s}`], claimed);
      }
      setIf(f, 'lightning_rod', names, [`${p}lightning_rod`], claimed);
      // Aliase für Rollen „stairs/slab“
      if (f.shapes['cut_stairs']) f.shapes['stairs'] = f.shapes['cut_stairs'];
      if (f.shapes['cut_slab']) f.shapes['slab'] = f.shapes['cut_slab'];
      if (Object.keys(f.shapes).length > 0) res.push(f);
    }
  }
  return res;
}

// ------------------------------------------------------------------ Farben

function colorFamilies(names: ReadonlySet<string>, claimed: Set<string>): MutableFamily[] {
  const res: MutableFamily[] = [];
  const add = (f: MutableFamily): void => {
    if (Object.keys(f.shapes).length > 0) res.push(f);
  };
  for (const c of DYE_COLORS) {
    const wool: MutableFamily = { id: `${c}_wool`, kind: 'wool', shapes: {}, dye: c };
    setIf(wool, 'block', names, [`${c}_wool`], claimed);
    for (const [s, n] of [['stairs', `${c}_wool_stairs`], ['slab', `${c}_wool_slab`], ['carpet', `${c}_carpet`],
      ['bed', `${c}_bed`], ['banner', `${c}_banner`], ['wall_banner', `${c}_wall_banner`]] as const) {
      setIf(wool, s, names, [n], claimed);
    }
    add(wool);
    const conc: MutableFamily = { id: `${c}_concrete`, kind: 'concrete', shapes: {}, dye: c };
    setIf(conc, 'block', names, [`${c}_concrete`], claimed);
    setIf(conc, 'stairs', names, [`${c}_concrete_stairs`], claimed);
    setIf(conc, 'slab', names, [`${c}_concrete_slab`], claimed);
    setIf(conc, 'powder', names, [`${c}_concrete_powder`], claimed);
    add(conc);
    const terra: MutableFamily = { id: `${c}_terracotta`, kind: 'terracotta', shapes: {}, dye: c };
    setIf(terra, 'block', names, [`${c}_terracotta`], claimed);
    setIf(terra, 'glazed', names, [`${c}_glazed_terracotta`], claimed);
    add(terra);
    const glass: MutableFamily = { id: `${c}_stained_glass`, kind: 'glass', shapes: {}, dye: c };
    setIf(glass, 'block', names, [`${c}_stained_glass`], claimed);
    setIf(glass, 'pane', names, [`${c}_stained_glass_pane`], claimed);
    add(glass);
  }
  // ungefärbte Gegenstücke
  const terra: MutableFamily = { id: 'terracotta', kind: 'terracotta', shapes: {} };
  setIf(terra, 'block', names, ['terracotta'], claimed);
  add(terra);
  const glass: MutableFamily = { id: 'glass', kind: 'glass', shapes: {} };
  setIf(glass, 'block', names, ['glass'], claimed);
  setIf(glass, 'pane', names, ['glass_pane'], claimed);
  add(glass);
  const tinted: MutableFamily = { id: 'tinted_glass', kind: 'glass', shapes: {} };
  setIf(tinted, 'block', names, ['tinted_glass'], claimed);
  add(tinted);

  // Farb-Sicht (eine Familie je Farbstoff, alle Farbformen) – nutzt dieselben Blöcke erneut
  for (const c of [...DYE_COLORS, 'undyed'] as const) {
    const f: MutableFamily = { id: c === 'undyed' ? 'undyed' : c, kind: 'color', shapes: {}, ...(c === 'undyed' ? {} : { dye: c }) };
    const pre = c === 'undyed' ? '' : `${c}_`;
    for (const s of CORE_SHAPES.color) {
      let cand = `${pre}${s}`;
      if (c === 'undyed') {
        const undyed: Record<string, string> = { stained_glass: 'glass', stained_glass_pane: 'glass_pane' };
        cand = undyed[s] ?? s;
      }
      const hit = firstExisting(names, [cand]);
      if (hit) {
        f.shapes[s] = hit;
        claimed.add(hit);
      }
    }
    if (c === 'undyed') f.core = ['candle', 'candle_cake', 'terracotta', 'stained_glass', 'stained_glass_pane', 'shulker_box'];
    add(f);
  }
  return res;
}

// ------------------------------------------------------------------ Stein & Rest (generisch)

function blockFormOf(base: string, names: ReadonlySet<string>): string | undefined {
  const alias = BASE_ALIAS[base];
  if (alias && names.has(alias)) return alias;
  return firstExisting(names, [base, `${base}s`, `${base}_block`]);
}

function genericFamilies(
  names: ReadonlySet<string>,
  claimed: Set<string>,
  ignored: Record<string, string>,
): MutableFamily[] {
  const byId = new Map<string, MutableFamily>();
  const get = (id: string, kind: FamilyKind): MutableFamily => {
    let f = byId.get(id);
    if (!f) {
      f = { id, kind, shapes: {} };
      byId.set(id, f);
    }
    return f;
  };
  for (const name of [...names].sort()) {
    if (claimed.has(name)) continue;
    if (IGNORE[name]) {
      ignored[name] = IGNORE[name];
      continue;
    }
    const suffix = GENERIC_SUFFIXES.find((s) => name.endsWith(`_${s}`));
    if (!suffix) continue;
    const base = name.slice(0, -(suffix.length + 1));
    const form = blockFormOf(base, names);
    const id = (form ?? base).replace(/_block$/, '');
    const f = get(id, 'other');
    f.shapes[suffix] = name;
    claimed.add(name);
    if (form && !f.shapes['block']) {
      f.shapes['block'] = form;
      claimed.add(form);
    }
  }
  // Eisen-Sonderfälle ohne `iron_`-Präfix im Namen:
  //  - Kette: bis 1.21.8 `chain`, seit 1.21.9 `iron_chain` (dann schon oben über das Suffix erfasst)
  //  - Laterne: `lantern` ist die Eisen-Laterne (Gegenstück zu `copper_lantern`), `soul_lantern` als Alternative
  const iron = (): MutableFamily => {
    const f = get('iron', 'other');
    if (!f.shapes['block'] && names.has('iron_block')) {
      f.shapes['block'] = 'iron_block';
      claimed.add('iron_block');
    }
    return f;
  };
  if (names.has('chain') && !claimed.has('chain')) {
    iron().shapes['chain'] = 'chain';
    claimed.add('chain');
  }
  if (names.has('lantern') && !claimed.has('lantern')) {
    const f = iron();
    f.shapes['lantern'] = 'lantern';
    claimed.add('lantern');
    if (names.has('soul_lantern') && !claimed.has('soul_lantern')) {
      f.alternates = { ...f.alternates, lantern: ['soul_lantern'] };
      claimed.add('soul_lantern');
    }
  }
  // kuratierte Vollblöcke ohne Formen
  for (const b of BLOCK_ONLY_STONE) {
    if (!names.has(b) || claimed.has(b)) continue;
    const f = get(b.replace(/_block$/, ''), 'stone');
    f.shapes['block'] = b;
    claimed.add(b);
  }
  // Art bestimmen + Varianten (chiseled/cracked/mossy/pillar/infested)
  for (const f of byId.values()) {
    const hasStoneShape = ['stairs', 'slab', 'wall'].some((s) => f.shapes[s]);
    if (f.id === 'bamboo_mosaic') {
      f.kind = 'wood';
      f.core = ['block', 'stairs', 'slab'];
    } else if (hasStoneShape || BLOCK_ONLY_STONE.some((b) => b.replace(/_block$/, '') === f.id)) {
      f.kind = 'stone';
    }
    if (f.kind !== 'stone') continue;
    const blk = f.shapes['block'];
    if (!blk) continue;
    for (const [shape, cands] of [
      ['chiseled', [`chiseled_${blk}`, `chiseled_${f.id}`]],
      ['cracked', [`cracked_${blk}`]],
      ['mossy', [`mossy_${blk}`]],
      ['pillar', [`${f.id}_pillar`]],
      ['infested', [`infested_${blk}`]],
    ] as const) {
      const hit = firstExisting(names, cands);
      if (hit) {
        f.shapes[shape] = hit;
        claimed.add(hit);
      }
    }
  }
  return [...byId.values()];
}

// ------------------------------------------------------------------ Repräsentant & Farbe

const REP_ORDER = ['planks', 'block', 'wool', 'cut', 'concrete', 'terracotta', 'stained_glass', 'log', 'carpet', 'slab', 'stairs'];

export function representative(f: Pick<Family, 'shapes'>): string | undefined {
  for (const s of REP_ORDER) if (f.shapes[s]) return f.shapes[s];
  return Object.values(f.shapes)[0];
}

// ------------------------------------------------------------------ Lücken & Fallbacks

/** Mehrwort-Materialien, die als EIN Token zählen (sonst teilt smooth_stone „stone“ mit end_stone). */
const COMPOUND_TOKENS = ['end_stone', 'red_sandstone', 'red_nether', 'dark_prismarine', 'dark_oak', 'pale_oak', 'light_blue', 'light_gray'];

function tokens(id: string): string[] {
  let s = id.replace(/^color:/, '');
  for (const c of COMPOUND_TOKENS) s = s.split(c).join(c.replace('_', '-'));
  return s.split('_').filter((t) => t.length > 0);
}

function similarity(a: Family, b: Family): { score: number; why: string } {
  // kleiner = ähnlicher
  let score = 250;
  let why = 'ohne Farbdaten';
  if (a.color && b.color) {
    const d = colorDistance(fromHex(a.color), fromHex(b.color));
    score = d;
    why = `Farbe Δ${Math.round(d)}`;
  }
  const ta = new Set(tokens(a.id));
  const shared = tokens(b.id).filter((t) => ta.has(t));
  const material = shared.filter((t) => !MODIFIER_TOKENS.has(t));
  const modifier = shared.filter((t) => MODIFIER_TOKENS.has(t));
  if (material.length > 0) {
    score -= 150;
    why = `Name „${material.join('_')}“, ${why}`;
  }
  score -= 15 * modifier.length;
  // gleicher Farbstoff (z. B. Wolle rot ↔ Beton rot) ist ein starkes Signal
  if (a.dye && a.dye === b.dye) {
    score -= 200;
    why = `gleiche Farbe ${a.dye}, ${why}`;
  }
  return { score, why };
}

/** Cross-Kind-Verwandtschaft für Fallbacks, wenn die eigene Art die Form nicht hat. */
const RELATED_KINDS: Readonly<Partial<Record<FamilyKind, readonly FamilyKind[]>>> = {
  wool: ['concrete', 'terracotta'],
  concrete: ['wool', 'terracotta'],
  terracotta: ['concrete', 'wool', 'stone'],
  stone: ['terracotta', 'concrete'],
};

export function computeGaps(families: Readonly<Record<string, Family>>, maxChain = 3): Gap[] {
  const all = Object.values(families);
  const gaps: Gap[] = [];
  for (const f of all) {
    const core = f.core ?? CORE_SHAPES[f.kind];
    for (const shape of core) {
      if (f.shapes[shape]) continue;
      const steps: FallbackStep[] = [];
      for (const alt of INTRA_FALLBACK[shape] ?? []) {
        const b = f.shapes[alt];
        if (b) steps.push({ family: f.id, shape: alt, block: b, why: 'gleiche Familie, andere Form' });
      }
      const sameKind = all.filter((g) => g.id !== f.id && g.kind === f.kind && g.shapes[shape]);
      const shapeAbsentInKind = sameKind.length === 0;
      let pool = sameKind;
      if (pool.length === 0) {
        for (const k of RELATED_KINDS[f.kind] ?? []) {
          pool = all.filter((g) => g.kind === k && g.shapes[shape]);
          if (pool.length > 0) break;
        }
      }
      const ranked = pool
        .map((g) => ({ g, ...similarity(f, g) }))
        .sort((x, y) => x.score - y.score || x.g.id.localeCompare(y.g.id))
        .slice(0, Math.max(0, maxChain - steps.length));
      for (const r of ranked) {
        steps.push({ family: r.g.id, shape, block: r.g.shapes[shape] as string, why: r.g.kind === f.kind ? r.why : `andere Art (${r.g.kind}), ${r.why}` });
      }
      gaps.push({ family: f.id, kind: f.kind, shape, shapeAbsentInKind, fallback: steps });
    }
  }
  return gaps.sort((a, b) => a.kind.localeCompare(b.kind) || a.family.localeCompare(b.family) || a.shape.localeCompare(b.shape));
}

/** Für Familien der Referenzversion, die in `families` fehlen: ähnlichste vorhandene Familien gleicher Art. */
export function computeVersionFallbacks(
  families: Readonly<Record<string, Family>>,
  reference: Readonly<Record<string, Family>>,
  n = 2,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const ref of Object.values(reference)) {
    if (families[ref.id]) continue;
    // Art "other" ist heterogen (Eisen, Moos, Stroh …): dort nur Kandidaten mit gemeinsamem Namens-Token
    const refTokens = new Set(tokens(ref.id));
    const pool = Object.values(families).filter(
      (g) => g.kind === ref.kind && (ref.kind !== 'other' || tokens(g.id).some((t) => refTokens.has(t))),
    );
    out[ref.id] = pool
      .map((g) => ({ g, s: similarity(ref, g).score }))
      .sort((a, b) => a.s - b.s)
      .slice(0, n)
      .map((x) => x.g.id);
  }
  return out;
}

// ------------------------------------------------------------------ Einstieg

export function deriveFamilies(
  version: string,
  blockNames: Iterable<string>,
  colorOf?: (block: string) => RGB | undefined,
  toHex?: (c: RGB) => string,
): FamilyData {
  const names = new Set(blockNames);
  const claimed = new Set<string>();
  const ignored: Record<string, string> = {};
  const list: MutableFamily[] = [
    ...woodFamilies(names, claimed),
    ...copperFamilies(names, claimed),
    ...colorFamilies(names, claimed),
    ...genericFamilies(names, claimed, ignored),
  ];
  const families: Record<string, Family> = {};
  for (const f of list.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))) {
    const key = f.kind === 'color' ? `color:${f.id}` : f.id;
    if (families[key]) throw new Error(`Familie doppelt: ${key}`);
    const rep = representative(f);
    const c = rep && colorOf ? colorOf(rep) : undefined;
    if (c && toHex) f.color = toHex(c);
    families[key] = { ...f, id: key };
  }
  return {
    version,
    coreShapes: CORE_SHAPES,
    families,
    gaps: computeGaps(families),
    versionFallbacks: {},
    ignored,
  };
}
