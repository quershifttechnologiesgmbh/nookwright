/**
 * Verbindungsgraph einer Base (F-Ensemble, `plan/spikes/F_ensemble_walkways.md`, Vorlage vazgriz/DungeonGenerator:
 * Graph → minimaler Spannbaum → 10–20 % Zusatzkanten für Rundwege; `plan/spikes/DungeonGenerator_lernen.md` §4.2).
 *
 * Orte (Knoten): Gebäude (zusammenhängende Grundrisse = ein Gebäude, innen über Türen und Treppen verbunden),
 * Wehrmauern (Wehrgang; am Boden Treppenfüße und Turmtüren), Tore, freistehende Türme/Windmühlen, Außenzonen.
 * Kanten:
 *  - `existing`: Wege, die das Gelände ohnehin legt (Haustür → jede Zone), zählen als vorhanden;
 *  - `path`: Spannbaum (Kruskal über den vollständigen Distanzgraphen, ≤ 30 Knoten) – Anschluss mit Bündelung;
 *  - `loop`: Zusatzkanten, Anzahl ⌈r · Baumkanten⌉ mit r aus dem Seed in [0,10; 0,20], gewählt nach Umwegfaktor
 *    (Baumweg : direkter Weg) – Rundweg ohne Bündelung;
 *  - `bridge`/`wallwalk`: Holzbrücke aus einem Obergeschoss zum Nachbargebäude bzw. zum Wehrgang, wo Lücke und Höhe
 *    passen (gerade, Tür im Feld des Fassadenrasters, keine privaten Räume, beide Enden flach, Treppe ≤ 1:1).
 * Rein und deterministisch; der Anwendungsdienst (`generateBase`) setzt den Plan um: Tür-Öffnungen als Anbau der Hülle
 * (`ShellAnnex`), Brücken als Bauwerk (`StructuresInput.bridges`), Wege als Zusatzwege des Geländes (`SiteStructures.links`).
 */
import type { Project, Shell, ShellAnnex } from '@mcda/blueprint';
import { CellSet, Rng, hashSeed, type Cell, type HorizontalDir, type Vec3 } from '@mcda/core';
import { BRIDGE_MAX_LENGTH, bridgeProfile, type BridgeSpec, type StructuresResult } from '@mcda/structures';
import type { BuildingInfo, SiteLink, SiteState } from '@mcda/terrain';

/** Schalter und Stellgrößen des Verbindungsgraphen (Feature-Branch: Standard aus). */
export interface EnsembleOptions {
  /** Brücken aus Obergeschossen zum Wehrgang bzw. zum Nachbargebäude. Standard true. */
  readonly bridges?: boolean;
  /** Wege-Graph (Anschlüsse im Spannbaum und Rundwege) als Zusatzwege des Geländes. Standard true. */
  readonly paths?: boolean;
  /** Anteil der Zusatzkanten an den Baumkanten, [min, max], aus dem Seed gewählt. Standard [0,1; 0,2]. */
  readonly loops?: readonly [number, number];
  /** Größte Brückenlänge (Zellen) zwischen zwei Gebäuden. Standard 10. */
  readonly maxGap?: number;
  /** Größte Brückenlänge (Zellen) zum Wehrgang. Standard 12. */
  readonly maxWallGap?: number;
  /**
   * Größter Höhenwechsel einer Brücke (Stufen). Standard {@link BRIDGE_MAX_RISE}: ein Hocheingang liegt nahezu waagerecht
   * (Burg Lichtenberg, Schattenburg); ein langer, steiler Treppenlauf auf Böcken wirkt wie ein Baugerüst (Review F-Ensemble).
   */
  readonly maxRise?: number;
}

/** Standard des größten Höhenwechsels einer Brücke (Stufen). */
export const BRIDGE_MAX_RISE = 3;

/**
 * Standard des Schalters in `generateBase`: `undefined` = aus (alle Ausgaben bitgleich zum Stand vor F-Ensemble).
 * Einschalten als Standard ist eine Zeile: `{}`.
 */
export const ENSEMBLE_DEFAULT: EnsembleOptions | undefined = undefined;

export type EnsemblePlaceKind = 'building' | 'wall' | 'gate' | 'tower' | 'zone';

export interface EnsemblePlace {
  readonly id: string;
  readonly kind: EnsemblePlaceKind;
  /** Bodenanschlüsse (Spalten vor Türen, Treppenfüße, Tor-Vorplätze, Zonenzellen). */
  readonly ports: readonly Cell[];
  readonly zoneId?: string;
}

export type EnsembleEdgeKind = 'existing' | 'path' | 'loop' | 'bridge' | 'wallwalk';

export interface EnsembleEdge {
  readonly a: string;
  readonly b: string;
  readonly kind: EnsembleEdgeKind;
  /** Geschätzte Länge (Blöcke, Manhattan bzw. Brückenzellen). */
  readonly length: number;
}

/** Geplante Brücke: Tür(en) in der Hülle, Lauf als Bauwerk. */
export interface PlannedBridge {
  readonly id: string;
  readonly kind: 'bridge' | 'wallwalk';
  readonly from: string;
  readonly to: string;
  readonly roomId: string;
  readonly floorIndex: number;
  /** Wandzelle der Tür. */
  readonly at: Cell;
  readonly dir: HorizontalDir;
  /** Standplatz der ersten Brückenzelle. */
  readonly start: Vec3;
  /** Gegenüber (Gebäude): letzte Brückenzelle, Etage und Wandzelle der zweiten Tür. */
  readonly end?: Vec3;
  readonly endFloor?: number;
  readonly endAt?: Cell;
  readonly length: number;
  readonly rise: number;
  readonly score: number;
  /** Paar der Orte (je Paar höchstens eine Brücke). */
  readonly pair: string;
  /** Eindeutiger Schlüssel des Kandidaten (Raum, Wandzelle, Richtung). */
  readonly key: string;
}

export interface EnsemblePlan {
  readonly places: readonly EnsemblePlace[];
  /** Kanten ohne Brücken (vorhanden, Baum, Rundweg-Kandidaten); Brücken in `bridges`. */
  readonly edges: readonly EnsembleEdge[];
  /** Zusatzwege: je `path`/`loop`-Kante einer, gleiche Reihenfolge. */
  readonly links: readonly SiteLink[];
  readonly linkEdges: readonly EnsembleEdge[];
  /** Höchstzahl der Rundwege: ⌈Anteil · Baumkanten⌉ (Kandidaten in `links` nach Vorrang). */
  readonly maxLoops: number;
  readonly bridges: readonly PlannedBridge[];
  /** Alle Brücken-Kandidaten nach Rang (Ersatz, wenn eine gewählte Brücke die Prüfung nicht besteht). */
  readonly bridgeCandidates: readonly PlannedBridge[];
  /** Gewählter Anteil der Zusatzkanten. */
  readonly loopRatio: number;
}

const STEP: Readonly<Record<HorizontalDir, Cell>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const DIRS: readonly HorizontalDir[] = ['north', 'east', 'south', 'west'];
const add = (c: Cell, d: HorizontalDir, k = 1): Cell => [c[0] + STEP[d][0] * k, c[1] + STEP[d][1] * k];
const perp = (d: HorizontalDir): readonly [Cell, Cell] => [[-STEP[d][1], STEP[d][0]], [STEP[d][1], -STEP[d][0]]];
const key = (c: Cell): string => `${c[0]},${c[1]}`;

/**
 * Private Räume: keine Brückentür (Schlafen, Privatgemach, Bad, Schatz, Kerker, Kapelle, Krankenstube, Stall …).
 * Geprüft gegen alle 45 Raumtypen des Katalogs (Review A4): Arbeits- und Gemeinschaftsräume (Werkstätten, Küche,
 * Lager, Studierzimmer, Bibliothek, Hallen) bleiben erlaubt, mit Abzug außerhalb von `PUBLIC_ROOMS`.
 */
const PRIVATE_ROOMS: ReadonlySet<string> = new Set([
  'bedroom', 'guest_room', 'nursery', 'solar', 'washroom', 'bathhouse', 'treasury', 'dungeon', 'wine_cellar', 'chapel', 'infirmary', 'portal_room', 'stable',
]);
/** Räume, in die eine Brücke gut führt (Halle, Wache, Flur-artig): ohne Abzug. */
const PUBLIC_ROOMS: ReadonlySet<string> = new Set([
  'entrance_hall', 'dining_hall', 'mead_hall', 'throne_room', 'barracks', 'armory', 'tower_room', 'gallery', 'map_room', 'trading_hall', 'tavern',
  'library', 'observatory', 'trophy_room', 'game_room', 'music_room',
]);
/** Punkte je Stufe (waagerechte Brücke bevorzugt: eine Stufe wiegt so viel wie 3 Zellen mehr Länge). */
const RISE_WEIGHT = 3;
const roomPenalty = (type: string): number => (PUBLIC_ROOMS.has(type) ? 0 : type === 'attic' ? 3 : 1);

/** Kürzeste Manhattan-Distanz zweier Zellmengen (Randzellen genügen). */
function distance(a: readonly Cell[], b: readonly Cell[]): number {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]));
  return best;
}

/** Randzellen einer Zone (4-Nachbar außerhalb) – für Distanzen genügt der Rand. */
function rim(cells: CellSet): Cell[] {
  return cells.toArray().filter(([x, z]) => DIRS.some((d) => !cells.has(x + STEP[d][0], z + STEP[d][1])));
}

class Dsu {
  private readonly parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
    return true;
  }
}

export interface EnsembleInput {
  readonly project: Project;
  /** Hülle ohne Brücken (mit angedockten Türmen). */
  readonly shell: Shell;
  /** Gebäude-Sicht des Geländes zu dieser Hülle. */
  readonly building: BuildingInfo;
  /** Bauwerke auf ebenem Boden (Wehrgang, Tore, Türme) – Planungsstand. */
  readonly fort?: StructuresResult;
  readonly site?: SiteState;
  readonly seed: number;
  readonly options: EnsembleOptions;
}

/** Plan des Verbindungsgraphen (rein). */
export function planEnsemble(input: EnsembleInput): EnsemblePlan {
  const { project, shell, building, fort, site, options } = input;
  const rng = new Rng(hashSeed(input.seed, 'ensemble'));
  const [rLo, rHi] = options.loops ?? [0.1, 0.2];
  const loopRatio = rLo + (rHi - rLo) * rng.next();

  // ------------------------------------------------------------------------------------------------ Orte
  const rooms = project.state.rooms;
  const painted = rooms.filter((r) => r.floorIndex >= 0).reduce((u, r) => u.union(r.cells), CellSet.empty());
  const clusters = painted.components().sort((a, b) => {
    const ka = a.toArray().sort((p, q) => p[1] - q[1] || p[0] - q[0])[0]!;
    const kb = b.toArray().sort((p, q) => p[1] - q[1] || p[0] - q[0])[0]!;
    return ka[1] - kb[1] || ka[0] - kb[0];
  });
  const clusterOf = (c: Cell): number => clusters.findIndex((s) => s.has(c[0], c[1]));
  const places: EnsemblePlace[] = [];
  clusters.forEach((cells, i) => {
    const ports = building.doors.filter((d) => cells.has(d.cell[0], d.cell[1])).map((d) => add(d.cell, d.outward));
    places.push({ id: `building${i}`, kind: 'building', ports });
  });
  const wallTowers = new Set((fort?.walls ?? []).flatMap((w) => w.towers));
  for (const w of fort?.walls ?? []) {
    if (w.walkway.length > 0) {
      const ports: Cell[] = [];
      for (const s of w.stairs) {
        const d: Cell = [Math.sign(s.bottom[0] - s.top[0]), Math.sign(s.bottom[2] - s.top[2])];
        ports.push([s.bottom[0] + d[0], s.bottom[2] + d[1]]);
      }
      for (const t of fort!.towers) {
        if (t.wall !== w.id || t.door === undefined) continue;
        ports.push(add([t.door.pos[0], t.door.pos[2]], t.door.facing));
      }
      places.push({ id: w.id, kind: 'wall', ports });
    }
    w.gates.forEach((g, gi) => places.push({ id: `${w.id}.gate${gi}`, kind: 'gate', ports: [...g.approach] }));
  }
  for (const t of fort?.towers ?? []) {
    if (wallTowers.has(t.id) || t.annex !== undefined || t.door === undefined) continue;
    places.push({ id: t.id, kind: 'tower', ports: [add([t.door.pos[0], t.door.pos[2]], t.door.facing)] });
  }
  for (const z of site?.zones ?? []) {
    if (z.kind === 'meadow' || z.cells.isEmpty) continue;
    places.push({ id: `zone:${z.id}`, kind: 'zone', ports: rim(z.cells), zoneId: z.id });
  }

  // ------------------------------------------------------------------------------------------------ Wege-Graph
  const edges: EnsembleEdge[] = [];
  const links: SiteLink[] = [];
  let maxLoops = 0;
  const linkEdges: EnsembleEdge[] = [];
  const ground = places.filter((p) => p.ports.length > 0);
  const dist = new Map<string, number>();
  const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let i = 0; i < ground.length; i++) {
    for (let j = i + 1; j < ground.length; j++) dist.set(pairKey(ground[i]!.id, ground[j]!.id), distance(ground[i]!.ports, ground[j]!.ports));
  }
  const d = (a: string, b: string): number => dist.get(pairKey(a, b)) ?? Infinity;
  const dsu = new Dsu();
  const tree: EnsembleEdge[] = [];
  // vorhanden: das Gelände legt von den Türen zu jeder Zone einen Weg (am nächsten Gebäude mit Tür)
  const doorBuildings = ground.filter((p) => p.kind === 'building');
  if (site !== undefined && doorBuildings.length > 0) {
    for (const z of ground.filter((p) => p.kind === 'zone')) {
      const b = [...doorBuildings].sort((x, y) => d(x.id, z.id) - d(y.id, z.id) || (x.id < y.id ? -1 : 1))[0]!;
      const e: EnsembleEdge = { a: b.id, b: z.id, kind: 'existing', length: d(b.id, z.id) };
      edges.push(e);
      tree.push(e);
      dsu.union(b.id, z.id);
    }
  }
  const endOf = (p: EnsemblePlace): SiteLink['from'] => (p.zoneId !== undefined ? { zoneId: p.zoneId } : { cells: p.ports });
  const byId = new Map(places.map((p) => [p.id, p] as const));
  if (options.paths !== false && site !== undefined) {
    const GROUND_MAX = 64;
    const candidates: [number, string, string][] = [];
    for (let i = 0; i < ground.length; i++) {
      for (let j = i + 1; j < ground.length; j++) {
        const w = d(ground[i]!.id, ground[j]!.id);
        if (w <= GROUND_MAX) candidates.push([w, ground[i]!.id, ground[j]!.id]);
      }
    }
    candidates.sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : x[2] < y[2] ? -1 : 1));
    for (const [w, a, b] of candidates) {
      if (!dsu.union(a, b)) continue;
      const e: EnsembleEdge = { a, b, kind: 'path', length: w };
      edges.push(e);
      tree.push(e);
      links.push({ from: endOf(byId.get(a)!), to: endOf(byId.get(b)!) });
      linkEdges.push(e);
    }
    // Rundwege: Umwegfaktor Baumweg : direkter Weg, gewichtete Auswahl ohne Zurücklegen
    const adj = new Map<string, [string, number][]>();
    for (const e of tree) {
      adj.set(e.a, [...(adj.get(e.a) ?? []), [e.b, e.length]]);
      adj.set(e.b, [...(adj.get(e.b) ?? []), [e.a, e.length]]);
    }
    const treeDist = (a: string, b: string): number => {
      const seen = new Map<string, number>([[a, 0]]);
      const stack = [a];
      while (stack.length > 0) {
        const u = stack.pop()!;
        for (const [v, w] of adj.get(u) ?? []) {
          if (seen.has(v)) continue;
          seen.set(v, seen.get(u)! + w);
          stack.push(v);
        }
      }
      return seen.get(b) ?? Infinity;
    };
    const inTree = new Set(tree.map((e) => pairKey(e.a, e.b)));
    const LOOP_MAX = 40;
    const LOOP_MIN_DETOUR = 1.6;
    const loopCands = candidates
      .filter(([w, a, b]) => w <= LOOP_MAX && !inTree.has(pairKey(a, b)))
      .map(([w, a, b]) => ({ a, b, w, detour: treeDist(a, b) / Math.max(w, 4) }))
      .filter((c) => Number.isFinite(c.detour) && c.detour >= LOOP_MIN_DETOUR);
    // alle Kandidaten in gewichteter Zufallsfolge; das Gelände legt davon höchstens `maxLoops`, und nur lohnende
    // (Netzweg ≥ 1,6 × neuer Weg, ≥ 4 neue Wegzellen – erst dort sind die echten Wege bekannt)
    maxLoops = Math.ceil(loopRatio * tree.length);
    const pool = [...loopCands];
    while (pool.length > 0) {
      const c = rng.weighted(pool, (x) => x.detour);
      pool.splice(pool.indexOf(c), 1);
      const e: EnsembleEdge = { a: c.a, b: c.b, kind: 'loop', length: c.w };
      edges.push(e);
      links.push({ from: endOf(byId.get(c.a)!), to: endOf(byId.get(c.b)!), loop: true });
      linkEdges.push(e);
    }
  }

  // ------------------------------------------------------------------------------------------------ Brücken
  const bridgeCandidates = options.bridges === false ? [] : planBridges(input, clusterOf);
  return { places, edges, links, linkEdges, maxLoops, bridges: selectBridges(bridgeCandidates), bridgeCandidates, loopRatio };
}

/** Brücken-Kandidaten nach Rang (Punkte: Länge + 2 · Stufen + 4 · Raumabzug; Gleichstand aus dem Seed). */
function planBridges(input: EnsembleInput, clusterOf: (c: Cell) => number): PlannedBridge[] {
  const { project, shell, building, fort, options } = input;
  const maxGap = options.maxGap ?? 10;
  const maxWall = options.maxWallGap ?? BRIDGE_MAX_LENGTH;
  const maxRise = options.maxRise ?? BRIDGE_MAX_RISE;
  const rooms = project.state.rooms;
  const roomById = new Map(rooms.map((r) => [r.id, r] as const));
  const allCells = rooms.reduce((u, r) => u.union(r.cells), CellSet.empty());
  // Außenprofil (Gesims, Sockel, Eckquader) entfällt in den Anbau-Spalten vor der Tür; die Prüfung nach der Ableitung
  // mit Brückentüren sieht die echte Hülle
  const occupied = new Set(shell.cells.filter((c) => c.kind !== 'facade').map((c) => `${c.pos[0]},${c.pos[1]},${c.pos[2]}`));
  const doorCols = new Set(building.doors.map((dd) => key(dd.cell)));
  const walk = new Map<string, number>();
  const walkWall = new Map<string, string>();
  for (const w of fort?.walls ?? []) {
    for (const [x, y, z] of w.walkway) {
      if (!walk.has(`${x},${z}`)) {
        walk.set(`${x},${z}`, y);
        walkWall.set(`${x},${z}`, w.id);
      }
    }
  }
  const fortCols = CellSet.of(fort?.footprint ?? []);
  const grid = shell.facadeGrid ?? [];
  /** Tür im Feld des Fassadenrasters (fehlt das Raster auf dieser Linie: frei). */
  const onBay = (floorIndex: number, out: HorizontalDir, w: Cell): boolean => {
    const ns = out === 'north' || out === 'south';
    const plane = ns ? w[1] : w[0];
    const along = ns ? w[0] : w[1];
    const line = grid.find((l) => l.floorIndex === floorIndex && l.out === out && l.plane === plane && l.from <= along && along <= l.to);
    return line === undefined || line.bays.some((b) => b.axis.includes(along));
  };
  /** Wandzelle einer geraden Außenwand eines Raums (innen frei, quer beidseits Wand). */
  const doorSpot = (roomId: string, w: Cell, out: HorizontalDir): boolean => {
    const info = shell.rooms.get(roomId);
    if (info === undefined) return false;
    const inside = add(w, out, -1);
    if (!info.interior.has(inside[0], inside[1]) || info.blocked?.has(inside[0], inside[1]) === true) return false;
    if (info.height < 2) return false;
    return perp(out).every(([px, pz]) => {
      const s: Cell = [w[0] + px, w[1] + pz];
      const si: Cell = [inside[0] + px, inside[1] + pz];
      return !info.interior.has(s[0], s[1]) && info.interior.has(si[0], si[1]) && roomById.get(roomId)!.cells.has(s[0], s[1]);
    });
  };
  /** Brückenvolumen frei von Hüllzellen (Lauf + Kopffreiheit, Geländer, Laternen). */
  const clear = (cells: readonly Cell[], feet: readonly number[], dir: HorizontalDir): boolean => {
    const [a, b] = perp(dir);
    return cells.every(([x, z], k) => {
      const f = feet[k]!;
      for (let y = f - 1; y <= f + 2; y++) if (occupied.has(`${x},${y},${z}`)) return false;
      for (const [px, pz] of [a, b]) for (let y = f - 1; y <= f + 1; y++) if (occupied.has(`${x + px},${y},${z + pz}`)) return false;
      return true;
    });
  };

  interface Cand extends Omit<PlannedBridge, 'key'> { readonly cols: readonly string[] }
  const cands: Cand[] = [];
  for (const r of rooms) {
    if (r.floorIndex < 1 || PRIVATE_ROOMS.has(r.roomTypeId)) continue;
    const info = shell.rooms.get(r.id);
    if (info === undefined) continue;
    const ci = clusterOf(r.cells.toArray()[0]!);
    for (const [ix, iz] of info.interior.toArray()) {
      for (const out of DIRS) {
        const w = add([ix, iz], out);
        if (info.interior.has(w[0], w[1]) || !r.cells.has(w[0], w[1])) continue;
        const o = add(w, out);
        const [pa, pb] = perp(out);
        const row = [o, [o[0] + pa[0], o[1] + pa[1]] as Cell, [o[0] + pb[0], o[1] + pb[1]] as Cell];
        if (row.some((c) => allCells.has(c[0], c[1]))) continue;
        // keine Außentür im Erdgeschoss unter der Brücke (die Anbau-Sperre nähme sie weg)
        if ([w, [w[0] + pa[0], w[1] + pa[1]] as Cell, [w[0] + pb[0], w[1] + pb[1]] as Cell].some((c) => doorCols.has(key(c)))) continue;
        if (!doorSpot(r.id, w, out) || !onBay(r.floorIndex, out, w)) continue;
        const feet0 = info.baseY;
        // entlang der Achse: Wehrgang, fremdes Gebäude oder Hindernis
        const path: Cell[] = [];
        let hit: { kind: 'wall'; y: number; wall: string } | { kind: 'building'; w2: Cell; cluster: number } | undefined;
        for (let k = 0; k <= Math.max(maxGap, maxWall); k++) {
          const c = add(o, out, k);
          const wy = walk.get(key(c));
          if (wy !== undefined) {
            if (k <= maxWall) hit = { kind: 'wall', y: wy, wall: walkWall.get(key(c))! };
            break;
          }
          if (allCells.has(c[0], c[1])) {
            const c2 = clusterOf(c);
            if (c2 >= 0 && c2 !== ci && k <= maxGap) hit = { kind: 'building', w2: c, cluster: c2 };
            break;
          }
          if (fortCols.has(c[0], c[1])) break;
          path.push(c);
        }
        if (hit === undefined || path.length < 2) continue;
        if (hit.kind === 'wall') {
          const feet = Math.abs(hit.y - feet0) > maxRise ? undefined : bridgeProfile(path.length, feet0, hit.y - feet0);
          if (feet === undefined || !clear(path, feet, out)) continue;
          const rise = hit.y - feet0;
          cands.push({
            id: '', kind: 'wallwalk', from: `building${ci}`, to: hit.wall, roomId: r.id, floorIndex: r.floorIndex, at: w, dir: out,
            start: [o[0], feet0, o[1]], length: path.length, rise, score: path.length + RISE_WEIGHT * Math.abs(rise) + 4 * roomPenalty(r.roomTypeId),
            cols: path.flatMap((c) => [key(c), key(add(c, out, 0))]), pair: `building${ci}|${hit.wall}`,
          });
        } else {
          if (path.length < 3) continue;
          const back = opposite4(out);
          const hitCell = hit.w2;
          // Gegenüber: Wandzelle eines Raums im Obergeschoss mit Innenzelle dahinter
          const other = rooms.filter((q) => q.floorIndex >= 1 && !PRIVATE_ROOMS.has(q.roomTypeId) && q.cells.has(hitCell[0], hitCell[1]));
          let best: { q: typeof rooms[number]; feet: number[]; score: number } | undefined;
          for (const q of other) {
            const qi = shell.rooms.get(q.id);
            if (qi === undefined || !doorSpot(q.id, hitCell, back) || !onBay(q.floorIndex, back, hitCell)) continue;
            const feet = Math.abs(qi.baseY - feet0) > maxRise ? undefined : bridgeProfile(path.length, feet0, qi.baseY - feet0);
            if (feet === undefined || !clear(path, feet, out)) continue;
            const s = path.length + RISE_WEIGHT * Math.abs(qi.baseY - feet0) + 4 * (roomPenalty(r.roomTypeId) + roomPenalty(q.roomTypeId));
            if (best === undefined || s < best.score) best = { q, feet, score: s };
          }
          if (best === undefined) continue;
          const last = path[path.length - 1]!;
          const endY = best.feet[best.feet.length - 1]!;
          const pair = [`building${ci}`, `building${hit.cluster}`].sort().join('|');
          cands.push({
            id: '', kind: 'bridge', from: `building${ci}`, to: `building${hit.cluster}`, roomId: r.id, floorIndex: r.floorIndex, at: w, dir: out,
            start: [o[0], feet0, o[1]], end: [last[0], endY, last[1]], endFloor: best.q.floorIndex, endAt: hitCell,
            length: path.length, rise: endY - feet0, score: best.score, cols: path.map(key), pair,
          });
        }
      }
    }
  }
  // Rang: Punkte, dann Seed-Hash als Gleichstandsbrecher (deterministisch, aber nicht immer die linke Ecke)
  // eigener Unter-Seed (Review): die Rundweg-Auswahl verbraucht eine datenabhängige Zahl Züge aus `rng`
  const salt = hashSeed(input.seed, 'ensemble-bridges');
  const tie = (c: Cand): number => hashSeed(salt, c.at[0], c.at[1], c.floorIndex, c.dir);
  cands.sort((a, b) => a.score - b.score || tie(a) - tie(b));
  return cands.map(({ cols: _c, ...c }) => ({ ...c, key: `${c.roomId}@${c.at[0]},${c.at[1]}>${c.dir}` }));
}

/**
 * Auswahl aus den Kandidaten (nach Rang): je Paar (Gebäude, Ziel) die beste Brücke, deren Spalten samt Geländer keine
 * andere Brücke berühren; `excluded` = Schlüssel verworfener Kandidaten (nach einer Prüfung in `generateBase`).
 */
export function selectBridges(candidates: readonly PlannedBridge[], excluded: ReadonlySet<string> = new Set()): PlannedBridge[] {
  const chosen: PlannedBridge[] = [];
  const pairs = new Set<string>();
  const used = new Set<string>();
  for (const c of candidates) {
    if (pairs.has(c.pair) || excluded.has(c.key)) continue;
    const [pa, pb] = perp(c.dir);
    const cols: string[] = [];
    for (let k = -1; k <= c.length; k++) {
      const m = add([c.start[0], c.start[2]], c.dir, k);
      for (const off of [[0, 0] as Cell, pa, pb]) cols.push(key([m[0] + off[0], m[1] + off[1]]));
    }
    if (cols.some((x) => used.has(x))) continue;
    for (const x of cols) used.add(x);
    pairs.add(c.pair);
    chosen.push({ ...c, id: `ens-b${chosen.length}` });
  }
  return chosen;
}

function opposite4(d: HorizontalDir): HorizontalDir {
  return d === 'north' ? 'south' : d === 'south' ? 'north' : d === 'east' ? 'west' : 'east';
}

/**
 * Anbauten der Hülle für geplante Brücken: je Tür ein Anbau aus den ersten zwei Querreihen vor der Wand (Tür in die
 * Öffnung, Wand darunter ohne Tür/Fenster, keine Außen-Deko in diesen Spalten); Oberkante = Kopf der Tür + 1.
 */
export function bridgeAnnexes(bridges: readonly PlannedBridge[]): ShellAnnex[] {
  const out: ShellAnnex[] = [];
  const annex = (id: string, at: Cell, dir: HorizontalDir, floorIndex: number, feet: number): ShellAnnex => {
    const cells: Cell[] = [];
    const [pa, pb] = perp(dir);
    for (let k = 1; k <= 2; k++) {
      const m = add(at, dir, k);
      for (const off of [[0, 0] as Cell, pa, pb]) cells.push([m[0] + off[0], m[1] + off[1]]);
    }
    return { id, footprint: CellSet.of(cells), top: feet + 2, openings: [{ floorIndex, at }] };
  };
  for (const b of bridges) {
    out.push(annex(`${b.id}-a`, b.at, b.dir, b.floorIndex, b.start[1]));
    if (b.end !== undefined && b.endAt !== undefined && b.endFloor !== undefined) out.push(annex(`${b.id}-b`, b.endAt, opposite4(b.dir), b.endFloor, b.end[1]));
  }
  return out;
}

/** Bauwerks-Vorgaben der geplanten Brücken. */
export function bridgeSpecs(bridges: readonly PlannedBridge[], options: EnsembleOptions): BridgeSpec[] {
  return bridges.map((b) => ({
    id: b.id, start: b.start, dir: b.dir,
    ...(b.end !== undefined ? { end: b.end } : { maxLength: options.maxWallGap ?? BRIDGE_MAX_LENGTH }),
  }));
}
