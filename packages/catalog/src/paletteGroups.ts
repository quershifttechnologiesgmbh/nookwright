/**
 * Paletten-Editor (W13-G): Rollengruppen → Theme-Rollen, handverlesene Materialfamilien je Gruppe und die Anwendung der
 * Nutzer-Überschreibungen (`PaletteOverrides` aus `@mcda/core`) auf ein **aufgelöstes** Theme. Rein und deterministisch.
 *
 * Reihenfolge der Auflösung: Theme → Farbpalette (`resolvePalettedTheme`) → Überschreibungen (`applyPaletteOverrides`).
 *
 * - **Gruppe setzen** („Change All Walls“ bei Dungeon Alchemist): Jede Ziel-Rolle der Gruppe trägt danach genau die
 *   gewählte Familie. Bauweise bleibt (`noise`, `shapes`, `perCell`, `blocks`), Material-Felder (`family`, `color`,
 *   `mix`, `gradient`) werden ersetzt. Die Familien, die das Theme vorher dort hatte, werden Ersatzfamilien – so hat
 *   die Rolle weiter jede Form (z. B. Kalzit ohne Treppe → Treppe aus der alten Familie statt Plattform-Rückfall).
 * - **Tauschen** („Eiche → Fichte“, Axiom-Ersetzen): In allen übrigen Rollen wird die Familie ersetzt, Gewichte,
 *   Verläufe und Varianten (`mossy`, `stripped_log`) bleiben – der Charakter des Themes bleibt erhalten.
 * - **Formvertrag** (`SHELL_ROLE_SHAPES`, Parität mit `@mcda/materialize`): Eine Familie, die keine der von der Rolle
 *   verlangten Formen hat, wird für diese Rolle übersprungen (die Rolle bleibt wie im Theme).
 * - Ohne Überschreibung liefert `applyPaletteOverrides` **dasselbe Objekt** (bitgleich, Referenzgleichheit).
 */
import { PALETTE_GROUPS, normalizePaletteOverrides, type PaletteGroup, type PaletteOverrides } from '@mcda/core';
import { FAMILY_SHAPES } from './familyShapes.js';
import { SHELL_ROLE_SHAPES } from './roleShapes.js';
import { THEME_COLORS, type ResolvedTheme, type ThemeColor, type ThemeMixEntry, type ThemeRoleSpec } from './theme.js';

export interface PaletteGroupDef {
  readonly id: PaletteGroup;
  /** Theme-Rollen, die die Gruppe färbt (fehlt eine im Theme, wird sie übersprungen). Die erste ist die Leitrolle. */
  readonly roles: readonly string[];
  /** Handverlesene Familien (Townscaper-Prinzip: wenige, die zusammenpassen), ungefähr hell → dunkel. */
  readonly families: readonly string[];
}

const WOODS = ['birch', 'pale_oak', 'bamboo', 'oak', 'jungle', 'acacia', 'cherry', 'spruce', 'mangrove', 'crimson', 'warped', 'dark_oak'] as const;
const FRAME_WOODS = ['birch', 'pale_oak', 'oak', 'jungle', 'acacia', 'cherry', 'spruce', 'mangrove', 'crimson', 'warped', 'dark_oak'] as const;

/**
 * Gruppen des Editors. Die Zuordnung zu Theme-Rollen folgt den Rollen, die alle Themes kennen (`catalog/themes`):
 * Außenwand `wall_primary`, Fachwerk `beam`/`pillar`, Dachfläche `roof_main`, Fundament und Sockelband
 * (`foundation`, `wall_plinth`), Hauptboden `floor_primary`, Hauptstoff `textile_primary`, Innenholz (Vertäfelung,
 * Decke, Türen).
 */
export const PALETTE_GROUP_DEFS: Readonly<Record<PaletteGroup, PaletteGroupDef>> = {
  wall: {
    id: 'wall',
    roles: ['wall_primary'],
    families: [
      'calcite', 'smooth_sandstone', 'sandstone', 'birch', 'oak', 'stone_bricks', 'andesite', 'cobblestone', 'tuff_bricks',
      'red_sandstone', 'bricks', 'mud_bricks', 'spruce', 'mangrove', 'deepslate_bricks', 'polished_blackstone_bricks', 'dark_oak',
    ],
  },
  frame: { id: 'frame', roles: ['beam', 'pillar'], families: FRAME_WOODS },
  roof: {
    id: 'roof',
    roles: ['roof_main'],
    families: [
      'smooth_sandstone', 'birch', 'oak', 'acacia', 'cherry', 'red_sandstone', 'stone_bricks', 'cobblestone', 'bricks', 'mud_bricks',
      'spruce', 'mangrove', 'prismarine_bricks', 'dark_prismarine', 'oxidized_copper', 'red_nether_bricks', 'cobbled_deepslate',
      'deepslate_tiles', 'dark_oak', 'nether_bricks', 'polished_blackstone_bricks',
    ],
  },
  base: {
    id: 'base',
    roles: ['foundation', 'wall_plinth'],
    families: [
      'sandstone', 'stone', 'andesite', 'stone_bricks', 'cobblestone', 'mossy_cobblestone', 'mossy_stone_bricks', 'tuff', 'tuff_bricks',
      'granite', 'red_sandstone', 'bricks', 'mud_bricks', 'cobbled_deepslate', 'deepslate_bricks', 'blackstone', 'polished_blackstone_bricks',
    ],
  },
  floor: {
    id: 'floor',
    roles: ['floor_primary'],
    families: [
      'birch', 'pale_oak', 'bamboo', 'smooth_sandstone', 'oak', 'jungle', 'acacia', 'cherry', 'smooth_stone', 'polished_andesite',
      'stone_bricks', 'polished_tuff', 'bricks', 'mud_bricks', 'spruce', 'mangrove', 'polished_deepslate', 'deepslate_tiles', 'dark_oak',
    ],
  },
  accent: { id: 'accent', roles: ['textile_primary'], families: THEME_COLORS.map((c) => `color:${c}`) },
  interior_wood: { id: 'interior_wood', roles: ['wall_wainscot', 'ceiling', 'door'], families: WOODS },
};

/**
 * Deutsche Namen der handverlesenen Familien (UI-Auswahl und Optionstext der Engine-Beschreibung, damit ein
 * Entscheidungsmodell „dunkles Holz“ → `dark_oak` und „Ziegeldach“ → `bricks` zuordnen kann).
 */
export const PALETTE_FAMILY_LABELS: Readonly<Record<string, string>> = {
  birch: 'Birke (helles Holz)', pale_oak: 'Blasseiche (sehr helles Holz)', bamboo: 'Bambus', oak: 'Eiche (mittleres Holz)',
  jungle: 'Tropenholz (rötliches Holz)', acacia: 'Akazie (orangerotes Holz)', cherry: 'Kirsche (rosa Holz)',
  spruce: 'Fichte (dunkelbraunes Holz)', mangrove: 'Mangrove (rotbraunes Holz)', crimson: 'Karmesin (purpurrotes Holz)',
  warped: 'Wirrholz (türkises Holz)', dark_oak: 'Dunkle Eiche (sehr dunkles Holz)',
  calcite: 'Kalzit (weißer Putz)', smooth_sandstone: 'Glatter Sandstein (hellgelb)', sandstone: 'Sandstein (gelb)',
  red_sandstone: 'Roter Sandstein (orange)', stone: 'Stein (grau)', smooth_stone: 'Glatter Stein (hellgrau)',
  stone_bricks: 'Steinziegel (grau)', mossy_stone_bricks: 'Bemooste Steinziegel', andesite: 'Andesit (grau)',
  polished_andesite: 'Polierter Andesit', cobblestone: 'Bruchstein (rau, grau)', mossy_cobblestone: 'Bemooster Bruchstein',
  tuff: 'Tuff (graugrün)', tuff_bricks: 'Tuffziegel', polished_tuff: 'Polierter Tuff', granite: 'Granit (rötlich)',
  bricks: 'Ziegel (roter Backstein, Ziegeldach)', mud_bricks: 'Lehmziegel (braun)', cobbled_deepslate: 'Bruchtiefenschiefer (dunkelgrau)',
  deepslate_bricks: 'Tiefenschieferziegel (dunkelgrau)', deepslate_tiles: 'Tiefenschieferfliesen (Schieferdach, dunkel)',
  polished_deepslate: 'Polierter Tiefenschiefer', blackstone: 'Schwarzstein', polished_blackstone_bricks: 'Schwarzsteinziegel (fast schwarz)',
  prismarine_bricks: 'Prismarinziegel (türkis)', dark_prismarine: 'Dunkler Prismarin (dunkelgrün)', oxidized_copper: 'Grünspan-Kupfer (Kupferdach)',
  red_nether_bricks: 'Rote Netherziegel (weinrot)', nether_bricks: 'Netherziegel (dunkelrot)',
  'color:white': 'Weiß', 'color:orange': 'Orange', 'color:magenta': 'Magenta', 'color:light_blue': 'Hellblau', 'color:yellow': 'Gelb',
  'color:lime': 'Hellgrün', 'color:pink': 'Rosa', 'color:gray': 'Grau', 'color:light_gray': 'Hellgrau', 'color:cyan': 'Türkis',
  'color:purple': 'Violett', 'color:blue': 'Blau', 'color:brown': 'Braun', 'color:green': 'Grün', 'color:red': 'Rot', 'color:black': 'Schwarz',
};

/** Anzeigename einer Familie (handverlesen, sonst ID mit Leerzeichen). */
export const paletteFamilyLabel = (family: string): string => PALETTE_FAMILY_LABELS[family] ?? family.replace(/^color:/, '').replace(/_/g, ' ');

/** Art einer Familie für den Tausch: Holz nur gegen Holz, Farbe nur gegen Farbe, Mauerwerk gegen Mauerwerk. */
export type FamilyKind = 'wood' | 'color' | 'masonry' | 'plain';

/** Art einer Familie (`undefined` = der Plattform unbekannt). */
export function familyKind(family: string): FamilyKind | undefined {
  if (family.startsWith('color:')) return (THEME_COLORS as readonly string[]).includes(family.slice(6)) ? 'color' : undefined;
  const shapes = Object.hasOwn(FAMILY_SHAPES, family) ? FAMILY_SHAPES[family] : undefined;
  if (shapes === undefined) return undefined;
  if (shapes.includes('planks') && shapes.includes('log')) return 'wood';
  if (shapes.includes('stairs')) return 'masonry';
  return 'plain';
}

/** Hat die Familie eine der Formen, die die Rolle verlangt (Formvertrag)? Rollen ohne Vertrag nehmen jede Familie. */
export function familyFitsRole(family: string, role: string): boolean {
  const need = SHELL_ROLE_SHAPES[role];
  if (family.startsWith('color:')) return need === undefined && familyKind(family) === 'color';
  const shapes = Object.hasOwn(FAMILY_SHAPES, family) ? FAMILY_SHAPES[family] : undefined;
  if (shapes === undefined) return false;
  return need === undefined || shapes.some((s) => need.includes(s));
}

/** Warum ein Tausch nicht geht (`undefined` = geht). */
export function swapProblem(from: string, to: string): string | undefined {
  const a = familyKind(from);
  const b = familyKind(to);
  if (a === undefined) return `Familie ${from} ist unbekannt`;
  if (b === undefined) return `Familie ${to} ist unbekannt`;
  if (from === to) return `${from} gegen sich selbst getauscht`;
  if (a !== b) return `${from} (${a}) lässt sich nicht gegen ${to} (${b}) tauschen – nur Holz gegen Holz, Stein gegen Stein, Farbe gegen Farbe`;
  return undefined;
}

/** Warum eine Familie für eine Gruppe nicht geht (`undefined` = geht). Nur handverlesene Familien der Gruppe. */
export function groupFamilyProblem(group: PaletteGroup, family: string): string | undefined {
  const def = PALETTE_GROUP_DEFS[group];
  if (!def.families.includes(family)) return `${family} gehört nicht zur Auswahl der Gruppe ${group} (${def.families.join(', ')})`;
  const lead = def.roles[0]!;
  return familyFitsRole(family, lead) ? undefined : `${family} hat keine Form, die ${lead} braucht`;
}

/** Familie eines Mischungs-Eintrags als Editor-ID (`spruce`, `color:red`); fester Block → `undefined`. */
function entryFamily(e: Pick<ThemeMixEntry, 'family' | 'color'>): string | undefined {
  return e.family !== undefined ? e.family : e.color !== undefined ? `color:${e.color}` : undefined;
}

/**
 * Tragende Familie einer Theme-Rolle: `family`/`color`, sonst die schwerste Familie der Mischung bzw. aller
 * Verlaufsstopps (Summe der Gewichte, bei Gleichstand alphabetisch). `undefined` für Rollen nur aus festen Blöcken.
 */
export function dominantFamily(spec: ThemeRoleSpec | undefined): string | undefined {
  if (spec === undefined) return undefined;
  const own = entryFamily(spec);
  if (own !== undefined) return own;
  const sum = new Map<string, number>();
  const add = (e: ThemeMixEntry): void => {
    const f = entryFamily(e);
    if (f !== undefined) sum.set(f, (sum.get(f) ?? 0) + e.weight);
  };
  for (const e of spec.mix ?? []) add(e);
  for (const st of spec.gradient?.stops ?? []) for (const e of st.mix) add(e);
  return [...sum.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

/** Familien einer Rolle (für Ersatzketten), ohne feste Blöcke, in Reihenfolge des Auftretens. */
function roleFamilies(spec: ThemeRoleSpec): string[] {
  const out: string[] = [];
  const add = (f: string | undefined): void => {
    if (f !== undefined && !f.startsWith('color:') && !out.includes(f)) out.push(f);
  };
  for (const f of spec.fallback ?? []) add(f);
  add(spec.family);
  for (const e of spec.mix ?? []) add(e.family);
  for (const st of spec.gradient?.stops ?? []) for (const e of st.mix) add(e.family);
  return out;
}

/** Rolle mit genau einer Familie (Material-Felder ersetzt, Bauweise behalten, alte Familien als Ersatz). */
function setRole(spec: ThemeRoleSpec, family: string): ThemeRoleSpec {
  const { family: _f, color: _c, mix: _m, gradient: _g, fallback: _fb, ...rest } = spec;
  if (family.startsWith('color:')) return { ...rest, color: family.slice(6) as ThemeColor };
  const fallback = roleFamilies(spec).filter((f) => f !== family);
  return { ...rest, family, ...(fallback.length > 0 ? { fallback } : {}) };
}

/** Familie in einem Eintrag tauschen (Familie bzw. Farbe); sonst unverändert. */
function swapEntry<T extends Pick<ThemeMixEntry, 'family' | 'color'>>(e: T, from: string, to: string): T {
  if (entryFamily(e) !== from) return e;
  if (to.startsWith('color:')) {
    const { family: _f, ...rest } = e;
    return { ...rest, color: to.slice(6) as ThemeColor } as T;
  }
  const { color: _c, ...rest } = e;
  return { ...rest, family: to } as T;
}

/** Tausch in einer Rolle; `undefined`, wenn die Rolle die Quelle nicht nennt. */
function swapRole(spec: ThemeRoleSpec, from: string, to: string): ThemeRoleSpec | undefined {
  const uses = entryFamily(spec) === from
    || (spec.mix ?? []).some((e) => entryFamily(e) === from)
    || (spec.gradient?.stops ?? []).some((st) => st.mix.some((e) => entryFamily(e) === from));
  if (!uses) return undefined;
  const out: ThemeRoleSpec = {
    ...swapEntry(spec, from, to),
    ...(spec.mix !== undefined ? { mix: spec.mix.map((e) => swapEntry(e, from, to)) } : {}),
    ...(spec.gradient !== undefined ? { gradient: { ...spec.gradient, stops: spec.gradient.stops.map((st) => ({ ...st, mix: st.mix.map((e) => swapEntry(e, from, to)) })) } } : {}),
  };
  // Die alte Familie bleibt Ersatz für Formen, die die neue nicht hat (Holz ↔ Holz hat fast immer alle)
  if (from.startsWith('color:')) return out;
  const fallback = [...(spec.fallback ?? []).filter((f) => f !== to)];
  if (!fallback.includes(from)) fallback.push(from);
  return { ...out, fallback };
}

/** Theme-Rollen, die eine Gruppe in diesem Theme tatsächlich färbt. */
export function groupRolesIn(theme: Pick<ResolvedTheme, 'roles'>, group: PaletteGroup): readonly string[] {
  return PALETTE_GROUP_DEFS[group].roles.filter((r) => theme.roles[r] !== undefined);
}

const applied = new WeakMap<ResolvedTheme, Map<string, ResolvedTheme>>();

/**
 * Überschreibungen auf ein aufgelöstes Theme anwenden (siehe Dateikopf). Zwischengespeichert je Theme-Objekt und
 * Normalform, damit Aufrufer wie `themeFor` bei gleichen Eingaben dasselbe Objekt bekommen (Vorschau-Caches).
 */
export function applyPaletteOverrides(theme: ResolvedTheme, overrides: PaletteOverrides | undefined): ResolvedTheme {
  const o = normalizePaletteOverrides(overrides);
  if (o === undefined) return theme;
  // WS-Farbe: nur Harmonie-Felder (kein Gruppen-/Tausch-Eintrag) → nichts zu tun, dasselbe Objekt (Harmonie wendet die Pipeline an)
  if (o.groups === undefined && o.swaps === undefined) return theme;
  const key = JSON.stringify(o);
  let byKey = applied.get(theme);
  const hit = byKey?.get(key);
  if (hit !== undefined) return hit;
  const roles: Record<string, ThemeRoleSpec> = { ...theme.roles };
  const locked = new Set<string>();
  for (const g of PALETTE_GROUPS) {
    const family = o.groups?.[g];
    if (family === undefined || familyKind(family) === undefined) continue;
    for (const role of groupRolesIn(theme, g)) {
      if (!familyFitsRole(family, role)) continue;
      roles[role] = setRole(roles[role]!, family);
      locked.add(role);
    }
  }
  for (const s of o.swaps ?? []) {
    if (swapProblem(s.from, s.to) !== undefined) continue;
    for (const [role, spec] of Object.entries(roles)) {
      if (locked.has(role) || !familyFitsRole(s.to, role)) continue;
      const next = swapRole(spec, s.from, s.to);
      if (next !== undefined) roles[role] = next;
    }
  }
  const out: ResolvedTheme = { ...theme, roles };
  if (byKey === undefined) {
    byKey = new Map();
    applied.set(theme, byKey);
  }
  byKey.set(key, out);
  return out;
}
