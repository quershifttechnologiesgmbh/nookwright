/**
 * W15 Fassaden-Details aus Teilblöcken (plan/spikes/W15_fassaden_detailbloecke.md; Nutzerwunsch „Blöcke, die außen an der
 * Fassade Detail und Tiefe einbauen“, Restkritik der W13-Blindvergleiche: flache Wände, keine Konsolen unter
 * Auskragungen, leere Giebeldreiecke).
 *
 * Jedes Muster (`FACADE_DETAIL_PATTERNS`) ist eine Katalog-Komponente `exterior/detail_<muster>`. Welche Muster ein
 * Gebäude bekommt, entscheidet die Stufe (`ExteriorStyle.facadeDetail`):
 *  - `off`: keine – alles andere bleibt bitgleich zum Stand vor W15;
 *  - `subtle` (Standard `DEFAULT_FACADE_DETAIL`): Muster mit dem Katalog-Tag `detail_subtle` bzw. `detail_subtle:<theme>` (Dichte je Theme);
 *  - `rich`: alle Muster des Themes, dazu dichter (Zahnschnitt statt Pfosten-Takt, Laterne am Hängezapfen, je Seite ein
 *    Holzstapel);
 *  - `grand` (EXT, 28.09.2026): wie `rich`, dazu die großen Bauteile aus `detail-grand.ts` (Balkon, Erker, Geschossband,
 *    Verdachung, Strebepfeiler, Wetterfahne, Glockentürmchen, Rankgitter, Taubenschlag; `FACADE_DETAIL_GRAND_PATTERNS`), seit EXT2 auch Sockelabsatz, Wandpfeiler, Blindfenster, Regenfallrohr
 *    (`detail-relief.ts`).
 * Ein Muster passt zu einem Theme, wenn die `styleTags` der Komponente es nennen; `facadeDetailOff` schaltet einzelne ab.
 *
 * Regeln (hart, Tests `packages/exterior/test/detail.test.ts`):
 *  - Läuft zuletzt (nach Fantasy-Modulen): belegt nur, was frei ist; nichts vor Scheiben (Reservierung `view`) und nichts
 *    im Laufweg vor Türen (`walk`), nie über einer Dachzelle.
 *  - Halt: jede Zelle liegt an einer Wand (`solidWall` dahinter) bzw. hängt unter einer Hüll- oder Dachzelle; die Laterne
 *    hängt am Zaun (Stützmaske der Komponente).
 *  - Spiegelsymmetrisch je Fassade bzw. Fenster: Paare werden ganz oder gar nicht gesetzt (`commit`), Einzelstücke nur in
 *    der Mittelachse. Keine Drehmuster (Windrad-Regel): jede Seite ist für sich spiegelgleich.
 *  - Deterministisch ohne Zufall (Auswahl nur aus Hülle, Theme und Stufe).
 */
import type { ShellAnchor, ShellCell } from '@mcda/blueprint';
import type { Catalog, ComponentDef } from '@mcda/catalog';
import type { HorizontalDir, Vec3 } from '@mcda/core';
import { OPP, alongOf, step, up, type ExteriorSite, type Part } from './site.js';
import { planReliefGround } from './detail-relief.js';
import { GRAND_COMPONENTS, planGrandFront, planGrandGround, planGrandUpper, type GrandKit } from './detail-grand.js';
import {
  DEFAULT_FACADE_DETAIL, DEFAULT_SIGN_ROOM_TYPES, FACADE_DETAIL_GRAND_PATTERNS, type ExteriorOptions, type ExteriorStyle, type FacadeDetailLevel, type FacadeDetailPattern,
} from './types.js';

/** Katalog-Komponente je Muster. */
export const FACADE_DETAIL_COMPONENTS: Readonly<Record<FacadeDetailPattern, string>> = {
  jettyCorbels: 'exterior/detail_jetty_corbel',
  sillCorbels: 'exterior/detail_sill_corbel',
  gablePendant: 'exterior/detail_gable_pendant',
  gableBanner: 'exterior/detail_gable_banner',
  eaveDentils: 'exterior/detail_eave_dentil',
  shopShelves: 'exterior/detail_shop_shelves',
  entranceGoods: 'exterior/detail_entrance_goods',
  rainBarrels: 'exterior/detail_rain_barrel',
  woodStack: 'exterior/detail_wood_stack',
  ...GRAND_COMPONENTS,
};
/** Katalog-Tag der Muster, die schon zur Stufe `subtle` gehören (mit `:<theme>` nur in diesem Theme). */
export const FACADE_DETAIL_SUBTLE_TAG = 'detail_subtle';

/** Stufe eines Gebäudes: Stil → Standard (`subtle`). */
export function facadeDetailLevelFor(style: ExteriorStyle): FacadeDetailLevel {
  return style.facadeDetail ?? DEFAULT_FACADE_DETAIL;
}

/** Ist das Muster für Stil und Theme aktiv (Stufe, Einzelschalter, `styleTags`, Tag `detail_subtle`)? */
export function facadeDetailActive(catalog: Catalog, style: ExteriorStyle, themeId: string | undefined, pattern: FacadeDetailPattern): boolean {
  const level = facadeDetailLevelFor(style);
  if (level === 'off' || style.facadeDetailOff?.includes(pattern) === true) return false;
  // die großen Bauteile gehören nur zur Stufe `grand` (`rich` und `subtle` bleiben bitgleich)
  if (level !== 'grand' && FACADE_DETAIL_GRAND_PATTERNS.includes(pattern)) return false;
  const def = catalog.find(FACADE_DETAIL_COMPONENTS[pattern]);
  if (def === undefined) return false;
  if (themeId !== undefined && def.styleTags?.includes(themeId) !== true) return false;
  if (level === 'rich' || level === 'grand') return true;
  return def.tags.includes(FACADE_DETAIL_SUBTLE_TAG) || (themeId !== undefined && def.tags.includes(`${FACADE_DETAIL_SUBTLE_TAG}:${themeId}`));
}

/** Kleinste Zielversion einer Variante (größtes `minVersion` ihrer Materialien; 0 = immer). */
export function variantMinVersion(def: ComponentDef, variantId: string | undefined): number {
  const v = variantId === undefined ? undefined : def.variants?.find((x) => x.id === variantId);
  const legend = v?.legend ?? def.legend ?? {};
  return Math.max(0, ...Object.values(legend).map((m) => m.minVersion ?? 0));
}

const DIRS: readonly HorizontalDir[] = ['north', 'east', 'south', 'west'];
const CW: Readonly<Record<HorizontalDir, HorizontalDir>> = { north: 'east', east: 'south', south: 'west', west: 'north' };
/** Hüllzellen über einer Auskragung (das Obergeschoss steht vor der Wand darunter). */
const OVERHANG: ReadonlySet<ShellCell['kind']> = new Set<ShellCell['kind']>(['floor', 'wall', 'pillar', 'lintel', 'window']);
/** Hüllzellen, an denen ein Teilblock hinten anliegen darf (kein Glas, keine Tür, kein Dach). */
const BACKING: ReadonlySet<ShellCell['kind']> = new Set<ShellCell['kind']>(['wall', 'pillar', 'lintel', 'floor', 'ceiling', 'facade']);
const backed = (site: ExteriorSite, p: Vec3, out: HorizontalDir): boolean => {
  const c = site.at(step(p, OPP[out]));
  return c !== undefined && BACKING.has(c.kind);
};
const ns = (d: HorizontalDir): boolean => d === 'north' || d === 'south';
const planeOf = (a: Pick<ShellAnchor, 'pos' | 'facing'>): number => (ns(a.facing) ? a.pos[2] : a.pos[0]);
const lineCoord = (d: HorizontalDir, p: Vec3): number => (ns(d) ? p[0] : p[2]);
/** Zelle in Laufkoordinate `u` einer Reihe, die durch `p` geht (Richtung `d`). */
const atU = (d: HorizontalDir, p: Vec3, u: number): Vec3 => (ns(d) ? [u, p[1], p[2]] : [p[0], p[1], u]);

/** Liegt hinter dem Teil eine Wand eines eingegrabenen Baukörpers (Erdhaus), die nicht seine Front ist? */
function buriedBehind(site: ExteriorSite, p: Part): boolean {
  const wall = step(p.at, OPP[p.facing]);
  return (site.shell.settings ?? []).some((s) => s.kind === 'buried' && s.footprint.has(wall[0], wall[2]) && (s.front ?? 'south') !== p.facing);
}

/** Setzen mit den gemeinsamen Regeln aller Muster: nie an der Erdseite eines eingegrabenen Baukörpers. */
function commit(
  site: ExteriorSite, anchor: Parameters<ExteriorSite['commit']>[1], floorIndex: number, parts: readonly Part[], extra?: () => boolean,
  opts?: { readonly roof?: boolean; readonly viewOk?: boolean },
) {
  if (parts.some((p) => buriedBehind(site, p))) return [];
  return site.commit('detailBlocks', anchor, floorIndex, parts, extra, 'detailBlocks', opts);
}

export interface FacadeDetailOptions extends Pick<ExteriorOptions, 'themeId' | 'roomTypes' | 'dataVersion'> {
  /** Anker in Räumen, deren Baukörper die Gruppe abschaltet, fallen weg (W12-C). */
  readonly on: (a: ShellAnchor) => boolean;
  readonly isMain: (a: ShellAnchor) => boolean;
}

function grandKit(site: ExteriorSite, catalog: Catalog, style: ExteriorStyle, opts: FacadeDetailOptions): GrandKit {
  return {
    site, act: (p) => facadeDetailActive(catalog, style, opts.themeId, p), backed: (p, out) => backed(site, p, out), fitsAll: (entries) => fitsAll(site, entries), mirrorPairs,
    commit: (anchor, floorIndex, parts, extra, o) => commit(site, anchor, floorIndex, parts, extra, o),
  };
}

/**
 * EXT: Balkon und Erker VOR den Fenstermodulen (Stufe `grand`): sie ersetzen Fensterbank, Laden und Blumenkasten des mittleren
 * Fensters, das die Module sonst belegten. Ohne die Stufe `grand` geschieht nichts.
 */
export function planFacadeFront(
  site: ExteriorSite, catalog: Catalog, anchors: readonly ShellAnchor[], doors: readonly ShellAnchor[], style: ExteriorStyle, opts: FacadeDetailOptions,
): void {
  if (facadeDetailLevelFor(style) !== 'grand') return;
  planGrandFront(grandKit(site, catalog, style, opts), anchors.filter(opts.on), { mainDoors: doors.filter(opts.on).filter(opts.isMain) });
}

/**
 * Fassaden-Details (nach allen anderen Gruppen). Reihenfolge = Vorrang: Konsolen unter Auskragungen, Konsolen unter
 * Fensterbänken, Giebelzapfen, Giebelbanner, Zahnschnitt unter der Traufe, Auslagen, Kram am Eingang, Regentonnen,
 * Holzstapel.
 */
export function planFacadeDetail(
  site: ExteriorSite, catalog: Catalog, anchors: readonly ShellAnchor[], doors: readonly ShellAnchor[], style: ExteriorStyle, opts: FacadeDetailOptions,
): void {
  const level = facadeDetailLevelFor(style);
  if (level === 'off') return;
  const grand = level === 'grand';
  const rich = level === 'rich' || grand;
  const act = (p: FacadeDetailPattern): boolean => facadeDetailActive(catalog, style, opts.themeId, p);
  const mine = anchors.filter(opts.on);
  const myDoors = doors.filter(opts.on);
  const kit = grandKit(site, catalog, style, opts);
  if (act('jettyCorbels')) planCorbelRows(site, rich, 'jetty');
  if (act('sillCorbels')) planSillCorbels(site, mine);
  const gables = realGables(mine);
  if (act('gablePendant')) planGablePendants(site, gables, rich);
  if (act('gableBanner')) planGableBanners(site, gables);
  if (act('eaveDentils')) planCorbelRows(site, true, 'eave');
  if (grand) planGrandUpper(kit, mine, { mainDoors: myDoors.filter(opts.isMain) });
  // Bodennahes (Auslagen, Kram, Tonnen, Stapel) nicht an eingegrabenen Baukörpern: dort liegen Hügel und Flanken vor der Wand
  const buried = (site.shell.settings ?? []).some((s) => s.kind === 'buried');
  if (buried) return;
  if (act('shopShelves')) planShopShelves(site, catalog, myDoors, style, opts);
  if (act('entranceGoods')) planEntranceGoods(site, catalog, myDoors, style, opts, rich);
  if (act('rainBarrels')) planRainBarrels(site, mine, myDoors.filter(opts.isMain));
  if (act('woodStack')) planWoodStacks(site, myDoors.filter(opts.isMain), rich);
  if (grand) {
    planGrandGround(kit, { mainDoors: myDoors.filter(opts.isMain) });
    planReliefGround(kit, myDoors.filter(opts.isMain));
  }
}

/** Spiegelpaare einer Auswahl in [a, b] (Mitte einzeln); nur Stellen, deren Spiegelbild auch gewählt ist. */
function mirrorPairs(picks: Iterable<number>, a: number, b: number): number[][] {
  const set = new Set([...picks].filter((u) => u >= a && u <= b));
  const out: number[][] = [];
  for (const u of [...set].sort((p, q) => Math.abs(2 * p - a - b) - Math.abs(2 * q - a - b) || p - q)) {
    const m = a + b - u;
    if (!set.has(m) || m < u) continue;
    out.push(m === u ? [u] : [u, m]);
  }
  return out;
}

/**
 * Konsolenreihen: Außenluft vor einer Wand, über der etwas vorkragt – `jetty`: eine Hüllzelle des Obergeschosses
 * (Bodenplatte, Wand, Pfosten, Fenster) bzw. das Gesimsband der Hülle (`wall_cornice`); `eave`: der Dachüberstand. Je
 * Reihe (Richtung, Wandebene, Höhe) zusammenhängende Läufe; dezent an den Rasterpfosten und an beiden Enden, reich jede
 * zweite Zelle von den Enden aus (Zahnschnitt). Unter der Traufe nur reich, zwischen den Traufkonsolen der Pfosten.
 */
function planCorbelRows(site: ExteriorSite, rich: boolean, mode: 'jetty' | 'eave'): void {
  const componentId = mode === 'jetty' ? FACADE_DETAIL_COMPONENTS.jettyCorbels : FACADE_DETAIL_COMPONENTS.eaveDentils;
  const stoneAbove = (p: Vec3): boolean => {
    const c = site.at(up(p));
    return c?.kind === 'facade' && c.role === 'wall_cornice';
  };
  const over = (c: ShellCell | undefined): boolean => c !== undefined
    && (mode === 'eave' ? c.kind === 'roof' : OVERHANG.has(c.kind) || (c.kind === 'facade' && c.role === 'wall_cornice'));
  const rows = new Map<string, { d: HorizontalDir; p: Vec3; us: Set<number> }>();
  for (const c of site.shell.cells) {
    if (!site.solidWall(c.pos)) continue;
    for (const d of DIRS) {
      const p = step(c.pos, d);
      // nur über dem Erdgeschoss-Boden (unter Tage liegen Keller und Gewölbe, feat/underground)
      if (p[1] <= site.y0 || !site.outside(p) || site.overRoof(p) || site.isTaken(p)) continue;
      if (!over(site.at(up(p)))) continue;
      const k = `${d}|${ns(d) ? p[2] : p[0]}|${p[1]}`;
      const row = rows.get(k) ?? rows.set(k, { d, p, us: new Set() }).get(k)!;
      row.us.add(lineCoord(d, p));
    }
  }
  const grid = site.shell.facadeGrid ?? [];
  for (const [, row] of [...rows].sort((x, y) => x[0].localeCompare(y[0]))) {
    const us = [...row.us].sort((x, y) => x - y);
    // zusammenhängende Läufe
    const runs: [number, number][] = [];
    for (const u of us) {
      const last = runs[runs.length - 1];
      if (last !== undefined && u === last[1] + 1) last[1] = u;
      else runs.push([u, u]);
    }
    const wallPlane = (ns(row.d) ? row.p[2] : row.p[0]) - (row.d === 'south' || row.d === 'east' ? 1 : -1);
    for (const [a, b] of runs) {
      if (b - a < 1) continue;
      const picks = new Set<number>([a, b]);
      if (rich) {
        for (let u = a; u <= b; u += 2) picks.add(u);
        for (let u = b; u >= a; u -= 2) picks.add(u);
      } else {
        // Pfosten des Rasters der Wand darüber bzw. darunter (Wandebene ± 1), sonst Takt 3 von der Mitte
        const posts = grid.filter((g) => g.out === row.d && Math.abs(g.plane - wallPlane) <= 1).flatMap((g) => [g.from, g.to, ...(g.studs ?? g.posts)]);
        const inRun = posts.filter((u) => u > a && u < b);
        if (inRun.length > 0) for (const u of inRun) picks.add(u);
        else for (let o = 0; 2 * o <= b - a; o += 3) [Math.floor((a + b) / 2) - o, Math.ceil((a + b) / 2) + o].forEach((u) => picks.add(u));
      }
      for (const pair of mirrorPairs(picks, a, b)) {
        const parts = pair.map((u): Part => {
          const at = atU(row.d, row.p, u);
          return { componentId, ...(mode === 'jetty' ? { variantId: stoneAbove(at) ? 'stone' : 'wood' } : {}), facing: row.d, at };
        });
        commit(site, mode === 'jetty' ? 'storey_line' : 'eave', 0, parts, () => parts.every((p) => site.solidWall(step(p.at, OPP[row.d]))));
      }
    }
  }
}

/**
 * Konsolen unter Fensterbank bzw. Blumenkasten (Obergeschosse und Giebel): unter beiden Enden der Bank-Reihe (Zellen vor
 * der Wand in der Reihe unter der Scheibe, die die Hülle als Rahmen bzw. Bank/Kasten belegt). Je Seite und Geschoss alle
 * Fenster oder keins (F6), je Fenster beide oder keine.
 */
function planSillCorbels(site: ExteriorSite, anchors: readonly ShellAnchor[]): void {
  const lines = new Map<string, ShellAnchor[]>();
  for (const a of anchors.filter((x) => x.kind === 'window' && x.floorIndex >= 1)) {
    const k = `${a.floorIndex}|${a.facing}|${planeOf(a)}`;
    (lines.get(k) ?? lines.set(k, []).get(k)!).push(a);
  }
  for (const [, line] of [...lines].sort((x, y) => x[0].localeCompare(y[0]))) {
    const entries: Part[][] = [];
    for (const a of line) {
      const along = alongOf(a.facing);
      const sill = (k: number): Vec3 => step(up(a.pos, -1), along, k);
      const held = (k: number): boolean => {
        const p = sill(k);
        const c = site.at(p);
        return site.isTaken(p) || (c !== undefined && c.kind === 'facade');
      };
      const span = a.span ?? 1;
      if (![...Array(span).keys()].every(held)) {
        entries.length = 0;
        break;
      }
      let l = 0;
      let r = span - 1;
      while (held(l - 1) && l > -2) l--;
      while (held(r + 1) && r < span + 1) r++;
      // Spiegelgleich zur Scheibe: gleich weit über beide Seiten
      const over = Math.min(-l, r - (span - 1));
      l = -over;
      r = span - 1 + over;
      const cols = l === r ? [l] : [l, r];
      // Bank aus Stein (Hüllrahmen im Gesims-Stein, Burg/Wachturm) → Steinkonsole
      const stone = [...Array(r - l + 1).keys()].some((i) => site.at(sill(l + i))?.role === 'wall_cornice');
      entries.push(cols.map((k): Part => ({ componentId: FACADE_DETAIL_COMPONENTS.sillCorbels, variantId: stone ? 'stone' : 'wood', facing: a.facing, at: up(sill(k), -1) })));
    }
    if (entries.length !== line.length || entries.length === 0) continue;
    if (!fitsAll(site, entries)) continue;
    for (let i = 0; i < line.length; i++) commit(site, 'window', line[i]!.floorIndex, entries[i]!);
  }
}

/** Passen alle Teile gemeinsam (Außenluft, frei, Wand dahinter)? */
function fitsAll(site: ExteriorSite, entries: readonly (readonly Part[])[]): boolean {
  const pending = new Set<string>();
  for (const parts of entries) {
    for (const part of parts) {
      if (!backed(site, part.at, part.facing)) return false;
      const p = site.placed(part);
      if (!site.fits(p, pending)) return false;
      for (const c of p.cells) pending.add(c.pos.join(','));
    }
  }
  return true;
}

/** Echte Giebel: Dreieck unter einem Ortgang derselben Richtung, ab 5 breit (wie W7-D). */
function realGables(anchors: readonly ShellAnchor[]): ShellAnchor[] {
  const verges = anchors.filter((a) => a.kind === 'verge');
  return anchors.filter((a) => a.kind === 'gable' && (a.span ?? 1) >= 5 && verges.some((v) => v.facing === a.facing && Math.abs(planeOf(v) - planeOf(a)) <= 3));
}

interface GableTop {
  readonly g: ShellAnchor;
  readonly mids: readonly number[];
  readonly top: number;
  readonly at: (m: number, y: number) => Vec3;
  readonly wall: (m: number, y: number) => boolean;
}

/** Oberste Giebelwandzelle mit freier Außenluft davor, gleich hoch in allen Mittelspalten. */
function gableTop(site: ExteriorSite, g: ShellAnchor): GableTop | undefined {
  const span = g.span ?? 1;
  const along = alongOf(g.facing);
  const mids = span % 2 === 1 ? [(span - 1) / 2] : [span / 2 - 1, span / 2];
  const at = (m: number, y: number): Vec3 => [g.pos[0] + (along === 'east' ? m : 0), y, g.pos[2] + (along === 'south' ? m : 0)];
  const wall = (m: number, y: number): boolean => site.solidWall(step(at(m, y), OPP[g.facing]));
  const tops = mids.map((m) => {
    let top: number | undefined;
    for (let y = g.pos[1]; y <= g.pos[1] + 24; y++) if (wall(m, y) && site.outside(at(m, y))) top = y;
    return top;
  });
  if (tops.some((t) => t === undefined) || new Set(tops).size !== 1) return undefined;
  return { g, mids, top: tops[0]!, at, wall };
}

/** Hängezapfen: Zaun vor der obersten Giebelwandzelle unter dem Überstand des Firsts (reich mit Laterne darunter). */
function planGablePendants(site: ExteriorSite, gables: readonly ShellAnchor[], rich: boolean): void {
  for (const g of gables) {
    const t = gableTop(site, g);
    if (t === undefined) continue;
    const cells = t.mids.map((m) => t.at(m, t.top));
    if (!cells.every((c) => site.at(up(c))?.kind === 'roof')) continue;
    const variants = rich && t.mids.length === 1 ? ['lantern', 'post'] : ['post'];
    for (const v of variants) {
      const parts = cells.map((c): Part => ({ componentId: FACADE_DETAIL_COMPONENTS.gablePendant, variantId: v, facing: g.facing, local: v === 'lantern' ? [0, 1, 0] : [0, 0, 0], at: c }));
      if (commit(site, 'gable', g.floorIndex, parts).length > 0) break;
    }
  }
}

/**
 * Giebelbanner: in der Mittelachse (gerade Breite: Paar neben den Mittelspalten) an der untersten Stelle des Giebels mit
 * Wand hinter Tuch und Stange (Hauszeichen über dem Kniestock), höchstens bis zwei Lagen unter der Spitze.
 */
function planGableBanners(site: ExteriorSite, gables: readonly ShellAnchor[]): void {
  for (const g of gables) {
    const t = gableTop(site, g);
    if (t === undefined) continue;
    const cols = t.mids.length === 1 ? t.mids : [t.mids[0]! - 1, t.mids[1]! + 1];
    for (let y = g.pos[1] + 2; y <= t.top - 2; y++) {
      if (!cols.every((m) => t.wall(m, y) && t.wall(m, y - 1))) continue;
      const parts = cols.map((m): Part => ({ componentId: FACADE_DETAIL_COMPONENTS.gableBanner, facing: g.facing, local: [0, 1, 0], at: t.at(m, y) }));
      if (commit(site, 'gable', g.floorIndex, parts).length > 0) break;
    }
  }
}

/** Türgruppen: nebeneinanderliegende Türanker gleicher Richtung, Ebene und Höhe (Doppeltür = eine Gruppe). */
function doorGroups(doors: readonly ShellAnchor[]): { a: ShellAnchor; from: number; to: number }[] {
  const out: { a: ShellAnchor; from: number; to: number }[] = [];
  const sorted = [...doors].sort((p, q) => p.facing.localeCompare(q.facing) || planeOf(p) - planeOf(q) || p.pos[1] - q.pos[1] || lineCoord(p.facing, p.pos) - lineCoord(q.facing, q.pos));
  for (const a of sorted) {
    const u = lineCoord(a.facing, a.pos);
    const last = out[out.length - 1];
    if (last !== undefined && last.a.facing === a.facing && planeOf(last.a) === planeOf(a) && last.a.pos[1] === a.pos[1] && u === last.to + 1) last.to = u;
    else out.push({ a, from: u, to: u });
  }
  return out;
}

/** Paar links/rechts einer Türgruppe im Abstand k auf Türhöhe (vor der Wand). */
const doorSides = (grp: { a: ShellAnchor; from: number; to: number }, k: number): [Vec3, Vec3] =>
  [atU(grp.a.facing, grp.a.pos, grp.from - k), atU(grp.a.facing, grp.a.pos, grp.to + k)];

function signTypes(style: ExteriorStyle): ReadonlySet<string> {
  return new Set(style.signRoomTypes ?? DEFAULT_SIGN_ROOM_TYPES);
}

const roomTypeOf = (a: ShellAnchor, opts: FacadeDetailOptions): string | undefined => (a.roomId !== undefined ? opts.roomTypes?.[a.roomId] : undefined);

/** Auslage: ein Regalpaar neben der Tür eines Ladens bzw. einer Werkstatt (Abstand 2–4, erstes freies Paar). */
function planShopShelves(site: ExteriorSite, catalog: Catalog, doors: readonly ShellAnchor[], style: ExteriorStyle, opts: FacadeDetailOptions): void {
  const def = catalog.find(FACADE_DETAIL_COMPONENTS.shopShelves);
  if (def === undefined) return;
  const shelf = (opts.dataVersion ?? 0) >= variantMinVersion(def, 'shelf');
  const types = signTypes(style);
  for (const grp of doorGroups(doors)) {
    const rt = roomTypeOf(grp.a, opts);
    if (rt === undefined || !types.has(rt)) continue;
    for (const k of [2, 3, 4]) {
      const parts = doorSides(grp, k).map((at): Part => ({ componentId: def.id, variantId: shelf ? 'shelf' : 'crate', facing: grp.a.facing, at }));
      if (commit(site, 'door', grp.a.floorIndex, parts, () => parts.every((p) => site.solidWall(step(p.at, OPP[p.facing])))).length > 0) break;
    }
  }
}

/** Kram am Eingang: Fass- bzw. Heuballenpaar neben Nebentüren (reich auch an der Haustür), Abstand 1–4. */
function planEntranceGoods(
  site: ExteriorSite, catalog: Catalog, doors: readonly ShellAnchor[], style: ExteriorStyle, opts: FacadeDetailOptions, rich: boolean,
): void {
  const def = catalog.find(FACADE_DETAIL_COMPONENTS.entranceGoods);
  if (def === undefined) return;
  const hay = opts.themeId !== undefined && def.tags.includes(`hay:${opts.themeId}`);
  const types = signTypes(style);
  for (const grp of doorGroups(doors)) {
    if (grp.a.floorIndex !== Math.min(...doors.map((x) => x.floorIndex))) continue;
    const main = opts.isMain(grp.a);
    if (main && !rich) continue;
    const rt = roomTypeOf(grp.a, opts);
    if (rt !== undefined && types.has(rt) && main) continue;
    for (const k of main ? [2, 3, 4] : [1, 2, 3]) {
      const parts = doorSides(grp, k).map((at): Part => ({ componentId: def.id, variantId: hay ? 'hay' : 'barrel', facing: grp.a.facing, at }));
      if (commit(site, 'door', grp.a.floorIndex, parts, () => parts.every((p) => site.solidWall(step(p.at, OPP[p.facing])))).length > 0) break;
    }
  }
}

/** Regentonnen: an beiden Enden der Wand mit der Haustür (Zelle vor der Endspalte, Fußhöhe), beide oder keine. */
function planRainBarrels(site: ExteriorSite, anchors: readonly ShellAnchor[], mainDoors: readonly ShellAnchor[]): void {
  const corners = anchors.filter((a) => a.kind === 'corner');
  if (corners.length === 0) return;
  const lowest = Math.min(...corners.map((a) => a.floorIndex));
  const done = new Set<string>();
  for (const door of mainDoors) {
    const f = door.facing;
    const row = planeOf(door);
    const k = `${f}|${row}`;
    if (done.has(k)) continue;
    done.add(k);
    const ends = corners.filter((c) => c.floorIndex === lowest && (c.facing === f || CW[c.facing] === f) && (ns(f) ? c.pos[2] : c.pos[0]) === row)
      .map((c) => step(c.pos, OPP[c.facing === f ? CW[f] : c.facing]));
    if (ends.length !== 2) continue;
    const [p, q] = ends.sort((x, y) => lineCoord(f, x) - lineCoord(f, y));
    // nur, wo die Tür etwa mittig liegt (spiegelgleiche Front)
    if (Math.abs(lineCoord(f, p!) + lineCoord(f, q!) - 2 * lineCoord(f, door.pos)) > 2) continue;
    const parts = [p!, q!].map((at): Part => ({ componentId: FACADE_DETAIL_COMPONENTS.rainBarrels, facing: f, at }));
    commit(site, 'corner', lowest, parts, () => parts.every((x) => site.solidWall(step(x.at, OPP[f]))));
  }
}

/**
 * Holzstapel: mittig vor einer Linie des untersten Fassadenrasters ohne Haustür (ungerade Breite, Mitte ± 1 frei, Wand
 * dahinter in beiden Lagen); dezent einer je Gebäude (längste Linie zuerst), reich einer je Seite.
 */
function planWoodStacks(site: ExteriorSite, mainDoors: readonly ShellAnchor[], rich: boolean): void {
  const grid = site.shell.facadeGrid ?? [];
  if (grid.length === 0) return;
  const lowest = Math.min(...grid.map((g) => g.y0));
  const mainSides = new Set(mainDoors.map((d) => `${d.facing}|${(ns(d.facing) ? d.pos[2] : d.pos[0]) - (d.facing === 'south' || d.facing === 'east' ? 1 : -1)}`));
  const lines = grid.filter((g) => g.y0 === lowest && (g.from + g.to) % 2 === 0 && g.to - g.from >= 4 && !mainSides.has(`${g.out}|${g.plane}`))
    .sort((p, q) => (q.to - q.from) - (p.to - p.from) || `${p.out}|${p.plane}`.localeCompare(`${q.out}|${q.plane}`));
  for (const g of lines) {
    const c = (g.from + g.to) / 2;
    const front = (u: number, y: number): Vec3 => (ns(g.out) ? [u, y, g.plane + (g.out === 'south' ? 1 : -1)] : [g.plane + (g.out === 'east' ? 1 : -1), y, u]);
    const baseY = g.y0 + 1;
    const part: Part = { componentId: FACADE_DETAIL_COMPONENTS.woodStack, facing: g.out, local: [1, 0, 0], at: front(c, baseY) };
    const ok = commit(site, 'plinth', g.floorIndex, [part], () => [c - 1, c, c + 1].every((u) => [0, 1].every((h) => site.solidWall(step(front(u, baseY + h), OPP[g.out])))));
    if (ok.length > 0 && !rich) return;
  }
}
