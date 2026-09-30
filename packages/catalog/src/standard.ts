/**
 * Baustandard (plan/baustandard.md, W2) als Katalog-Regeln für Themes: Materialbudget der Wandfelder (W4), Sockel
 * (W7), Verlauf über die Bauwerkshöhe (W5), Deckungsrezept des Dachs (D1), Kantenkontrast (D3) und Wert-Kontrast
 * Wand ↔ Dach (D9). Die Prüfungen
 * melden **Hinweise** (Warnungen), keine Fehler – ein Theme bleibt ladbar. Ein Test hält die Themes im Repo bei null
 * Hinweisen, damit das Rauschen nicht wieder zuwächst.
 *
 * Rein, nur aus Theme-Daten und der Formtabelle der Plattform (`FAMILY_SHAPES`, ohne Abhängigkeit zu
 * `@mcda/platform`). Für D3 gilt „Familie der Kante ≠ Familie der Fläche“; den Helligkeitsabstand Wand ↔ Dach (D9,
 * W4) prüft eine kleine Tabelle mittlerer Texturhelligkeiten je Familie (`FAMILY_LIGHTNESS`, nur Zahlen).
 */
import { FAMILY_SHAPES } from './familyShapes.js';
import type { ResolvedTheme, ThemeDef, ThemeMixEntry, ThemeRoleSpec } from './theme.js';

/** Wandfelder (Außenhaut und Putz): hier gilt das Materialbudget W4. */
export const WALL_FIELD_ROLES: readonly string[] = ['wall_primary', 'wall_secondary', 'wall_infill', 'wall_gable'];
/** Sockelrollen (Bodenplatte unter den Wänden, Sockelprofil): höchstens zwei Steine (W7). */
export const PLINTH_ROLES: readonly string[] = ['foundation', 'wall_plinth'];

/** Grenzen des Baustandards (plan/baustandard.md, Spalte „Messkriterium“). */
export const STANDARD_LIMITS = {
  /** W4: Grundblöcke je Verlaufsstopp bzw. Mischung eines Wandfelds. */
  wallPerStop: 3,
  /** W4: Grundblöcke eines Wandfelds über alle Stopps (Messkriterium „je Außenwand-Ebene ≤ 4“). */
  wallTotal: 4,
  /** W7: Grundsteine im Sockel. */
  plinth: 2,
  /** D1: Hauptton + höchstens zwei Nachbartöne in ganzen Ringen. */
  roofTones: 3,
  /**
   * D9 (W4, 27.09.2026, Review M5): Mindestabstand der Helligkeit (OKLab-L, 0–1) zwischen dem Hauptmaterial der
   * Außenwand und dem der Dachfläche. 0,10 ist das Doppelte des P1-Mindestabstands der Pipeline (0,05) und liegt unter
   * Eiche ↔ Fichte (0,16); gleiche Familien (0), Sandstein ↔ glatter Sandstein (0,03) oder Tiefenschieferziegel ↔
   * -fliesen (0,06) fallen darunter.
   */
  wallRoofContrast: 0.1,
  /**
   * D9 Bauwerk (W5-B, Review W4-R N5): Mindestabstand der mittleren Helligkeit zwischen Mauer/Turmwand
   * (`wall_primary`) und Krone (`parapet`) bzw. Wehrgang/Plattform (`walkway`), wenn beide aus Holz sind – dieselbe
   * Grenze wie Wand ↔ Dach. Stein auf Stein (einfarbiges Mauerwerk wie bei 12 von 13 Bergfried-Vorbildern) und Stein
   * auf Holz (anderer Farbton) prüft die Regel nicht.
   */
  structureContrast: 0.1,
} as const;

/** D9 Bauwerk: Rollen, die sich bei Holz auf Holz von der Mauer abheben (Krone, Wehrgang/Turmplattform). */
export const STRUCTURE_CONTRAST_ROLES: readonly string[] = ['parapet', 'walkway'];

/**
 * D9 Bauwerk (W5-B): Helligkeit (OKLab-L) der Stamm-Varianten – die Rinde (`log`/`wood`) ist oft viel dunkler als das
 * Brett der Familie (Fichte 0,29 statt 0,47), entrindet heller. Gemessen wie `FAMILY_LIGHTNESS` (Texturmittel 1.21.11).
 */
export const VARIANT_LIGHTNESS: Readonly<Record<string, number>> = {
  'oak.log': 0.47, 'spruce.log': 0.29, 'dark_oak.log': 0.31, 'birch.log': 0.88, 'jungle.log': 0.4, 'acacia.log': 0.5, 'mangrove.log': 0.39,
  'cherry.log': 0.28, 'pale_oak.log': 0.43,
  'oak.stripped_log': 0.67, 'spruce.stripped_log': 0.49, 'dark_oak.stripped_log': 0.36, 'birch.stripped_log': 0.76, 'jungle.stripped_log': 0.64,
  'acacia.stripped_log': 0.57, 'mangrove.stripped_log': 0.42, 'cherry.stripped_log': 0.73, 'pale_oak.stripped_log': 0.96,
};

/**
 * D9: Helligkeit (OKLab-L) je Familie, gemessen als Mittelwert der Textur des Grundblocks (Bretter bzw. Block) in
 * 1.21.11 – nur Zahlen, keine Assets (Werkzeug: Bericht W4-G §5). Familien ohne Eintrag werden nicht geprüft.
 */
export const FAMILY_LIGHTNESS: Readonly<Record<string, number>> = {
  oak: 0.63, spruce: 0.47, birch: 0.76, jungle: 0.59, acacia: 0.55, dark_oak: 0.31, mangrove: 0.42, cherry: 0.81, pale_oak: 0.9,
  bamboo: 0.75, crimson: 0.39, warped: 0.48, bamboo_mosaic: 0.74,
  stone: 0.59, cobblestone: 0.6, mossy_cobblestone: 0.55, stone_bricks: 0.58, mossy_stone_bricks: 0.57, andesite: 0.63,
  polished_andesite: 0.62, diorite: 0.8, polished_diorite: 0.81, granite: 0.56, polished_granite: 0.57, deepslate_bricks: 0.4,
  deepslate_tiles: 0.34, cobbled_deepslate: 0.42, polished_deepslate: 0.4, tuff: 0.53, tuff_bricks: 0.51, polished_tuff: 0.51,
  blackstone: 0.27, polished_blackstone: 0.32, polished_blackstone_bricks: 0.3, bricks: 0.55, mud_bricks: 0.54, packed_mud: 0.56,
  sandstone: 0.84, cut_sandstone: 0.85, smooth_sandstone: 0.87, red_sandstone: 0.59, cut_red_sandstone: 0.6, smooth_red_sandstone: 0.58,
  calcite: 0.91, smooth_quartz: 0.93, quartz_block: 0.93, quartz_bricks: 0.92, prismarine: 0.66, prismarine_bricks: 0.69,
  dark_prismarine: 0.44, copper_block: 0.62, exposed_copper: 0.62, weathered_copper: 0.64, oxidized_copper: 0.66, terracotta: 0.54,
  white_terracotta: 0.79, end_stone_bricks: 0.89, nether_bricks: 0.23, red_nether_bricks: 0.26, mushroom_stem: 0.83, smooth_stone: 0.7,
  resin_bricks: 0.6, purpur_block: 0.65, snow_block: 0.99, moss_block: 0.51,
};

/** Varianten, die Verwitterung sind und keinen eigenen Grundblock zählen (`mossy`, `cracked`). */
const WEATHER_VARIANTS = new Set(['mossy', 'cracked']);
/** Varianten, die aus Brettern einen Stamm machen (senkrechte Zufallsstämme im Bretterfeld, W4). */
const LOG_VARIANTS = new Set(['log', 'stripped_log', 'wood', 'stripped_wood']);

/** Holzfamilie der Plattform (hat Bretter oder Stamm): Eiche, Fichte, Bambus, Karmesin … */
export function isWoodFamily(family: string): boolean {
  const shapes = Object.hasOwn(FAMILY_SHAPES, family) ? FAMILY_SHAPES[family] : undefined;
  if (shapes !== undefined && (shapes.includes('planks') || shapes.includes('log'))) return true;
  // Bambus-Mosaik ist eine eigene Familie ohne Bretter/Stamm, gehört aber zum Bambus
  return family.endsWith('_mosaic') && isWoodFamily(family.slice(0, -'_mosaic'.length));
}

/** Grundblock eines Mischungs-Eintrags: Verwitterung (mossy/cracked, auch als Familien-Präfix) zählt nicht extra. */
export function baseBlockKey(e: ThemeMixEntry): string {
  if (e.color !== undefined) return `c:${e.color}`;
  if (e.block !== undefined) return `b:${e.block.replace(/^minecraft:(mossy|cracked)_/, 'minecraft:')}`;
  const fam = e.family!.replace(/^(mossy|cracked)_/, '');
  return e.variant === undefined || WEATHER_VARIANTS.has(e.variant) ? `f:${fam}` : `f:${fam}.${e.variant}`;
}

/** Alle Mischungen einer Rolle (Einzelwert, Mischung oder jeder Verlaufsstopp). */
function mixesOf(spec: ThemeRoleSpec): Array<readonly ThemeMixEntry[]> {
  if (spec.mix !== undefined) return [spec.mix];
  if (spec.gradient !== undefined) return spec.gradient.stops.map((s) => s.mix);
  if (spec.family !== undefined) return [[{ family: spec.family, weight: 1 }]];
  return [[{ color: spec.color!, weight: 1 }]];
}

/** Anteile je Familie über alle Stopps (jeder Stopp auf 1 normiert, dann gemittelt). */
function familyShares(spec: ThemeRoleSpec): Map<string, number> {
  const mixes = mixesOf(spec);
  const out = new Map<string, number>();
  for (const mix of mixes) {
    const total = mix.reduce((s, e) => s + e.weight, 0);
    for (const e of mix) {
      const k = e.family ?? (e.color !== undefined ? `color:${e.color}` : e.block!);
      out.set(k, (out.get(k) ?? 0) + e.weight / total / mixes.length);
    }
  }
  return out;
}

/**
 * Ist die Rolle eine **Holzfläche** (W3 „Ecke nach Material“)? Holzfamilien tragen mindestens die Hälfte der Anteile
 * über alle Stopps. Unbekannte Rolle → `false`.
 */
export function isWoodRole(theme: Pick<ResolvedTheme, 'roles'>, role: string): boolean {
  const spec = Object.hasOwn(theme.roles, role) ? theme.roles[role] : undefined;
  if (spec === undefined) return false;
  let wood = 0;
  for (const [fam, share] of familyShares(spec)) if (isWoodFamily(fam)) wood += share;
  return wood >= 0.5;
}

/** Familien einer Rolle (für D3: Kante ≠ Fläche). */
function familiesOf(spec: ThemeRoleSpec): Set<string> {
  const out = new Set<string>();
  for (const mix of mixesOf(spec)) for (const e of mix) if (e.family !== undefined) out.add(e.family.replace(/^(mossy|cracked)_/, ''));
  return out;
}

/**
 * Hinweise zu den Rollen **einer** Theme-Datei (W4, W7, D1) – Teil von `validateThemeDef`. Jede Meldung beginnt mit
 * der Regel-ID des Baustandards.
 */
export function roleStandardWarnings(t: ThemeDef): string[] {
  const out: string[] = [];
  for (const [role, spec] of Object.entries(t.roles)) {
    const where = `${t.id}.${role}`;
    if (WALL_FIELD_ROLES.includes(role)) {
      const all = new Set<string>();
      mixesOf(spec).forEach((mix, i) => {
        const keys = new Set(mix.map(baseBlockKey));
        for (const k of keys) all.add(k);
        if (keys.size > STANDARD_LIMITS.wallPerStop) {
          out.push(`${where}: W4 Materialbudget – ${spec.gradient !== undefined ? `Stopp ${i}` : 'Mischung'} hat ${keys.size} Grundblöcke (höchstens ${STANDARD_LIMITS.wallPerStop})`);
        }
      });
      if (all.size > STANDARD_LIMITS.wallTotal) out.push(`${where}: W4 Materialbudget – ${all.size} Grundblöcke über alle Stopps (höchstens ${STANDARD_LIMITS.wallTotal})`);
      const entries = mixesOf(spec).flat();
      const boards = entries.some((e) => e.family !== undefined && isWoodFamily(e.family) && (e.variant === undefined || e.variant === 'planks'));
      const logs = entries.some((e) => e.family !== undefined && e.variant !== undefined && LOG_VARIANTS.has(e.variant));
      if (boards && logs) out.push(`${where}: W4 Stämme als Zufallsblöcke im Bretterfeld (Stämme nur als Ecke, Schwelle, Rähm oder Raster)`);
    }
    if (PLINTH_ROLES.includes(role)) {
      const keys = new Set(mixesOf(spec).flat().map(baseBlockKey));
      if (keys.size > STANDARD_LIMITS.plinth) out.push(`${where}: W7 Sockel aus ${keys.size} Grundsteinen (höchstens ${STANDARD_LIMITS.plinth}; Moos macht die Verwitterung)`);
    }
    if (role === 'roof_main') {
      const keys = new Set(mixesOf(spec).flat().map((e) => baseBlockKey(e)));
      if (keys.size > 1 && spec.gradient?.quantize !== 'ring') {
        out.push(`${where}: D1 Deckungsrezept – ${keys.size} Materialien je Zelle gemischt; Töne in ganzen Ringen (gradient.quantize "ring")`);
      } else if (keys.size > STANDARD_LIMITS.roofTones) {
        out.push(`${where}: D1 Deckungsrezept – ${keys.size} Töne (Hauptton + höchstens ${STANDARD_LIMITS.roofTones - 1} Nachbartöne)`);
      }
    }
  }
  return out;
}

/**
 * D9: Hauptfamilie einer Rolle nach **Fläche** – beim Verlauf zählt jeder Stopp mit dem Achsenabschnitt, den er
 * deckt (Stufe: bis zum nächsten Stopp; linear/weich: je zur Hälfte mit dem Nachbarn). So trägt ein schmaler
 * First- oder Sockelring nicht wie die ganze Fläche. Verwitterung (`mossy_`/`cracked_`) zählt zur Grundfamilie.
 */
export function mainFamily(spec: ThemeRoleSpec): string | undefined {
  const shares = new Map<string, number>();
  const add = (mix: readonly ThemeMixEntry[], w: number): void => {
    const total = mix.reduce((s, e) => s + e.weight, 0);
    for (const e of mix) {
      if (e.family === undefined) continue;
      const f = e.family.replace(/^(mossy|cracked)_/, '');
      shares.set(f, (shares.get(f) ?? 0) + (w * e.weight) / total);
    }
  };
  if (spec.gradient !== undefined) {
    const { stops, interpolate } = spec.gradient;
    for (let i = 0; i + 1 < stops.length; i++) {
      const len = stops[i + 1]!.at - stops[i]!.at;
      if (interpolate === 'step') add(stops[i]!.mix, len);
      else {
        add(stops[i]!.mix, len / 2);
        add(stops[i + 1]!.mix, len / 2);
      }
    }
  } else for (const mix of mixesOf(spec)) add(mix, 1);
  return [...shares].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
}

/** Helligkeit eines Mischungs-Eintrags: Variante (Stamm, entrindet) vor Familie; Verwitterung zählt zur Grundfamilie. */
function entryLightness(e: ThemeMixEntry): number | undefined {
  if (e.family === undefined) return undefined;
  const f = e.family.replace(/^(mossy|cracked)_/, '');
  const v = e.variant === 'wood' ? 'log' : e.variant === 'stripped_wood' ? 'stripped_log' : e.variant;
  const key = `${f}.${v ?? ''}`;
  if (v !== undefined && Object.hasOwn(VARIANT_LIGHTNESS, key)) return VARIANT_LIGHTNESS[key];
  return Object.hasOwn(FAMILY_LIGHTNESS, f) ? FAMILY_LIGHTNESS[f] : undefined;
}

/**
 * D9 Bauwerk (W5-B): mittlere Helligkeit einer Rolle nach **Fläche** – Mischung nach Gewicht, Verlauf je Stopp mit dem
 * Achsenabschnitt wie `mainFamily`, Stämme mit ihrer Rinde (`VARIANT_LIGHTNESS`). Einträge ohne bekannte Helligkeit
 * (Einzelblöcke, Farben) fallen heraus; ohne einen bekannten Eintrag `undefined`.
 */
export function roleLightness(spec: ThemeRoleSpec): number | undefined {
  let sum = 0;
  let weight = 0;
  const add = (mix: readonly ThemeMixEntry[], w: number): void => {
    const total = mix.reduce((s, e) => s + e.weight, 0);
    for (const e of mix) {
      const l = entryLightness(e);
      if (l === undefined || total <= 0) continue;
      sum += (l * w * e.weight) / total;
      weight += (w * e.weight) / total;
    }
  };
  if (spec.gradient !== undefined) {
    const { stops, interpolate } = spec.gradient;
    for (let i = 0; i + 1 < stops.length; i++) {
      const len = stops[i + 1]!.at - stops[i]!.at;
      if (interpolate === 'step') add(stops[i]!.mix, len);
      else {
        add(stops[i]!.mix, len / 2);
        add(stops[i + 1]!.mix, len / 2);
      }
    }
  } else for (const mix of mixesOf(spec)) add(mix, 1);
  return weight > 0 ? sum / weight : undefined;
}

/**
 * Hinweise zum **aufgelösten** Theme (mit geerbten Rollen): D3 Kantenkontrast (Ortgang/Traufe `roof_trim` nicht aus
 * einer Familie der Dachfläche) und W5 (Außenwand-Verlauf über die Bauwerkshöhe `facade_h`, nicht je Geschoss).
 */
export function themeStandardWarnings(theme: ResolvedTheme): string[] {
  const out: string[] = [];
  const roles = theme.roles;
  const trim = Object.hasOwn(roles, 'roof_trim') ? roles['roof_trim'] : undefined;
  const main = Object.hasOwn(roles, 'roof_main') ? roles['roof_main'] : undefined;
  if (trim !== undefined && main !== undefined) {
    const same = [...familiesOf(trim)].filter((f) => familiesOf(main).has(f));
    if (same.length > 0) out.push(`${theme.id}: D3 Kantenkontrast – roof_trim (${same.join(', ')}) ist auch Familie der Dachfläche roof_main`);
  }
  const wall = Object.hasOwn(roles, 'wall_primary') ? roles['wall_primary'] : undefined;
  // D3 (W2-FB: Windbrett und Traufkante in `roof_trim`): die Kante hebt sich auch von der tragenden Wandfamilie ab.
  // W5-B (Review W4-R N5 „gerahmtes Bild“): Ausnahme dunkles Dach über Holzwand – dort darf die Kante im Holzton der
  // Wand laufen, solange sie sich im Wert vom Dach abhebt (≥ `wallRoofContrast`); in 15 Holzbau-Vorbildern mit
  // sichtbarem Dach hat keins eine helle Kante (plan/spikes/W5B_burg.md), die helle Eiche rahmte das Dach wie ein Bild.
  if (trim !== undefined && wall !== undefined) {
    const shares = [...familyShares(wall)].sort((a, b) => b[1] - a[1]);
    const wallFamily = shares[0]?.[0]?.replace(/^(mossy|cracked)_/, '');
    const lt = roleLightness(trim);
    const lr = main === undefined ? undefined : roleLightness(main);
    const darkRoofOverWood = isWoodRole(theme, 'wall_primary') && lt !== undefined && lr !== undefined && lt - lr >= STANDARD_LIMITS.wallRoofContrast;
    if (wallFamily !== undefined && familiesOf(trim).has(wallFamily) && !darkRoofOverWood) out.push(`${theme.id}: D3 Kantenkontrast – roof_trim (${wallFamily}) ist die tragende Familie der Wand wall_primary`);
  }
  // D9 (W4, Review M5): Wand und Dach brauchen einen sichtbaren Helligkeitsabstand (nordic: Fichte an Fichte)
  if (wall !== undefined && main !== undefined) {
    const w = mainFamily(wall);
    const r = mainFamily(main);
    const lw = w === undefined ? undefined : FAMILY_LIGHTNESS[w];
    const lr = r === undefined ? undefined : FAMILY_LIGHTNESS[r];
    if (lw !== undefined && lr !== undefined && Math.abs(lw - lr) < STANDARD_LIMITS.wallRoofContrast) {
      out.push(`${theme.id}: D9 Wert-Kontrast – Wand ${w} (L ${lw.toFixed(2)}) und Dach ${r} (L ${lr.toFixed(2)}) liegen ${Math.abs(lw - lr).toFixed(2)} auseinander (mindestens ${STANDARD_LIMITS.wallRoofContrast.toFixed(2)})`);
    }
  }
  // D9 Bauwerk (W5-B, Review W4-R N5): Holzburg nicht „komplett braun“ – Krone und Wehrgang/Plattform heben sich in der
  // Helligkeit von der Mauer ab, wenn beide aus Holz sind
  if (wall !== undefined && isWoodRole(theme, 'wall_primary')) {
    const lw = roleLightness(wall);
    for (const role of STRUCTURE_CONTRAST_ROLES) {
      const spec = Object.hasOwn(roles, role) ? roles[role] : undefined;
      if (spec === undefined || lw === undefined || !isWoodRole(theme, role)) continue;
      const l = roleLightness(spec);
      if (l !== undefined && Math.abs(l - lw) < STANDARD_LIMITS.structureContrast) {
        out.push(`${theme.id}: D9 Bauwerk – ${role} (L ${l.toFixed(2)}) hebt sich nicht von der Holzmauer wall_primary (L ${lw.toFixed(2)}) ab: ${Math.abs(l - lw).toFixed(2)} (mindestens ${STANDARD_LIMITS.structureContrast.toFixed(2)})`);
      }
    }
  }
  if (wall?.gradient !== undefined && wall.gradient.along === 'wall_h') {
    out.push(`${theme.id}: W5 wall_primary verläuft je Geschoss (wall_h) – Außenwand über die Bauwerkshöhe (facade_h)`);
  }
  return out;
}
