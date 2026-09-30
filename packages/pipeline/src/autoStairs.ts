/**
 * W11-A „Treppen automatisch aus den Räumen“: verbindet die Etagen eines Projekts, deren Räume noch keine Treppe
 * verbindet – dieselbe Regel für den Editor (Malen, Radieren, Kante ziehen) und die Engine (`project_auto_stairs`,
 * `rooms_generate.autoStairs`). Rein und deterministisch (Zufall nur als Gleichstands-Bruch aus dem Projekt-Seed).
 *
 * Vorbild: Dungeon-Planer (plan/spikes/DungeonGenerator_lernen.md §4.1, plan/spikes/F_underground.md §1.1 Schritt 2) –
 * Graph über die Etagen, Spannbaum, Treppe nach der Kern-Regel (`checkLink`), nie als Nebenwirkung einer Wegsuche.
 *
 * - **Graph:** Knoten sind die Etagen mit Räumen je Baukörper, Kanten verbinden übereinanderliegende Etagen (eine
 *   Treppe führt immer von `f` nach `f + 1`). Der Spannbaum einer Kette ist die Kette selbst: je unverbundenem
 *   Nachbarpaar genau eine Treppe (minimal). Vorhandene Treppen zählen als Kanten und werden nie bewegt.
 * - **Kandidaten:** jede Lage, an der `checkLink` die Treppe annimmt (Stufen samt 8er-Nachbarschaft im Kern EINES Raums,
 *   oben ebenso, keine Überschneidung), ohne gesperrte oder von Hand gesetzte Möbel im Weg (`fixedFurnitureInStairs`).
 * - **Kosten:** Erschließungsräume (Eingangshalle, Flur, Treppenhaus) vor Gemeinschaftsräumen vor Arbeitsräumen vor
 *   privaten Räumen (Schlafzimmer, Bad …); gestapelt über/unter einer vorhandenen Treppe (Wechselstiege wie ein echter
 *   Treppenkern); an der Wand statt in der Raummitte; nicht in Türzonen; nicht vor Fenstern; gerade vor L/U vor Wendel
 *   vor Leiter.
 * - **Spielbarkeit (W8-E):** Die Treppe nimmt keinem der beiden Räume ein Pflichtobjekt, das dort ohne sie Platz hatte
 *   (`requiredWithoutPose` über `catalogFurnishable`); sonst gilt der Kandidat nicht.
 */
import {
  DEFAULT_CORRIDOR_TYPES, checkLink, deriveShell, isCoreCell, stairLayout, volumeFloors, volumeOf,
  type Project, type ProjectState, type Room, type RoomShellInfo, type Shell, type StairLayout, type StairTurn, type StairType, type VerticalLink, type VolumeId,
} from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import { CellSet, HORIZONTAL, cellKey, hashSeed, type Cell, type HorizontalDir } from '@mcda/core';
import { catalogFurnishable, fixedFurnitureInStairs } from './rules.js';

/** Eine automatisch gewählte Treppe (wie `Project.placeStairs`) samt den beiden Räumen, die sie verbindet. */
export interface AutoStair {
  readonly floorIndex: number;
  readonly origin: Cell;
  readonly facing: HorizontalDir;
  readonly type: StairType;
  readonly turn?: StairTurn;
  readonly lowerRoomId: string;
  readonly upperRoomId: string;
}

/** Nachbar-Etagen eines Baukörpers, die ohne Treppe blieben, mit Grund. */
export interface AutoStairGap {
  readonly volumeId: VolumeId;
  /** Untere Etage des Paares. */
  readonly floorIndex: number;
  readonly reason: 'no_overlap' | 'unplayable';
}

export interface AutoStairsPlan {
  /** In Reihenfolge zu setzen (jede prüft gegen die vorigen). */
  readonly stairs: readonly AutoStair[];
  readonly gaps: readonly AutoStairGap[];
}

export interface AutoStairsOptions {
  /** Katalog: Pflichtobjekte (W8-E) und gesperrte/von Hand gesetzte Möbel. Ohne Katalog nur die Geometrie. */
  readonly catalog?: Catalog;
  /** Flur-Rollen (wie `ShellOptions.corridorTypes`); gelten zusätzlich als Erschließung. */
  readonly corridorTypes?: readonly string[];
  /**
   * Nur Lücken, die es in diesem früheren Zustand noch nicht gab (Editor: „diese Aktion hat die Etage getrennt“). Eine
   * Treppe, die der Nutzer bewusst entfernt hat, kommt so nicht bei der nächsten Aktion zurück. Fehlt = alle Lücken.
   */
  readonly since?: ProjectState;
  /** Höchstens so viele Kandidaten je Etagenpaar mit Probe-Hülle prüfen (Standard 24). */
  readonly probes?: number;
}

// ------------------------------------------------------------------ Raum-Rang

/** Erschließung: Treppen gehören hierher (Diele, Flur, Treppenhaus). */
export const STAIR_CIRCULATION: readonly string[] = ['entrance_hall', 'gallery', 'hallway', 'corridor', 'stairwell', 'foyer', 'landing'];
/** Gemeinschafts- und Nebenräume: gut, wenn keine Erschließung passt. */
export const STAIR_COMMON: readonly string[] = [
  'storage', 'attic', 'wine_cellar', 'solar', 'dining_hall', 'mead_hall', 'tavern', 'trading_hall', 'throne_room', 'tower_room', 'barracks',
];
/** Private Räume: nur, wenn es keine andere Stelle gibt. */
export const STAIR_PRIVATE: readonly string[] = ['bedroom', 'guest_room', 'nursery', 'washroom', 'bathhouse', 'infirmary', 'treasury'];

function roomRank(corridor: ReadonlySet<string>): (roomTypeId: string) => number {
  const common = new Set(STAIR_COMMON);
  const privy = new Set(STAIR_PRIVATE);
  return (id) => (corridor.has(id) ? 0 : common.has(id) ? 3 : privy.has(id) ? 40 : 8);
}

/** Treppenart: Vorrang (Kosten) und Drehsinn-Varianten. Leiter nur als letzte Wahl. */
const TYPES: ReadonlyArray<{ readonly type: StairType; readonly cost: number; readonly turns: readonly (StairTurn | undefined)[] }> = [
  { type: 'straight', cost: 0, turns: [undefined] },
  { type: 'l', cost: 0.6, turns: ['right', 'left'] },
  { type: 'u', cost: 0.9, turns: ['right', 'left'] },
  { type: 'spiral', cost: 2, turns: ['right', 'left'] },
  { type: 'ladder', cost: 6, turns: [undefined] },
];

// ------------------------------------------------------------------ Graph

const linkVolume = (state: ProjectState, link: VerticalLink): VolumeId | undefined => {
  const r = state.rooms.find((x) => x.floorIndex === link.floorIndex && x.cells.has(link.origin[0], link.origin[1]));
  return r === undefined ? undefined : volumeOf(r);
};

/**
 * Unverbundene Nachbar-Etagen: je Baukörper jedes Paar (f, f + 1) mit Räumen auf beiden Etagen ohne Treppe dazwischen.
 * Reihenfolge: vom Erdgeschoss nach außen (EG ↔ 1. OG, 1. UG ↔ EG, 1. OG ↔ 2. OG …), damit sich Treppen stapeln.
 */
export function disconnectedFloors(state: ProjectState): Array<{ readonly volumeId: VolumeId; readonly floorIndex: number }> {
  const volumes = [...new Set(state.rooms.map(volumeOf))].sort();
  const out: Array<{ volumeId: VolumeId; floorIndex: number }> = [];
  for (const v of volumes) {
    const floors = new Set(state.rooms.filter((r) => volumeOf(r) === v).map((r) => r.floorIndex));
    const linked = new Set(state.links.filter((l) => linkVolume(state, l) === v).map((l) => l.floorIndex));
    for (const f of floors) if (floors.has(f + 1) && !linked.has(f)) out.push({ volumeId: v, floorIndex: f });
  }
  return out.sort((a, b) => Math.abs(a.floorIndex + 0.5) - Math.abs(b.floorIndex + 0.5) || b.floorIndex - a.floorIndex || a.volumeId.localeCompare(b.volumeId));
}

// ------------------------------------------------------------------ Kandidaten

interface Candidate {
  readonly link: VerticalLink;
  readonly layout: StairLayout;
  readonly lower: Room;
  readonly upper: Room;
  readonly cost: number;
}

const shift = (c: Cell, o: Cell): Cell => [c[0] + o[0], c[1] + o[1]];
const manhattan = (a: Cell, b: Cell): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/** Geometrie an `origin` verschoben (die Form hängt nur an Art, Richtung und Etagenabstand). */
function translate(rel: StairLayout, o: Cell): StairLayout {
  const t = (c: Cell): Cell => shift(c, o);
  return {
    blocks: rel.blocks, // nur die Zahl zählt (Kosten); die Blöcke baut später `placeStairs` selbst
    footprint: rel.footprint.map(t),
    holes: rel.holes.map(t),
    top: rel.top.map(t),
    bottom: { ...rel.bottom, inside: t(rel.bottom.inside) },
    arrival: { ...rel.arrival, inside: t(rel.arrival.inside) },
    ...(rel.support !== undefined ? { support: t(rel.support) } : {}),
  };
}

/** Abstand (Schachbrett) jeder Raumzelle zur nächsten Zelle außerhalb (Randzelle = 1), gedeckelt – eine Breitensuche. */
function edgeDistances(room: Room, cap = 6): Map<string, number> {
  const dist = new Map<string, number>();
  let front: Cell[] = [];
  for (const [x, z] of room.cells) {
    let edge = false;
    for (let dz = -1; dz <= 1 && !edge; dz++) for (let dx = -1; dx <= 1; dx++) if (!room.cells.has(x + dx, z + dz)) edge = true;
    if (edge) {
      dist.set(cellKey(x, z), 1);
      front.push([x, z]);
    }
  }
  for (let d = 2; d <= cap && front.length > 0; d++) {
    const next: Cell[] = [];
    for (const [x, z] of front) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const k = cellKey(x + dx, z + dz);
        if (dist.has(k) || !room.cells.has(x + dx, z + dz)) continue;
        dist.set(k, d);
        next.push([x + dx, z + dz]);
      }
    }
    front = next;
  }
  return dist;
}

interface FloorShell {
  /** Türzonen: Innenzellen vor Türen samt Nachbarn. */
  readonly doorZone: Set<string>;
  /** Innenzellen vor Fenstern. */
  readonly window: Set<string>;
}

function floorShells(shell: Shell): Map<string, FloorShell> {
  const out = new Map<string, FloorShell>();
  for (const [id, info] of shell.rooms) {
    const doorZone = new Set<string>();
    for (const d of [...info.doors, ...(info.stairs ?? [])]) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) doorZone.add(cellKey(d.inside[0] + dx, d.inside[1] + dz));
    }
    out.set(id, { doorZone, window: new Set(info.windows.map((w) => cellKey(w.inside[0], w.inside[1]))) });
  }
  return out;
}

/**
 * Treppen zwischen `floorIndex` und der Etage darüber im Baukörper `volumeId`, deren Zellen im Kern je eines Raums
 * liegen (Vorprüfung der Kern-Regel), nach Kosten sortiert (Gleichstand: Seed-Hash der Lage). Die volle Prüfung
 * (`checkLink`: Überschneidungen, Baukörper; gesperrte Möbel) folgt erst in Kostenfolge – sie ist teuer.
 */
function candidates(state: ProjectState, volumeId: VolumeId, floorIndex: number, shell: Shell, opts: AutoStairsOptions): Candidate[] {
  const floors = volumeFloors(state, volumeId);
  const lo = floors.find((f) => f.index === floorIndex);
  const up = floors.find((f) => f.index === floorIndex + 1);
  if (lo === undefined || up === undefined) return [];
  const rise = up.y0 - lo.y0;
  const corridor = new Set([...STAIR_CIRCULATION, ...(opts.corridorTypes ?? DEFAULT_CORRIDOR_TYPES)]);
  const rank = roomRank(corridor);
  const inVolume = (r: Room) => volumeOf(r) === volumeId;
  const lowers = state.rooms.filter((r) => r.floorIndex === floorIndex && inVolume(r)).sort((a, b) => a.id.localeCompare(b.id));
  const uppers = state.rooms.filter((r) => r.floorIndex === floorIndex + 1 && inVolume(r));
  const upperAt = (c: Cell): Room | undefined => uppers.find((r) => r.cells.has(c[0], c[1]));
  // Kern-Regel vorab je Raum (Zelle samt 8 Nachbarn im Raum), damit die Suche nur nachschlägt
  const cores = new Map([...lowers, ...uppers].map((r) => [r.id, CellSet.of(r.cells.toArray().filter((c) => isCoreCell(r.cells, c)))] as const));
  const inCore = (r: Room, c: Cell, o: Cell): boolean => cores.get(r.id)!.has(c[0] + o[0], c[1] + o[1]);
  const zones = floorShells(shell);
  const edge = new Map(lowers.map((r) => [r.id, edgeDistances(r)] as const));
  // Treppen der Nachbarpaare (gestapelt: Austritt unten ↔ Antritt oben)
  const below: Cell[] = [];
  const above: Cell[] = [];
  for (const l of state.links) {
    if (linkVolume(state, l) !== volumeId) continue;
    const other = floors.find((f) => f.index === l.floorIndex);
    const next = floors.find((f) => f.index === l.floorIndex + 1);
    if (other === undefined || next === undefined) continue;
    try {
      const lay = stairLayout(l, next.y0 - other.y0);
      if (l.floorIndex === floorIndex - 1) below.push(lay.arrival.inside);
      if (l.floorIndex === floorIndex + 1) above.push(lay.bottom.inside);
    } catch {
      // Treppe passt nicht mehr zur Höhe: kein Stapel-Bezug
    }
  }
  const out: Candidate[] = [];
  for (const spec of TYPES) {
    for (const turn of spec.turns) {
      for (const facing of HORIZONTAL) {
        let rel: StairLayout;
        try {
          rel = stairLayout({ type: spec.type, origin: [0, 0], facing, ...(turn !== undefined ? { turn } : {}) }, rise);
        } catch {
          continue; // Art kann den Etagenabstand nicht (Wendel über 7)
        }
        const lowerRel = [...rel.footprint, rel.bottom.inside];
        const upperRel = [...rel.holes, ...rel.top, rel.arrival.inside];
        for (const lower of lowers) {
          for (const origin of lower.cells) {
            if (!lowerRel.every((c) => inCore(lower, c, origin))) continue;
            if (rel.support !== undefined) {
              const s = shift(rel.support, origin);
              if (!lower.cells.has(s[0], s[1])) continue;
            }
            const upper = upperAt(shift(rel.arrival.inside, origin));
            if (upper === undefined || !upperRel.every((c) => inCore(upper, c, origin))) continue;
            const link: VerticalLink = {
              id: `s${state.seq}`, type: spec.type, floorIndex, origin: [origin[0], origin[1]], facing, ...(turn !== undefined ? { turn } : {}),
            };
            const layout = translate(rel, origin);
            out.push({ link, layout, lower, upper, cost: cost(layout, spec.cost, lower, upper, rank, zones, edge.get(lower.id)!, below, above, state.seed) });
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.cost - b.cost);
}

function cost(
  layout: StairLayout, typeCost: number, lower: Room, upper: Room, rank: (id: string) => number, zones: Map<string, FloorShell>, edge: Map<string, number>,
  below: readonly Cell[], above: readonly Cell[], seed: number,
): number {
  let c = typeCost + rank(lower.roomTypeId) + rank(upper.roomTypeId);
  // gestapelt wie ein Treppenkern: Antritt nah am Austritt der Treppe darunter, Austritt nah am Antritt darüber
  const stack = [...below.map((b) => manhattan(b, layout.bottom.inside)), ...above.map((a) => manhattan(a, layout.arrival.inside))];
  if (stack.length > 0) c += 0.3 * Math.min(40, Math.min(...stack));
  // an der Wand: jede Stufe weiter innen als die erste Kernreihe kostet (der Raum bleibt als Fläche nutzbar)
  let inner = 0;
  for (const f of layout.footprint) inner += Math.max(0, (edge.get(cellKey(f[0], f[1])) ?? 6) - 2);
  c += (0.4 * inner) / Math.max(1, layout.footprint.length);
  // Türzonen und Fenster
  const lz = zones.get(lower.id);
  const uz = zones.get(upper.id);
  const lowerCells = [...layout.footprint, layout.bottom.inside];
  const upperCells = [...layout.holes, ...layout.top];
  const hits = (cells: readonly Cell[], set: Set<string> | undefined): number => (set === undefined ? 0 : cells.filter((x) => set.has(cellKey(x[0], x[1]))).length);
  c += 3 * hits(layout.footprint, lz?.doorZone) + 3 * hits(upperCells, uz?.doorZone);
  c += 1.5 * hits(lowerCells, lz?.window) + 1 * hits(upperCells, uz?.window);
  // Gleichstand: Seed-Hash der Lage (deterministisch, unabhängig von der Reihenfolge der Suche)
  const o = layout.footprint[0]!;
  return c + (hashSeed(seed, 'auto-stairs', o[0], o[1], layout.bottom.toward, layout.blocks.length) / 2 ** 32) * 0.01;
}

// ------------------------------------------------------------------ Plan

/** Proben je Raumpaar, bevor das nächste Paar drankommt (W8-E-Prüfung ist teuer: Probe-Hülle + Solver). */
const PROBES_PER_PAIR = 3;

const probeShell = (state: ProjectState, corridorTypes: readonly string[] | undefined): Shell =>
  deriveShell(state, { roof: 'gable', ...(corridorTypes !== undefined ? { corridorTypes } : {}) });

/**
 * Plant die Treppen, die jede Etage mit Räumen erreichbar machen (je Baukörper). Leer, wenn schon alles verbunden ist
 * – dann bleibt das Projekt bitgleich. Vorhandene Treppen bleiben unangetastet.
 */
export function planAutoStairs(state: ProjectState, opts: AutoStairsOptions = {}): AutoStairsPlan {
  const old = opts.since === undefined ? [] : disconnectedFloors(opts.since);
  const pairs = disconnectedFloors(state).filter((p) => !old.some((o) => o.volumeId === p.volumeId && o.floorIndex === p.floorIndex));
  if (pairs.length === 0) return { stairs: [], gaps: [] };
  const furnishable = opts.catalog === undefined ? undefined : catalogFurnishable(opts.catalog);
  const probes = opts.probes ?? 24;
  const stairs: AutoStair[] = [];
  const gaps: AutoStairGap[] = [];
  let st = state;
  for (const pair of pairs) {
    // ein früheres Paar kann dieses schon verbunden haben (nie bei Ketten, sicherheitshalber)
    if (!disconnectedFloors(st).some((p) => p.volumeId === pair.volumeId && p.floorIndex === pair.floorIndex)) continue;
    const shell = probeShell(st, opts.corridorTypes);
    const list = candidates(st, pair.volumeId, pair.floorIndex, shell, opts);
    const missing = (sh: Shell, room: Room): readonly string[] => {
      const info: RoomShellInfo | undefined = sh.rooms.get(room.id);
      return furnishable === undefined || info === undefined ? [] : furnishable(room.roomTypeId, info);
    };
    let chosen: Candidate | undefined;
    let valid = 0;
    // je Raumpaar nur wenige Proben: scheitert ein Paar (zu kleiner Raum), kommt das nächste Paar dran
    const failed = new Map<string, number>();
    for (const cand of list) {
      const pairKey = `${cand.lower.id}>${cand.upper.id}`;
      if ((failed.get(pairKey) ?? 0) >= PROBES_PER_PAIR) continue;
      if (typeof checkLink(st, cand.link) === 'string') continue;
      if (opts.catalog !== undefined && fixedFurnitureInStairs(st, opts.catalog, cand.link) !== undefined) continue;
      if (furnishable === undefined) {
        chosen = cand;
        break;
      }
      if (++valid > probes) break;
      const next = { ...st, links: [...st.links, cand.link], seq: st.seq + 1 };
      const sh = probeShell(next, opts.corridorTypes);
      const worse = [cand.lower, cand.upper].some((r) => {
        const before = new Set(missing(shell, r));
        return missing(sh, r).some((t) => !before.has(t));
      });
      if (!worse) {
        chosen = cand;
        break;
      }
      failed.set(pairKey, (failed.get(pairKey) ?? 0) + 1);
    }
    if (chosen === undefined && valid === 0) {
      gaps.push({ ...pair, reason: 'no_overlap' });
      continue;
    }
    if (chosen === undefined) {
      gaps.push({ ...pair, reason: 'unplayable' });
      continue;
    }
    const l = chosen.link;
    stairs.push({
      floorIndex: l.floorIndex, origin: l.origin, facing: l.facing, type: l.type, ...(l.turn !== undefined ? { turn: l.turn } : {}),
      lowerRoomId: chosen.lower.id, upperRoomId: chosen.upper.id,
    });
    st = { ...st, links: [...st.links, l], seq: st.seq + 1 };
  }
  return { stairs, gaps };
}

/**
 * Plant und setzt die Treppen auf `project` (je eine `placeStairs`-Aktion; im Editor läuft das innerhalb der Aktion,
 * die die Etage getrennt hat – ein Undo-Schritt). Liefert den Plan für die Statuszeile.
 */
export function applyAutoStairs(project: Project, opts: AutoStairsOptions = {}): AutoStairsPlan {
  const plan = planAutoStairs(project.state, opts);
  for (const s of plan.stairs) project.placeStairs(s.floorIndex, s.origin, s.facing, s.type, s.turn !== undefined ? { turn: s.turn } : {});
  return plan;
}

// ------------------------------------------------------------------ Texte

/** Etagenname wie in der App: EG, 1. OG, 1. UG. */
export const storyLabel = (index: number): string => (index === 0 ? 'EG' : index > 0 ? `${index}. OG` : `${-index}. UG`);

/**
 * Statuszeile, z. B. „Treppe automatisch gesetzt: EG ↔ 1. OG in Eingangshalle“; mehrere mit „ · “, Lücken mit Grund.
 * Leer, wenn nichts zu melden ist.
 */
export function autoStairsText(plan: AutoStairsPlan, state: ProjectState, catalog?: Catalog): string {
  const name = (roomId: string): string => {
    const id = state.rooms.find((r) => r.id === roomId)?.roomTypeId ?? roomId;
    return catalog !== undefined && catalog.roomTypeIds().includes(id) ? catalog.roomType(id).name : id;
  };
  const parts = plan.stairs.map((s) => {
    const lo = name(s.lowerRoomId);
    const up = name(s.upperRoomId);
    return `Treppe automatisch gesetzt: ${storyLabel(s.floorIndex)} ↔ ${storyLabel(s.floorIndex + 1)} in ${lo === up ? lo : `${lo} → ${up}`}`;
  });
  for (const g of plan.gaps) {
    const why = g.reason === 'no_overlap'
      ? 'kein Raum liegt groß genug übereinander – Räume überlappen lassen oder die Treppe von Hand setzen (T)'
      : 'jede Stelle nähme einem Raum ein Pflichtmöbel – Treppe von Hand setzen (T)';
    parts.push(`Keine Treppe ${storyLabel(g.floorIndex)} ↔ ${storyLabel(g.floorIndex + 1)}: ${why}`);
  }
  return parts.join(' · ');
}
