/**
 * Pipeline-Schritt 4a „Kontext“ (research/12 §3.0, §4, §7.1): je Hüllzelle die Größen, von denen Muster,
 * Verläufe und Verwitterung abhängen. Rein aus der Hülle (ShellCell: kind/role/roomId/exterior) und der
 * Raumsicht (RoomShellInfo) berechnet, ändert nichts. Deterministisch und unabhängig von der Zellreihenfolge.
 *
 * Koordinaten für das Rauschen sind 2D in der Ebene der Fläche (`plane`, `a`, `b`): Boden/Decke (x, z),
 * Dach (x, z), Wand (entlang der Wand, y). So hat jede Fläche eine exakt gleichverteilte Cluster-Mischung.
 *
 * Etagen: Wandspalten und Innenflächen gelten je Etage (Raum → `floorIndex`), damit sich Muster übereinander
 * liegender Etagen nicht mischen (Türschwelle oben über einer Tür unten).
 * Zellen anderer Kontexte (I2):
 *  - Gelände/Vegetation (`terrain`, `plant`): EINE Ebene (x, z) für alles Gelände → Flecken laufen über
 *    Höhenstufen weiter (Wiese, Wege, Hof als echte Cluster statt weißem Rauschen).
 *  - Bauwerke (`fort`): Wandebene entlang des Mauerlaufs (Laufrichtung aus den Nachbarn derselben Höhe),
 *    waagerechte Flächen (Turmböden, Plattformen) in der Ebene (x, z); `wall_h` läuft vom Fuß bis zur Krone
 *    der Spalte, `roof_t` der Turmdächer von der Traufe bis zur Spitze des jeweiligen Bauwerks.
 */
import type { RoomShellInfo, Shell, ShellCell, ShellKind } from '@mcda/blueprint';
import type { GradientAxis } from '@mcda/catalog';
import { hashSeed, key3, type HorizontalDir } from '@mcda/core';
import { capturedAttributes, captureCandidate, type CellAttributes } from './attributes.js';

/** Numerischer Spaltenschlüssel (x, z) für Maps (schneller als Zeichenketten; |x|, |z| < 32768). */
export const colKey = (x: number, z: number): number => (x + 0x8000) * 0x10000 + (z + 0x8000);

/** `ground` = Gelände und Vegetation (Kontext Gelände). */
export type SurfaceKind = 'floor' | 'wall' | 'ceiling' | 'roof' | 'ground';
export type Axis2 = 'x' | 'z';

/** Innenfläche eines Raums mit raumlokalen Koordinaten (u entlang der langen Achse, v quer). */
export interface RoomFrame {
  readonly roomId: string;
  readonly roomType?: string;
  readonly baseY: number;
  /** Lichte Höhe = Anzahl der Wandreihen. */
  readonly H: number;
  readonly uAxis: Axis2;
  readonly vAxis: Axis2;
  /** Ursprung der Innenfläche (Minimum). */
  readonly minX: number;
  readonly minZ: number;
  /** Ausdehnung der Innenfläche entlang u bzw. v. */
  readonly uLen: number;
  readonly vLen: number;
  /** Chebyshev-Abstand zur Wand je Innenzelle (1 = Randring); Schlüssel `colKey(x, z)`. */
  readonly dist: ReadonlyMap<number, number>;
  readonly dMax: number;
  /** Schritte (4er-Nachbarschaft) von der nächsten Tür-Innenzelle; Schlüssel `colKey(x, z)`. */
  readonly doorDist: ReadonlyMap<number, number>;
  /** Haupttür (bzw. erste Tür): Innenzelle und Richtung zur Tür. */
  readonly mainDoor?: { readonly x: number; readonly z: number; readonly toward: HorizontalDir };
}

export interface CellContext {
  readonly surface: SurfaceKind;
  readonly kind: ShellKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Additiv (research/30 K8): stabile Zell-`id` der Hülle, falls `ShellOptions.stableCellIds` gesetzt war. */
  readonly cellId?: number;
  /** Raum der Zelle (Boden/Decke: Raum der Innenfläche, sonst Träger-Raum). */
  readonly roomId?: string;
  readonly roomType?: string;
  readonly frame?: RoomFrame;
  /** Außenwand bzw. Boden/Decke unter/über einer Außenwand; Dach immer. */
  readonly exterior: boolean;
  /** Wandreihe über der Bodenplatte (0 = erste Reihe); Bodenplatte −1, Decke H. */
  readonly hRel: number;
  /** Lichte Höhe (Wandreihen) des Raums. */
  readonly H: number;
  /** Boden/Decke: 0 = unter/über einer Wandspalte, sonst Chebyshev-Abstand zur Wand (1 = Randring). Wand: 0. */
  readonly wallDist: number;
  /** Boden/Decke unter/über einer Türspalte. */
  readonly door: boolean;
  /** Türschwelle: Raumtypen der Räume beiderseits der Tür (ohne Außenseite). */
  readonly doorSideTypes?: readonly string[];
  /** Boden/Decke im Ring: Ecke (Wand in zwei Richtungen oder nur diagonal); Spalte: Pfeiler/Ecke. */
  readonly corner: boolean;
  /** Richtung der Wand, an der die Zelle liegt (Wand: Laufrichtung; Ring: parallel zur nächsten Wand). */
  readonly wallAxis?: Axis2;
  /** Wand: Nachbarspalte entlang der Wand ist Pfeiler, Tür oder Fenster (Kante). */
  readonly edge: boolean;
  /** Raumlokal (Innenfläche), 0-basiert. */
  readonly u: number;
  readonly v: number;
  /** Schritte von der nächsten Tür (Infinity ohne Tür). */
  readonly doorDist: number;
  /** Rausch-Ebene und 2D-Koordinaten darin. */
  readonly plane: number;
  readonly a: number;
  readonly b: number;
  /** Verlaufsparameter 0–1 je Achse (fehlende Achse → der Resolver nimmt 0,5). */
  readonly t: Readonly<Partial<Record<GradientAxis, number>>>;
  /**
   * Schrittweite jeder Verlaufsachse in t-Einheiten = **eine Reihe/ein Block** dieser Achse (research/30 K2).
   * `gradient.fade` rechnet damit „Reihen“ in t um. Ohne Angabe gilt die Achse als konstant (Schrittweite 1).
   */
  readonly tStep?: Readonly<Partial<Record<GradientAxis, number>>>;
  /** Additiv (F1): Geschoss (Raum → Etage; Zellen ohne Raum, Gelände, Bauwerke: 0). */
  readonly storey: number;
  /** Additiv (F1): an dieser Spalte liegt keine Etage darüber (Wand, Boden, Decke); Dach, Gelände, Bauwerke: true. */
  readonly topStorey: boolean;
  /**
   * Additiv (W2, I3): an dieser Spalte liegt keine Etage darunter (kein Raum, keine Wand der Etage `storey − 1`).
   * Fehlt = unterstes Geschoss (Dach, Gelände, Bauwerke und von Hand gebaute Kontexte).
   */
  readonly bottomStorey?: boolean;
  /** Additiv (F1, research/12 §3.0): Wandlinie der Spalte und Position darin – nur gerade Wandspalten eines Gebäudes. */
  readonly line?: WallLine;
  readonly along?: number;
  /** Additiv (F1): Lage zu einer Tür-/Fensterzelle in der Wandebene (daneben, darüber, darunter). */
  readonly openingSide?: 'beside' | 'above' | 'below';
  /** Additiv (research/16 D12): Dachtreppe an einem Grat (Soll-Form outer_*) bzw. in einer Kehle (inner_*). */
  readonly roofLine?: 'hip' | 'valley';
  /**
   * Additiv (research/30 K7, Capture): von der Trägerwand geerbte Attribute – nur mit
   * `MaterializeOptions.captureAttributes`, sonst `undefined` (alle Ergebnisse bleiben dann bitgleich).
   */
  readonly attrs?: CellAttributes;
  /**
   * Additiv (W13-E): die Hülle trägt `Shell.upperFrame` (Bautyp mit eigenem Wandkleid der Obergeschosse) – für
   * `when.upperFrame` der Flächen-Regeln. Fehlt sonst.
   */
  readonly upperFrame?: true;
}

/**
 * Wandlinie einer Etage (research/12 §3.0 `seg`/`along`/`len`): zusammenhängende Wandspalten entlang einer Achse,
 * von Ecke zu Ecke und durch T-Stöße hindurch (die ganze Fassade einer Etage). Theme-unabhängig; den Feldrhythmus
 * (`bay`, `post`, `nearOpening`) rechnet das Fachwerk-Muster daraus (timber.ts).
 */
export interface WallLine {
  /** Kennung (Etage, Achse, Lage, Anfang) für die Motivwahl. */
  readonly key: number;
  readonly axis: Axis2;
  readonly len: number;
  /** Spalten ohne Laufrichtung (Ecke, T, Kreuz, Wandende): feste Ständer. */
  readonly pillar: readonly boolean[];
  /** Spalten mit Tür oder Fenster in den Wandreihen der Etage (Giebel- und Gaubenfenster zählen nicht). */
  readonly opening: readonly boolean[];
  /** Giebelwand: die Oberkante der Wand steigt entlang der Linie um ≥ 2 (Dreieck statt Traufwand/Kniestock). */
  readonly gable: boolean;
  /**
   * Additiv (W2, Baustandard W2/F1): Pfostenspalten des Fassadenrasters der Hülle (`Shell.facadeGrid`) auf dieser
   * Linie – das Fachwerk stellt seine Ständer dorthin, damit sie mit Wandvorlagen und Fenstermodulen fluchten. Fehlt
   * ohne Raster (bisheriges Verhalten).
   */
  readonly grid?: readonly boolean[];
}

const WALLISH: ReadonlySet<ShellKind> = new Set<ShellKind>(['wall', 'pillar', 'door', 'window', 'lintel']);
const N4: readonly (readonly [number, number, HorizontalDir])[] = [[1, 0, 'east'], [-1, 0, 'west'], [0, 1, 'south'], [0, -1, 'north']];
const N8: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

interface Column {
  readonly kinds: Set<ShellKind>;
  exterior: boolean;
  /** W4: Die Spalte hat Zellen in den Wandreihen ihrer Etage (nicht nur Gaube/Giebel/Kniestock darüber) … */
  storey: boolean;
  /** … und davon mindestens eine Außenwandzelle. */
  storeyExterior: boolean;
}

function roomFrame(info: RoomShellInfo, roomType: string | undefined): RoomFrame {
  const cells = [...info.interior];
  const inside = new Set(cells.map(([x, z]) => colKey(x, z)));
  // Chebyshev-Abstand zur Wand: BFS in der 8er-Nachbarschaft, Start = Zellen mit Nachbar außerhalb der Innenfläche
  const dist = new Map<number, number>();
  let queue: (readonly [number, number])[] = [];
  for (const [x, z] of cells) {
    if (N8.some(([dx, dz]) => !inside.has(colKey(x + dx, z + dz)))) {
      dist.set(colKey(x, z), 1);
      queue.push([x, z]);
    }
  }
  for (let d = 2; queue.length > 0; d++) {
    const next: (readonly [number, number])[] = [];
    for (const [x, z] of queue) {
      for (const [dx, dz] of N8) {
        const k = colKey(x + dx, z + dz);
        if (inside.has(k) && !dist.has(k)) {
          dist.set(k, d);
          next.push([x + dx, z + dz]);
        }
      }
    }
    queue = next;
  }
  let dMax = 0;
  for (const d of dist.values()) dMax = Math.max(dMax, d);
  // Tür-Abstand: BFS in der 4er-Nachbarschaft von den Tür-Innenzellen
  const doorDist = new Map<number, number>();
  let dq: (readonly [number, number])[] = [];
  for (const d of info.doors) {
    const k = colKey(d.inside[0], d.inside[1]);
    if (inside.has(k) && !doorDist.has(k)) {
      doorDist.set(k, 0);
      dq.push(d.inside);
    }
  }
  for (let d = 1; dq.length > 0; d++) {
    const next: (readonly [number, number])[] = [];
    for (const [x, z] of dq) {
      for (const [dx, dz] of N4) {
        const k = colKey(x + dx, z + dz);
        if (inside.has(k) && !doorDist.has(k)) {
          doorDist.set(k, d);
          next.push([x + dx, z + dz]);
        }
      }
    }
    dq = next;
  }
  const b = info.interior.bounds() ?? { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  const w = b.maxX - b.minX + 1;
  const dz = b.maxZ - b.minZ + 1;
  const uAxis: Axis2 = w >= dz ? 'x' : 'z';
  const main = info.doors.find((d) => d.isMain) ?? info.doors[0];
  return {
    roomId: info.roomId,
    ...(roomType !== undefined ? { roomType } : {}),
    baseY: info.baseY,
    H: info.height,
    uAxis,
    vAxis: uAxis === 'x' ? 'z' : 'x',
    minX: b.minX,
    minZ: b.minZ,
    uLen: uAxis === 'x' ? w : dz,
    vLen: uAxis === 'x' ? dz : w,
    dist,
    dMax,
    doorDist,
    ...(main !== undefined ? { mainDoor: { x: main.inside[0], z: main.inside[1], toward: main.toward } } : {}),
  };
}

/** Raumlokale Koordinaten (u, v) einer Spalte. */
export function roomUV(f: RoomFrame, x: number, z: number): { u: number; v: number } {
  const dx = x - f.minX;
  const dz = z - f.minZ;
  return f.uAxis === 'x' ? { u: dx, v: dz } : { u: dz, v: dx };
}

/** Zellen anderer Kontexte, die nicht zum Gebäude gehören (eigene Zweige, zählen nicht für Gebäude-Höhen). */
const FOREIGN: ReadonlySet<ShellKind> = new Set<ShellKind>(['terrain', 'plant', 'fort']);

/** Schlüssel (Etage, x, z) für Spalten und Innenflächen je Etage. */
const floorKey = (f: number, x: number, z: number): number => f * 0x100000000 + colKey(x, z);
/** Schlüssel (x, y, z) für Bauwerkszellen (|y| < 2048). */
const posKey = (x: number, y: number, z: number): number => (y + 2048) * 0x100000000 + colKey(x, z);

/** W9-G5: Dachrollen der Bauwerke (Turmdach der Mauertürme `roof_tower` wie `roof_main`: `roof_t` je Bauwerk). */
const FORT_ROOF_ROLES: ReadonlySet<string> = new Set(['roof_main', 'roof_tower']);

/** Spalte eines Bauwerks: Fuß und Krone (ohne Dach). */
interface FortColumn {
  min: number;
  max: number;
}

function widen<K>(m: Map<K, FortColumn>, k: K, y: number): void {
  const r = m.get(k);
  if (r === undefined) m.set(k, { min: y, max: y });
  else {
    r.min = Math.min(r.min, y);
    r.max = Math.max(r.max, y);
  }
}

/**
 * W9-G5: Höhenspanne (kleinstes/größtes y) der zusammenhängenden Dachfläche je Dachzelle (26er-Nachbarschaft, damit
 * die diagonal steigenden Treppenreihen zusammenhängen). Schlüssel `posKey`.
 */
function roofSpans(cells: readonly ShellCell[]): Map<number, FortColumn> {
  const index = new Map<number, number>();
  cells.forEach((c, i) => index.set(posKey(c.pos[0], c.pos[1], c.pos[2]), i));
  const comp = new Array<number>(cells.length).fill(-1);
  const spans: FortColumn[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (comp[i] !== -1) continue;
    const id = spans.length;
    const span = { min: cells[i]!.pos[1], max: cells[i]!.pos[1] };
    spans.push(span);
    comp[i] = id;
    const stack = [i];
    while (stack.length > 0) {
      const [x, y, z] = cells[stack.pop()!]!.pos;
      span.min = Math.min(span.min, y);
      span.max = Math.max(span.max, y);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const j = index.get(posKey(x + dx, y + dy, z + dz));
        if (j === undefined || comp[j] !== -1) continue;
        comp[j] = id;
        stack.push(j);
      }
    }
  }
  const out = new Map<number, FortColumn>();
  cells.forEach((c, i) => out.set(posKey(c.pos[0], c.pos[1], c.pos[2]), spans[comp[i]!]!));
  return out;
}

/**
 * Kontext aller Hüllzellen (gleiche Reihenfolge wie `shell.cells`).
 * @param roomTypes Raum-ID → Raumtyp-ID (für `when.roomTypes` der Flächen-Regeln); optional.
 */
export function shellContext(
  shell: Shell,
  roomTypes: Readonly<Record<string, string>> = {},
  opts: { readonly capture?: boolean; readonly relative?: boolean } = {},
): CellContext[] {
  /**
   * K8: Mit stabilen Zell-`id`s wird das Rauschfeld in **hausrelativen** Koordinaten ausgewertet – sonst wandert
   * die Textur beim Verschieben mit, obwohl die `id` gleich bleibt. Gelände und Pflanzen bleiben ortsgebunden
   * (die Wiese gehört zum Grundstück, nicht zum Haus).
   */
  const rel = opts.relative === true;
  // Ursprung bewusst aus den **Hauszellen** (ohne Gelände/Pflanzen): „hausrelativ" heißt am Haus, nicht am
  // Grundstücksrand. Und als Schleife statt `Math.min(...array)` – bei großen Bases (>100 000 Zellen) bricht
  // die Spread-Schreibweise mit einem RangeError ab (Review 4).
  let ox = 0;
  let oz = 0;
  if (rel) {
    let minX = Infinity;
    let minZ = Infinity;
    for (const cell of shell.cells) {
      if (cell.kind === 'terrain' || cell.kind === 'plant') continue;
      if (cell.pos[0] < minX) minX = cell.pos[0];
      if (cell.pos[2] < minZ) minZ = cell.pos[2];
    }
    if (minX !== Infinity) {
      ox = minX;
      oz = minZ;
    }
  }
  const rx = (x: number, kind: ShellKind): number => (rel && kind !== 'terrain' && kind !== 'plant' ? x - ox : x);
  const rz = (z: number, kind: ShellKind): number => (rel && kind !== 'terrain' && kind !== 'plant' ? z - oz : z);
  const typeOf = (id: string | undefined): string | undefined => (id !== undefined && Object.hasOwn(roomTypes, id) ? roomTypes[id] : undefined);
  /** Etage einer Zelle über ihren Raum (Zellen ohne Raum: Etage 0). */
  const floorOf = (c: ShellCell): number => (c.roomId !== undefined ? shell.rooms.get(c.roomId)?.floorIndex ?? 0 : 0);

  // Wandspalten je Etage: Arten und Außenlage; Gebäude-Höhen nur aus Zellen des Gebäudes
  const cols = new Map<number, Column>();
  let minY = Infinity;
  let maxY = -Infinity;
  // W9-G5 (Materialspiel): `roof_t` je zusammenhängender Dachfläche (26er-Nachbarschaft), nicht über alle Dächer des
  // Gebäudes – sonst hob das Flachdach des Bergfrieds das Maximum, und das Palasdach blieb ganz im Traufton (Burg:
  // alle Dachzellen unter t = 0,4). Gauben und Anbaudächer hängen an ihrer Hauptfläche und laufen mit ihr.
  const roofCells: ShellCell[] = [];
  // Bauwerke: belegte Positionen, Spalten (Fuß/Krone ohne Dach), Dachhöhen je Bauwerk
  const fortCells = new Set<number>();
  const fortCols = new Map<number, FortColumn>();
  const fortRoof = new Map<string, FortColumn>();
  // Öffnungen (F1): Tür-/Fensterzellen je Position und Spalten mit Öffnung in den Wandreihen ihrer Etage
  const openPos = new Set<number>();
  const openCols = new Set<number>();
  /** Oberkante (größtes y) der wandartigen Zellen je Spalte und Etage. */
  const colTop = new Map<number, number>();
  for (const c of shell.cells) {
    const [x, y, z] = c.pos;
    if (c.kind === 'fort') {
      fortCells.add(posKey(x, y, z));
      if (FORT_ROOF_ROLES.has(c.role)) widen(fortRoof, c.roomId ?? '-', y);
      else widen(fortCols, colKey(x, z), y);
      continue;
    }
    if (FOREIGN.has(c.kind)) continue;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    if (c.kind === 'roof') roofCells.push(c);
    if (!WALLISH.has(c.kind)) continue;
    if (c.kind === 'door' || c.kind === 'window') {
      openPos.add(posKey(x, y, z));
      const info = c.roomId !== undefined ? shell.rooms.get(c.roomId) : undefined;
      if (info !== undefined && y >= info.baseY && y < info.baseY + info.height) openCols.add(floorKey(info.floorIndex, x, z));
    }
    const k = floorKey(floorOf(c), x, z);
    colTop.set(k, Math.max(colTop.get(k) ?? -Infinity, y));
    let col = cols.get(k);
    if (col === undefined) {
      col = { kinds: new Set(), exterior: false, storey: false, storeyExterior: false };
      cols.set(k, col);
    }
    col.kinds.add(c.kind);
    if (c.exterior === true) col.exterior = true;
    const info = c.roomId !== undefined ? shell.rooms.get(c.roomId) : undefined;
    if (info === undefined || y < info.baseY + info.height) {
      col.storey = true;
      if (c.exterior === true) col.storeyExterior = true;
    }
  }
  const roofSpan = roofSpans(roofCells);
  const isCol = (f: number, x: number, z: number): boolean => cols.has(floorKey(f, x, z));
  const isExtCol = (f: number, x: number, z: number): boolean => cols.get(floorKey(f, x, z))?.exterior === true;
  /**
   * Laufrichtung einer Wandspalte; Ecken, T, Kreuze und freie Pfeiler haben keine. W2 (X1 §5.1 Punkt 4, Außenhaut
   * `skin`): Eine Außenwand-Spalte ohne Pfeiler richtet sich nur nach ihren **Außenwand**-Nachbarn – ein
   * Innenwand-Anschluss liegt dann im Fassadenfeld (Laufrichtung, Rausch-Ebene und Wandlinie der Fassade, kein
   * Fachwerk-Ständer). Ohne `skin` ist jeder solche Anschluss ein Pfeiler und das Ergebnis unverändert.
   */
  const colAxis = (f: number, x: number, z: number): Axis2 | undefined => {
    const col = cols.get(floorKey(f, x, z));
    // W4 (27.09.2026, Review S5): Eine Wandspalte der Etage richtet sich nur nach Nachbarn, die ebenfalls in den
    // Wandreihen stehen – Gaubenwangen über der Traufe machten die Fassadenspalten darunter zu „Pfeilern“ (drei
    // Fachwerk-Ständer nebeneinander unter jeder Gaube, dazu fielen die Rasterpfosten daneben weg)
    const storeyOnly = col?.storey === true;
    const nb = !storeyOnly
      ? (col?.exterior === true ? isExtCol : isCol)
      : col.storeyExterior
        ? (ff: number, xx: number, zz: number): boolean => cols.get(floorKey(ff, xx, zz))?.storeyExterior === true
        : (ff: number, xx: number, zz: number): boolean => cols.get(floorKey(ff, xx, zz))?.storey === true;
    const ex = nb(f, x + 1, z) || nb(f, x - 1, z);
    const ez = nb(f, x, z + 1) || nb(f, x, z - 1);
    if (col?.kinds.has('pillar') === true) return undefined;
    if (ex && !ez) return 'x';
    if (ez && !ex) return 'z';
    return undefined;
  };

  // Räume: Innenflächen je Etage
  const frames = new Map<string, RoomFrame>();
  const owner = new Map<number, string>();
  for (const [id, info] of shell.rooms) {
    frames.set(id, roomFrame(info, typeOf(id)));
    for (const [x, z] of info.interior) owner.set(floorKey(info.floorIndex, x, z), id);
  }

  const buildingT = (y: number): number => (maxY > minY ? (y - minY) / (maxY - minY) : 0.5);
  /** t-Schrittweite je Reihe: eine Reihe der Gebäudehöhe bzw. der Wand (research/30 K2). */
  const buildingStep = (): number => (maxY > minY ? 1 / (maxY - minY) : 1);
  const wallStep = (H: number): number => (H > 1 ? 1 / (H - 1) : 1);
  /**
   * W5 (Baustandard): **ein** Fassadenverlauf über das ganze Gebäude. 0 = Bodenplatte des Erdgeschosses (Sockel),
   * 1 = oberste Wandreihe des höchsten Geschosses (Traufe). Absolut in y, damit Bänder über versetzte Baukörper
   * (Palas/Bergfried) in gleicher Höhe laufen; Giebel über der Traufe bleiben bei 1, Keller unter dem Sockel bei 0.
   */
  let footY = Infinity;
  let eaveY = -Infinity;
  for (const info of shell.rooms.values()) {
    if (info.floorIndex >= 0) footY = Math.min(footY, info.baseY - 1);
    eaveY = Math.max(eaveY, info.baseY + info.height - 1);
  }
  if (footY === Infinity) footY = minY;
  const facadeSpan = eaveY - footY;
  const facadeT = (y: number): number => (facadeSpan > 0 ? clamp01((y - footY) / facadeSpan) : 0.5);
  const facadeStep = facadeSpan > 0 ? 1 / facadeSpan : 1;


  /** Je Wandspalte einmal: Laufrichtung, Kante (Nachbar Pfeiler/Tür/Fenster), Rausch-Ebene. */
  const wallCols = new Map<number, { readonly wallAxis: Axis2 | undefined; readonly edge: boolean; readonly plane: number }>();
  const edgeKinds = (f: number, nx: number, nz: number): boolean => {
    const n = cols.get(floorKey(f, nx, nz));
    return n !== undefined && (n.kinds.has('pillar') || n.kinds.has('door') || n.kinds.has('window'));
  };
  const wallColumn = (f: number, x: number, z: number): { readonly wallAxis: Axis2 | undefined; readonly edge: boolean; readonly plane: number } => {
    const k = floorKey(f, x, z);
    let w = wallCols.get(k);
    if (w === undefined) {
      const wallAxis = colAxis(f, x, z);
      const edge = wallAxis === 'x' ? edgeKinds(f, x + 1, z) || edgeKinds(f, x - 1, z) : wallAxis === 'z' ? edgeKinds(f, x, z + 1) || edgeKinds(f, x, z - 1) : true;
      // K8-Reparatur (W2, P0-B S1): Die Ebene ist die Saat des Rauschfelds – mit stabilen IDs aus **hausrelativen**
      // Koordinaten, damit das Muster beim Verschieben stehen bleibt und Nachbarzellen einer Wand ihre Flecken teilen
      // (ohne IDs ist `rx`/`rz` die Identität: bitgleich zu vorher).
      const plane = wallAxis === 'x' ? hashSeed('wall', 'x', rz(z, 'wall')) : wallAxis === 'z' ? hashSeed('wall', 'z', rx(x, 'wall')) : hashSeed('post', rx(x, 'wall'), rz(z, 'wall'));
      w = { wallAxis, edge, plane };
      wallCols.set(k, w);
    }
    return w;
  };
  /** Keine Etage darüber an dieser Spalte (weder Wand noch Innenfläche der Etage f + 1). */
  const topAt = (f: number, x: number, z: number): boolean => !isCol(f + 1, x, z) && !owner.has(floorKey(f + 1, x, z));
  /** W2 (I3): keine Etage darunter an dieser Spalte (weder Wand noch Innenfläche der Etage f − 1). */
  const bottomAt = (f: number, x: number, z: number): boolean => !isCol(f - 1, x, z) && !owner.has(floorKey(f - 1, x, z));

  // W2: Pfosten des Fassadenrasters je (Etage, Laufachse, Wandebene) – Nord/Süd laufen entlang x (Ebene z)
  const gridPosts = new Map<string, ReadonlySet<number>>();
  for (const g of shell.facadeGrid ?? []) {
    const axis: Axis2 = g.out === 'north' || g.out === 'south' ? 'x' : 'z';
    const k = `${g.floorIndex}|${axis}|${g.plane}`;
    gridPosts.set(k, new Set([...(gridPosts.get(k) ?? []), ...g.posts]));
  }
  // Wandlinien (F1): je Etage und Achse von Ecke zu Ecke, einmal je Linie berechnet
  const lines = new Map<number, WallLine>();
  const lineAt = (f: number, x: number, z: number, axis: Axis2): { readonly line: WallLine; readonly along: number } => {
    const [dx, dz] = axis === 'x' ? [1, 0] : [0, 1];
    let sx = x;
    let sz = z;
    while (isCol(f, sx - dx, sz - dz)) {
      sx -= dx;
      sz -= dz;
    }
    const along = x - sx + (z - sz);
    const k = floorKey(f, sx, sz) * 2 + (axis === 'x' ? 0 : 1);
    let line = lines.get(k);
    if (line === undefined) {
      const pillar: boolean[] = [];
      const opening: boolean[] = [];
      let lo = Infinity;
      let hi = -Infinity;
      for (let cx = sx, cz = sz; isCol(f, cx, cz); cx += dx, cz += dz) {
        pillar.push(colAxis(f, cx, cz) === undefined);
        opening.push(openCols.has(floorKey(f, cx, cz)));
        const top = colTop.get(floorKey(f, cx, cz))!;
        lo = Math.min(lo, top);
        hi = Math.max(hi, top);
      }
      const key = hashSeed('line', f, axis, axis === 'x' ? sz : sx, axis === 'x' ? sx : sz);
      const posts = gridPosts.get(`${f}|${axis}|${axis === 'x' ? sz : sx}`);
      const grid = posts === undefined ? undefined : pillar.map((_, i) => posts.has((axis === 'x' ? sx : sz) + i));
      line = { key, axis, len: pillar.length, pillar, opening, gable: hi - lo >= 2, ...(grid !== undefined ? { grid } : {}) };
      lines.set(k, line);
    }
    return { line, along };
  };
  /** Lage zu einer Tür-/Fensterzelle in der Wandebene; Nachbarn entlang der Laufrichtung zählen als „daneben“. */
  const openingSide = (x: number, y: number, z: number, axis: Axis2): 'beside' | 'above' | 'below' | undefined => {
    const [dx, dz] = axis === 'x' ? [1, 0] : [0, 1];
    if (openPos.has(posKey(x + dx, y, z + dz)) || openPos.has(posKey(x - dx, y, z - dz))) return 'beside';
    if (openPos.has(posKey(x, y + 1, z))) return 'below';
    if (openPos.has(posKey(x, y - 1, z))) return 'above';
    return undefined;
  };

  const planes = new Map<string, number>();
  const flatPlane = (kind: string, y: number): number => {
    const k = `${kind}${y}`;
    let p = planes.get(k);
    if (p === undefined) {
      p = hashSeed(kind, y);
      planes.set(k, p);
    }
    return p;
  };
  const roofPlane = hashSeed('roof');
  const groundPlane = hashSeed('ground');

  /** Laufrichtung einer Bauwerkszelle aus den Nachbarn derselben Höhe (± 2 Blöcke); Gleichstand → keine. */
  const fortAxis = (x: number, y: number, z: number): Axis2 | undefined => {
    let nx = 0;
    let nz = 0;
    for (const d of [-2, -1, 1, 2]) {
      if (fortCells.has(posKey(x + d, y, z))) nx++;
      if (fortCells.has(posKey(x, y, z + d))) nz++;
    }
    return nx > nz ? 'x' : nz > nx ? 'z' : undefined;
  };

  const fortContext = (c: ShellCell): CellContext => {
    const [x, y, z] = c.pos;
    const building_h = buildingT(y);
    const common = {
      kind: c.kind, x, y, z,
      ...(c.roomId !== undefined ? { roomId: c.roomId } : {}),
      exterior: true, wallDist: 0, door: false, u: 0, v: 0, doorDist: Infinity, storey: 0, topStorey: true,
    } as const;
    if (FORT_ROOF_ROLES.has(c.role)) {
      const r = fortRoof.get(c.roomId ?? '-');
      const roof_t = r !== undefined && r.max > r.min ? (y - r.min) / (r.max - r.min) : 0.5;
      const roofStep = r !== undefined && r.max > r.min ? 1 / (r.max - r.min) : 1;
      return {
        ...common, surface: 'roof', hRel: 0, H: 0, corner: false, edge: roof_t === 0,
        plane: hashSeed('fort-roof', c.roomId ?? '-'), a: x, b: z, t: { roof_t, building_h },
        tStep: { roof_t: roofStep, building_h: buildingStep() },
      };
    }
    const col = fortCols.get(colKey(x, z)) ?? { min: y, max: y };
    const hRel = y - col.min;
    const H = col.max - col.min + 1;
    const axis = fortAxis(x, y, z);
    return {
      ...common, surface: 'wall', hRel, H,
      corner: axis === undefined,
      ...(axis !== undefined ? { wallAxis: axis } : {}),
      edge: axis === undefined,
      // Wand: Ebene entlang des Laufs (a = Laufkoordinate, b = y); waagerecht (Gleichstand): Ebene (x, z) je Höhe
      plane: axis === 'x' ? hashSeed('fort', 'x', z) : axis === 'z' ? hashSeed('fort', 'z', x) : flatPlane('fort-flat', y),
      a: axis === 'z' ? z : x,
      b: axis === undefined ? z : y,
      // W5: Bauwerke haben keinen Geschossbezug – der Fassadenverlauf ist dort der Verlauf Fuß → Krone (`wall_h`)
      t: { wall_h: H > 1 ? clamp01(hRel / (H - 1)) : 0.5, building_h, facade_h: H > 1 ? clamp01(hRel / (H - 1)) : 0.5 },
      tStep: { wall_h: wallStep(H), building_h: buildingStep(), facade_h: wallStep(H) },
    };
  };

  const out = shell.cells.map((c: ShellCell): CellContext => {
    const [x, y, z] = c.pos;
    // K8: die stabile Zell-id reicht bis in den Kontext (nur vorhanden, wenn die Hülle sie vergibt)
    const cellId = c.id;

    if (c.kind === 'fort') return fortContext(c);
    if (c.kind === 'terrain' || c.kind === 'plant') {
      return {
        surface: 'ground', kind: c.kind, x, y, z,
        ...(cellId !== undefined ? { cellId } : {}),
        exterior: true, hRel: 0, H: 0, wallDist: 0, door: false, corner: false, edge: false,
        u: 0, v: 0, doorDist: Infinity,
        // feat/tiled-wfc: Spiegelpartner eines Musters werten die Mischung am selben Ort aus
        plane: groundPlane, a: rx(c.pickAt?.[0] ?? x, c.kind), b: rz(c.pickAt?.[1] ?? z, c.kind),
        t: {},
        tStep: {},
        storey: 0, topStorey: true,
      };
    }

    const f = floorOf(c);
    const k = floorKey(f, x, z);
    const col = cols.get(k);
    const building_h = buildingT(y);

    if (c.kind === 'floor' || c.kind === 'ceiling') {
      const roomId = owner.get(k) ?? c.roomId;
      const frame = roomId !== undefined ? frames.get(roomId) : undefined;
      const fk = (nx: number, nz: number): number => floorKey(f, nx, nz);
      const inner = colKey(x, z);
      const d = owner.has(k) ? (frame?.dist.get(inner) ?? 1) : col !== undefined ? 0 : 1;
      let corner = false;
      let wallAxis: Axis2 | undefined;
      if (d === 0) {
        wallAxis = wallColumn(f, x, z).wallAxis;
        corner = wallAxis === undefined;
      } else if (frame !== undefined) {
        let hx = false;
        let hz = false;
        for (const [dx, dz] of N4) {
          const nd = owner.get(fk(x + dx, z + dz)) === frame.roomId ? (frame.dist.get(colKey(x + dx, z + dz)) ?? 0) : 0;
          if (nd < d) {
            if (dx !== 0) hx = true;
            else hz = true;
          }
        }
        corner = hx === hz; // zwei Richtungen (konvexe Ecke) oder keine (nur diagonal: einspringende Ecke)
        wallAxis = hx && !hz ? 'z' : hz && !hx ? 'x' : undefined;
      }
      const uv = frame !== undefined ? roomUV(frame, x, z) : { u: 0, v: 0 };
      const H = frame?.H ?? 3;
      const doorDist = col?.kinds.has('door') === true ? 0 : (frame?.doorDist.get(inner) ?? Infinity);
      const floor_d = d === 0 || frame === undefined ? 0 : frame.dMax > 1 ? (d - 1) / (frame.dMax - 1) : 0;
      const roomType = typeOf(roomId);
      const isDoor = col?.kinds.has('door') === true;
      const doorSideTypes = isDoor
        ? [...new Set(N4.map(([dx, dz]) => typeOf(owner.get(fk(x + dx, z + dz)))).filter((t): t is string => t !== undefined))]
        : undefined;
      return {
        surface: c.kind,
        kind: c.kind,
        x, y, z,
        ...(cellId !== undefined ? { cellId } : {}),
        ...(roomId !== undefined ? { roomId } : {}),
        ...(roomType !== undefined ? { roomType } : {}),
        ...(frame !== undefined ? { frame } : {}),
        exterior: col?.exterior ?? false,
        hRel: c.kind === 'floor' ? -1 : H,
        H,
        wallDist: d,
        door: isDoor,
        ...(doorSideTypes !== undefined ? { doorSideTypes } : {}),
        corner,
        ...(wallAxis !== undefined ? { wallAxis } : {}),
        edge: false,
        u: uv.u,
        v: uv.v,
        doorDist,
        plane: flatPlane(c.kind, y),
        a: rx(x, c.kind),
        b: rz(z, c.kind),
        t: {
          wall_h: c.kind === 'floor' ? 0 : 1,
          building_h,
          floor_d,
          path_d: Number.isFinite(doorDist) ? clamp01(doorDist / 4) : 1,
          facade_h: facadeT(y),
        },
        tStep: {
          wall_h: 1,
          building_h: buildingStep(),
          floor_d: frame !== undefined && frame.dMax > 1 ? 1 / (frame.dMax - 1) : 1,
          path_d: 0.25,
          facade_h: facadeStep,
        },
        storey: f,
        topStorey: topAt(f, x, z),
        bottomStorey: bottomAt(f, x, z),
      };
    }

    if (c.kind === 'roof') {
      const { min: roofMin, max: roofMax } = roofSpan.get(posKey(x, y, z)) ?? { min: y, max: y };
      const roof_t = roofMax > roofMin ? (y - roofMin) / (roofMax - roofMin) : 0.5;
      const shape = c.orient?.stairShape;
      const roofLine = shape?.startsWith('outer') === true ? 'hip' : shape?.startsWith('inner') === true ? 'valley' : undefined;
      return {
        surface: 'roof', kind: c.kind, x, y, z,
        ...(cellId !== undefined ? { cellId } : {}),
        ...(c.roomId !== undefined ? { roomId: c.roomId } : {}),
        exterior: true, hRel: 0, H: 0, wallDist: 0, door: false, corner: false, edge: roof_t === 0,
        u: 0, v: 0, doorDist: Infinity,
        plane: roofPlane, a: rx(x, c.kind), b: rz(z, c.kind),
        t: { roof_t, building_h },
        tStep: { roof_t: roofMax > roofMin ? 1 / (roofMax - roofMin) : 1, building_h: buildingStep() },
        storey: f, topStorey: true,
        ...(roofLine !== undefined ? { roofLine } : {}),
      };
    }

    // Wandartige Zellen (wall, pillar, door, window, lintel) sowie Treppen/Geländer der Etagen
    const frame = c.roomId !== undefined ? frames.get(c.roomId) : undefined;
    const baseY = frame?.baseY ?? minY + 1;
    const H = frame?.H ?? 3;
    const hRel = y - baseY;
    const { wallAxis, edge, plane } = wallColumn(f, x, z);
    const roomType = typeOf(c.roomId);
    const straight = wallAxis !== undefined && col !== undefined && WALLISH.has(c.kind) ? wallAxis : undefined;
    const at = straight !== undefined ? lineAt(f, x, z, straight) : undefined;
    const side = straight !== undefined ? openingSide(x, y, z, straight) : undefined;
    return {
      surface: 'wall', kind: c.kind, x, y, z,
        ...(cellId !== undefined ? { cellId } : {}),
      ...(c.roomId !== undefined ? { roomId: c.roomId } : {}),
      ...(roomType !== undefined ? { roomType } : {}),
      ...(frame !== undefined ? { frame } : {}),
      exterior: c.exterior === true,
      hRel, H,
      wallDist: 0,
      door: c.kind === 'door',
      corner: wallAxis === undefined,
      ...(wallAxis !== undefined ? { wallAxis } : {}),
      edge,
      u: 0, v: 0,
      doorDist: Infinity,
      plane,
      a: wallAxis === 'z' ? rz(z, c.kind) : wallAxis === 'x' ? rx(x, c.kind) : 0,
      b: y,
      t: { wall_h: H > 1 ? clamp01(hRel / (H - 1)) : 0.5, building_h, facade_h: facadeT(y) },
      tStep: { wall_h: wallStep(H), building_h: buildingStep(), facade_h: facadeStep },
      storey: f,
      topStorey: topAt(f, x, z),
      bottomStorey: bottomAt(f, x, z),
      ...(at !== undefined ? { line: at.line, along: at.along } : {}),
      ...(side !== undefined ? { openingSide: side } : {}),
    };
  });
  const done = opts.capture === true ? captureAttributes(out) : out;
  // W13-E: Leseport der Hülle für `when.upperFrame` (ohne ihn bleibt jeder Kontext dasselbe Objekt)
  return shell.upperFrame === true ? done.map((c) => ({ ...c, upperFrame: true as const })) : done;
}

/**
 * Capture (research/30 K7): Deko-Zellen in Außenluft erben die Attribute der Trägerwand. Gesucht wird in der
 * Wandebene einen Schritt in x/z (dieselbe Höhe) – die Wand hinter der Deko. Ohne Trägerwand bleibt `attrs` weg
 * (die Zelle verhält sich wie bisher). Der zweite Durchgang ändert **nichts** an den eigenen Feldern, er ergänzt
 * nur `attrs`.
 */
function captureAttributes(contexts: readonly CellContext[]): CellContext[] {
  const byPos = new Map<string, CellContext>();
  for (const c of contexts) byPos.set(key3([c.x, c.y, c.z]), c);
  const out = contexts.slice();
  contexts.forEach((c, i) => {
    if (!captureCandidate(c)) return;
    let source: CellContext | undefined;
    for (const [dx, dz] of N4) {
      const n = byPos.get(key3([c.x + dx, c.y, c.z + dz]));
      if (n !== undefined && n.surface === 'wall' && n.frame !== undefined) source = n;
      if (source !== undefined) break;
    }
    if (source === undefined) return;
    out[i] = { ...c, attrs: capturedAttributes(source) };
  });
  return out;
}
