/**
 * EXT (28.09.2026, plan/spikes/EXT_fassade.md): die Stufe `grand` der Fassaden-Details. Sie schließt die bis dahin nie
 * aufgerufenen Außen-Komponenten des Katalogs an den Außen-Planer an (FN-Maßnahmen M1, M3, M5):
 *  - Balkon und Erker vor dem mittleren Fenster des ersten Obergeschosses (M1),
 *  - Geschossband an den Geschossgrenzen ohne Gesims und Verdachung über den Fenstern (M3),
 *  - Strebepfeiler an Steinwänden, Wetterfahne und Glockentürmchen auf dem First, Rankgitter und Taubenschlag (M5, Bauernhaus),
 *  - EXT2 (29.09.2026): Wandrelief am Fuß der Fassade (`detail-relief.ts`: Sockelabsatz, Wandpfeiler, Blindfenster, Regenfallrohr).
 *    Nicht verdrahtet bleiben `corner_turret` (braucht einen Hüllenanbau, kollidiert mit Traufe und Dach) und `roof_dormer_blind`
 *    (die Hülle baut echte Gauben).
 *
 * Es gelten die Regeln von `detail.ts`: nur freie Außenluft, nie vor Scheiben (`view`) und im Laufweg (`walk`) – Ausnahme
 * Erker, dessen Glas vor der Scheibe steht (`viewOk`) –, Halt an einer Wand, spiegelsymmetrisch je Seite (Paare ganz oder
 * gar nicht, Einzelstücke nur in der Mittelachse), deterministisch ohne Zufall. Ohne die Stufe wird nichts davon aufgerufen.
 */
import type { ShellAnchor, ShellAnchorKind } from '@mcda/blueprint';
import type { HorizontalDir, Vec3 } from '@mcda/core';
import { OPP, alongOf, step, type ExteriorSite, type Part } from './site.js';
import type { FacadeDetailPattern } from './types.js';

/** Katalog-Komponente je Muster der Stufe `grand`. */
export const GRAND_COMPONENTS = {
  balcony: 'exterior/balcony',
  orielWindow: 'exterior/oriel_window',
  windowHoods: 'exterior/window_hood',
  stringCourse: 'exterior/string_course',
  buttress: 'exterior/buttress',
  weathervane: 'exterior/weathervane',
  bellTurret: 'exterior/bell_turret',
  trellis: 'exterior/trellis',
  dovecote: 'exterior/dovecote',
  // EXT2: Wandrelief (detail-relief.ts)
  plinthLedge: 'exterior/detail_plinth_ledge',
  pilasters: 'exterior/arcade_pier',
  blindArch: 'exterior/window_frame_arch',
  downspout: 'exterior/detail_downspout',
} as const satisfies Partial<Record<FacadeDetailPattern, string>>;

/** Werkzeuge aus `detail.ts` (gemeinsame Setzregeln), damit diese Datei nicht von ihr abhängt. */
export interface GrandKit {
  readonly site: ExteriorSite;
  readonly act: (pattern: FacadeDetailPattern) => boolean;
  readonly commit: (
    anchor: ShellAnchorKind, floorIndex: number, parts: readonly Part[], extra?: () => boolean, opts?: { readonly roof?: boolean; readonly viewOk?: boolean },
  ) => readonly unknown[];
  readonly backed: (p: Vec3, out: HorizontalDir) => boolean;
  readonly fitsAll: (entries: readonly (readonly Part[])[]) => boolean;
  readonly mirrorPairs: (picks: Iterable<number>, a: number, b: number) => number[][];
}

const DIRS: readonly HorizontalDir[] = ['north', 'east', 'south', 'west'];
const ns = (d: HorizontalDir): boolean => d === 'north' || d === 'south';
const planeOf = (a: Pick<ShellAnchor, 'pos' | 'facing'>): number => (ns(a.facing) ? a.pos[2] : a.pos[0]);
const lineCoord = (d: HorizontalDir, p: Vec3): number => (ns(d) ? p[0] : p[2]);
const atU = (d: HorizontalDir, p: Vec3, u: number): Vec3 => (ns(d) ? [u, p[1], p[2]] : [p[0], p[1], u]);

/** Fensterreihen (Richtung, Wandebene, Geschoss, Höhe) der Geschosse ab `minFloor`, in fester Reihenfolge. */
function windowLines(anchors: readonly ShellAnchor[], minFloor: number): ShellAnchor[][] {
  const lines = new Map<string, ShellAnchor[]>();
  for (const a of anchors) {
    if (a.kind !== 'window' || a.floorIndex < minFloor) continue;
    const k = `${a.floorIndex}|${a.facing}|${planeOf(a)}|${a.pos[1]}`;
    (lines.get(k) ?? lines.set(k, []).get(k)!).push(a);
  }
  return [...lines].sort((p, q) => p[0].localeCompare(q[0], undefined, { numeric: true })).map(([, l]) => l.sort((p, q) => lineCoord(p.facing, p.pos) - lineCoord(q.facing, q.pos)));
}

/** Mittleres Fenster einer Reihe mit ungerader Anzahl gleich breiter, spiegelgleich verteilter Fenster (sonst nichts). */
function midWindow(line: readonly ShellAnchor[]): ShellAnchor | undefined {
  const n = line.length;
  if (n % 2 === 0) return undefined;
  const span = line[0]!.span ?? 1;
  if (span % 2 === 0 || line.some((a) => (a.span ?? 1) !== span)) return undefined;
  const us = line.map((a) => lineCoord(a.facing, a.pos));
  for (let i = 0; i < n; i++) if (us[i]! + us[n - 1 - i]! !== us[0]! + us[n - 1]!) return undefined;
  return line[(n - 1) / 2];
}

const alongCell = (a: ShellAnchor, k: number): Vec3 => step(a.pos, alongOf(a.facing), k);

/** Balkon: vor dem mittleren Fenster des ersten Obergeschosses der Eingangsseite, Boden auf der Geschossplatte (sonst auf Bankhöhe). */
function planBalconies(kit: GrandKit, anchors: readonly ShellAnchor[], mainDoors: readonly ShellAnchor[]): void {
  const { site } = kit;
  const lines = windowLines(anchors, 1);
  if (lines.length === 0) return;
  const first = Math.min(...lines.map((l) => l[0]!.floorIndex));
  const front = new Set(mainDoors.map((d) => d.facing));
  for (const line of lines) {
    const m = midWindow(line);
    if (m === undefined || m.floorIndex !== first || !front.has(m.facing)) continue;
    const level = site.levelOf(m.floorIndex, m.pos);
    if (level === undefined) continue;
    const centre = lineCoord(m.facing, m.pos) + ((m.span ?? 1) - 1) / 2;
    for (const fy of [level.y0 + 1, level.y0]) {
      const at = atU(m.facing, [m.pos[0], fy, m.pos[2]], centre);
      const cols = [-1, 0, 1].map((k) => atU(m.facing, at, centre + k));
      const ok = kit.commit('window', m.floorIndex, [{ componentId: GRAND_COMPONENTS.balcony, facing: m.facing, local: [1, 1, 0], at }], () => cols.every((c) => kit.backed(c, m.facing)));
      if (ok.length > 0) break;
    }
    return;
  }
}

/** Erker: auf Konsolen vor dem mittleren Fenster des ersten Obergeschosses der Seiten ohne Balkon; hoch (Glas in Fensterhöhe, Dach darüber), sonst niedrig. */
function planOriels(kit: GrandKit, anchors: readonly ShellAnchor[], mainDoors: readonly ShellAnchor[]): void {
  const { site } = kit;
  const lines = windowLines(anchors, 1);
  if (lines.length === 0) return;
  const first = Math.min(...lines.map((l) => l[0]!.floorIndex));
  const front = new Set(mainDoors.map((d) => d.facing));
  const done = new Set<string>();
  for (const line of lines) {
    const m = midWindow(line);
    if (m === undefined || m.floorIndex !== first || line.length < 3 || (span(m) !== 1)) continue;
    const side = `${m.facing}|${planeOf(m)}`;
    if (done.has(side) || (front.has(m.facing) && site.placements.some((p) => p.componentId === GRAND_COMPONENTS.balcony))) continue;
    const sillY = m.pos[1] - 1;
    for (const v of [undefined, 'short'] as const) {
      const at: Vec3 = [m.pos[0], sillY, m.pos[2]];
      const cols = [-1, 0, 1].map((k) => alongCell(m, k));
      const ok = kit.commit(
        'window', m.floorIndex,
        [{ componentId: GRAND_COMPONENTS.orielWindow, ...(v !== undefined ? { variantId: v } : {}), facing: m.facing, local: [1, 0, 0], at }],
        () => cols.every((c) => kit.backed([c[0], sillY, c[2]], m.facing)),
        { viewOk: true },
      );
      if (ok.length > 0) {
        done.add(side);
        break;
      }
    }
  }
}
const span = (a: ShellAnchor): number => a.span ?? 1;

/**
 * Geschossband: an der Geschossplatte jedes Obergeschosses, wo die Hülle kein Gesims zeigt (Spalten davor frei), als
 * Spiegelpaare je Lauf. Turmartige Bauten (bis 9 breit, ab 3 Geschosse) bekommen nur ein Band in halber Höhe.
 */
function planStringCourses(kit: GrandKit): void {
  const { site } = kit;
  const floors = [...site.levels.values()].filter((l) => l.index >= 1).sort((p, q) => p.index - q.index);
  if (floors.length === 0) return;
  const b = site.shell.cells.reduce((acc, c) => ({ x0: Math.min(acc.x0, c.pos[0]), x1: Math.max(acc.x1, c.pos[0]), z0: Math.min(acc.z0, c.pos[2]), z1: Math.max(acc.z1, c.pos[2]) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
  const towerLike = floors.length >= 2 && Math.max(b.x1 - b.x0, b.z1 - b.z0) + 1 <= 9;
  const chosen = towerLike ? [floors[Math.ceil(floors.length / 2) - 1]!] : floors;
  for (const level of chosen) {
    const rows = new Map<string, { d: HorizontalDir; p: Vec3; us: Set<number> }>();
    for (const c of site.shell.cells) {
      if (c.pos[1] !== level.y0 || !(c.kind === 'floor' || c.kind === 'wall' || c.kind === 'pillar')) continue;
      for (const d of DIRS) {
        const p = step(c.pos, d);
        if (!site.outside(p) || site.overRoof(p) || site.isTaken(p)) continue;
        // die Außenwand darüber muss stehen (kein Freiraum über der Platte, sonst hinge das Band an nichts)
        if (!kit.backed(p, d)) continue;
        const k = `${d}|${ns(d) ? p[2] : p[0]}`;
        const row = rows.get(k) ?? rows.set(k, { d, p, us: new Set() }).get(k)!;
        row.us.add(lineCoord(d, p));
      }
    }
    for (const [, row] of [...rows].sort((x, y) => x[0].localeCompare(y[0]))) {
      const us = [...row.us].sort((x, y) => x - y);
      const runs: [number, number][] = [];
      for (const u of us) {
        const last = runs[runs.length - 1];
        if (last !== undefined && u === last[1] + 1) last[1] = u;
        else runs.push([u, u]);
      }
      for (const [a, z] of runs) {
        if (z - a < 2) continue;
        for (const pair of kit.mirrorPairs(us.filter((u) => u >= a && u <= z), a, z)) {
          const parts = pair.map((u): Part => ({ componentId: GRAND_COMPONENTS.stringCourse, variantId: 'band', facing: row.d, at: atU(row.d, row.p, u) }));
          kit.commit('storey_line', level.index, parts, () => parts.every((p) => kit.backed(p.at, row.d)));
        }
      }
    }
  }
}

/** Oberste Scheibenlage eines Fensters (Scheiben übereinander hinter der Ankerzelle). */
function topPane(site: ExteriorSite, a: ShellAnchor): number {
  let y = a.pos[1];
  while (site.at(step([a.pos[0], y + 1, a.pos[2]], OPP[a.facing]))?.kind === 'window') y++;
  return y;
}

/**
 * Verdachung: eine Lage über der obersten Scheibe, je Fenster einen Streifen (eins breiter je Seite, wenn die Nachbarfenster
 * Platz lassen). Je Reihe alle Fenster oder keins; unter einer Traufe (Dachzelle dort) entfällt sie von selbst.
 */
function planWindowHoods(kit: GrandKit, anchors: readonly ShellAnchor[]): void {
  const { site } = kit;
  for (const line of windowLines(anchors, 0)) {
    if (line.length === 0) continue;
    const us = line.map((a) => lineCoord(a.facing, a.pos));
    const w = span(line[0]!);
    const gaps = us.slice(1).map((u, i) => u - us[i]!);
    const wide = gaps.length === 0 || Math.min(...gaps) >= w + 3;
    const entries = line.map((a) => {
      const y = topPane(site, a) + 1;
      const cols = wide ? [-1, ...Array.from({ length: w }, (_, i) => i), w] : Array.from({ length: w }, (_, i) => i);
      return cols.map((k): Part => ({ componentId: GRAND_COMPONENTS.windowHoods, variantId: 'stairs', facing: a.facing, at: ((c) => [c[0], y, c[2]] as Vec3)(alongCell(a, k)) }));
    });
    if (!kit.fitsAll(entries)) continue;
    for (let i = 0; i < line.length; i++) kit.commit('window', line[i]!.floorIndex, entries[i]!);
  }
}

/** Ein Firstpunkt: Zelle über dem First, auf der Dachzelle stehend und quer dazu abfallend (einreihiger First). */
function ridgeSpot(site: ExteriorSite, r: ShellAnchor, k: number): Vec3 | undefined {
  const alongX = r.facing === 'south';
  const p: Vec3 = alongX ? [r.pos[0] + k, r.pos[1], r.pos[2]] : [r.pos[0], r.pos[1], r.pos[2] + k];
  const below = site.at([p[0], p[1] - 1, p[2]]);
  if (below === undefined || below.kind !== 'roof' || site.top(p[0], p[2]) !== p[1] - 1) return undefined;
  const side = alongX ? ([[0, 0, -1], [0, 0, 1]] as const) : ([[-1, 0, 0], [1, 0, 0]] as const);
  if (side.some((s) => site.top(p[0] + s[0], p[2] + s[2]) >= p[1] - 1)) return undefined;
  return p;
}

/**
 * Wetterfahne und Glockentürmchen auf dem First: das Türmchen mittig auf dem längsten einreihigen First ab 9 Zellen,
 * die Wetterfahne nur auf Firstpunkten von einer Zelle (Turmspitzen, Pyramidendächer).
 */
function planRidgeTops(kit: GrandKit, anchors: readonly ShellAnchor[]): void {
  const { site } = kit;
  const ridges = anchors.filter((a) => a.kind === 'ridge' && (a.span ?? 1) % 2 === 1)
    .sort((p, q) => (q.span ?? 1) - (p.span ?? 1) || p.pos[0] - q.pos[0] || p.pos[2] - q.pos[2] || p.pos[1] - q.pos[1]);
  let bell = false;
  for (const [i, r] of ridges.entries()) {
    const mid = ((r.span ?? 1) - 1) / 2;
    const c = ridgeSpot(site, r, mid);
    if (c === undefined) continue;
    const alongX = r.facing === 'south';
    if (i === 0 && (r.span ?? 1) >= 11 && kit.act('bellTurret')) {
      const cells = [-1, 0, 1].map((k) => ridgeSpot(site, r, mid + k));
      if (cells.every((x) => x !== undefined)) {
        // die Breite der Komponente (x) läuft entlang des Firsts: Front Süden (x → Osten) bzw. Westen (x → Süden)
        const ok = kit.commit('ridge', r.floorIndex, [{ componentId: GRAND_COMPONENTS.bellTurret, variantId: 'ridge', facing: alongX ? 'south' : 'west', local: [1, 0, 0], at: c }], undefined, { roof: true });
        if (ok.length > 0) {
          bell = true;
          continue;
        }
      }
    }
    // Fahne nur auf der Spitze (Turm, Pyramide): auf langen Firsten wirkt ein Mast wie eine Antenne
    if (!kit.act('weathervane') || (r.span ?? 1) !== 1 || (i === 0 && bell)) continue;
    kit.commit('ridge', r.floorIndex, [{ componentId: GRAND_COMPONENTS.weathervane, variantId: 'vane', facing: r.facing, at: c }], undefined, { roof: true });
  }
}

/** Linien des untersten Fassadenrasters ohne Haustür, längste zuerst; `front` = Zelle vor der Wand in Laufkoordinate `u`, Höhe `y`. */
export function groundLines(site: ExteriorSite, mainDoors: readonly ShellAnchor[]) {
  const grid = site.shell.facadeGrid ?? [];
  const lowest = grid.length === 0 ? 0 : Math.min(...grid.map((g) => g.y0));
  const mainSides = new Set(mainDoors.map((d) => `${d.facing}|${planeOf(d) - (d.facing === 'south' || d.facing === 'east' ? 1 : -1)}`));
  const lines = grid.filter((g) => g.y0 === lowest && !mainSides.has(`${g.out}|${g.plane}`))
    .sort((p, q) => (q.to - q.from) - (p.to - p.from) || `${p.out}|${p.plane}`.localeCompare(`${q.out}|${q.plane}`));
  const front = (out: HorizontalDir, plane: number, u: number, y: number): Vec3 => (ns(out) ? [u, y, plane + (out === 'south' ? 1 : -1)] : [plane + (out === 'east' ? 1 : -1), y, u]);
  return { lines, lowest, front };
}

/**
 * Strebepfeiler an Steinwänden des Erdgeschosses (Fuß auf Geländehöhe, vor der Sockelreihe der Hülle): Paare zwischen den Fenstern,
 * von den Ecken nach innen im Mindestabstand 5, höchstens 3 Paare je Wand; nur wo die Wand dahinter 3 Zellen hoch geschlossen ist.
 * Nicht an der Eingangsseite.
 */
function planButtresses(kit: GrandKit, mainDoors: readonly ShellAnchor[]): void {
  const { site } = kit;
  const { lines, lowest, front } = groundLines(site, mainDoors);
  for (const g of lines) {
    const len = g.to - g.from + 1;
    if (len < 7) continue;
    const a = g.from + 1;
    const b = g.to - 1;
    const solid = (u: number): boolean => [1, 2, 3].every((h) => site.solidWall(step(front(g.out, g.plane, u, lowest + h), OPP[g.out])));
    const chosen: number[] = [];
    let pairs = 0;
    for (let u = a; u <= (a + b) / 2 && pairs < 3; u++) {
      const m = a + b - u;
      if (chosen.some((c) => Math.abs(c - u) < 5) || !solid(u) || !solid(m)) continue;
      // die Nachbarspalten hinter dem Pfeiler bleiben Wand (kein Fenster daneben, das er verdeckte)
      if (![u - 1, u + 1, m - 1, m + 1].every(solid)) continue;
      const list = u === m ? [u] : [u, m];
      const parts = list.map((x): Part => ({ componentId: GRAND_COMPONENTS.buttress, variantId: 'plinth', facing: g.out, local: [0, 1, 0], at: front(g.out, g.plane, x, lowest + 1) }));
      if (kit.commit('plinth', g.floorIndex, parts).length > 0) {
        chosen.push(...list);
        pairs++;
      }
    }
  }
}

/**
 * Rankgitter und Taubenschlag an fensterlosen Wandstücken des Erdgeschosses (Seite ohne Haustür): das Gitter als Spiegelpaar,
 * der Schlag einzeln in der Wandmitte (sonst entfällt er); drei Spalten hinter dem Teil sind geschlossene Wand.
 */
function planFarmDetails(kit: GrandKit, mainDoors: readonly ShellAnchor[]): void {
  const { site } = kit;
  const { lines, lowest, front } = groundLines(site, mainDoors);
  // Der Sockel (Fassadenzellen) kann ein bis zwei Reihen hoch sein: das Gitter steht auf dem ersten freien Stand darüber.
  const bases = [lowest + 1, lowest + 2, lowest + 3];
  const behind = (g: { out: HorizontalDir; plane: number }, u: number, y: number): boolean => site.solidWall(step(front(g.out, g.plane, u, y), OPP[g.out]));
  let trellis = kit.act('trellis');
  let dove = kit.act('dovecote');
  for (const g of lines) {
    if (g.to - g.from < 6) continue;
    const a = g.from;
    const b = g.to;
    const wall = (u: number, y: number, rows: number): boolean => [u - 1, u, u + 1].every((x) => Array.from({ length: rows }, (_, h) => h).every((h) => behind(g, x, y + h)));
    for (const baseY of bases) {
      if (trellis) {
        for (let u = a + 1; 2 * u <= a + b && trellis; u++) {
          const m = a + b - u;
          if (!wall(u, baseY, 3) || !wall(m, baseY, 3)) continue;
          const parts = (u === m ? [u] : [u, m]).map((x): Part => ({ componentId: GRAND_COMPONENTS.trellis, facing: g.out, local: [1, 0, 0], at: front(g.out, g.plane, x, baseY) }));
          if (kit.commit('plinth', g.floorIndex, parts).length > 0) trellis = false;
        }
      }
      if (dove && (g.from + g.to) % 2 === 0) {
        const c = (g.from + g.to) / 2;
        const part: Part = { componentId: GRAND_COMPONENTS.dovecote, facing: g.out, local: [0, 0, 0], at: front(g.out, g.plane, c, baseY) };
        if (kit.commit('plinth', g.floorIndex, [part], () => [0, 1, 2, 3].every((h) => behind(g, c, baseY + h))).length > 0) dove = false;
      }
    }
  }
}

export interface GrandOptions {
  readonly mainDoors: readonly ShellAnchor[];
}

/** Vor den Fenstermodulen (sie belegen sonst Bank und Seiten des mittleren Fensters): Balkon und Erker. */
export function planGrandFront(kit: GrandKit, anchors: readonly ShellAnchor[], o: GrandOptions): void {
  if (kit.act('balcony')) planBalconies(kit, anchors, o.mainDoors);
  if (kit.act('orielWindow')) planOriels(kit, anchors, o.mainDoors);
}

/** Oberes: Geschossband, Verdachung, Wetterfahne und Glockentürmchen (auch bei Erdhäusern, ohne Bodennahes). */
export function planGrandUpper(kit: GrandKit, anchors: readonly ShellAnchor[], _o: GrandOptions): void {
  if (kit.act('stringCourse')) planStringCourses(kit);
  if (kit.act('windowHoods')) planWindowHoods(kit, anchors);
  if (kit.act('weathervane') || kit.act('bellTurret')) planRidgeTops(kit, anchors);
}

/** Bodennahes: Strebepfeiler, Rankgitter, Taubenschlag. */
export function planGrandGround(kit: GrandKit, o: GrandOptions): void {
  if (kit.act('buttress')) planButtresses(kit, o.mainDoors);
  // Rankgitter und Taubenschlag gehören an niedrige Häuser, nicht an Türme und Burgen
  if ((kit.act('trellis') || kit.act('dovecote')) && kit.site.levels.size <= 2) planFarmDetails(kit, o.mainDoors);
}
