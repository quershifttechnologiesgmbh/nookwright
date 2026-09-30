/**
 * Grundstücks-Module (W3-GA, Baustandard G1 „wenig, gezielt“; Bericht plan/spikes/W3GA_grundstueck.md): feste
 * Bausteine mit **Bezug** statt Streuung über die Fläche.
 *  - **Sichtfelder** (`facadeBands`): die Streifen vor Haupt- und Seitenfassaden bis zum Grundstücksrand bleiben frei
 *    von Bäumen, Findlingen und Gehölz – Fassaden und der Weg zur Tür sind lesbar; Bäume stehen an den Hausecken,
 *    dahinter und am Rand.
 *  - **Baumgruppe** (`planTreeGroups`): 2–3 Bäume einer Art im Randband des Grundstücks, bevorzugt an den Ecken
 *    hinter dem Haus, Gruppen weit auseinander, höchstens zwei Arten je Grundstück; Unterholz (Busch) am Kronenrand
 *    setzt der Generator.
 *  - **Straßenzaun** (`buildStreetFence`): Zaunlinie an der Straßenseite mit Tor genau über dem Hauptweg.
 * Rein und deterministisch (Seed), arbeitet auf dem Arbeitszustand `Gen`.
 */
import { Rng, hashSeed, type HorizontalDir, type Vec3 } from '@mcda/core';
import type { BuildingInfo } from './building.js';
import { C, type Gen } from './gen.js';
import { postKind, slimPost, stubPost } from './fences.js';
import { DIR_OFFSET } from './grid.js';
import { TREE_SPECIES, type TreeSpecies } from './style.js';

/** Haupttür wie die Zufahrt (`generateSite`): nach Süden, sonst die erste. */
export function mainDoor(g: Gen): BuildingInfo['doors'][number] | undefined {
  return g.building.doors.find((d) => d.outward === 'south') ?? g.building.doors[0];
}

/**
 * Sichtfelder der Fassaden: 1 = vor der Haupt- oder einer Seitenfassade (quer innerhalb der Hausbreite ± `margin`,
 * bis zum Grundstücksrand), 2 = hinter dem Haus (Rückseite gegenüber der Haustür), 0 = diagonal vor den Hausecken.
 * Bäume stehen an den Ecken und hinter dem Haus, nie vor einer Fassade mit Fenstern (Vorbilder: Hausbaum an der
 * Ecke, Gehölz am Rand, Fassaden frei). Ohne Haustür gilt jede Seite als Seitenfassade.
 */
export function facadeBands(g: Gen, margin = 4, sight?: number): Uint8Array {
  const { grid } = g;
  const band = new Uint8Array(grid.size);
  // Baukörper samt Mauerring (Burg: Bauwerke mit Tordurchgang sind die Fassade nach außen; eine freistehende
  // Windmühle zählt nicht)
  let foot = g.building.footprint.union(g.building.covered).bounds();
  if (foot === undefined) return band;
  const walled = g.struct.includes(2);
  for (let i = 0; i < grid.size && walled; i++) {
    if (g.struct[i] !== 1) continue;
    const x = grid.x(i);
    const z = grid.z(i);
    foot = { minX: Math.min(foot.minX, x), minZ: Math.min(foot.minZ, z), maxX: Math.max(foot.maxX, x), maxZ: Math.max(foot.maxZ, z) };
  }
  const door = mainDoor(g);
  const back = door === undefined ? undefined : ({ north: 'south', south: 'north', east: 'west', west: 'east' } as const)[door.outward];
  for (let i = 0; i < grid.size; i++) {
    const x = grid.x(i);
    const z = grid.z(i);
    const inX = x >= foot.minX - margin && x <= foot.maxX + margin;
    const inZ = z >= foot.minZ - margin && z <= foot.maxZ + margin;
    const side = inX && z < foot.minZ ? 'north' : inX && z > foot.maxZ ? 'south' : inZ && x < foot.minX ? 'west' : inZ && x > foot.maxX ? 'east' : undefined;
    if (side === undefined) continue;
    band[i] = side === back ? 2 : 1;
  }
  // W12-C (Review R6-4 „Birke vor dem Wohnhaus“): Sichtkeil vor der Haustür – von dort aus sieht man den Eingang
  // (Kamera der ersten Ansicht: Schwenk ≤ 50° aus der Türachse). Keine Bäume, Findlinge und Gehölz im Keil
  // (Halbwinkel `sight`, Grad; Breite an der Tür ± `margin`), auch nicht diagonal vor den Hausecken. Landschaftsbau:
  // Bäume rahmen den Eingang seitlich, nie davor (homedit.com front yard landscape ideas).
  const entry = sight === undefined ? undefined : g.building.doors.find((d) => d.main === true) ?? door;
  if (entry !== undefined && sight !== undefined) {
    const [fx, fz] = DIR_OFFSET[entry.outward];
    const tan = Math.tan((sight * Math.PI) / 180);
    for (let i = 0; i < grid.size; i++) {
      if (band[i] === 2) continue;
      const dx = grid.x(i) - entry.cell[0];
      const dz = grid.z(i) - entry.cell[1];
      const v = dx * fx + dz * fz;
      const u = Math.abs(dx * fz - dz * fx);
      if (v >= 1 && u <= margin + v * tan) band[i] = 1;
    }
  }
  return band;
}

/** Abstand zum Grundstücksrand (0 = Randspalte). */
export function borderDist(g: Gen, i: number): number {
  const { grid } = g;
  const x = grid.x(i) - grid.minX;
  const z = grid.z(i) - grid.minZ;
  return Math.min(x, z, grid.w - 1 - x, grid.d - 1 - z);
}

export interface TreeGroupOptions {
  readonly size: readonly [number, number];
  readonly every: number;
  readonly rim: readonly [number, number];
  readonly spacing: number;
  readonly species: Partial<Record<TreeSpecies, number>>;
  /** W4-A: höchstens so viele Bäume; eine Gruppe beginnt nur, wenn noch `size[0]` Platz haben. */
  readonly max?: number;
}

export interface PlannedTree {
  readonly cell: number;
  readonly species: TreeSpecies;
  readonly group: number;
}

/**
 * Baumgruppen im Randband: Gruppenmitten per „weitester Punkt“ (erst die Ecke mit dem meisten Platz, dann jeweils
 * die Kandidatenzelle mit dem größten Abstand zu den bisherigen Gruppen), je Gruppe eine Art (nach Gewicht des
 * Stils), 1–2 weitere Stämme im Abstand `spacing … spacing + 2` um die Mitte. `ok` prüft die Stammzelle (frei,
 * Wiese, Abstand zu Wegen/Zonen, nicht im Vorderband).
 */
export function planTreeGroups(g: Gen, o: TreeGroupOptions, ok: (i: number) => boolean): PlannedTree[] {
  const { grid } = g;
  const rng = new Rng(hashSeed(g.seed, 'tree-groups'));
  const cands: number[] = [];
  for (let i = 0; i < grid.size; i++) {
    const b = borderDist(g, i);
    if (b >= o.rim[0] && b <= o.rim[1] && ok(i)) cands.push(i);
  }
  if (cands.length === 0) return [];
  const perimeter = 2 * (grid.w + grid.d);
  const groups = Math.max(1, Math.round(perimeter / o.every));
  const species = TREE_SPECIES.filter((s) => (o.species[s] ?? 0) > 0);
  if (species.length === 0) return [];
  // höchstens zwei Arten je Grundstück (Vorbilder: 1–2 Arten), je Gruppe eine; die Gruppen wechseln sich ab
  const srng = new Rng(hashSeed(g.seed, 'tree-group-species'));
  const first = srng.weighted(species, (s) => o.species[s] ?? 0);
  const rest = species.filter((s) => s !== first);
  const plotSpecies = rest.length === 0 ? [first] : [first, srng.weighted(rest, (s) => o.species[s] ?? 0)];
  const cheb =(a: number, b: number): number => Math.max(Math.abs(grid.x(a) - grid.x(b)), Math.abs(grid.z(a) - grid.z(b)));
  // Rückseite zuerst: Gruppen hinter dem Haus (gegenüber der Haustür) rahmen es, vorn bleibt der Blick frei
  const door = mainDoor(g);
  const foot = g.building.footprint.bounds();
  const F = door === undefined ? [0, 0] as const : DIR_OFFSET[door.outward];
  const cx = foot === undefined ? 0 : (foot.minX + foot.maxX) / 2;
  const cz = foot === undefined ? 0 : (foot.minZ + foot.maxZ) / 2;
  const behind = (i: number): number => -((grid.x(i) - cx) * F[0] + (grid.z(i) - cz) * F[1]);
  const cornerDist = (i: number): number => {
    const x = grid.x(i) - grid.minX;
    const z = grid.z(i) - grid.minZ;
    return Math.min(x, grid.w - 1 - x) + Math.min(z, grid.d - 1 - z);
  };
  // Mindestabstand der Gruppenmitten: gleichmäßig über den Umfang verteilt, aber nie enger als zwei Kronen
  const apart = Math.max(o.spacing * 2, Math.min(Math.floor(perimeter / groups / 2), Math.floor(Math.max(grid.w, grid.d) * 0.6)));
  const centers: number[] = [];
  const out: PlannedTree[] = [];
  const taken = (i: number): boolean => out.some((t) => cheb(t.cell, i) < o.spacing);
  const cap = o.max ?? Infinity;
  for (let k = 0; k < groups; k++) {
    if (cap - out.length < Math.max(1, o.size[0])) break;
    let best = -1;
    let score = -Infinity;
    for (const i of cands) {
      if (taken(i)) continue;
      const d = centers.length === 0 ? Infinity : Math.min(...centers.map((c) => cheb(c, i)));
      if (d < apart) continue;
      // erste Gruppe an der geräumigsten Ecke, danach weitester Punkt; Ecken leicht bevorzugt
      const s = (centers.length === 0 ? 0 : Math.min(d, 64)) - cornerDist(i) * 0.25 + Math.sign(behind(i)) * 6 + rng.next() * 0.5;
      if (s > score) {
        score = s;
        best = i;
      }
    }
    if (best < 0) break;
    centers.push(best);
    const sp = plotSpecies[k % plotSpecies.length]!;
    out.push({ cell: best, species: sp, group: k });
    const want = rng.int(o.size[0], Math.max(o.size[0], o.size[1])) - 1;
    const ring = cands
      .filter((i) => !taken(i) && cheb(i, best) >= o.spacing && cheb(i, best) <= o.spacing + 2)
      .sort((a, b) => a - b);
    for (let m = 0; m < want && out.length < cap; m++) {
      const pick = rng.shuffle(ring.filter((i) => !taken(i)))[0];
      if (pick === undefined) break;
      out.push({ cell: pick, species: sp, group: k });
    }
  }
  return out;
}

export interface StreetFence {
  /** Torzellen (Zauntor, 1–3 breit, genau über dem Hauptweg). */
  readonly gates: readonly number[];
  readonly posts: readonly number[];
  /** W4-A: schlanke Zaunpfosten (Zaun 2 hoch), nur mit `logEvery`. */
  readonly slim: readonly number[];
  readonly fence: readonly number[];
  /** Laternen auf den beiden Torpfosten. */
  readonly lights: readonly Vec3[];
}

/**
 * Straßenzaun (W3-GA, Modul „Zaun mit Tor“; Vorbilder: Zaun an der Straßenseite, Öffnung in der Wegachse, Licht nur
 * an den Torpfosten): eine Zaunlinie eine Zelle innerhalb des Grundstücksrands auf der Seite, zu der der Hauptweg
 * führt. Das Tor liegt genau über dem Hauptweg (so breit wie der Weg, höchstens 3), daneben Stammpfosten mit
 * Laterne, dazwischen Pfosten im Takt `postEvery`, an den Enden Pfosten. Die Linie endet vor allem, was nicht Wiese
 * ist (Weg, Zone, Bauwerk, Wasser, Objekt); ist sie auf einer Seite kürzer als 2 Felder, entfällt der Zaun ganz.
 */
export interface StreetFenceOptions {
  /** W4-A schlanke Zaunlinie: Stumpf-Pfosten nur am Linienende und höchstens alle `logEvery` Felder. */
  readonly logEvery?: number;
  /** W4-A: `front` = nur vor dem Haus (Hausbreite + 2 je Seite), sonst die ganze Seite. */
  readonly span?: 'side' | 'front';
}

/**
 * W4-A (Variante „Vorgartenzaun“, `span: 'front'`): die Linie reicht nur über die Hausbreite + `FRONT_MARGIN` je
 * Seite; ohne Option läuft sie über die ganze Seite.
 */
export const FRONT_MARGIN = 2;

export function buildStreetFence(g: Gen, route: readonly number[], side: HorizontalDir, postEvery: number, opts: StreetFenceOptions = {}): StreetFence | undefined {
  const { grid, top, emit } = g;
  const onLine = (i: number): boolean => {
    const x = grid.x(i) - grid.minX;
    const z = grid.z(i) - grid.minZ;
    if (x < 1 || x > grid.w - 2 || z < 1 || z > grid.d - 2) return false;
    switch (side) {
      case 'north': return z === 1;
      case 'south': return z === grid.d - 2;
      case 'west': return x === 1;
      case 'east': return x === grid.w - 2;
    }
  };
  const cross = route.find(onLine);
  if (cross === undefined) return undefined;
  // Laufrichtung entlang der Linie
  const [ax, az] = side === 'north' || side === 'south' ? [1, 0] : [0, 1];
  const at = (i: number, k: number): number => grid.at(grid.x(i) + ax * k, grid.z(i) + az * k);
  const isPath = (i: number): boolean => i >= 0 && onLine(i) && (g.path[i] === 1 || g.route[i] === 1);
  let lo = cross;
  let hi = cross;
  while (isPath(at(lo, -1))) lo = at(lo, -1);
  while (isPath(at(hi, 1))) hi = at(hi, 1);
  const opening: number[] = [];
  for (let c = lo; ; c = at(c, 1)) {
    opening.push(c);
    if (c === hi) break;
  }
  if (opening.length > 3) return undefined;
  // W4-A Vorgartenzaun: Spanne entlang der Linie = Baukörper (samt Überdachung) ± FRONT_MARGIN, mindestens das Tor
  // ± (FRONT_MARGIN + 1) – der Zaun rahmt den Vorgarten und endet nicht direkt am Tor, wenn der Weg seitlich mündet
  const foot = opts.span === 'front' ? g.building.footprint.union(g.building.covered).bounds() : undefined;
  const along = (i: number): number => (side === 'north' || side === 'south' ? grid.x(i) : grid.z(i));
  const spanLo = foot === undefined ? -Infinity : Math.min((side === 'north' || side === 'south' ? foot.minX : foot.minZ) - FRONT_MARGIN, along(lo) - FRONT_MARGIN - 1);
  const spanHi = foot === undefined ? Infinity : Math.max((side === 'north' || side === 'south' ? foot.maxX : foot.maxZ) + FRONT_MARGIN, along(hi) + FRONT_MARGIN + 1);
  const inSpan = (i: number): boolean => along(i) >= spanLo && along(i) <= spanHi;
  const ok = (i: number, prev: number): boolean => i >= 0 && onLine(i) && inSpan(i) && (g.cls[i] === C.meadow || g.cls[i] === C.pad) && g.path[i] === 0
    && g.route[i] === 0 && g.blocked[i] === 0 && g.struct[i] === 0 && g.water[i] === 0 && g.profile[i] === 0 && g.lowered[i] === 0
    && g.plantCol[i] === 0 && Math.abs(top[i]! - top[prev]!) <= 1;
  const arm = (from: number, dir: 1 | -1): number[] => {
    const out: number[] = [];
    let prev = from;
    for (let c = at(from, dir); ok(c, prev); c = at(c, dir)) {
      out.push(c);
      prev = c;
    }
    return out;
  };
  const left = arm(lo, -1);
  const right = arm(hi, 1);
  if (left.length < 2 || right.length < 2) return undefined;
  const res = { gates: [] as number[], posts: [] as number[], slim: [] as number[], fence: [] as number[], lights: [] as Vec3[] };
  for (const i of opening) {
    emit([grid.x(i), top[i]! + 1, grid.z(i)], 'plant', 'fence_outdoor', 'fence_gate', { facing: side });
    g.ring[i] = 1;
    // Das Tor ist Durchgang, aber keine Wegzelle (über Wegen bleibt die Kopffreiheit): der Weg endet beidseits am Tor
    g.path[i] = 0;
    res.gates.push(i);
  }
  for (const run of [left, right]) {
    // Pfosten gleichmäßig von Torpfosten bis Endpfosten, höchstens `postEvery` Felder auseinander (keine Doppelpfosten)
    const m = Math.max(1, Math.ceil((run.length - 1) / postEvery));
    const postAt = new Set<number>([0]);
    for (let k = 1; k <= m; k++) postAt.add(Math.round((k * (run.length - 1)) / m));
    const L = run.length - 1;
    run.forEach((i, k) => {
      const x = grid.x(i);
      const z = grid.z(i);
      const t = top[i]!;
      g.ring[i] = 1;
      g.blocked[i] = 1;
      g.plantCol[i] = 1;
      if (opts.logEvery !== undefined && k > 0) {
        // W4-A schlanke Linie: Endpfosten und großer Takt als Stumpf mit Zaunkopf, dazwischen schlanke Zaunpfosten
        const kind = k === L ? 'major' : postKind(k, L, postEvery, opts.logEvery);
        if (kind === 'major') {
          // W5-B (Review W4-R N10): Eckpfosten aus Zaun ohne Stammfuß und ohne Erdfleck
          stubPost(g, x, t, z, false);
          res.posts.push(i);
        } else if (kind === 'minor') {
          slimPost(g, x, t, z);
          res.slim.push(i);
        } else {
          emit([x, t + 1, z], 'plant', 'fence_outdoor', 'fence');
          res.fence.push(i);
        }
        return;
      }
      if (postAt.has(k)) {
        emit([x, t + 1, z], 'plant', 'fence_post', 'log', { axis: 'y' });
        emit([x, t + 2, z], 'plant', 'fence_post', 'log', { axis: 'y' });
        g.surface[i] = 'ground_dirt';
        res.posts.push(i);
        if (k === 0 && emit([x, t + 3, z], 'plant', 'light_outdoor', 'lantern')) res.lights.push([x, t + 3, z]);
      } else {
        emit([x, t + 1, z], 'plant', 'fence_outdoor', 'fence');
        res.fence.push(i);
      }
    });
  }
  return res;
}
