/**
 * Domänendienst `deriveShell` (plan/03 §4.2): leitet aus den gemalten Räumen die Hülle ab – je Etage Boden,
 * Wände (Außenmaß), Türen, Fenster, Decke, Dach, dazu Treppen mit Deckenöffnung und Geländer
 * (research/03 §C7–§C9). Rein und deterministisch: gleiche Eingabe, gleiche Ausgabe; aller Zufall kommt aus
 * `project.seed`.
 *
 * Etagen: die Bodenplatte der Etage f+1 ist die Decke der Etage f (ein Block). Dachregion der Etage f =
 * Grundriss(f) \ Grundriss(f+1); die obere Etage ist für das Dach Sperrzone (weder Saat noch Dach), so steigt
 * es an ihren Wänden als Pultdach an (gekappt auf Wandhöhe). Fenster der oberen Etage, die ein solches Dach
 * verdecken würde, entfallen. Haustür nur auf Etage 0 (sonst der untersten Etage mit Räumen); andere Etagen
 * erreicht man über Treppen, ihre Türen gehen von den Treppenräumen aus.
 *
 * Additiv (B2): Gauben (`dormers`, roof-shapes.ts/dormers.ts, Fenster in roof-finish.ts), „Fenster aus“ gilt auch für
 * Giebel- und Gaubenfenster, Auskragung auf Traufkonsolen ohne Warnung, angedockte Bauwerke (`annexes`: Aussparung im
 * Dach, Türen, Wände am Anbau ohne Tür/Fenster, Treppenturm verbindet Etagen).
 *
 * Additiv (V0, Baukörper, research/19 §7.4): Räume gehören zu Baukörpern mit eigener Basishöhe, eigenen lichten Höhen
 * und eigenem Dach; Baukörper teilen keine Spalten (Invariante des Aggregats). Abgeleitet wird je GESCHOSS = alle Räume
 * mit derselben Bodenplatte (y0), über Baukörper hinweg:
 *  - Wände: ein gemeinsamer Wandplan je Geschoss. Räume anderer Baukörper, die in der Höhe überlappen, kommen als
 *    fremde Labels dazu (nur für die Wandwahl). Die Rangfolge der Baukörper (höher zuerst) steht vor der Raum-Priorität:
 *    der höhere trägt die gemeinsame Wand – eine Brandwand, 1 Block dick, in allen Geschossen in derselben Spalte.
 *  - Türen: im Geschoss wie bisher, also auch zwischen Baukörpern mit gleichem Boden; verschiedene Böden → keine Tür,
 *    dann erschließt jeder Baukörper sein Erdgeschoss selbst (Außentür nur aus Räumen im Erdgeschoss ihres Baukörpers).
 *  - Dach je Baukörper (`Volume.roof`/`roofDetail`, sonst `ShellOptions`): nie über fremden Spalten (Überstand bis zur
 *    Mitte zwischen den Baukörpern), an der Brandwand eines anderen ohne eigene Giebelwand.
 *  - Abdichten: Luft im Inneren eines Baukörpers (Raum oder Dachraum), die seitlich an eine Spalte eines anderen grenzt,
 *    wo dieser nichts hat (über seinem Dach, unter seiner Bodenplatte), bekommt dort Wand – die Brandwand wird über das
 *    niedrigere Dach hochgezogen bzw. bis zum tieferen Boden hinabgeführt.
 * Ohne Baukörper ist jedes Geschoss genau eine Etage und das Ergebnis zellgleich mit dem Stand davor.
 *
 * Additiv (BT16, Lage `buried`, buried.ts): Dach `earth` = flache Decke, Außentüren und Fenster nur in der Frontebene,
 * Anker und Außenprofil nicht in der Hügel-Zone, Rundtür und Rundfenster vor der Front; `Shell.settings` gibt die Lage
 * an das Gelände weiter. Ohne Lage ≠ `ground` zellgleich.
 */
import { CellSet, key3, type Cell, type HorizontalDir, type Vec3 } from '@mcda/core';
import { DEFAULT_VOLUME, type Floor, type ProjectState, type Room, type RoomId, type VerticalLink, type VolumeId } from '../model.js';
import { stairLayout, type StairLayout } from '../stairs.js';
import { allVolumes, roomFloors, volumeClash, volumeOf } from '../volumes.js';
import { deriveAnchors, exteriorModel, sortAnchors } from './anchors.js';
import { DEFAULT_FACADE_BAY, doorPreference, doublePairs, middleBayCells, planFacadeGrid, type GridLevel, type GridLine } from './bays.js';
import { BURIED_COVER, BURIED_PORTAL_REACH, BURIED_WING, buriedFrontDetails, forward, frontPlane, frontSpan, moundZone } from './buried.js';
import { doorCandidates, planDoors, runPairs, type DoorPlan, type PlacedDoor, type RoomRole } from './doors.js';
import { applyFacade } from './facade.js';
import { BIT, CCW, DIRS, N8, OPP, STEP, axisOf, frameAround, inFrame, openOutside, worldCell } from './grid.js';
import { placeAtticLights, placeDormerWindows, placeGableWindows, settleRoofStairs, type AtticColumn } from './roof-finish.js';
import { buildRoofBlocks, type DormerFront, type GableColumn, type PitchedRoof } from './roof-shapes.js';
import type {
  FacadeGridLine, RoofDetail, RoofStyle, RoomShellInfo, Shell, ShellAnchor, ShellAnnex, ShellAnnexInfo, ShellCell, ShellDoor, ShellOptions,
  ShellOrient, ShellRoofFit, ShellSetting, ShellStairAccess, ShellWindow,
} from './types.js';
import { applyVolumeRoof, applyVolumeTrim } from './volume-trim.js';
import { FLOOR, WALL, WC, computeWalls, diagonalOnlyContacts, floorParts, type WallPlan } from './walls.js';
import { RHYTHM_DORMERS, densifyGridWindows, rhythmWindows } from './facade-rhythm.js';
import { planGridWindows, planWindows, windowsOff, type PlannedWindow } from './windows.js';

export const DEFAULT_CORRIDOR_TYPES: readonly string[] = ['hallway', 'corridor'];

/** Prioritätsbonus für Flure: Flure behalten immer ihre lichte Breite. */
const CORRIDOR_BONUS = 1_000_000;
/** feat/underground: Etagen ab hier abwärts sind Gewölbe (Stein statt Wohnraum-Materialien). */
const VAULT_FLOOR = -2;
/** Räume ohne Zusatztür für Rundgänge (`ShellOptions.loopDoors`): privat oder verschlossen. */
const LOOP_PRIVATE_TYPES: ReadonlySet<string> = new Set(['bedroom', 'guest_room', 'nursery', 'washroom', 'bathhouse', 'treasury', 'dungeon', 'infirmary']);
/** Rang des Baukörpers vor jeder Raum-Priorität (der höhere Baukörper verliert und trägt die Brandwand). */
const VOLUME_RANK = 1_000_000_000;

/** „r2“ < „r10“: natürliche Sortierung der Raum-IDs (bestimmt die Label-Reihenfolge und damit Gleichstände). */
export function compareRoomIds(a: string, b: string): number {
  const ma = /^(\D*)(\d+)$/.exec(a);
  const mb = /^(\D*)(\d+)$/.exec(b);
  if (ma !== null && mb !== null && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2]) || (a < b ? -1 : a > b ? 1 : 0);
  return a < b ? -1 : a > b ? 1 : 0;
}

interface DoorView {
  readonly door: PlacedDoor;
  readonly facing: HorizontalDir;
  readonly hinge: 'left' | 'right';
}

interface Access {
  readonly cell: number;
  readonly toward: HorizontalDir;
  readonly linkId: string;
  readonly end: 'bottom' | 'top';
}

/**
 * Ein Geschoss (Räume mit derselben Bodenplatte) im gemeinsamen Raster. Ohne Baukörper genau eine Etage.
 * Labels 1…rooms.length sind eigene Räume, darüber fremde (Räume anderer Baukörper in gleicher Höhe, nur für Wände).
 */
interface Level {
  /** Vertreter (erster Raum): Index, Boden, lichte Höhe – ohne Baukörper die Etage selbst. */
  readonly floor: Floor;
  /** Etage je Baukörper in diesem Geschoss (alle mit Boden `floor.y0`). */
  readonly members: ReadonlyMap<VolumeId, Floor>;
  readonly rooms: readonly Room[];
  readonly labels: Int32Array;
  /** Gemalte Zellen (Grundriss) der eigenen Räume. */
  readonly footprint: Uint8Array;
  readonly plan: WallPlan;
  readonly role: (label: number) => RoomRole;
  readonly idOf: (label: number) => RoomId;
  /** Lichte Höhe je eigenem Label. */
  readonly heights: Int32Array;
  /** Baukörper je eigenem Label (Index = Label). */
  readonly vols: readonly VolumeId[];
  /** W7: Baukörper je Label, eigene und fremde Räume (Index = Label, 0 = außen). */
  readonly labelVols: readonly VolumeId[];
  readonly minHeight: number;
  /** Nicht belegbar: Treppe, Öffnung, oberste Stufe, Geländer, Leiter-Pfosten. */
  readonly blocked: Uint8Array;
  /** Reserviert durch Treppen (auch die Zugänge): kein Geländer, keine zweite Treppe. */
  readonly reserved: Uint8Array;
  /** Keine Bodenplatte (Öffnung, oberste Stufe/Leiter in der Platte). */
  readonly noSlab: Uint8Array;
  /** Wandzellen ohne Tür/Fenster (Leiter-Träger). */
  readonly noDoor: Uint8Array;
  readonly railing: number[];
  readonly access: Access[];
  doors: DoorView[];
  windows: PlannedWindow[];
  /** W2: Fassadenraster der Außenseiten (nur mit `FacadeRules.grid`). */
  grid?: readonly GridLine[];
  /** Oberste Dachblock-Höhe je Spalte (für verdeckte Fenster der Etage darüber). */
  roofTop?: Float64Array;
}

/** Öffnung in ein angedocktes Bauwerk: Wandzelle und Bodenzelle davor. */
interface AnnexDoor {
  readonly lvl: Level;
  readonly floorIndex: number;
  readonly cell: number;
  readonly inside: number;
}

interface AnnexAt {
  readonly a: ShellAnnex;
  /** Grundriss im Raster. */
  readonly foot: Uint8Array;
  readonly openings: readonly AnnexDoor[];
}

interface PlacedLink {
  readonly link: VerticalLink;
  readonly layout: StairLayout;
  readonly lo: Level;
  readonly up: Level;
  readonly lowerLabel: number;
  readonly upperLabel: number;
  /** Leiter vor Bodenzelle: Pfosten als Träger. */
  readonly supportPost: boolean;
}

/** Höhenbereich eines Baukörpers in einer Spalte (Geschosse bzw. Dach), für verdeckte Fenster. */
interface Span {
  readonly rank: number;
  readonly lo: number;
  readonly hi: number;
}

function deriveShellPlain(state: ProjectState, options: ShellOptions): Shell {
  const warnings: string[] = [];
  const floors = [...state.floors].sort((a, b) => a.index - b.index);
  if (floors.length === 0) return { cells: [], rooms: new Map(), warnings: ['Das Projekt hat keine Etage – keine Hülle abgeleitet'], anchors: [] };
  const known = new Set(floors.map((f) => f.index));
  const orphans = state.rooms.filter((r) => !known.has(r.floorIndex));
  if (orphans.length > 0) warnings.push(`Räume auf unbekannten Etagen ignoriert: ${orphans.map((r) => r.id).join(', ')}`);
  const painted = state.rooms.filter((r) => known.has(r.floorIndex) && !r.cells.isEmpty);
  if (painted.length === 0) return { cells: [], rooms: new Map(), warnings, anchors: [] };

  // ---------------------------------------------------------------- Baukörper: effektive Etagen, Rang, Dächer
  const frames = roomFloors(state);
  const listed = allVolumes(state);
  const props = new Map(listed.map((v) => [v.id, v] as const));
  const used = [...new Set(painted.map(volumeOf))];
  const multi = used.length > 1;
  if (multi) {
    const clash = volumeClash(state);
    if (clash !== undefined) warnings.push(`Baukörper überschneiden sich (${clash}) – Hülle unzuverlässig`);
  }
  const topOf = new Map<VolumeId, number>();
  const bottomOf = new Map<VolumeId, number>();
  for (const r of painted) {
    const f = frames.get(r.id)!;
    const v = volumeOf(r);
    topOf.set(v, Math.max(topOf.get(v) ?? -Infinity, f.y0 + f.height + 1));
    bottomOf.set(v, Math.min(bottomOf.get(v) ?? Infinity, f.y0));
  }
  const listedAt = (v: VolumeId): number => {
    const k = listed.findIndex((x) => x.id === v);
    return k < 0 ? listed.length : k;
  };
  // Rangfolge: der höhere Baukörper trägt die Brandwand; Gleichstand: tiefer beginnend, dann Anlage-Reihenfolge
  const order = [...used].sort((a, b) => topOf.get(b)! - topOf.get(a)! || bottomOf.get(a)! - bottomOf.get(b)! || listedAt(a) - listedAt(b) || (a < b ? -1 : 1));
  const rankOf = new Map(order.map((v, k) => [v, k] as const));
  const rank = (v: VolumeId): number => rankOf.get(v)!;
  // Lage (BT16): eingegrabene Baukörper – Dach `earth` (flache Decke), Öffnungen nur in der Frontebene
  const settings: ShellSetting[] = [];
  for (const v of used) {
    const s = props.get(v)?.setting;
    if (s?.kind !== 'buried') continue;
    // Grundriss über der Erde: ein Unterbau (Keller über den Hausgrundriss hinaus, feat/underground) verschiebt weder
    // Frontebene noch Hügel. Heute liegt jeder Keller unter dem Erdgeschoss – derselbe Grundriss, bitgleich.
    const own = painted.filter((r) => volumeOf(r) === v);
    const above = own.filter((r) => r.floorIndex >= 0);
    const footprint = CellSet.of((above.length > 0 ? above : own).flatMap((r) => r.cells.toArray()));
    settings.push({ volumeId: v, kind: 'buried', front: s.front ?? 'south', cover: s.cover ?? BURIED_COVER, wing: BURIED_WING, footprint });
  }
  const buried = new Map(settings.map((s) => [s.volumeId, { front: s.front!, plane: frontPlane(s), span: frontSpan(s) }] as const));
  const roofOf = (v: VolumeId): RoofStyle => (buried.has(v) ? 'flat' : props.get(v)?.roof ?? options.roof);
  const detailOf = (v: VolumeId): RoofDetail | undefined => props.get(v)?.roofDetail ?? options.roofDetail;
  /**
   * Dach-Detail für die Dachform: Q2 (research/59 Hebel 5) erzwingt mit `rules.roofEdge` die Dachkante
   * (`roof_trim`) an Traufe und Ortgang. Giebelfenster bleiben wie ohne das Feld (fehlte das Detail ganz, bleibt
   * `gableWindows: false`, sonst hätte die Pflichtkante sie stillschweigend eingeschaltet).
   */
  const roofDetailFor = (v: VolumeId): RoofDetail | undefined => {
    const d = detailOf(v);
    if (options.facade?.rules?.roofEdge !== true) return d;
    return { ...(d ?? { gableWindows: false }), trim: true };
  };
  const requested = options.overhang ?? 1;
  // Q2 (research/59 Hebel 1): `rules.minOverhang` hebt einen zu kleinen bzw. fehlenden Dachüberstand an. Flachdach
  // bleibt ohne Traufe und damit ohne Überstand; ohne das Feld ändert sich nichts.
  const minOverhang = options.facade?.rules?.minOverhang !== undefined ? Math.max(1, Math.floor(options.facade.rules.minOverhang)) : 0;
  const overhangOf = (style: RoofStyle): number =>
    style !== 'flat' && Number.isFinite(requested)
      ? Math.max(minOverhang, Math.max(0, Math.floor(requested)))
      : style !== 'flat' ? Math.max(minOverhang, 1) : 0;
  const corridorTypes = new Set(options.corridorTypes ?? DEFAULT_CORRIDOR_TYPES);
  const frame = frameAround(
    (function* () {
      for (const r of painted) yield* r.cells;
      for (const a of options.annexes ?? []) yield* a.footprint;
    })(),
    Math.max(...used.map((v) => overhangOf(roofOf(v)))) + 2,
  );
  const n = frame.w * frame.d;
  const idx = (c: Cell): number => {
    const x = c[0] - frame.x0;
    const z = c[1] - frame.z0;
    return inFrame(frame, x, z) ? z * frame.w + x : -1;
  };

  // ---------------------------------------------------------------- Geschosse: Raster + Wände
  const byY0 = new Map<number, Room[]>();
  for (const r of painted) {
    const y0 = frames.get(r.id)!.y0;
    (byY0.get(y0) ?? byY0.set(y0, []).get(y0)!).push(r);
  }
  const levels: Level[] = [];
  for (const y0 of [...byY0.keys()].sort((a, b) => a - b)) {
    const rooms = byY0.get(y0)!.sort((a, b) => compareRoomIds(a.id, b.id));
    const members = new Map<VolumeId, Floor>();
    for (const r of rooms) if (!members.has(volumeOf(r))) members.set(volumeOf(r), frames.get(r.id)!);
    const top = y0 + Math.max(...[...members.values()].map((f) => f.height)) + 1;
    // Räume anderer Baukörper, deren Etage (Bodenplatte bis Decke) diese Höhe berührt: nur für die Wandwahl
    const foreign = painted
      .filter((r) => {
        const f = frames.get(r.id)!;
        return !members.has(volumeOf(r)) && f.y0 <= top && f.y0 + f.height + 1 >= y0;
      })
      .sort((a, b) => compareRoomIds(a.id, b.id));
    const all = [...rooms, ...foreign];
    const own = rooms.length;
    const labels = new Int32Array(n);
    for (let k = all.length - 1; k >= 0; k--) for (const c of all[k]!.cells) labels[idx(c)] = k + 1;
    const role = (label: number): RoomRole => (corridorTypes.has(all[label - 1]!.roomTypeId) ? 'corridor' : 'public');
    const prio = new Float64Array(all.length + 1);
    all.forEach((r, k) => (prio[k + 1] = -r.cells.size + (role(k + 1) === 'corridor' ? CORRIDOR_BONUS : 0) + rank(volumeOf(r)) * VOLUME_RANK));
    const plan = computeWalls(frame, labels, prio);
    const idOf = (label: number): RoomId => rooms[label - 1]!.id;
    for (let l = 1; l <= own; l++) {
      const parts = floorParts(plan, l);
      if (parts === 0) warnings.push(`Raum ${idOf(l)} ist nach Wandabzug schmaler als 1 Block – keine begehbare Fläche`);
      else if (parts > 1) warnings.push(`Raum ${idOf(l)}: die begehbare Fläche zerfällt nach Wandabzug in ${parts} Teile`);
    }
    const heights = new Int32Array(own + 1);
    const vols: VolumeId[] = [DEFAULT_VOLUME];
    rooms.forEach((r, k) => {
      heights[k + 1] = frames.get(r.id)!.height;
      vols.push(volumeOf(r));
    });
    levels.push({
      floor: frames.get(rooms[0]!.id)!, members, rooms, labels, plan, role, idOf, heights, vols, labelVols: [DEFAULT_VOLUME, ...all.map(volumeOf)],
      minHeight: Math.min(...heights.slice(1)),
      footprint: Uint8Array.from(labels, (l) => (l > 0 && l <= own ? 1 : 0)),
      blocked: new Uint8Array(n),
      reserved: new Uint8Array(n),
      noSlab: new Uint8Array(n),
      noDoor: new Uint8Array(n),
      railing: [],
      access: [],
      doors: [],
      windows: [],
    });
  }
  const levelOfVF = new Map<string, Level>();
  for (const l of levels) for (const [v, f] of l.members) levelOfVF.set(`${v}|${f.index}`, l);
  /** Geschoss mit der Etage `index` des Baukörpers `v`. */
  const levelAt = (v: VolumeId, index: number): Level | undefined => levelOfVF.get(`${v}|${index}`);
  /** Geschoss direkt über dem Baukörper `v`, wenn seine Bodenplatte die Decke von `l` ist. */
  const upOf = (l: Level, v: VolumeId): Level | undefined => {
    const f = l.members.get(v);
    const u = f === undefined ? undefined : levelAt(v, f.index + 1);
    return u !== undefined && u.floor.y0 === f!.y0 + f!.height + 1 ? u : undefined;
  };
  /** Geschoss direkt unter dem Baukörper `v`, wenn seine Decke die Bodenplatte von `l` ist. */
  const downOf = (l: Level, v: VolumeId): Level | undefined => {
    const f = l.members.get(v);
    const d = f === undefined ? undefined : levelAt(v, f.index - 1);
    const df = d?.members.get(v);
    return df !== undefined && df.y0 + df.height + 1 === f!.y0 ? d : undefined;
  };
  for (const v of used) {
    const own = levels.filter((l) => l.members.has(v)).map((l) => l.members.get(v)!).sort((a, b) => a.index - b.index);
    for (let k = 1; k < own.length; k++) {
      const lo = own[k - 1]!;
      const up = own[k]!;
      if (up.index === lo.index + 1 && up.y0 !== lo.y0 + lo.height + 1) {
        warnings.push(`Etage ${up.index}: Etagenabstand passt nicht (Boden bei y=${up.y0}, erwartet ${lo.y0 + lo.height + 1})`);
      }
    }
  }
  // Erdgeschoss je Baukörper: Etage 0, sonst die unterste mit Räumen. Geschosse mit einem Erdgeschoss haben Außentüren.
  const groundOf = new Map<VolumeId, number>();
  for (const v of used) {
    const idxs = levels.filter((l) => l.members.has(v)).map((l) => l.members.get(v)!.index);
    groundOf.set(v, idxs.includes(0) ? 0 : Math.min(...idxs));
  }
  const isGround = (l: Level): boolean => [...l.members].some(([v, f]) => f.index === groundOf.get(v));
  const grounds = levels.filter(isGround);
  // Auskragung: mit Traufkonsolen (F3a, facade.ts) trägt je eine Konsole die Außenwand, die genau 1 Block über eine
  // Außenwand darunter hinausragt – gewollt und gestützt, keine Warnung; weiter auskragende Zellen bleiben Warnung.
  const brackets = (options.facade?.brackets ?? 0) >= 1;
  for (const l of levels) {
    for (const r of l.rooms) {
      const v = volumeOf(r);
      if (r.floorIndex <= groundOf.get(v)!) continue;
      const below = levelAt(v, r.floorIndex - 1);
      const stacked = below !== undefined && downOf(l, v) === below;
      let free = 0;
      let carried = 0;
      for (const c of r.cells) {
        const i = idx(c);
        if (below?.footprint[i] === 1) continue;
        const x = i % frame.w;
        const z = Math.floor(i / frame.w);
        const onBracket = brackets && stacked && DIRS.some((dir) => {
          const [dx, dz] = STEP[dir];
          return l.footprint[(z + dz) * frame.w + x + dx] !== 1 && below.footprint[(z - dz) * frame.w + x - dx] === 1;
        });
        if (onBracket) carried++;
        else free++;
      }
      const onBrackets = carried > 0 ? ` (${carried} weitere auf Konsolen)` : '';
      if (free > 0) warnings.push(`Raum ${r.id} (Etage ${r.floorIndex}) kragt mit ${free} Zellen über Etage ${r.floorIndex - 1} hinaus (Balkon/Auskragung ohne Unterbau)${onBrackets}`);
    }
  }

  // Lage buried (BT16): Außenwände außerhalb der Frontebene ohne Tür und Fenster (dort liegt Erde)
  if (buried.size > 0) {
    for (const lvl of levels) {
      for (let i = 0; i < n; i++) {
        const l = lvl.labels[i]!;
        const b = l > 0 && l <= lvl.rooms.length ? buried.get(lvl.vols[l]!) : undefined;
        if (b === undefined || lvl.plan.kind[i] !== WALL || lvl.plan.exterior[i] !== 1) continue;
        const [x, z] = worldCell(frame, i);
        const ahead = idx([x + STEP[b.front][0], z + STEP[b.front][1]]);
        if (forward(b.front, x, z) !== b.plane || ahead < 0 || lvl.labels[ahead] !== 0) lvl.noDoor[i] = 1;
      }
    }
  }

  // ---------------------------------------------------------------- Treppen: reservieren, Öffnung, Geländer
  const links = placeLinks(state.links, idx, warnings);
  for (const pl of links) {
    const { up, layout } = pl;
    for (const h of layout.holes) {
      const hi = idx(h);
      const hx = hi % frame.w;
      const hz = Math.floor(hi / frame.w);
      for (const [dx, dz] of N8) {
        if (!inFrame(frame, hx + dx, hz + dz)) continue;
        const j = (hz + dz) * frame.w + hx + dx;
        if (up.plan.kind[j] !== FLOOR || up.reserved[j] === 1 || up.blocked[j] === 1) continue;
        up.blocked[j] = 1;
        up.railing.push(j);
      }
    }
  }

  // ---------------------------------------------------------------- Anbauten (T1/T3): Grundriss frei, Öffnungen, Wände dicht
  const annexes = placeAnnexes(options.annexes ?? []);

  // ---------------------------------------------------------------- W2 Fassadenraster (vor Türen und Fenstern)
  if (options.facade?.rules?.grid === true) {
    // W2-FB (Folgeauftrag): der Fensterabstand des Nutzers bleibt wirksam – ein Fenster je Feld, zwischen zwei Fenstern
    // liegen dann mindestens Feldbreite − 1 Wandzellen und der Pfosten; ein größerer Abstand verbreitert die Felder
    const spacing = options.windows?.spacing;
    const wanted = spacing === undefined ? 0 : Math.floor(spacing) - 1;
    const field = Math.max(2, Math.min(8, Math.max(wanted, Math.floor(options.facade.rules.bay ?? DEFAULT_FACADE_BAY))));
    // W7 (Turmschaft `RoofDetail.shaftGrid`, plan/spikes/W7B_burg.md): jede Seite des Turms ein eigenes Raster von Ecke zu
    // Ecke, die Linie des Nachbarbaukörpers endet an der Fuge – nur mit mehreren Baukörpern und einem Schaft
    const shafts = multi ? new Set(used.filter((v) => detailOf(v)?.shaftGrid === true)) : new Set<VolumeId>();
    const volumesOf = (l: Level): GridLevel['volumes'] => (shafts.size === 0 ? undefined : { of: l.labelVols, shafts });
    const g = planFacadeGrid(frame, levels.map((l) => {
      const volumes = volumesOf(l);
      return { plan: l.plan, own: l.rooms.length, floorIndex: l.floor.index, ...(volumes !== undefined ? { volumes } : {}) };
    }), field);
    levels.forEach((l, k) => (l.grid = g[k]!));
  }

  // ---------------------------------------------------------------- Türen (Erdgeschosse zuerst, dann über Treppen)
  const upper = levels.filter((l) => !isGround(l) && [...l.members].some(([v, f]) => f.index > groundOf.get(v)!));
  const order0 = [...grounds, ...upper, ...levels.filter((l) => !isGround(l) && !upper.includes(l)).reverse()];
  const reachOf = new Map<Level, ReadonlySet<number>>();
  // W12-C (Scheunentor, `Volume.exterior.barn`): Türspalte mittig in der Giebelwand weg vom übrigen Gebäude
  const barnDoors = barnDoorCells();
  for (const lvl of order0) {
    const isEntrance = isGround(lvl);
    const roots = new Set<number>();
    for (const pl of links) {
      if (pl.up === lvl && reachOf.get(pl.lo)?.has(pl.lowerLabel) === true) roots.add(pl.upperLabel);
      if (pl.lo === lvl && reachOf.get(pl.up)?.has(pl.upperLabel) === true) roots.add(pl.lowerLabel);
    }
    // Treppenturm: Öffnungen desselben Anbaus auf einer schon erreichten Etage machen die Räume hier erreichbar
    for (const { openings } of annexes) {
      if (openings.some((o) => o.lvl !== lvl && reachOf.get(o.lvl)?.has(o.lvl.labels[o.inside]!) === true)) {
        for (const o of openings) if (o.lvl === lvl) roots.add(lvl.labels[o.inside]!);
      }
    }
    if (lvl.minHeight < 2) {
      warnings.push(`Lichte Höhe ${lvl.minHeight} < 2${isEntrance ? '' : ` (Etage ${lvl.floor.index})`}: keine Türen und Fenster möglich`);
      reachOf.set(lvl, isEntrance ? new Set() : roots);
      continue;
    }
    const { blocked, noDoor } = doorMasks(lvl);
    const upstairs = isEntrance && lvl.rooms.some((r) => r.floorIndex !== groundOf.get(volumeOf(r)));
    const prefer = isEntrance && lvl.grid !== undefined ? doorPreference(frame, lvl.grid) : undefined;
    // W4-C: Haustür im Mittelfeld (F3) und Doppeltür in passenden Räumen (Regeln `centerDoor`, `doubleDoor`)
    // W12-B: Lage buried – die Mitte der Front vor dem Mittelfeld des Rasters
    const middle = (isEntrance && buried.size > 0 ? buriedMiddle(lvl) : undefined)
      ?? (isEntrance && lvl.grid !== undefined && options.facade?.rules?.centerDoor === true ? middleBayCells(frame, lvl.grid) : undefined);
    const doubleTypes = isEntrance ? options.facade?.rules?.doubleDoor : undefined;
    const doubleMain = doubleTypes !== undefined && doubleTypes.length > 0
      ? { rooms: (label: number) => doubleTypes.includes(lvl.rooms[label - 1]!.roomTypeId), pairs: lvl.grid !== undefined ? doublePairs(frame, lvl.grid) : runPairs(lvl.plan) }
      : undefined;
    const doorPlan = planDoors({
      plan: lvl.plan, roomCount: lvl.rooms.length, role: lvl.role, roomKey: lvl.idOf, seed: state.seed,
      openOutside: openOutside(frame, lvl.labels), exterior: isEntrance, roots: [...roots].sort((a, b) => a - b),
      blocked, noDoor,
      ...(upstairs ? { exteriorRooms: (label: number) => lvl.rooms[label - 1]!.floorIndex === groundOf.get(lvl.vols[label]!) } : {}),
      ...(prefer !== undefined ? { preferCols: (c: number) => prefer.get(c) ?? 0 } : {}),
      ...(middle !== undefined ? { middleRank: (c: number) => middle.get(c) ?? 0 } : {}),
      ...(doubleMain !== undefined ? { doubleMain } : {}),
      ...(isEntrance && barnDoors.size > 0 ? { sideRank: (c: number) => (barnDoors.has(c) ? 1 : 0) } : {}),
      ...(options.loopDoors !== undefined && options.loopDoors > 0
        ? { loops: { chance: options.loopDoors, rooms: (label: number) => !LOOP_PRIVATE_TYPES.has(lvl.rooms[label - 1]!.roomTypeId) } }
        : {}),
    });
    const reach: ReadonlySet<number> = isEntrance
      ? new Set(lvl.rooms.map((_, k) => k + 1).filter((l) => !doorPlan.unreachable.includes(l)))
      : roots.size === 0 ? new Set() : doorPlan.reachableFromMain;
    reachOf.set(lvl, reach);
    doorWarnings(lvl, doorPlan, isEntrance, roots.size, reach, warnings);
    // Türen in angedockte Bauwerke: die Kandidaten an den Öffnungen (Wände am Anbau sind für die Planung gesperrt)
    const into = annexes.flatMap(({ openings }) => openings.filter((o) => o.lvl === lvl).map((o) => o.cell));
    const forced = into.length === 0 ? [] : doorCandidates(lvl.plan, state.seed, openOutside(frame, lvl.labels), blocked)
      .filter((c) => into.includes(c.cell)).map((c): PlacedDoor => ({ ...c, reason: 'side', isMain: false }));
    lvl.doors = [...orientDoors(doorPlan.doors, isEntrance ? [0] : roots.size > 0 ? [...roots] : [1]), ...orientDoors(forced, [0])];
  }

  // ---------------------------------------------------------------- Dächer (je Baukörper), dann Fenster und Etagen
  const cells: ShellCell[] = [];
  const roofCells: ShellCell[] = [];
  /** W4 (Dachraum-Licht): Spalten unter geneigten Dächern (Dachboden bis oberste Dachzelle). */
  const attic: AtticColumn[] = [];
  /** W4-B (`RoofDetail.hatch`): Leiter der Dachluke je Geschoss (Bodenzelle → Blickrichtung der Leiter). */
  const hatches = new Map<Level, Map<number, HorizontalDir>>();
  /** W2 (D4): Sohlbalken unter Giebelfeldern (Position → Achse entlang der Wand). */
  const sills = new Map<string, 'x' | 'z'>();
  /** W2 (D5): tatsächliche Neigung je Dach, nur mit `heightBudget: true` bzw. (W3) bei geteiltem Dach. */
  const roofFit: ShellRoofFit[] = [];
  const gableCols = new Map<VolumeId, GableColumn[]>();
  const dormerFronts: DormerAt[] = [];
  /** Spalte → Rang + 1 des Baukörpers (0 = keiner); nur mit mehreren Baukörpern. */
  const colRank = new Int32Array(n);
  const spans = multi ? new Map<number, Span[]>() : undefined;
  if (multi) {
    for (const l of levels) {
      for (let i = 0; i < n; i++) {
        if (l.footprint[i] !== 1) continue;
        const v = l.vols[l.labels[i]!]!;
        colRank[i] = rank(v) + 1;
        const f = l.members.get(v)!;
        (spans!.get(i) ?? spans!.set(i, []).get(i)!).push({ rank: rank(v), lo: f.y0, hi: f.y0 + f.height + 1 });
      }
    }
  }
  const noRoofOf = multi ? roofShares() : undefined;
  for (const lvl of levels) {
    for (const v of [...lvl.members.keys()].sort((a, b) => listedAt(a) - listedAt(b) || rank(a) - rank(b))) {
      // Keller (Etagenindex < 0) liegen im Erdreich: nie ein Dach, der Teil außerhalb der Etage darüber bekommt nur die
      // Decke (feat/underground: Unterbau über den Hausgrundriss hinaus). Heute liegt jeder Keller ganz unter dem
      // Erdgeschoss – dort gibt es keine Dachfläche, das Ergebnis bleibt bitgleich.
      if (lvl.members.get(v)!.index < 0) continue;
      const style = roofOf(v);
      if (style !== 'flat') emitRoof(lvl, v, style, overhangOf(style), roofCells);
      else if (!buried.has(v) && roofDetailFor(v) !== undefined) emitFlatRim(lvl, v, roofCells);
    }
  }
  for (const lvl of levels) {
    const baseY = lvl.floor.y0 + 1;
    const own = lvl.rooms.length;
    const covered = (cell: number): boolean => {
      if (lvl.noDoor[cell] === 1) return true;
      const label = lvl.labels[cell]!;
      if (label > own) return true;
      const v = lvl.vols[label]!;
      // Keller (Etagenindex < 0) liegen im Erdreich: keine Fenster.
      if (lvl.members.get(v)!.index < 0 || lvl.heights[label]! < 2) return true;
      // W12-B (28.09.2026): Lage buried – kein Fenster im Rundbogen der Haustür (höchstens 3 quer daneben)
      if (buried.has(v) && lvl.doors.some((dv) => dv.door.a === 0 && dv.door.run === lvl.plan.runOf[cell]
        && Math.abs(dv.door.pos - lvl.plan.posInRun[cell]!) <= BURIED_PORTAL_REACH)) return true;
      const roofBelow = downOf(lvl, v)?.roofTop;
      const x = cell % frame.w;
      const z = Math.floor(cell / frame.w);
      if (roofBelow !== undefined && DIRS.some((dir) => {
        const nx = x + STEP[dir][0];
        const nz = z + STEP[dir][1];
        return inFrame(frame, nx, nz) && roofBelow[nz * frame.w + nx]! >= baseY + 1;
      })) return true;
      // Baukörper: Wand, Decke oder Dach eines anderen Baukörpers vor dem Fenster
      return spans !== undefined && DIRS.some((dir) => {
        const j = (z + STEP[dir][1]) * frame.w + x + STEP[dir][0];
        return (spans.get(j) ?? []).some((s) => s.rank !== rank(v) && s.lo <= baseY + Math.min(2, lvl.heights[label]! - 1) && s.hi >= baseY + 1);
      });
    };
    if (lvl.minHeight >= 2 && lvl.rooms.some((r) => r.floorIndex >= 0)) {
      // W2: mit Fassadenraster ein Fenster je Feld (blinde Felder statt verschobener Fenster), sonst je Wandlauf
      const planned = lvl.grid === undefined
        ? planWindows(lvl.plan, new Set(lvl.doors.map((v) => v.door.run)), options.windows ?? {}, covered)
        : windowsOff(options.windows ?? {}, Math.max(frame.w, frame.d)) ? [] : planGridWindows(lvl.plan, frame, lvl.grid, new Set(lvl.doors.map((v) => v.door.cell)), covered);
      // W12-C: das Scheunentor (5 breit um die Tür, `Volume.exterior.barn`) braucht die Wand daneben ohne Fenster
      const gates = lvl.doors.filter((v) => barnDoors.has(v.door.cell)).map((v) => worldCell(frame, v.door.cell));
      const inGate = (cell: number): boolean => {
        const [x, z] = worldCell(frame, cell);
        return gates.some(([gx, gz]) => (gx === x && Math.abs(gz - z) <= 2) || (gz === z && Math.abs(gx - x) <= 2));
      };
      const kept0 = planned.filter((w) => w.room <= own && (gates.length === 0 || !inGate(w.cell)));
      // WS-Fassade: Fensterachsen im Takt auf flachen Wandläufen (mit Fassadenraster nur Läufe ohne jedes Fenster, das Raster trägt den Takt schon)
      const rhythmOn = options.facadeRhythm?.windows === true && !windowsOff(options.windows ?? {}, Math.max(frame.w, frame.d));
      const rhythmSkip = (cell: number): boolean => covered(cell) || (gates.length > 0 && inGate(cell));
      const rhythmDoors = lvl.doors.map((v) => v.door.cell);
      const rhythmPairs = lvl.doors.flatMap((v) => (v.door.pair === undefined ? [] : [v.door.pair]));
      const kept1 = rhythmOn
        ? rhythmWindows(lvl.plan, own, kept0, rhythmDoors, rhythmSkip, rhythmPairs, lvl.grid !== undefined).windows
        : kept0;
      // Fassadenraster: Zusatzfenster in großen Lücken (Mindestdichte gegen flache Wände)
      const kept = rhythmOn && lvl.grid !== undefined
        ? [...kept1, ...densifyGridWindows(lvl.plan, frame, lvl.grid, kept1, [...rhythmDoors, ...rhythmPairs], rhythmSkip, own)]
        : kept1;
      // W16-B: Fenster-Pflicht je Raumtyp (`FacadeStyle.lightRooms`); ohne die Liste bitgleich
      const light = options.facade?.lightRooms;
      if (light !== undefined && light.length > 0 && !windowsOff(options.windows ?? {}, Math.max(frame.w, frame.d))) {
        kept.push(...rescueWindows(lvl, light, kept, (cell) => covered(cell) || (gates.length > 0 && inGate(cell))));
      }
      lvl.windows = buriedPairs(lvl, kept, covered);
    }
    placeHatches(lvl);
    emitLevel(lvl, cells);
  }
  emitLinks(links, cells);

  // Dachzellen nur, wo keine Struktur steht (Schutz; nach Konstruktion kollisionsfrei)
  const taken = new Set(cells.map((c) => `${c.pos[0]},${c.pos[1]},${c.pos[2]}`));
  for (const c of roofCells) {
    const k = `${c.pos[0]},${c.pos[1]},${c.pos[2]}`;
    if (!taken.has(k)) {
      taken.add(k);
      cells.push(c);
    }
  }
  // W2 (D4): Sohlbalken – die Decke in der Wandflucht unter einem Giebelfeld wird ein liegender Balken
  // (nicht über Eckständern: dort läuft der Pfosten weiter)
  if (sills.size > 0) {
    const post = new Set(cells.filter((c) => c.kind === 'pillar').map((c) => `${c.pos[0]},${c.pos[1] + 1},${c.pos[2]}`));
    cells.forEach((c, k) => {
      const at = `${c.pos[0]},${c.pos[1]},${c.pos[2]}`;
      const axis = c.kind === 'ceiling' && !post.has(at) ? sills.get(at) : undefined;
      if (axis !== undefined) cells[k] = { ...c, role: 'beam', shape: 'log', orient: { axis } };
    });
  }
  // Baukörper: Brandwände abdichten (über das niedrigere Dach hochziehen, bis zum tieferen Boden hinabführen)
  const enclosure = multi ? sealVolumes(taken) : undefined;
  // Giebelfenster (W7, nur mit Dach-Details), Gaubenfenster (D4) – beide nicht bei „Fenster aus“ – und Soll-Form jeder
  // Dachtreppe nach der Vanilla-Regel
  const noWindows = windowsOff(options.windows ?? {}, Math.max(frame.w, frame.d));
  const annexAt = (x: number, z: number): boolean => annexes.some(({ foot }) => foot[idx([x, z])] === 1);
  if (!noWindows) {
    for (const [v, cols] of gableCols) {
      const detail = detailOf(v);
      if (detail === undefined || detail.gableWindows === false) continue;
      const occupied = enclosure !== undefined
        ? (x: number, z: number, y: number): boolean => annexAt(x, z) || enclosure(x, y, z, rank(v))
        : annexes.length > 0 ? annexAt : undefined;
      placeGableWindows(cells, cols, occupied);
    }
  }
  const dormerWindows = noWindows ? [] : placeDormerWindows(cells, dormerFronts);
  settleRoofStairs(cells);

  // ---------------------------------------------------------------- Raumsicht (Leseport für die Einrichtung)
  const info = new Map<RoomId, RoomShellInfo>();
  for (const lvl of levels) for (const [id, r] of roomViews(lvl)) info.set(id, r);
  // Anker aus den fertigen Zellen (nach Wänden und Dach) samt Gaubenfenstern, dann optional das Außenprofil
  const annexInfo = options.annexes === undefined ? {} : { annexes: annexes.map(annexView) };
  const anchors = deriveAnchors({ cells, rooms: info, ...annexInfo });
  if (dormerWindows.length > 0) anchors.push(...dormerWindows.map(dormerAnchor));
  // W4 (27.09.2026): Dachraum spawnsicher – Laternen auf dem Dachboden (nach den Ankern: sie ändern keine Außen-Anker)
  placeAtticLights(cells, attic);
  // Lage buried: keine Anker in der Hügel-Zone
  const mound = settings.length > 0 ? moundZone(settings) : undefined;
  const anchorsKept = mound === undefined ? anchors : anchors.filter((a) => !mound(a.pos[0], a.pos[2]));
  const grid = facadeGridOf();
  const plain: Shell = {
    cells, rooms: info, warnings, anchors: sortAnchors(anchorsKept), ...annexInfo, ...(settings.length > 0 ? { settings } : {}),
    ...(grid !== undefined ? { facadeGrid: grid } : {}),
    ...(roofFit.length > 0 ? { roofFit } : {}),
  };
  // Lage buried: Rundtür und Rundfenster vor dem Außenprofil (das Profil weicht ihnen aus, ihr Inneres bleibt frei)
  const rings = mound === undefined ? undefined : buriedFront(plain);
  const shell = rings?.shell ?? plain;
  if (options.facade === undefined) return shell;
  const faced = applyFacade(shell, options.facade);
  // Baukörper: ein Sockelband kann auf gleicher Höhe an die Dachtreppe eines tieferen Baukörpers stoßen – Soll-Form neu
  if (multi && faced.cells !== cells) settleRoofStairs(faced.cells as ShellCell[]);
  // Lage buried: Außenprofil in der Hügel-Zone entfällt (dort liegt Erde)
  if (mound === undefined) return faced;
  // W9-G4: Rundtür und Rundfenster selbst bleiben auch in den Flanken der Hügel-Zone (sie stehen vor der Front)
  const outside = faced.cells.filter((c) => c.kind !== 'facade' || rings!.own.has(key3(c.pos)) || (!mound(c.pos[0], c.pos[2]) && !rings!.clear.has(key3(c.pos))));
  return outside.length === faced.cells.length ? faced : { ...faced, cells: outside };

  // ================================================================ Hilfen mit Zugriff auf frame/idx

  /**
   * W12-B (28.09.2026, plan/spikes/W12B_erdhausfront.md): Lage buried – Rang der Frontwandzellen für die Haustür
   * (`middleRank`): je näher an der Mitte der Front, desto höher (Vorbilder: Rundtür mittig, Fenster paarweise). Ohne
   * Frontzelle `undefined` (wie bisher).
   */
  function buriedMiddle(lvl: Level): Map<number, number> | undefined {
    const out = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const l = lvl.labels[i]!;
      const b = l > 0 && l <= lvl.rooms.length ? buried.get(lvl.vols[l]!) : undefined;
      if (b === undefined || lvl.plan.kind[i] !== WALL || lvl.plan.exterior[i] !== 1) continue;
      const [x, z] = worldCell(frame, i);
      if (forward(b.front, x, z) !== b.plane) continue;
      const a = axisOf(b.front) === 'z' ? x : z;
      out.set(i, 1 + (b.span[1] - b.span[0]) - Math.abs(2 * a - b.span[0] - b.span[1]));
    }
    return out.size > 0 ? out : undefined;
  }

  /**
   * W12-C (Scheunentor, `Volume.exterior.barn`): je Baukörper mit Scheunentor die Wandzelle mitten in der Giebelwand,
   * die vom übrigen Gebäude weg zeigt (Rechteck-Hülle der Erdgeschoss-Räume: Giebel = Schmalseite, der First läuft
   * entlang der Langseite; die Seite, deren Wandlinie weiter vom Schwerpunkt der übrigen Räume entfernt liegt). Bei
   * gerader Giebelbreite die Zelle links der Mitte. Ohne solchen Baukörper leer (bitgleich).
   */
  function barnDoorCells(): Set<number> {
    const out = new Set<number>();
    for (const v of used) {
      if (props.get(v)?.exterior?.barn !== true) continue;
      const g = groundOf.get(v);
      const own = painted.filter((r) => volumeOf(r) === v && r.floorIndex === g);
      const others = painted.filter((r) => volumeOf(r) !== v);
      if (own.length === 0 || others.length === 0) continue;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const r of own) for (const [x, z] of r.cells) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      let sx = 0, sz = 0, m = 0;
      for (const r of others) for (const [x, z] of r.cells) { sx += x; sz += z; m++; }
      const cx = sx / m, cz = sz / m;
      if (x1 - x0 >= z1 - z0) {
        const x = Math.abs(x1 - cx) >= Math.abs(x0 - cx) ? x1 : x0;
        out.add(idx([x, Math.floor((z0 + z1) / 2)]));
      } else {
        const z = Math.abs(z1 - cz) >= Math.abs(z0 - cz) ? z1 : z0;
        out.add(idx([Math.floor((x0 + x1) / 2), z]));
      }
    }
    return out;
  }

  /**
   * W13-C (28.09.2026, plan/spikes/W13C_erdhaus_huegel.md, Runde 2): Lage buried – jedes Frontfenster wird ein
   * Doppelfenster (2 × 2 Scheiben, im Rundrahmen ein Bullauge): die Nachbarzelle im Wandlauf weg von der Haustür wird
   * ebenfalls Fenster, wenn sie frei ist (kein Laufende, nicht verdeckt, kein Fenster). Spiegelgleich zur Tür. Ohne Lage
   * buried unverändert.
   */
  function buriedPairs(lvl: Level, planned: PlannedWindow[], covered: (cell: number) => boolean): PlannedWindow[] {
    if (buried.size === 0) return planned;
    const have = new Set(planned.map((w) => w.cell));
    const out = [...planned];
    for (const w of planned) {
      const b = buried.get(lvl.vols[w.room]!);
      if (b === undefined) continue;
      const alongOf = (cell: number): number => { const [x, z] = worldCell(frame, cell); return axisOf(b.front) === 'z' ? x : z; };
      const door = lvl.doors.find((dv) => dv.door.a === 0 && (() => { const [x, z] = worldCell(frame, dv.door.cell); return forward(b.front, x, z) === b.plane; })());
      if (door === undefined) continue;
      const run = lvl.plan.runs[w.run]!;
      const pos = lvl.plan.posInRun[w.cell]!;
      const away = Math.sign(alongOf(w.cell) - alongOf(door.door.cell));
      const k = [pos - 1, pos + 1].find((q) => q >= 1 && q <= run.cells.length - 2 && alongOf(run.cells[q]!) === alongOf(w.cell) + away);
      if (k === undefined) continue;
      const n = run.cells[k]!;
      if (have.has(n) || covered(n)) continue;
      have.add(n);
      out.push({ cell: n, inside: w.inside + (n - w.cell), room: w.room, run: w.run });
    }
    return out;
  }

  /** Lage buried: Rundtür und Rundfenster vor der Front (buried.ts) samt freizuhaltendem Ring-Inneren. */
  function buriedFront(s: Shell): { shell: Shell; clear: ReadonlySet<string>; own: ReadonlySet<string> } {
    const volumeOfRoom = new Map(painted.map((r) => [r.id, volumeOf(r)] as const));
    const front = buriedFrontDetails(s.cells, settings, (id) => (id === undefined ? undefined : volumeOfRoom.get(id)), exteriorModel(s).isAir);
    const own = new Set(front.cells.map((c) => key3(c.pos)));
    return { shell: front.cells.length === 0 ? s : { ...s, cells: [...s.cells, ...front.cells] }, clear: front.clear, own };
  }

  /** W2: Fassadenraster in Weltkoordinaten (Leseport für Außenprofil und Außen-Deko); ohne Raster `undefined`. */
  function facadeGridOf(): FacadeGridLine[] | undefined {
    if (options.facade?.rules?.grid !== true) return undefined;
    return levels.flatMap((l) => (l.grid ?? []).map((g): FacadeGridLine => {
      const ns = g.out === 'north' || g.out === 'south';
      const a0 = ns ? frame.x0 : frame.z0;
      return {
        floorIndex: l.floor.index, y0: l.floor.y0, out: g.out, plane: g.plane + (ns ? frame.z0 : frame.x0),
        from: g.from + a0, to: g.to + a0, posts: g.posts.map((p) => p + a0),
        bays: g.bays.map((b) => ({ from: b.from + a0, to: b.to + a0, axis: b.axis.map((x) => x + a0) })),
      };
    }));
  }

  function pos(i: number, y: number): Vec3 {
    const [x, z] = worldCell(frame, i);
    return [x, y, z];
  }

  /** Masken der Türplanung: fremde Böden sind nicht begehbar, fremde Wände bekommen keine Tür. */
  function doorMasks(lvl: Level): { blocked: Uint8Array; noDoor: Uint8Array } {
    const own = lvl.rooms.length;
    if (!lvl.labels.some((l) => l > own)) return { blocked: lvl.blocked, noDoor: lvl.noDoor };
    const foreignAt = (i: number, kind: number): boolean => lvl.labels[i]! > own && lvl.plan.kind[i] === kind;
    return {
      blocked: Uint8Array.from(lvl.blocked, (b, i) => (b === 1 || foreignAt(i, FLOOR) ? 1 : 0)),
      noDoor: Uint8Array.from(lvl.noDoor, (b, i) => (b === 1 || foreignAt(i, WALL) ? 1 : 0)),
    };
  }

  function emitLevel(lvl: Level, out: ShellCell[]): void {
    const { labels, plan, idOf, heights } = lvl;
    const own = lvl.rooms.length;
    const y0 = lvl.floor.y0;
    const baseY = y0 + 1;
    const doorAt = new Map(lvl.doors.map((v) => [v.door.cell, v] as const));
    const windowAt = new Set(lvl.windows.map((w) => w.cell));
    const ups = new Map([...lvl.members.keys()].map((v) => [v, upOf(lvl, v)] as const));
    const { skinWall, innerPost, jamb, seam } = junctions(lvl, doorAt, windowAt);
    // feat/underground: Gewölbe-Ebene (Etage ≤ −2, heute nur der Unterbau) aus Stein – Mauerwerk und Decke `foundation`,
    // Boden `floor_stone`, keine Holzpfosten (Undercroft statt Wohnkeller). Höhere Etagen unverändert (bitgleich).
    const vault = [...lvl.members.values()].every((f) => f.index <= VAULT_FLOOR);
    for (let i = 0; i < n; i++) {
      if (labels[i] === 0 || labels[i]! > own || lvl.noSlab[i] === 1) continue;
      // W4-B (Turmschaft): Bodenplatte eines Obergeschosses in der Außenwand in der Wandrolle – kein Band je Geschoss
      const plain = plan.kind[i] === WALL && plan.exterior[i] === 1 && plainShaftAt(lvl, lvl.vols[labels[i]!]!);
      out.push(cell(pos(i, y0), 'floor', vault ? 'floor_stone' : plain ? 'wall_primary' : 'floor_primary', 'block', undefined, idOf(labels[i]!), false));
    }
    for (let i = 0; i < n; i++) {
      if (plan.kind[i] !== WALL || labels[i]! > own) continue;
      const roomId = idOf(labels[i]!);
      const height = heights[labels[i]!]!;
      const windowTop = baseY + Math.min(2, height - 1);
      const exterior = plan.exterior[i] === 1;
      const door = doorAt.get(i);
      // W2: Anschluss außen als Wandfeld, Pfosten in der Endzelle der Innenwand (sonst: nur gerade Zellen sind Wand)
      const asWall = (plan.cls[i] === WC.STRAIGHT && innerPost[i] !== 1) || skinWall[i] === 1;
      for (let y = baseY; y <= y0 + height; y++) {
        const p = pos(i, y);
        if (door !== undefined && y === baseY) {
          out.push(cell(p, 'door', 'door', 'door', { facing: door.facing, half: 'lower', hinge: door.hinge }, roomId, exterior));
        } else if (door !== undefined && y === baseY + 1) {
          out.push(cell(p, 'door', 'door', 'door', { facing: door.facing, half: 'upper', hinge: door.hinge }, roomId, exterior));
        } else if (door !== undefined && y === baseY + 2) {
          out.push(cell(p, 'lintel', 'beam', 'log', { axis: door.door.axis }, roomId, exterior));
        } else if (windowAt.has(i) && y > baseY && y <= windowTop) {
          out.push(cell(p, 'window', 'window', 'pane', undefined, roomId, exterior));
        } else if (seam[i] === 1) {
          // W3-CA (X1 B6): Baukörperfuge – der Anschluss einer Brandwand an die Fassade ist ein Eckquader-Band
          out.push(cell(p, 'wall', 'wall_quoin', 'block', undefined, roomId, exterior));
        } else if (vault) {
          out.push(cell(p, asWall ? 'wall' : 'pillar', 'foundation', 'block', undefined, roomId, exterior));
        } else if (asWall && !(jamb[i] === 1 && y <= baseY + 1)) {
          out.push(cell(p, 'wall', 'wall_primary', 'block', undefined, roomId, exterior));
        } else {
          out.push(cell(p, 'pillar', 'beam', 'log', { axis: 'y' }, roomId, exterior));
        }
      }
    }
    for (const i of lvl.railing) out.push(cell(pos(i, baseY), 'railing', 'beam', 'fence', undefined, idOf(labels[i]!), false));
    for (let i = 0; i < n; i++) {
      const label = labels[i]!;
      if (label === 0 || label > own) continue;
      const v = lvl.vols[label]!;
      if (ups.get(v)?.footprint[i] === 1) continue; // dort ist die Bodenplatte der Etage darüber die Decke
      const ladder = hatches.get(lvl)?.get(i);
      if (ladder !== undefined) {
        // W4-B: Dachluke – Leiter von der untersten Luftreihe bis in die Dachplatte (dort keine Decke)
        for (let y = baseY; y <= y0 + heights[label]! + 1; y++) out.push(cell(pos(i, y), 'stairs', 'ladder', 'ladder', { facing: ladder }, idOf(label), false));
        continue;
      }
      out.push(cell(pos(i, y0 + heights[label]! + 1), 'ceiling', vault ? 'foundation' : 'ceiling', 'block', undefined, idOf(label), roofOf(v) === 'flat'));
    }
  }

  /**
   * W2 (Baustandard W1/I2/I4, Regeln `skin` und `jambs`): Zellen, die anders als nach ihrer Grundriss-Klasse gebaut
   * werden. `skinWall`: T bzw. Wandende in der Außenwand (Innenwand-Anschluss) wird Wandfeld – die T-Zelle hat bei
   * 1 Block dicken Wänden nur die Außenseite frei (X1 §2 B1), innen ist sie nie sichtbar. `innerPost`: dafür wird die
   * Endzelle der Innenwand, die an die Außenwand stößt, zum Pfosten (von beiden Räumen sichtbar, X4 §7.1) – nicht an
   * Türen, nie in einer Außenwand. `jamb`: Wandzellen links und rechts jeder Innentür werden in den Türreihen Pfosten
   * (Laibung, mit dem Sturz darüber ein Rahmen). Ohne die Regeln bleiben alle Masken leer (zellgleich zu vorher).
   */
  function junctions(lvl: Level, doorAt: ReadonlyMap<number, DoorView>, windowAt: ReadonlySet<number>): { skinWall: Uint8Array; innerPost: Uint8Array; jamb: Uint8Array; seam: Uint8Array } {
    const rules = options.facade?.rules;
    const { plan, labels } = lvl;
    const own = lvl.rooms.length;
    const skinWall = new Uint8Array(rules?.skin === true ? n : 0);
    const innerPost = new Uint8Array(rules?.skin === true ? n : 0);
    const jamb = new Uint8Array(rules?.jambs === true ? n : 0);
    const plainWall = (j: number): boolean =>
      j >= 0 && j < n && plan.kind[j] === WALL && labels[j]! > 0 && labels[j]! <= own && plan.cls[j] === WC.STRAIGHT && plan.exterior[j] !== 1
      && !doorAt.has(j) && !windowAt.has(j);
    if (rules?.skin === true) {
      for (let i = 0; i < n; i++) {
        const cls = plan.cls[i];
        if (plan.kind[i] !== WALL || labels[i]! > own || plan.exterior[i] !== 1 || (cls !== WC.T && cls !== WC.END)) continue;
        skinWall[i] = 1;
        if (cls !== WC.T) continue;
        // T: die fehlende Wandrichtung zeigt nach außen, gegenüber läuft die Innenwand
        const outward = DIRS.find((dir) => (plan.mask[i]! & BIT[dir]) === 0)!;
        const [dx, dz] = STEP[OPP[outward]];
        const x = (i % frame.w) + dx;
        const z = Math.floor(i / frame.w) + dz;
        const j = inFrame(frame, x, z) ? z * frame.w + x : -1;
        if (plainWall(j)) innerPost[j] = 1;
      }
    }
    if (rules?.jambs === true) {
      for (const v of lvl.doors) {
        const d = v.door;
        if (d.room[0] === 0 || d.room[1] === 0) continue; // nur Innentüren
        const step = d.axis === 'x' ? 1 : frame.w;
        for (const j of [d.cell - step, d.cell + step]) if (plainWall(j) && innerPost[j] !== 1) jamb[j] = 1;
      }
    }
    return { skinWall, innerPost, jamb, seam: seamCells(lvl, doorAt, windowAt) };
  }

  /**
   * W3-CA (Prüfbericht X1 B6, Baukörperfuge): T-Zelle der Außenwand, an die eine **Brandwand zwischen zwei Baukörpern**
   * stößt – dort wird die Fassade über die ganze Etagenhöhe ein Eckquader-Band (Lisene), damit der Übergang Palas/
   * Bergfried als bewusste Fuge lesbar ist statt als Zufall eines Eck-Ankers. Nur mit Eckquadern (`FacadeStyle.quoins`)
   * und mehreren Baukörpern; sonst leer (zellgleich).
   */
  function seamCells(lvl: Level, doorAt: ReadonlyMap<number, DoorView>, windowAt: ReadonlySet<number>): Uint8Array {
    const { plan, labels } = lvl;
    const own = lvl.rooms.length;
    if (options.facade?.quoins !== true || !multi) return new Uint8Array(0);
    const seam = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (plan.kind[i] !== WALL || labels[i]! > own || plan.exterior[i] !== 1 || plan.cls[i] !== WC.T || doorAt.has(i) || windowAt.has(i)) continue;
      const outward = DIRS.find((dir) => (plan.mask[i]! & BIT[dir]) === 0)!;
      const [sx, sz] = STEP[OPP[outward]];
      const x = (i % frame.w) + sx;
      const z = Math.floor(i / frame.w) + sz;
      if (!inFrame(frame, x, z)) continue;
      // Räume beiderseits des Brandwand-Stummels (quer zur Außenwand)
      const [ax, az] = STEP[CCW[outward]];
      const side = (k: number): number => (inFrame(frame, x + k * ax, z + k * az) ? labels[(z + k * az) * frame.w + x + k * ax]! : 0);
      const [la, lb] = [side(1), side(-1)];
      if (la === 0 || lb === 0) continue;
      const other = (la > own) !== (lb > own) || (la <= own && lb <= own && lvl.vols[la] !== lvl.vols[lb]);
      if (other) seam[i] = 1;
    }
    return seam;
  }

  /**
   * Dach des Baukörpers `v` über seinem Grundriss in `lvl` ohne den seiner Etage darüber, samt Giebelwänden
   * (roof-shapes.ts); merkt sich die Dachhöhe je Spalte.
   */
  function emitRoof(lvl: Level, v: VolumeId, kind: PitchedRoof, over: number, out: ShellCell[]): void {
    const f = lvl.members.get(v)!;
    const up = upOf(lvl, v);
    const own = lvl.rooms.length;
    const solo = lvl.members.size === 1;
    const footprint = solo ? lvl.footprint : Uint8Array.from(lvl.labels, (l) => (l > 0 && l <= own && lvl.vols[l] === v ? 1 : 0));
    const upFoot = up === undefined ? undefined : up.members.size === 1 ? up.footprint : Uint8Array.from(up.labels, (l) => (l > 0 && l <= up.rooms.length && up.vols[l] === v ? 1 : 0));
    const region = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      if (footprint[i] === 1 && upFoot?.[i] !== 1) {
        region[i] = 1;
        any = true;
      }
    }
    if (!any) return;
    const ceilingY = f.y0 + f.height + 1;
    // Aussparung: kein Dach über angedockten Bauwerken, die bis an das Dach dieser Etage reichen, und über fremden Baukörpern
    const cut = annexes.filter(({ a }) => a.top >= ceilingY + 1 - over);
    const foreign = noRoofOf?.get(v);
    const noRoof = cut.length === 0 && foreign === undefined
      ? undefined
      : Uint8Array.from({ length: n }, (_, i) => (cut.some(({ foot }) => foot[i] === 1) || foreign?.[i] === 1 ? 1 : 0));
    // Brandwand eines anderen Baukörpers (höherer Rang trägt): dorthin keine Giebelwand
    const closed = multi ? Uint8Array.from(colRank, (r) => (r > 0 && r - 1 < rank(v) ? 1 : 0)) : undefined;
    const detail = roofDetailFor(v);
    // W2 (D5): Dachhöhen-Budget – Traufhöhe ab der Bodenplatte des Erdgeschosses, Geschosshöhe dieser Etage
    const storeys = levels.filter((l) => (l.members.get(v)?.index ?? -1) >= 0);
    const ground = levelAt(v, Math.max(0, groundOf.get(v)!))?.members.get(v);
    const budget = ground !== undefined ? { groundY: ground.y0, storey: f.height + 1, single: storeys.length <= 1 } : undefined;
    const dormersOf = options.dormers ?? (options.facadeRhythm?.dormers === true ? RHYTHM_DORMERS : undefined);
    const roof = buildRoofBlocks(
      {
        style: kind, overhang: over, front: frontOf(v),
        ...(detail !== undefined ? { detail } : {}),
        ...(dormersOf !== undefined ? { dormers: dormersOf } : {}),
      },
      {
        x0: frame.x0, z0: frame.z0, w: frame.w, d: frame.d, region, footprint, ceilingY,
        // Kappung auf Wandhöhe der Etage darüber (Pultdach an höheren Wänden)
        ...(up !== undefined ? { upper: upFoot!, capY: ceilingY + up.members.get(v)!.height } : {}),
        ...(noRoof !== undefined ? { noRoof } : {}),
        ...(closed !== undefined ? { closed } : {}),
        ...(budget !== undefined ? { budget } : {}),
      },
    );
    for (const s of roof.sills) sills.set(`${s.pos[0]},${s.pos[1]},${s.pos[2]}`, s.axis);
    if (detail?.heightBudget === true || roof.split === true || roof.knee !== undefined) {
      roofFit.push({
        volumeId: v, floorIndex: f.index, requested: detail?.pitch ?? 'normal', pitch: roof.pitch, area: region.reduce((a, b) => a + b, 0),
        ...(roof.split === true ? { split: true } : {}),
        ...(roof.knee !== undefined ? { knee: roof.knee } : {}),
      });
    }
    const roomAt = (i: number): RoomId | undefined => {
      const l = lvl.labels[i]!;
      return l === 0 || l > own ? undefined : lvl.idOf(l);
    };
    for (const b of roof.blocks) out.push(cell(b.pos, b.kind, b.role, b.shape, b.orient, roomAt(b.i), true));
    for (let i = 0; i < n; i++) {
      if (region[i] !== 1 || !Number.isFinite(roof.top[i]!)) continue;
      const [x, z] = worldCell(frame, i);
      attic.push({ x, z, floorY: f.y0 + lvl.heights[lvl.labels[i]!]! + 1, top: roof.top[i]! });
    }
    (gableCols.get(v) ?? gableCols.set(v, []).get(v)!).push(...roof.gables);
    for (const df of roof.dormers) {
      const roomId = roomAt(idx(df.panes[0]!));
      dormerFronts.push({ ...df, floorIndex: f.index, ...(roomId !== undefined ? { roomId } : {}) });
    }
    if (lvl.roofTop === undefined) lvl.roofTop = roof.top;
    else for (let i = 0; i < n; i++) lvl.roofTop[i] = Math.max(lvl.roofTop[i]!, roof.top[i]!);
    if (spans !== undefined) {
      const lo = new Map<number, number>();
      for (const b of roof.blocks) lo.set(b.i, Math.min(lo.get(b.i) ?? Infinity, b.pos[1]));
      for (const [i, y] of lo) (spans.get(i) ?? spans.set(i, []).get(i)!).push({ rank: rank(v), lo: y, hi: roof.top[i]! });
    }
  }

  /** W4-B (`RoofDetail.plainShaft`): Obergeschoss eines Turmschafts – Bodenplatte in der Außenwand ohne Band. */
  function plainShaftAt(lvl: Level, v: VolumeId): boolean {
    const f = lvl.members.get(v);
    return f !== undefined && detailOf(v)?.plainShaft === true && f.index > groundOf.get(v)!;
  }

  /**
   * W4-B (`RoofDetail.hatch`, Mechanik: Leiter braucht eine volle Fläche dahinter, eine offene Falltür direkt über der
   * Leiter mit gleichem `facing` ist kletterbar): Dachluke im obersten Geschoss eines Baukörpers mit Flachdach. Im
   * größten eigenen Raum eine Bodenzelle an einer Wandzelle ohne Tür und Fenster (die Leiter hängt über alle Wandreihen
   * an ihr), davor eine freie Bodenzelle desselben Raums; nicht auf Treppen, Öffnungen, Zugängen oder vor Türen. Wahl:
   * Ecke vor Wandmitte, dann weit weg von Treppen-Austritt und Türen, dann die kleinste Zelle (deterministisch). Leiter-
   * Zelle gesperrt, die Zelle davor als Treppenzugang `hatch:<Baukörper>` (die Einrichtung hält sie frei und erreichbar).
   */
  function placeHatches(lvl: Level): void {
    const { plan, labels } = lvl;
    const own = lvl.rooms.length;
    for (const [v, f] of lvl.members) {
      if (roofOf(v) !== 'flat' || buried.has(v) || detailOf(v)?.hatch !== true || levelAt(v, f.index + 1) !== undefined) continue;
      const size = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        const l = labels[i]!;
        if (l > 0 && l <= own && lvl.vols[l] === v && plan.kind[i] === FLOOR) size.set(l, (size.get(l) ?? 0) + 1);
      }
      const room = [...size.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      if (room === undefined) continue;
      const doorCells = new Set(lvl.doors.map((d) => d.door.cell));
      const doorSides = lvl.doors.flatMap((d) => d.door.side.filter((c) => c >= 0));
      const windowCells = new Set(lvl.windows.map((w) => w.cell));
      const keep = [...lvl.access.map((a) => a.cell), ...doorSides];
      const floorOf = (i: number): boolean => i >= 0 && i < n && plan.kind[i] === FLOOR && labels[i] === room;
      const wallAt = (i: number): boolean => i >= 0 && i < n && plan.kind[i] === WALL && !doorCells.has(i) && !windowCells.has(i);
      let best: { i: number; facing: HorizontalDir; score: readonly number[] } | undefined;
      for (let i = 0; i < n; i++) {
        if (!floorOf(i) || lvl.blocked[i] === 1 || lvl.reserved[i] === 1 || doorSides.includes(i)) continue;
        const x = i % frame.w;
        const z = Math.floor(i / frame.w);
        const at = (d: HorizontalDir, k = 1): number => (inFrame(frame, x + STEP[d][0] * k, z + STEP[d][1] * k) ? i + STEP[d][0] * k + STEP[d][1] * k * frame.w : -1);
        const walls = DIRS.filter((d) => plan.kind[at(d)] === WALL).length;
        const far = keep.length === 0 ? 0 : Math.min(...keep.map((c) => Math.max(Math.abs((c % frame.w) - x), Math.abs(Math.floor(c / frame.w) - z))));
        for (const d of DIRS) {
          const facing = OPP[d];
          const front = at(facing);
          if (!wallAt(at(d)) || !floorOf(front) || lvl.blocked[front] === 1) continue;
          const score = [walls >= 2 ? 0 : 1, -far, i, DIRS.indexOf(d)];
          if (best === undefined || lexLess(score, best.score)) best = { i, facing, score };
        }
      }
      if (best === undefined) {
        warnings.push(`Dachluke (Baukörper ${v}): im obersten Raum keine fensterlose Wand mit freier Zelle davor – ohne Zugang zum Dach`);
        continue;
      }
      const front = best.i + STEP[best.facing][0] + STEP[best.facing][1] * frame.w;
      lvl.blocked[best.i] = 1;
      lvl.reserved[best.i] = 1;
      lvl.reserved[front] = 1;
      lvl.access.push({ cell: front, toward: OPP[best.facing], linkId: `hatch:${v}`, end: 'bottom' });
      (hatches.get(lvl) ?? hatches.set(lvl, new Map()).get(lvl)!).set(best.i, best.facing);
    }
  }

  /**
   * W2 (Baustandard D8): Flachdach mit Rand – ein Gesims aus umgedrehten Treppen (`roof_trim`, Rücken zur Wand) auf
   * Deckenhöhe rund um die Wandflucht, an Außenecken eine obere Stufe. Nur wo die Decke Dach ist (keine Etage darüber),
   * außerhalb aller Grundrisse, fremder Baukörper und Anbauten; eingegrabene Baukörper (Erde) bleiben ohne.
   */
  function emitFlatRim(lvl: Level, v: VolumeId, out: ShellCell[]): void {
    const f = lvl.members.get(v)!;
    const up = upOf(lvl, v);
    const own = lvl.rooms.length;
    const mine = (i: number): boolean => lvl.labels[i]! > 0 && lvl.labels[i]! <= own && lvl.vols[lvl.labels[i]!] === v;
    const upFoot = up === undefined ? undefined : Uint8Array.from(up.labels, (l) => (l > 0 && l <= up.rooms.length && up.vols[l] === v ? 1 : 0));
    const ceilingY = f.y0 + f.height + 1;
    // W4-B (Turmschaft): Steingesims (Kragsteinkranz unter der Brüstung) statt Holzrand
    const rimRole = detailOf(v)?.plainShaft === true ? 'wall_cornice' : 'roof_trim';
    const free = (x: number, z: number): boolean => {
      if (!inFrame(frame, x, z)) return false;
      const j = z * frame.w + x;
      return lvl.labels[j] === 0 && colRank[j] === 0 && !annexes.some(({ foot }) => foot[j] === 1);
    };
    const rim = new Set<number>();
    for (let i = 0; i < n; i++) {
      if (!mine(i) || lvl.plan.kind[i] !== WALL || upFoot?.[i] === 1) continue;
      const x = i % frame.w;
      const z = Math.floor(i / frame.w);
      for (const dir of DIRS) {
        const nx = x + STEP[dir][0];
        const nz = z + STEP[dir][1];
        const j = nz * frame.w + nx;
        if (!free(nx, nz) || rim.has(j)) continue;
        rim.add(j);
        out.push(cell(pos(j, ceilingY), 'roof', rimRole, 'stairs', { facing: OPP[dir], half: 'top' }, undefined, true));
      }
    }
    // Außenecken: Diagonale neben zwei Randzellen
    for (let i = 0; i < n; i++) {
      if (!mine(i) || lvl.plan.kind[i] !== WALL || upFoot?.[i] === 1) continue;
      const x = i % frame.w;
      const z = Math.floor(i / frame.w);
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const j = (z + dz) * frame.w + x + dx;
        if (!free(x + dx, z + dz) || rim.has(j) || !rim.has(z * frame.w + x + dx) || !rim.has((z + dz) * frame.w + x)) continue;
        rim.add(j);
        out.push(cell(pos(j, ceilingY), 'roof', rimRole, 'slab', { half: 'top' }, undefined, true));
      }
    }
  }

  /** Vorderseite eines Baukörpers: Haustür in seinen Räumen, sonst die erste Haustür, sonst Süden. */
  function frontOf(v: VolumeId): HorizontalDir {
    const mains = grounds.flatMap((l) => l.doors.filter((d) => d.door.isMain).map((d) => ({ l, d })));
    const mine = mains.find(({ l, d }) => d.door.room.some((label) => label > 0 && l.vols[label] === v));
    return (mine ?? mains[0])?.d.facing ?? 'south';
  }

  /**
   * Dach-Aussparung je Baukörper: fremde Spalten und Überstand-Spalten, die näher (Manhattan) an einem anderen Baukörper
   * liegen – so treffen sich zwei Überstände an der Brandwand-Linie, statt sich zu überlagern (Gleichstand: höherer Rang).
   */
  function roofShares(): Map<VolumeId, Uint8Array> {
    const dist = order.map((_, k) => {
      const d = new Int32Array(n).fill(-1);
      const queue: number[] = [];
      for (let i = 0; i < n; i++) if (colRank[i] === k + 1) (d[i] = 0), queue.push(i);
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q]!;
        const x = i % frame.w;
        const z = Math.floor(i / frame.w);
        for (const dir of DIRS) {
          const nx = x + STEP[dir][0];
          const nz = z + STEP[dir][1];
          if (!inFrame(frame, nx, nz)) continue;
          const j = nz * frame.w + nx;
          if (d[j]! < 0) (d[j] = d[i]! + 1), queue.push(j);
        }
      }
      return d;
    });
    return new Map(order.map((v, k) => [v, Uint8Array.from({ length: n }, (_, i) => {
      if (colRank[i] !== 0) return colRank[i] !== k + 1 ? 1 : 0;
      const mine = dist[k]![i]!;
      return dist.some((d, kk) => kk !== k && d[i]! >= 0 && (d[i]! < mine || (d[i] === mine && kk < k))) ? 1 : 0;
    })] as const));
  }

  /**
   * Abdichten zwischen Baukörpern: Luft einer Spalte c (innen: von der tiefsten Bodenplatte bis zur obersten Hüllzelle;
   * dazu die offene untere Hälfte einer oberen Stufe), die an eine Spalte j eines anderen Baukörpers grenzt, wo dieser
   * außerhalb seines Inneren ist und nichts steht, bekommt in j eine Wandzelle; dazu die Zelle neben Dachblock bzw.
   * Bodenplatte an den Enden (bündige Brandwand). Eine Stufe in j neben solcher Luft wird Vollblock (ihre offene Hälfte
   * führte sonst hinaus). Danach läuft die Füllung entlang der Brandwand-Linie bis an die Ecken. Liefert die Frage
   * „liegt (x, y, z) im Inneren eines anderen Baukörpers als Rang r?“ (Giebelfenster).
   */
  function sealVolumes(occ: Set<string>): (x: number, y: number, z: number, r: number) => boolean {
    const lo = new Float64Array(n).fill(Infinity);
    const hi = new Float64Array(n).fill(-Infinity);
    for (const l of levels) for (let i = 0; i < n; i++) if (l.footprint[i] === 1) lo[i] = Math.min(lo[i]!, l.floor.y0);
    for (const c of cells) {
      const i = idx([c.pos[0], c.pos[2]]);
      if (i >= 0) hi[i] = Math.max(hi[i]!, c.pos[1]);
    }
    const key = (i: number, y: number): string => {
      const [x, z] = worldCell(frame, i);
      return `${x},${y},${z}`;
    };
    /** Stufen (nur Dach) je Position: Index in `cells`. */
    const slabs = new Map<string, number>();
    cells.forEach((c, k) => {
      if (c.shape === 'slab') slabs.set(`${c.pos[0]},${c.pos[1]},${c.pos[2]}`, k);
    });
    /** Raum der Spalte j im Geschoss auf oder unter y (sonst im untersten). */
    const roomAt = (j: number, y: number): RoomId | undefined => {
      let best: RoomId | undefined;
      for (const l of levels) {
        const label = l.labels[j]!;
        if (label === 0 || label > l.rooms.length) continue;
        if (best === undefined || l.floor.y0 <= y) best = l.idOf(label);
      }
      return best;
    };
    const fill: ShellCell[] = [];
    for (let c = 0; c < n; c++) {
      if (colRank[c] === 0 || lo[c] === Infinity) continue;
      const cx = c % frame.w;
      const cz = Math.floor(c / frame.w);
      for (const dir of DIRS) {
        const nx = cx + STEP[dir][0];
        const nz = cz + STEP[dir][1];
        if (!inFrame(frame, nx, nz)) continue;
        const j = nz * frame.w + nx;
        if (colRank[j] === 0 || colRank[j] === colRank[c]) continue;
        const outside = (y: number): boolean => (y < lo[j]! || y > hi[j]!) && !occ.has(key(j, y));
        const trig: number[] = [];
        for (let y = lo[c]!; y <= hi[c]!; y++) {
          // obere Stufe: ihre untere Hälfte ist Dachraum-Luft
          if (occ.has(key(c, y)) && cells[slabs.get(key(c, y)) ?? -1]?.orient?.half !== 'top') continue;
          if (outside(y)) trig.push(y);
          const k = occ.has(key(c, y)) ? undefined : slabs.get(key(j, y));
          if (k !== undefined) {
            const { orient: _half, ...rest } = cells[k]!;
            cells[k] = { ...rest, shape: 'block' };
            slabs.delete(key(j, y));
          }
        }
        const put = (y: number): void => {
          if (!outside(y)) return;
          const roomId = roomAt(j, y);
          occ.add(key(j, y));
          fill.push(cell(pos(j, y), 'wall', 'wall_primary', 'block', undefined, roomId, true));
        };
        for (let s = 0; s < trig.length; ) {
          let e = s;
          while (e + 1 < trig.length && trig[e + 1] === trig[e]! + 1) e++;
          const a = trig[s]!;
          const b = trig[e]!;
          if (occ.has(key(c, a - 1))) put(a - 1);
          for (let y = a; y <= b; y++) put(y);
          if (occ.has(key(c, b + 1))) put(b + 1);
          s = e + 1;
        }
      }
    }
    // Entlang der Brandwand-Linie bis an die Ecken weiterführen: Spalten desselben Baukörpers außerhalb seines Inneren,
    // die an das Innere eines anderen grenzen (sonst bliebe unter bzw. über der Ecke eine Kerbe)
    for (let q = 0; q < fill.length; q++) {
      const [fx, y, fz] = fill[q]!.pos;
      const j = idx([fx, fz]);
      for (const dir of DIRS) {
        const k = idx([fx + STEP[dir][0], fz + STEP[dir][1]]);
        if (k < 0 || colRank[k] !== colRank[j] || occ.has(key(k, y)) || (y >= lo[k]! && y <= hi[k]!)) continue;
        const kx = k % frame.w;
        const kz = Math.floor(k / frame.w);
        const touches = DIRS.some((d2) => {
          if (!inFrame(frame, kx + STEP[d2][0], kz + STEP[d2][1])) return false;
          const m = (kz + STEP[d2][1]) * frame.w + kx + STEP[d2][0];
          return colRank[m] !== 0 && colRank[m] !== colRank[k] && y >= lo[m]! && y <= hi[m]!;
        });
        if (!touches) continue;
        occ.add(key(k, y));
        fill.push(cell(pos(k, y), 'wall', 'wall_primary', 'block', undefined, roomAt(k, y), true));
      }
    }
    cells.push(...fill);
    return (x, y, z, r) => {
      const i = idx([x, z]);
      return i >= 0 && colRank[i] !== 0 && colRank[i] !== r + 1 && y >= lo[i]! && y <= hi[i]!;
    };
  }

  /**
   * Anbauten prüfen (Grundriss außerhalb der Räume, am Haus; Öffnung = gerade Außenwand zwischen Raum und Anbau) und
   * die Wände am Anbau für Tür- und Fensterplanung sperren (Etagen, deren Wand unter der Oberkante des Anbaus beginnt).
   */
  function placeAnnexes(list: readonly ShellAnnex[]): AnnexAt[] {
    const out: AnnexAt[] = [];
    for (const a of list) {
      const foot = new Uint8Array(n);
      const own = [...a.footprint].map(idx);
      for (const i of own) foot[i] = 1;
      const near = (i: number, test: (j: number) => boolean): boolean => DIRS.some((dir) => test(i + STEP[dir][0] + STEP[dir][1] * frame.w));
      if (own.length === 0 || own.some((i) => levels.some((l) => l.footprint[i] === 1))) {
        warnings.push(`Anbau ${a.id}: Grundriss leer oder über Räumen – ignoriert`);
        continue;
      }
      if (!own.some((i) => near(i, (j) => levels.some((l) => l.footprint[j] === 1)))) {
        warnings.push(`Anbau ${a.id} berührt das Haus nicht – ignoriert`);
        continue;
      }
      const openings: AnnexDoor[] = [];
      for (const o of a.openings ?? []) {
        const i = idx(o.at);
        const onFloor = levels.filter((l) => l.rooms.some((r) => r.floorIndex === o.floorIndex));
        const lvl = onFloor.find((l) => i >= 0 && l.plan.kind[i] === WALL && l.labels[i]! <= l.rooms.length) ?? onFloor[0];
        const run = i >= 0 && lvl !== undefined ? lvl.plan.runs[lvl.plan.runOf[i]!] : undefined;
        const across = run?.axis === 'x' ? frame.w : 1;
        const inside = [i - across, i + across].find((j) => lvl?.plan.kind[j] === FLOOR && lvl.blocked[j] !== 1 && lvl.labels[j]! <= lvl.rooms.length);
        const ok = lvl !== undefined && run !== undefined && lvl.plan.cls[i] === WC.STRAIGHT && inside !== undefined && foot[2 * i - inside] === 1
          && lvl.heights[lvl.labels[inside]!]! >= 2 && lvl.floor.y0 + 2 <= a.top;
        if (ok) openings.push({ lvl, floorIndex: o.floorIndex, cell: i, inside });
        else warnings.push(`Anbau ${a.id}: Öffnung bei ${o.at.join(',')} (Etage ${o.floorIndex}) ist keine gerade Außenwand zwischen Raum und Anbau – ignoriert`);
      }
      for (const l of levels) {
        if (l.floor.y0 + 1 > a.top) continue;
        for (let i = 0; i < n; i++) if (l.plan.kind[i] === WALL && near(i, (j) => foot[j] === 1)) l.noDoor[i] = 1;
      }
      out.push({ a, foot, openings });
    }
    return out;
  }

  /** Leseport eines Anbaus: Türen und die höchste Hüllenzelle an der Kontaktlinie. */
  function annexView({ a, foot, openings }: AnnexAt): ShellAnnexInfo {
    let contactTop = -Infinity;
    for (const c of cells) {
      const i = idx([c.pos[0], c.pos[2]]);
      if (i >= 0 && foot[i] !== 1 && DIRS.some((dir) => foot[i + STEP[dir][0] + STEP[dir][1] * frame.w] === 1)) contactTop = Math.max(contactTop, c.pos[1]);
    }
    const doors = openings.flatMap((o) => o.lvl.doors.filter((v) => v.door.cell === o.cell)
      .map((v) => ({ floorIndex: o.floorIndex, at: worldCell(frame, o.cell), y: o.lvl.floor.y0 + 1, facing: v.facing })));
    return { id: a.id, footprint: a.footprint, top: a.top, doors, contactTop };
  }

  function emitLinks(placed: readonly PlacedLink[], out: ShellCell[]): void {
    for (const pl of placed) {
      const roomId = pl.lo.idOf(pl.lowerLabel);
      for (const b of pl.layout.blocks) {
        const p: Vec3 = [b.cell[0], pl.lo.floor.y0 + b.dy, b.cell[1]];
        switch (b.part) {
          case 'tread':
            out.push(cell(p, 'stairs', 'beam', 'stairs', { facing: b.facing!, half: 'bottom' }, roomId, false));
            break;
          case 'landing':
          case 'fill':
            out.push(cell(p, 'stairs', 'beam', 'planks', undefined, roomId, false));
            break;
          case 'post':
            out.push(cell(p, 'stairs', 'beam', 'log', { axis: 'y' }, roomId, false));
            break;
          case 'ladder':
            out.push(cell(p, 'stairs', 'ladder', 'ladder', { facing: b.facing! }, roomId, false));
            break;
          case 'support':
            if (pl.supportPost) out.push(cell(p, 'stairs', 'beam', 'log', { axis: 'y' }, roomId, false));
            break;
        }
      }
    }
  }

  function roomViews(lvl: Level): Array<[RoomId, RoomShellInfo]> {
    const { rooms, plan, labels, floor } = lvl;
    const own = rooms.length;
    const doorsOf: ShellDoor[][] = rooms.map(() => []);
    const windowsOf: ShellWindow[][] = rooms.map(() => []);
    const interiorOf: Cell[][] = rooms.map(() => []);
    const blockedOf: Cell[][] = rooms.map(() => []);
    const stairsOf: ShellStairAccess[][] = rooms.map(() => []);
    for (const v of lvl.doors) {
      const d = v.door;
      for (const k of [0, 1] as const) {
        const l = d.room[k];
        if (l === 0) continue;
        // W4-C: Flügel einer Doppeltür nennen die Innenzelle vor dem anderen Flügel (Einrichtung und Außen-Planer)
        const partner = d.pair === undefined ? undefined : worldCell(frame, d.pair + (d.side[k] - d.cell));
        doorsOf[l - 1]!.push({ inside: worldCell(frame, d.side[k]), toward: towardDoor(d.axis, k), isMain: d.isMain, ...(partner !== undefined ? { partner } : {}) });
      }
    }
    for (const w of lvl.windows) {
      const k = w.inside < w.cell ? 0 : 1;
      windowsOf[w.room - 1]!.push({ inside: worldCell(frame, w.inside), toward: towardDoor(plan.runs[w.run]!.axis, k) });
    }
    for (let i = 0; i < n; i++) {
      if (plan.kind[i] !== FLOOR || labels[i]! > own) continue;
      interiorOf[labels[i]! - 1]!.push(worldCell(frame, i));
      if (lvl.blocked[i] === 1) blockedOf[labels[i]! - 1]!.push(worldCell(frame, i));
    }
    for (const a of lvl.access) stairsOf[labels[a.cell]! - 1]!.push({ inside: worldCell(frame, a.cell), toward: a.toward, linkId: a.linkId, end: a.end });
    const baseY = floor.y0 + 1;
    return rooms.map((r, k) => {
      const blocked = CellSet.of(blockedOf[k]!);
      const interior = CellSet.of(interiorOf[k]!);
      if (!blocked.isEmpty && stairsOf[k]!.length > 0) {
        const free = interior.difference(blocked);
        if (free.components().length > 1) warnings.push(`Raum ${r.id}: Treppe/Geländer teilen die freie Fläche`);
      }
      return [
        r.id,
        {
          roomId: r.id, floorIndex: r.floorIndex, baseY, height: lvl.heights[k + 1]!,
          interior, doors: doorsOf[k]!, windows: windowsOf[k]!, blocked, stairs: stairsOf[k]!,
        },
      ];
    });
  }

  /**
   * Treppen in die Geschosse ihres Baukörpers eintragen (Baukörper = Raum an `origin` unten); ungültige (Wand,
   * außerhalb, Überschneidung) mit Warnung überspringen.
   */
  function placeLinks(all: readonly VerticalLink[], index: (c: Cell) => number, warn: string[]): PlacedLink[] {
    const out: PlacedLink[] = [];
    for (const link of [...all].sort((a, b) => compareRoomIds(a.id, b.id))) {
      const start = painted.find((r) => r.floorIndex === link.floorIndex && r.cells.has(link.origin[0], link.origin[1]));
      const v = start === undefined ? DEFAULT_VOLUME : volumeOf(start);
      const lo = levelAt(v, link.floorIndex);
      const up = levelAt(v, link.floorIndex + 1);
      if (lo === undefined || up === undefined) {
        warn.push(`Treppe ${link.id}: auf Etage ${lo === undefined ? link.floorIndex : link.floorIndex + 1} gibt es keinen Raum – Treppe ignoriert`);
        continue;
      }
      let layout: StairLayout;
      try {
        layout = stairLayout(link, up.floor.y0 - lo.floor.y0);
      } catch (e) {
        warn.push(`Treppe ${link.id}: ${(e as Error).message}`);
        continue;
      }
      const lowerCells = [...layout.footprint, layout.bottom.inside].map(index);
      const upperCells = [...layout.holes, ...layout.top, layout.arrival.inside].map(index);
      const lowerLabel = lowerCells[0]! >= 0 ? lo.labels[lowerCells[0]!]! : 0;
      const upperLabel = upperCells[upperCells.length - 1]! >= 0 ? up.labels[upperCells[upperCells.length - 1]!]! : 0;
      const fits = (lvl: Level, label: number, cs: readonly number[]): boolean =>
        label > 0 && label <= lvl.rooms.length && cs.every((i) => i >= 0 && lvl.plan.kind[i] === FLOOR && lvl.labels[i] === label && lvl.reserved[i] !== 1);
      let supportPost = false;
      let ok = fits(lo, lowerLabel, lowerCells) && fits(up, upperLabel, upperCells);
      if (ok && layout.support !== undefined) {
        const s = index(layout.support);
        if (s >= 0 && lo.plan.kind[s] === WALL) supportPost = false;
        else if (s >= 0 && lo.plan.kind[s] === FLOOR && lo.labels[s] === lowerLabel && lo.reserved[s] !== 1) supportPost = true;
        else ok = false;
      }
      if (!ok) {
        warn.push(`Treppe ${link.id} passt nicht (mehr) in die Räume: Wand, außerhalb oder überschneidet eine andere Treppe – ignoriert`);
        continue;
      }
      for (const c of layout.footprint) {
        lo.reserved[index(c)] = 1;
        lo.blocked[index(c)] = 1;
      }
      if (layout.support !== undefined) {
        const s = index(layout.support);
        if (supportPost) {
          lo.reserved[s] = 1;
          lo.blocked[s] = 1;
        } else lo.noDoor[s] = 1;
      }
      lo.reserved[index(layout.bottom.inside)] = 1;
      lo.access.push({ cell: index(layout.bottom.inside), toward: layout.bottom.toward, linkId: link.id, end: 'bottom' });
      for (const c of [...layout.holes, ...layout.top]) {
        up.reserved[index(c)] = 1;
        up.blocked[index(c)] = 1;
        up.noSlab[index(c)] = 1;
      }
      up.reserved[index(layout.arrival.inside)] = 1;
      up.access.push({ cell: index(layout.arrival.inside), toward: layout.arrival.toward, linkId: link.id, end: 'top' });
      out.push({ link, layout, lo, up, lowerLabel, upperLabel, supportPost });
    }
    return out;
  }
}

type DormerAt = DormerFront & { readonly floorIndex: number; readonly roomId?: RoomId };

/** Fensteranker einer Gaube: Luft vor der untersten Scheibe der ersten Spalte, span = Scheibenspalten. */
function dormerAnchor(f: DormerAt): ShellAnchor {
  const [x, z] = f.panes[0]!;
  return {
    kind: 'window', pos: [x + STEP[f.dir][0], f.y0, z + STEP[f.dir][1]], facing: f.dir, span: f.panes.length, floorIndex: f.floorIndex,
    ...(f.roomId !== undefined ? { roomId: f.roomId } : {}),
  };
}

function doorWarnings(lvl: Level, plan: DoorPlan, isEntrance: boolean, rootCount: number, reach: ReadonlySet<number>, warnings: string[]): void {
  const { idOf } = lvl;
  const own = lvl.rooms.length;
  const where = isEntrance ? '' : ` (Etage ${lvl.floor.index})`;
  // Über-Eck-Kontakt nur melden, wenn er erklärt, warum ein Raum nicht verbunden ist
  const connected = plan.reachableFromMain;
  for (const [a, b] of diagonalOnlyContacts(lvl.plan)) {
    if (a > own || b > own || (connected.has(a) && connected.has(b))) continue;
    warnings.push(`Räume ${idOf(a)} und ${idOf(b)} berühren sich nur über Eck – dort ist keine Tür möglich`);
  }
  if (isEntrance) {
    if (plan.mainRoom === undefined) warnings.push('Keine Haustür möglich: kein Raum hat ein gerades Außenwandstück mit begehbarer Innenseite');
    for (const l of plan.viaSideEntrance) warnings.push(`Raum ${idOf(l)} ist nicht mit dem Haupteingang verbunden (eigener Nebeneingang)`);
    for (const l of plan.unreachable) warnings.push(`Raum ${idOf(l)} ist nicht erreichbar: keine Tür möglich`);
    return;
  }
  if (rootCount === 0) {
    warnings.push(`Etage ${lvl.floor.index}: keine Treppe führt hierher – Räume ${lvl.rooms.map((r) => r.id).join(', ')} sind nicht erreichbar`);
    return;
  }
  lvl.rooms.forEach((r, k) => {
    if (!reach.has(k + 1)) warnings.push(`Raum ${r.id}${where} ist nicht erreichbar: keine Tür oder Treppe dorthin`);
  });
}

/**
 * Stabile Zell-`id`s (research/30 K8): Zellen werden nach (x, z, y) sortiert und bekommen je Gruppe
 * (`kind|role|floor|roomId|shape`) eine laufende Nummer. Weil die Sortierung nur die **Reihenfolge** festlegt,
 * bleibt die `id` beim Verschieben des Gebäudes gleich – anders als eine Koordinate. Ändert sich die Form
 * (Zellen kommen hinzu oder fallen weg), verschieben sich die Nummern innerhalb der Gruppe; echte Identität über
 * Umbauten hinweg bräuchte eine Historie im Projekt (offen, research/30 §K8).
 */
export function assignCellIds(shell: Shell): Shell {
  const sorted = [...shell.cells].sort((a, b) => a.pos[0] - b.pos[0] || a.pos[2] - b.pos[2] || a.pos[1] - b.pos[1]);
  const next = new Map<string, number>();
  const ids = new Map<ShellCell, number>();
  for (const c of sorted) {
    const key = `${c.kind}|${c.role}|${c.roomId ?? '-'}|${c.shape}`;
    const n = next.get(key) ?? 0;
    next.set(key, n + 1);
    ids.set(c, n);
  }
  return { ...shell, cells: shell.cells.map((c) => ({ ...c, id: ids.get(c) ?? 0 })) };
}

/**
 * W16-B (Review R7-4): je Raum mit Fenster-Pflicht (`light`) ohne Fenster auf dieser Etage eine Zelle seiner geraden
 * Außenwand – nicht überdeckt (`skip`), mindestens 2 Zellen (Chebyshev) neben jeder Tür der Etage. Unter den Kandidaten
 * die mit dem größten Abstand zu Türen und Laufkanten, dann der kleinste Index (deterministisch).
 */
function rescueWindows(lvl: Level, light: readonly string[], have: readonly PlannedWindow[], skip: (cell: number) => boolean): PlannedWindow[] {
  const { plan } = lvl;
  const { frame, kind, labels } = plan;
  const lit = new Set(have.map((w) => w.room));
  const doors = lvl.doors.map((v) => [v.door.cell % frame.w, Math.floor(v.door.cell / frame.w)] as const);
  const out: PlannedWindow[] = [];
  lvl.rooms.forEach((room, i) => {
    const label = i + 1;
    if (room.floorIndex < 0 || lit.has(label) || !light.includes(room.roomTypeId)) return;
    let best: { w: PlannedWindow; score: number } | undefined;
    for (let cell = 0; cell < kind.length; cell++) {
      if (kind[cell] !== WALL || plan.cls[cell] !== WC.STRAIGHT || plan.runOf[cell]! < 0 || skip(cell)) continue;
      const x = cell % frame.w;
      const z = Math.floor(cell / frame.w);
      let inside = -1;
      for (const [a, b] of [[1, 0], [0, 1]] as const) {
        if (!inFrame(frame, x + a, z + b) || !inFrame(frame, x - a, z - b)) continue;
        const p = cell + a + b * frame.w;
        const q = cell - a - b * frame.w;
        if (kind[p] === FLOOR && labels[p] === label && labels[q] === 0) inside = p;
        else if (kind[q] === FLOOR && labels[q] === label && labels[p] === 0) inside = q;
      }
      if (inside < 0) continue;
      const doorGap = Math.min(Infinity, ...doors.map(([dx, dz]) => Math.max(Math.abs(dx - x), Math.abs(dz - z))));
      if (doorGap < 2) continue;
      const run = plan.runOf[cell]!;
      const pos = plan.posInRun[cell]!;
      const edge = Math.min(pos, plan.runs[run]!.cells.length - 1 - pos);
      const score = Math.min(doorGap, edge + 2);
      if (best === undefined || score > best.score) best = { w: { cell, inside, room: label, run }, score };
    }
    if (best !== undefined) out.push(best.w);
  });
  return out;
}

/** Hülle ableiten; mit `options.stableCellIds` tragen die Zellen zusätzlich eine stabile `id` (K8). */
export function deriveShell(state: ProjectState, options: ShellOptions): Shell {
  // W12-C: Kantenrolle je Baukörper (`Volume.exterior.trim`) nach der fertigen Hülle; ohne das Feld bitgleich
  // W16-B: danach die Dachrolle je Baukörper (`Volume.exterior.roof`, nur verbliebene `roof_main`-Zellen – die Kante hat Vorrang)
  const shell = applyVolumeRoof(applyVolumeTrim(deriveShellPlain(state, options), state), state);
  return options.stableCellIds === true ? assignCellIds(shell) : shell;
}

function cell(pos: Vec3, kind: ShellCell['kind'], role: string, shape: string, orient: ShellOrient | undefined, roomId: RoomId | undefined, exterior: boolean): ShellCell {
  return {
    pos,
    kind,
    role,
    shape,
    ...(orient !== undefined ? { orient } : {}),
    ...(roomId !== undefined ? { roomId } : {}),
    exterior,
  };
}

/** Richtung von der Seite k (0 = Nord/West, 1 = Süd/Ost) zur Wandzelle. */
/** Lexikografisch kleiner (gleich lange Zahlenlisten). */
function lexLess(a: readonly number[], b: readonly number[]): boolean {
  const k = a.findIndex((v, j) => v !== b[j]);
  return k >= 0 && a[k]! < b[k]!;
}

function towardDoor(axis: 'x' | 'z', k: 0 | 1): HorizontalDir {
  const fromNegative: HorizontalDir = axis === 'x' ? 'south' : 'east';
  return k === 0 ? fromNegative : OPP[fromNegative];
}

/**
 * Ausrichtung der Türen: `facing` = Blickrichtung beim Hinausgehen, also vom Raum, der weiter vom Ausgang
 * entfernt ist (BFS-Tiefe über alle Türen ab `roots`: außen = 0 bzw. die Treppenräume), zum näheren;
 * Außentüren zeigen nach außen. Scharnier auf der Seite des näheren Laufendes, damit die offene Tür an der
 * kurzen Wand anliegt (left = gegen den Uhrzeigersinn von `facing` aus gesehen).
 */
function orientDoors(doors: readonly PlacedDoor[], roots: readonly number[]): DoorView[] {
  const adj = new Map<number, number[]>();
  for (const d of doors) {
    (adj.get(d.a) ?? adj.set(d.a, []).get(d.a)!).push(d.b);
    (adj.get(d.b) ?? adj.set(d.b, []).get(d.b)!).push(d.a);
  }
  const depth = new Map<number, number>(roots.map((r) => [r, 0] as const));
  const queue = [...roots];
  for (let qi = 0; qi < queue.length; qi++) {
    const r = queue[qi]!;
    for (const m of (adj.get(r) ?? []).sort((x, y) => x - y)) {
      if (!depth.has(m)) {
        depth.set(m, depth.get(r)! + 1);
        queue.push(m);
      }
    }
  }
  return doors.map((door) => {
    const [lp, lq] = door.room;
    const towardP = towardDoor(door.axis, 0);
    const towardQ = OPP[towardP];
    const dp = depth.get(lp) ?? Infinity;
    const dq = depth.get(lq) ?? Infinity;
    // Hinausgehen von q nach p, wenn p näher am Ausgang liegt (bei Gleichstand zum kleineren Label)
    const facing = dp < dq || (dp === dq && lp < lq) ? towardQ : towardP;
    const L = door.runLength;
    const toStart = door.pos;
    const toEnd = L - 1 - door.pos;
    const near: HorizontalDir | undefined =
      toStart === toEnd ? undefined : door.axis === 'x' ? (toStart < toEnd ? 'west' : 'east') : toStart < toEnd ? 'north' : 'south';
    // W4-C Doppeltür wie im Spiel (Faktencheck #18, `DoorBlock#getHinge`): steht der andere Flügel links (gegen den
    // Uhrzeigersinn von `facing`), sitzt das Scharnier rechts – beide Scharniere außen, die Griffe treffen sich in der Mitte
    if (door.pair !== undefined) {
      const toPair: HorizontalDir = door.axis === 'x' ? (door.pair > door.cell ? 'east' : 'west') : door.pair > door.cell ? 'south' : 'north';
      return { door, facing, hinge: toPair === CCW[facing] ? 'right' : 'left' };
    }
    const hinge = near === undefined || near === CCW[facing] ? 'left' : 'right';
    return { door, facing, hinge };
  });
}
