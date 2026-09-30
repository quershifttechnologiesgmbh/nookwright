/**
 * W7-D Fantasy-Vibe (plan/spikes/W7D_fantasy.md, Baustandard „Fantasy-Vibe: über Module, nicht über Rauschen“).
 *
 * Fantasy-Module sind Katalogeinheiten `exterior/fantasy_<modul>` (`FANTASY_MODULES`); jedes Modul hat je Kit
 * (`FANTASY_KITS`) eine Variante gleichen Namens (Doppeltür: `<kit>_double`) – fehlt sie, gehört das Modul nicht zum
 * Kit. Welche Module ein Gebäude bekommt, entscheidet die Fantasy-Stufe (`ExteriorStyle.fantasy`):
 *  - `off`: keine (Standard aller Themes, die kein Fantasy-Modul in seinen `styleTags` nennt – bitgleich zu vorher);
 *  - `accent`: nur Module mit dem Katalog-Tag `fantasy_accent` (Hängelaterne am Bogenarm, Giebelhorn) – in jedem Theme
 *    zuschaltbar;
 *  - `full`: alle Module des Kits (Standard in elven und dwarven).
 * Kit: Stil `fantasyKit` → Kit gleichen Namens wie das Theme → Wandmaterial des Themes (Modul-Tag `walls_wood` →
 * `elven`, `walls_stone` → `dwarven`).
 *
 * Alle Module sitzen an festen Ankern und sind spiegelsymmetrisch gesetzt (Paare bzw. Mittelachse). Ersetzende Module
 * folgen dem Schalter des Ersetzten (Bogenarm → `eaveLanterns`, Feuerschalen → `entranceDecor`, Giebelhorn →
 * `ridgeDecor`); die hinzukommenden (Banner, Giebelzier, Laubranke) dem Schalter `fantasyDecor`.
 */
import type { FacadeGridLine, ShellAnchor } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import type { HorizontalDir, Vec3 } from '@mcda/core';
import { moduleWalls } from './modules.js';
import { OPP, alongOf, step, up, type ExteriorSite, type Part } from './site.js';
import { FANTASY_KITS, type ExteriorGroup, type ExteriorStyle, type FantasyKitId, type FantasyLevel } from './types.js';
import { windowModuleComponent, windowModuleFor } from './windows.js';

/** Fantasy-Module des Katalogs (`exterior/fantasy_<modul>`). */
export const FANTASY_MODULES = ['lantern_arm', 'gable_horn', 'banner', 'crest', 'growth', 'brazier'] as const;
export type FantasyModuleId = (typeof FANTASY_MODULES)[number];
/** Katalog-ID eines Fantasy-Moduls. */
export const fantasyModuleComponent = (id: FantasyModuleId): string => `exterior/fantasy_${id}`;
/** Katalog-Tag der Module, die schon zur Stufe „Akzent“ gehören. */
export const FANTASY_ACCENT_TAG = 'fantasy_accent';

/** Fantasy-Stufe eines Gebäudes: Stil → `full`, wenn ein Fantasy-Modul das Theme in seinen `styleTags` nennt → `off`. */
export function fantasyLevelFor(catalog: Catalog, style: ExteriorStyle, themeId: string | undefined): FantasyLevel {
  if (style.fantasy !== undefined) return style.fantasy;
  if (themeId === undefined) return 'off';
  return FANTASY_MODULES.some((m) => catalog.find(fantasyModuleComponent(m))?.styleTags?.includes(themeId) === true) ? 'full' : 'off';
}

/** Kit eines Gebäudes: Stil → Kit gleichen Namens wie das Theme → Wandmaterial des Themes (Holz → elven, Stein → dwarven). */
export function fantasyKitFor(catalog: Catalog, style: ExteriorStyle, themeId: string | undefined): FantasyKitId {
  if (style.fantasyKit !== undefined) return style.fantasyKit;
  const named = FANTASY_KITS.find((k) => k === themeId);
  if (named !== undefined) return named;
  return moduleWalls(catalog, windowModuleComponent(windowModuleFor(catalog, {}, themeId))) === 'stone' ? 'dwarven' : 'elven';
}

/** Stück eines Fantasy-Moduls für ein Gebäude (Komponente + Kit-Variante). */
export interface FantasyPiece {
  readonly componentId: string;
  readonly variantId: string;
}

/**
 * Das Stück des Moduls `module` für Stil und Theme – nur, wenn die Stufe es einschließt (`full` alle, `accent` nur Module
 * mit `fantasy_accent`) und das Modul eine Variante für das Kit hat (`double`: die Variante `<kit>_double`). Den Schalter
 * der Gruppe prüft der Aufrufer.
 */
export function fantasyPiece(
  catalog: Catalog, style: ExteriorStyle, themeId: string | undefined, module: FantasyModuleId, double = false,
): FantasyPiece | undefined {
  const level = fantasyLevelFor(catalog, style, themeId);
  if (level === 'off') return undefined;
  const componentId = fantasyModuleComponent(module);
  const def = catalog.find(componentId);
  if (def === undefined || (level === 'accent' && !def.tags.includes(FANTASY_ACCENT_TAG))) return undefined;
  const variantId = `${fantasyKitFor(catalog, style, themeId)}${double ? '_double' : ''}`;
  return def.variants?.some((v) => v.id === variantId) === true ? { componentId, variantId } : undefined;
}

const CW: Readonly<Record<HorizontalDir, HorizontalDir>> = { north: 'east', east: 'south', south: 'west', west: 'north' };
const planeOf = (a: Pick<ShellAnchor, 'pos' | 'facing'>): number => (a.facing === 'north' || a.facing === 'south' ? a.pos[2] : a.pos[0]);
const lineCoord = (out: HorizontalDir, p: Vec3): number => (out === 'north' || out === 'south' ? p[0] : p[2]);

/**
 * Fantasy-Module an ihren Ankern (nach allen anderen Gruppen, nur wo frei; die Laterne am Bogenarm setzt
 * `planWindowLanterns`, die Feuerschalen `planEntrances`):
 *  - Giebelhorn (`gable_horn`, Gruppe `ridgeDecor`): eine Lage über der Luftzelle neben der untersten Treppe jedes
 *    Ortgangs, Front nach außen – je Giebel beide Hörner oder keins (spiegelgleich, gleiche Höhe). Nur an Ortgängen ab 4
 *    Treppen (keine Gauben); Walmdächer haben keinen Ortgang.
 *  - Giebelzier (`crest`) und Banner (`banner`), Gruppe `fantasyDecor`: an jedem echten Giebel (unter einem Ortgang, ab 5
 *    breit) in der Mittelachse – die Zier vor der obersten freien Giebelwandzelle (gerade Breite: ein Paar), darunter das
 *    Banner (gerade Breite: ein Paar neben den Mittelspalten) an der höchsten freien Stelle, nie vor Glas.
 *  - Banner an der Traufseite (`banner`): je Seite ohne Giebel eins am mittleren Rasterpfosten der obersten Linie bzw. das
 *    innerste Pfostenpaar, direkt unter der Traufe (unter der Traufkonsole) – nicht an Pfosten mit Laterne (F7).
 *  - Laubranke (`growth`): an den beiden Außenecken der Eingangsseite (Eckzelle am Fuß), beide oder keine.
 */
export function planFantasy(
  site: ExteriorSite, catalog: Catalog, anchors: readonly ShellAnchor[], doors: readonly ShellAnchor[], mains: (a: ShellAnchor) => boolean,
  style: ExteriorStyle, themeId: string | undefined,
): void {
  const on = (g: ExteriorGroup): boolean => style[g] !== false;
  const horn = on('ridgeDecor') ? fantasyPiece(catalog, style, themeId, 'gable_horn') : undefined;
  if (horn !== undefined) planHorns(site, anchors, horn);
  if (!on('fantasyDecor')) return;
  const banner = fantasyPiece(catalog, style, themeId, 'banner');
  const crest = fantasyPiece(catalog, style, themeId, 'crest');
  // echte Giebel (Dreieck unter einem Ortgang derselben Richtung) ab 5 breit – nicht der Kniestock an der Traufseite, der
  // für die Hülle ebenfalls „Wand über der Decke“ ist
  const verges = anchors.filter((a) => a.kind === 'verge');
  const gables = anchors.filter((a) => a.kind === 'gable' && (a.span ?? 1) >= 5
    && verges.some((v) => v.facing === a.facing && Math.abs(planeOf(v) - planeOf(a)) <= 3));
  if (banner !== undefined || crest !== undefined) planGables(site, gables, banner, crest);
  if (banner !== undefined) planEaveBanners(site, site.shell.facadeGrid ?? [], gables, banner);
  const growth = fantasyPiece(catalog, style, themeId, 'growth');
  if (growth !== undefined) planGrowth(site, anchors, doors.filter(mains), growth);
}

function planHorns(site: ExteriorSite, anchors: readonly ShellAnchor[], horn: FantasyPiece): void {
  const ends = new Map<string, ShellAnchor[]>();
  for (const a of anchors.filter((x) => x.kind === 'verge' && (x.span ?? 1) >= 4)) {
    // die beiden Ortgänge eines Giebels enden auf derselben Höhe (Traufe) in derselben Ebene
    const k = `${a.facing}|${planeOf(a)}|${a.pos[1]}`;
    (ends.get(k) ?? ends.set(k, []).get(k)!).push(a);
  }
  for (const [, all] of [...ends].sort((p, q) => p[0].localeCompare(q[0]))) {
    // je Giebel zwei Ortgänge (links, rechts): nebeneinander entlang der Wand paarweise (Quergiebel einer Halle: mehrere
    // Giebel in derselben Ebene)
    const sorted = [...all].sort((p, q) => lineCoord(p.facing, p.pos) - lineCoord(q.facing, q.pos));
    if (sorted.length % 2 === 1) continue;
    for (let i = 0; i + 1 < sorted.length; i += 2) {
      const list = [sorted[i]!, sorted[i + 1]!];
      if (list.some((a) => site.at(step(a.pos, OPP[a.facing]))?.kind !== 'roof')) continue;
      // eine Lage über der Ortgang-Luftzelle (neben der untersten Treppe, außen): so berührt das Horn keine Dachtreppe
      // waagrecht – direkt auf der Traufecke änderte es die Treppenform der Nachbartreppe (Vanilla: innere Ecke)
      const parts = list.map((a): Part => ({ ...horn, facing: a.facing, at: up(a.pos) }));
      site.commit('ridgeDecor', 'verge', list[0]!.floorIndex, parts);
    }
  }
}

function planGables(site: ExteriorSite, gables: readonly ShellAnchor[], banner: FantasyPiece | undefined, crest: FantasyPiece | undefined): void {
  for (const g of gables) {
    const span = g.span ?? 1;
    const along = alongOf(g.facing);
    // Mittelachse: ungerade Breite eine Spalte (Zier + Banner), gerade Breite die beiden mittleren (nur ein Zierpaar)
    const mids = span % 2 === 1 ? [(span - 1) / 2] : [span / 2 - 1, span / 2];
    const at = (m: number, y: number): Vec3 => [g.pos[0] + (along === 'east' ? m : 0), y, g.pos[2] + (along === 'south' ? m : 0)];
    const wall = (m: number, y: number): boolean => site.solidWall(step(at(m, y), OPP[g.facing]));
    const free = (m: number, y: number): boolean => site.outside(at(m, y)) && !site.isTaken(at(m, y));
    // oberste Giebelwandzelle mit freier Außenluft davor (unter dem Firstüberstand), gleich hoch in allen Mittelspalten
    const tops = mids.map((m) => {
      let top: number | undefined;
      for (let y = g.pos[1]; y <= g.pos[1] + 24; y++) if (wall(m, y) && free(m, y)) top = y;
      return top;
    });
    if (tops.some((t) => t === undefined) || new Set(tops).size !== 1) continue;
    const top = tops[0]!;
    if (crest !== undefined) site.commit('fantasyDecor', 'gable', g.floorIndex, mids.map((m): Part => ({ ...crest, facing: g.facing, at: at(m, top) })));
    if (banner === undefined) continue;
    // Banner: die höchste Zelle darunter mit Wand dahinter und einer Wandzelle darunter (das Tuch hängt eine Zelle tief),
    // nie vor Glas (Reservierung `view` prüft `fits`). Ungerade Breite: eins in der Mittelachse; gerade Breite: ein Paar
    // eine Spalte neben den beiden Mittelspalten (flankiert das Giebelfenster), beide auf gleicher Höhe
    const cols = mids.length === 1 ? mids : [mids[0]! - 1, mids[1]! + 1];
    for (let y = top - 1; y > g.pos[1]; y--) {
      if (!cols.every((m) => wall(m, y) && wall(m, y - 1))) continue;
      const parts = cols.map((m): Part => ({ ...banner, facing: g.facing, local: [0, 1, 0], at: at(m, y) }));
      if (site.commit('fantasyDecor', 'gable', g.floorIndex, parts).length > 0) break;
    }
  }
}

function planEaveBanners(site: ExteriorSite, grid: readonly FacadeGridLine[], gables: readonly ShellAnchor[], banner: FantasyPiece): void {
  // oberste Linie je Seite (Außenrichtung + Wandebene); Seiten mit Giebel bekommen ihr Banner am Giebel
  const top = new Map<string, FacadeGridLine>();
  for (const l of grid) {
    const k = `${l.out}|${l.plane}`;
    const cur = top.get(k);
    if (cur === undefined || l.y0 > cur.y0 || (l.y0 === cur.y0 && l.to - l.from > cur.to - cur.from)) top.set(k, l);
  }
  const gableSides = new Set(gables.map((g) => `${g.facing}|${planeOf(g) - (g.facing === 'north' || g.facing === 'west' ? -1 : 1)}`));
  for (const [k, l] of [...top].sort((p, q) => p[0].localeCompare(q[0]))) {
    if (gableSides.has(k) || l.posts.length === 0) continue;
    const c2 = l.from + l.to;
    const unlit = l.posts.filter((p) => !site.litPosts.has(`${l.out}|${l.plane}|${p}`));
    // mittlerer Pfosten, sonst das innerste spiegelgleiche Paar (ohne Laterne)
    const center = unlit.filter((p) => 2 * p === c2);
    const pair = unlit.filter((p) => 2 * p < c2 && unlit.includes(c2 - p)).sort((p, q) => q - p)[0];
    const cols = center.length > 0 ? center : pair !== undefined ? [pair, c2 - pair] : [];
    if (cols.length === 0) continue;
    const front = (c: number, y: number): Vec3 => (l.out === 'north' || l.out === 'south' ? [c, y, l.plane + (l.out === 'south' ? 1 : -1)] : [l.plane + (l.out === 'east' ? 1 : -1), y, c]);
    // Zelle unter der Traufe: erste Zelle vor der Wand mit Dach darüber (ab der Brüstung der Linie)
    const eaveY = (c: number): number | undefined => {
      for (let y = l.y0 + 2; y <= l.y0 + 12; y++) if (site.at(up(front(c, y)))?.kind === 'roof') return y;
      return undefined;
    };
    const ys = cols.map(eaveY);
    if (ys.some((y) => y === undefined) || new Set(ys).size !== 1) continue;
    const y = ys[0]!;
    // unter der Traufkonsole (belegt), sonst direkt unter dem Überstand
    for (const by of site.isTaken(front(cols[0]!, y)) ? [y - 1] : [y, y - 1]) {
      const parts = cols.map((c): Part => ({ ...banner, facing: l.out, local: [0, 1, 0], at: front(c, by) }));
      if (!cols.every((c) => site.solidWall(step(front(c, by), OPP[l.out])))) continue;
      if (site.commit('fantasyDecor', 'eave', l.floorIndex, parts).length > 0) {
        for (const c of cols) site.litPosts.add(`${l.out}|${l.plane}|${c}`);
        break;
      }
    }
  }
}

function planGrowth(site: ExteriorSite, anchors: readonly ShellAnchor[], mainDoors: readonly ShellAnchor[], growth: FantasyPiece): void {
  const lowest = Math.min(...anchors.filter((a) => a.kind === 'corner').map((a) => a.floorIndex));
  const corners = anchors.filter((a) => a.kind === 'corner' && a.floorIndex === lowest);
  const done = new Set<string>();
  for (const door of mainDoors) {
    const f = door.facing;
    const k = `${f}|${planeOf(door)}`;
    if (done.has(k)) continue;
    done.add(k);
    // Ecken dieser Wand: Diagonalzelle mit Außenseite f (facing f oder CW(facing) = f) in der Flucht vor der Wand
    const row = planeOf(door);
    const mine = corners.filter((c) => (c.facing === f || CW[c.facing] === f) && (f === 'north' || f === 'south' ? c.pos[2] : c.pos[0]) === row);
    if (mine.length !== 2) continue;
    const [a, b] = mine.sort((p, q) => lineCoord(f, p.pos) - lineCoord(f, q.pos));
    const dc = lineCoord(f, door.pos);
    // nur, wo die Tür etwa mittig liegt (spiegelgleiche Front); sonst wirkte eine Ecke zufällig
    if (Math.abs((lineCoord(f, a!.pos) + lineCoord(f, b!.pos)) - 2 * dc) > 2) continue;
    site.commit('fantasyDecor', 'corner', a!.floorIndex, mine.map((c): Part => ({ ...growth, facing: f, at: c.pos })));
  }
}
