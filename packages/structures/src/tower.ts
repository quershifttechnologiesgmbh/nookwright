/**
 * Türme (research/14 §4, research/18 §5): quadratisch oder rund (Kreis im Raster), mehrere Geschosse mit
 * Wendeltreppe (3×3 um eine Mittelsäule, research/03 §C8), Eingangstür mit Vortreppe, Schießscharten-Fenster.
 * Abschluss: Zinnenkranz auf Kragsteinen, Dach (roof.ts: Kegel, Zelt, Helm, Spitzhelm, welsche Haube),
 * Aussichtsstube (T5), Glockenstube (T4) oder Plattform mit Geländer.
 *
 * Aufbau (y0 = Bodenplatte):
 *   y0 ............ Bodenplatte (ganzer Grundriss) über einem Sockel bis zum Gelände
 *   y0+1 … ........ Außenwand (Rand des Grundrisses), unterste 2 Reihen Rolle foundation
 *   Geschossböden . Ring zwischen Kern und Wand (der 3×3-Kern bleibt Treppenschacht)
 *   topY .......... Plattform, Stuben- bzw. Dachgeschoss-Boden, mit Luke über der Treppe
 *   Dach .......... Traufe bei topY+4 (roof, lookout) bzw. topY+5 (belfry), Profil siehe roof.ts
 *
 * Schnitt Aussichtsstube (eckig)                Schnitt Glockenstube
 *   _ / / ^ \ \ _   Dach über Radius r+2        / # # # \    Dach
 *   . | . . . | .   Pfosten, 2 Reihen offen      # # # # #    Sturz (Wandkrone topY+4)
 *   . | f f f | .   Zaun-Brüstung (topY+1)       # a a a #    Schallöffnung (2 Reihen Luft)
 *   = = = = = = =   Boden, 1 auskragend (topY)   # f B f #    Zaun-Brüstung, Glocke auf dem Boden
 *   v # . . . # v   Kopfbänder (topY−1)          # = = = #    Boden der Stube (topY)
 */
import { hashSeed, type Cell, type HorizontalDir, type Vec3 } from '@mcda/core';
import { B, PRIO, bell, carriesBelow, log, stair, type Block, type Site } from './canvas.js';
import { N4, dirTo, footprintOffsets, inFootprint, pseudoAngle } from './geometry.js';
import { towerRoof, type RoofBlock } from './roof.js';
import { isCapped, isMerlon, solveAndLog } from './crenel.js';
import { commitStairRun, planStairRun } from './stairs.js';
import type { RoofShape, TowerFinial, TowerInfo, TowerShape, TowerSpec, TowerStyle, TowerTop, TowerTopStyle } from './types.js';

export interface ResolvedStyle {
  readonly shape: TowerShape;
  readonly r: number;
  readonly top: TowerTop;
  readonly pitch: number;
  readonly corbels: boolean;
  readonly levelHeight: number;
  readonly roofShape: RoofShape;
  readonly flare: boolean;
  readonly finial?: TowerFinial;
  /** O1: Glocke hängend (sonst Bodenbefestigung) bzw. hängende Laternen unter der Traufe; nur gesetzt, wenn gewählt. */
  readonly bell?: 'hanging';
  readonly hangingLanterns?: true;
  /** W3-CA: Licht je Geschoss; nur gesetzt, wenn gewählt. */
  readonly lit?: true;
}

/** Abschlüsse mit Dach. */
export const hasRoof = (top: TowerTop): boolean => top === 'roof' || top === 'lookout' || top === 'belfry';

/** Gestalt mit Standardwerten; zu kleine oder gerade Maße werden aufgerundet (Hinweis). */
export function resolveStyle(style: TowerStyle | undefined, warn: (m: string) => void, what: string): ResolvedStyle {
  const shape = style?.shape ?? 'round';
  // Rund braucht Ø 9, damit der Geschossring um den Treppenkern 4-zusammenhängend ist; eckig reicht 7.
  const min = shape === 'round' ? 9 : 7;
  let size = style?.size ?? min;
  if (size < min || size % 2 === 0) {
    const fixed = Math.max(min, size % 2 === 0 ? size + 1 : size);
    warn(`${what}: Turmgröße ${size} → ${fixed} (${shape === 'round' ? 'rund' : 'eckig'}: ungerade, mindestens ${min})`);
    size = fixed;
  }
  const top = style?.top ?? (shape === 'round' ? 'roof' : 'battlements');
  // Kegel gehört zum runden, Zelt und Helm zum eckigen Grundriss (sonst Lücken zwischen Wand und Dach)
  const natural: RoofShape = shape === 'round' ? 'cone' : 'tent';
  let roofShape = style?.roofShape ?? natural;
  if ((roofShape === 'cone' || roofShape === 'tent' || roofShape === 'helm') && roofShape !== natural && !(roofShape === 'helm' && shape === 'square')) {
    warn(`${what}: Dachform ${roofShape} passt nicht zu ${shape === 'round' ? 'rundem' : 'eckigem'} Turm → ${natural}`);
    roofShape = natural;
  }
  return {
    shape,
    r: (size - 1) / 2,
    top,
    pitch: style?.roofPitch ?? (roofShape === 'spire' ? 3 : roofShape === 'helm' ? 1 : 2),
    corbels: style?.corbels ?? true,
    levelHeight: Math.max(3, style?.levelHeight ?? 4),
    roofShape,
    flare: style?.flare ?? top === 'lookout',
    ...(style?.finial !== undefined ? { finial: style.finial } : {}),
    ...(style?.bell === 'hanging' ? { bell: 'hanging' as const } : {}),
    ...(style?.hangingLanterns === true ? { hangingLanterns: true as const } : {}),
    ...(style?.lit === true ? { lit: true as const } : {}),
  };
}

/**
 * W3-CA (Turmsatz): Gestalt eines Mauerturms mit Rollen-Überschreibung (`corner`, `gate`) – Form und Größe bleiben die
 * des Grundstils, nur der Abschluss wechselt. Ohne Überschreibung genau `resolveStyle(style)`.
 */
export function resolveRoleStyle(style: TowerStyle | undefined, role: TowerTopStyle | undefined, warn: (m: string) => void, what: string): ResolvedStyle {
  if (role === undefined) return resolveStyle(style, warn, what);
  const { corner: _c, gate: _g, ...base } = style ?? {};
  return resolveStyle({ ...base, ...role }, warn, what);
}

/** Bodenplatte eines Turms: eine Ebene über dem höchsten Geländepunkt des Grundrisses. */
export function towerBaseY(site: Site, center: Cell, shape: TowerShape, r: number): number {
  let g = -Infinity;
  for (const [dx, dz] of footprintOffsets(shape, r)) g = Math.max(g, site.groundY(center[0] + dx, center[1] + dz));
  return g + 1;
}

/** Geschossböden: Pflichtböden (Platte, Wehrgang, oben) plus Zwischenböden im Abstand h, mindestens 3 Luftreihen. */
export function towerFloors(y0: number, topY: number, h: number, wallLevel?: number): number[] {
  const fixed = [...new Set([y0, ...(wallLevel !== undefined && wallLevel > y0 && wallLevel < topY ? [wallLevel] : []), topY])].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < fixed.length - 1; i++) {
    const a = fixed[i]!;
    const b = fixed[i + 1]!;
    out.push(a);
    for (let f = a + h; b - f >= 4; f += h) out.push(f);
  }
  out.push(topY);
  return out;
}

export interface TowerPlan {
  /** Herkunft (roomId der Zellen). */
  readonly id: string;
  readonly center: Cell;
  readonly style: ResolvedStyle;
  readonly baseY: number;
  readonly topY: number;
  readonly wallLevel?: number;
  readonly wall?: string;
  /** Randzellen (absolut), die auf Wehrgang-Höhe geöffnet werden. */
  readonly openings: readonly Cell[];
  /** Vorzugsrichtung der Tür (Vektor). */
  readonly doorPref: readonly [number, number];
  readonly spire: boolean;
  // Additiv (C4, angedockte Türme T1/T3); fehlen alle, baut der Turm bitgleich wie zuvor.
  /** Geschossböden fest vorgegeben (sonst `towerFloors`). */
  readonly floors?: readonly number[];
  /** Durchgänge ins Haus: Randzelle (absolut) und unterste Luftreihe; 2 Reihen bleiben frei. */
  readonly passages?: readonly { readonly cell: Cell; readonly y: number }[];
  /** `false`: keine Eingangstür von außen (Zugang über das Haus). */
  readonly entrance?: false;
  /** Seite, an der das Haus anschließt: dort keine Scharten und keine Tür. */
  readonly side?: HorizontalDir;
  /** `spiral`: Scharten steigen mit der Wendel (je ¼ Drehung eine, T3) statt 2 Reihen je Geschoss an den Achsen. */
  readonly slits?: 'spiral';
  /**
   * Additiv (W4-B, „Bergfried führt“): höchste zulässige Höhe des Dachs samt Spitze (absolut). Reicht das Dach darüber,
   * entfällt zuerst die Spitze, dann wird es flacher (Neigung − 1 bis 1); fehlt = keine Grenze (bitgleich).
   */
  readonly maxTop?: number;
  /**
   * Additiv (W9-G5, `WallPlan.accents`): Materialakzente – Rolle der Dachfläche (`roof`), Kappe (Stufe) auf jeder Zinne
   * (`cap`) und Rolle von Brüstung und Zinnen des Zinnenkranzes (`crown`, Hurde). Fehlt = bitgleich.
   */
  readonly accents?: TowerAccents;
}

/** Materialakzente eines Turms (W9-G5): nur Rollen und Kappen, die Geometrie bleibt. */
export interface TowerAccents {
  readonly roof?: string;
  readonly cap?: string;
  readonly crown?: string;
}

/** Wendeltreppen-Ring um die Mittelsäule, im Uhrzeigersinn ab Norden (je Stufe 1 Block höher). */
const SPIRAL: readonly Cell[] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

export function buildTower(site: Site, plan: TowerPlan): TowerInfo {
  const { center: [cx, cz], style: { shape, r, top }, baseY: y0, topY, id: owner } = plan;
  const canvas = site.canvas;
  const inFp = (dx: number, dz: number): boolean => inFootprint(shape, r, dx, dz);
  const offs = footprintOffsets(shape, r);
  const isBoundary = (dx: number, dz: number): boolean => inFp(dx, dz) && N4.some(([ax, az]) => !inFp(dx + ax, dz + az));
  const isCore = (dx: number, dz: number): boolean => Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
  const isLanding = (dx: number, dz: number): boolean => inFp(dx, dz) && !isBoundary(dx, dz) && !isCore(dx, dz);
  const boundary = offs.filter(([dx, dz]) => isBoundary(dx, dz));
  const interior = offs.filter(([dx, dz]) => !isBoundary(dx, dz));
  const at = (dx: number, y: number, dz: number): Vec3 => [cx + dx, y, cz + dz];
  const put = (dx: number, y: number, dz: number, b: Block, prio: number = PRIO.tower): boolean => canvas.put(at(dx, y, dz), b, owner, prio);
  const floors = plan.floors !== undefined ? [...plan.floors] : towerFloors(y0, topY, plan.style.levelHeight, plan.wallLevel);
  // Dach direkt über der Außenwand (Dachgeschoss bzw. Glockenstube, 1 höher); sonst endet die Wand unter topY
  const walled = top === 'roof' || top === 'belfry';
  const wallTop = top === 'roof' ? topY + 3 : top === 'belfry' ? topY + 4 : topY - 1;

  for (const [dx, dz] of offs) site.block(cx + dx, cz + dz);
  // Sockel bis zum Gelände + Bodenplatte
  for (const [dx, dz] of offs) for (let y = site.groundY(cx + dx, cz + dz) + 1; y <= y0; y++) put(dx, y, dz, B.base);
  // Außenwand, unten Sockelrolle; W7-B: Mauertürme bis zum Wehrgang als Sockelgeschoss (`fort_base`, Steinsockel der
  // Holzburg wie 5 von 22 Holzburg-Vorbildern – W1, W4, W11, W14, W16; ohne die Rolle im Theme wie die Wand)
  const baseTop = plan.wallLevel ?? y0 + 1;
  for (const [dx, dz] of boundary) for (let y = y0 + 1; y <= wallTop; y++) put(dx, y, dz, y <= y0 + 1 ? B.base : y <= baseTop ? B.fortBase : B.wall);
  // Geschossböden: Ring um den Kern; oben ganz (Luke entsteht durch die Kopffreiheit der Treppe)
  // (Rollen: Turmböden `tower_floor`, offene Plattform unter dem Zinnenkranz `walkway`)
  for (const f of floors) {
    if (f === y0) continue;
    const platform = f === topY && (top === 'battlements' || top === 'platform');
    for (const [dx, dz] of f === topY ? (walled ? interior : offs) : interior.filter(([dx, dz]) => !isCore(dx, dz))) put(dx, f, dz, platform ? B.walkway : B.floor);
  }
  // Mittelsäule + Wendeltreppe mit Kopffreiheit
  for (let y = y0 + 1; y < topY; y++) put(0, y, 0, B.post);
  for (let y = y0 + 1; y <= topY; y++) {
    const k = y - y0 - 1;
    const [ax, az] = SPIRAL[k % 8]!;
    const [bx, bz] = SPIRAL[(k + 1) % 8]!;
    put(ax, y, az, stair('wall_primary', dirTo(bx - ax, bz - az)), PRIO.spiral);
    // Eckstufen berühren die Säule nur an der Kante: Stützblock darunter (Flächenkontakt zur Vorstufe)
    if (ax !== 0 && az !== 0 && y - 1 > y0) put(ax, y - 1, az, B.wall, PRIO.spiral);
    canvas.reserve(at(ax, y + 1, az), owner);
    canvas.reserve(at(ax, y + 2, az), owner);
  }

  // Öffnungen zum Wehrgang (auf Höhe des Wehrgang-Bodens + 1, 2 Reihen)
  const opened = new Set<string>();
  if (plan.wallLevel !== undefined) {
    const L = plan.wallLevel;
    const open = (dx: number, dz: number): void => {
      opened.add(`${dx},${dz}`);
      canvas.reserve(at(dx, L + 1, dz), owner);
      canvas.reserve(at(dx, L + 2, dz), owner);
    };
    for (const [x, z] of plan.openings) {
      const dx = x - cx;
      const dz = z - cz;
      if (!isBoundary(dx, dz)) continue;
      open(dx, dz);
      // Diagonaler Anschluss (runder Turm): Durchbruch bis zu einer Randzelle mit Geschossring dahinter
      if (!N4.some(([ax, az]) => isLanding(dx + ax, dz + az))) {
        const via = N4.map(([ax, az]) => [dx + ax, dz + az] as const).find(([bx, bz]) => isBoundary(bx, bz) && N4.some(([ax, az]) => isLanding(bx + ax, bz + az)));
        if (via !== undefined) open(via[0], via[1]);
      }
    }
  }
  // Durchgänge ins Haus (angedockter Turm): Randzelle auf Türhöhe 2 Reihen frei
  for (const { cell: [x, z], y } of plan.passages ?? []) {
    opened.add(`${x - cx},${z - cz}`);
    canvas.reserve(at(x - cx, y, z - cz), owner);
    canvas.reserve(at(x - cx, y + 1, z - cz), owner);
  }

  // Eingangstür: Randzelle mit Geschossring dahinter und freiem Vorplatz, möglichst in Vorzugsrichtung
  let door: TowerInfo['door'];
  const [px, pz] = plan.doorPref;
  const pl = Math.hypot(px, pz) || 1;
  let best: { score: number; dx: number; dz: number; d: HorizontalDir; run: NonNullable<ReturnType<typeof planStairRun>> } | undefined;
  for (const [dx, dz] of plan.entrance === false ? [] : boundary) {
    if (opened.has(`${dx},${dz}`)) continue;
    for (const [ax, az, d] of N4) {
      if (d === plan.side || inFp(dx + ax, dz + az) || !isLanding(dx - ax, dz - az)) continue;
      const ox = cx + dx + ax;
      const oz = cz + dz + az;
      if (site.isBlocked(ox, oz) || site.groundY(ox, oz) > y0) continue;
      const score = (dx * px + dz * pz) / (Math.hypot(dx, dz) * pl);
      if (best !== undefined && score <= best.score + 1e-9) continue;
      const run = planStairRun(site, [ox, oz], d, y0);
      if (run !== undefined) best = { score, dx, dz, d, run };
    }
  }
  if (best !== undefined) {
    const { dx, dz, d, run } = best;
    put(dx, y0 + 1, dz, { role: 'door', shape: 'door', orient: { facing: d, half: 'lower', hinge: 'left' } }, PRIO.door);
    put(dx, y0 + 2, dz, { role: 'door', shape: 'door', orient: { facing: d, half: 'upper', hinge: 'left' } }, PRIO.door);
    const [ax, az] = N4.find((n) => n[2] === d)!;
    for (const y of [y0 + 1, y0 + 2]) canvas.reserve(at(dx + ax, y, dz + az), owner);
    site.block(cx + dx + ax, cz + dz + az);
    commitStairRun(site, run, 'foundation', owner);
    door = { pos: at(dx, y0 + 1, dz), facing: d };
  } else if (plan.entrance !== false) {
    site.warnings.push(`${owner}: kein Eingang möglich (Umgebung belegt oder Gelände zu hoch)`);
  }

  // Schießscharten: 2 Fensterreihen je Obergeschoss an den vier Achsen, nicht zur Mauer (bzw. zum Haus) hin;
  // Treppenturm (T3): je ¼ Drehung der Wendel eine Scharte in Augenhöhe über der Stufe, Dachgeschoss wie gehabt
  for (const [ax, az, d] of N4) {
    const dx = ax * r;
    const dz = az * r;
    if (d === plan.side || site.isBlocked(cx + dx + ax, cz + dz + az) || (door !== undefined && door.pos[0] === cx + dx && door.pos[2] === cz + dz)) continue;
    for (const f of floors) {
      if (f === y0 || (top !== 'roof' && f === topY) || (plan.slits === 'spiral' && f !== topY)) continue;
      for (const y of [f + 1, f + 2]) if (canvas.at(at(dx, y, dz)) !== undefined) put(dx, y, dz, B.slit, PRIO.feature);
    }
    if (plan.slits !== 'spiral') continue;
    const onFloor = new Set(floors);
    for (let y = y0 + 1; y < topY; y++) {
      const [sx, sz] = SPIRAL[(y - y0 - 1) % 8]!;
      if (sx !== ax || sz !== az || onFloor.has(y + 2) || y + 2 >= topY) continue;
      if (canvas.at(at(dx, y + 2, dz)) !== undefined) put(dx, y + 2, dz, B.slit, PRIO.feature);
    }
  }

  let bellPos: Vec3 | undefined;
  if (top === 'battlements') battlements(plan, put, boundary, site, (dx, y, dz) => canvas.at(at(dx, y, dz)) === undefined && !canvas.isReserved(at(dx, y, dz)));
  else if (top === 'platform') platformTop(plan, put, boundary);
  else {
    if (top === 'lookout') lookout(plan, put);
    if (top === 'belfry') {
      belfry(plan, put, boundary, (dx, y, dz) => canvas.reserve(at(dx, y, dz), owner));
      const facing = door?.facing ?? 'south';
      if (plan.style.bell === 'hanging') {
        // T4: Glockenbalken quer zur Tür unter der Wandkrone (liegt an beiden Enden auf ihr), Kette, Deckenglocke
        const axis = facing === 'north' || facing === 'south' ? 'x' : 'z';
        for (let t = 1 - r; t <= r - 1; t++) put(axis === 'x' ? t : 0, topY + 4, axis === 'x' ? 0 : t, log(axis), PRIO.feature);
        put(0, topY + 3, 0, B.chain, PRIO.feature);
        bellPos = at(0, topY + 2, 0);
        put(0, topY + 2, 0, bell(facing, 'ceiling'), PRIO.feature);
      } else {
        bellPos = at(0, topY + 1, 0);
        put(0, topY + 1, 0, bell(facing), PRIO.feature);
      }
    }
    const rw = top === 'lookout' ? r + 1 : r;
    const yR = topY + (top === 'belfry' ? 5 : 4);
    roof(plan, put, rw, yR, (m) => site.warnings.push(m));
    if (plan.style.hangingLanterns === true) {
      const free = (dx: number, y: number, dz: number): boolean => canvas.at(at(dx, y, dz)) === undefined && !canvas.isReserved(at(dx, y, dz));
      if (eaveLanterns(plan, put, free, (dx, y, dz) => canvas.at(at(dx, y, dz)), rw, yR) === 0) {
        site.warnings.push(`${owner}: keine Traufecke mit tragender Unterseite und freier Luft – keine hängenden Laternen`);
      }
    }
  }

  if (plan.style.lit === true) {
    towerLights(plan, floors, door, (dx, y, dz) => canvas.at(at(dx, y, dz)), (dx, y, dz) => canvas.isReserved(at(dx, y, dz)), put, isLanding);
  }

  // Standplätze oben (Plattform, Stube bzw. Dachgeschoss)
  const topStands: Vec3[] = [];
  for (const [dx, dz] of walled ? interior : top === 'lookout' ? footprintOffsets(shape, r + 1) : offs) {
    if (canvas.at(at(dx, topY, dz)) !== undefined && canvas.at(at(dx, topY + 1, dz)) === undefined && canvas.at(at(dx, topY + 2, dz)) === undefined) {
      topStands.push(at(dx, topY + 1, dz));
    }
  }
  return {
    id: owner, center: plan.center, shape, size: 2 * r + 1, top, baseY: y0, floors, topY, topStands,
    ...(door !== undefined ? { door } : {}),
    ...(plan.wallLevel !== undefined ? { wallLevel: plan.wallLevel } : {}),
    ...(plan.wall !== undefined ? { wall: plan.wall } : {}),
    ...(bellPos !== undefined ? { bell: bellPos } : {}),
  };
}

type Put = (dx: number, y: number, dz: number, b: Block, prio?: number) => boolean;

/**
 * Zinnenkranz: Kragsteine (umgedrehte Treppen) + Brüstung 1 Block außen, oder Brüstung auf der Außenwand.
 * W9-G5 (Akzente): Brüstung und Zinnen in der Rolle `accents.crown` (Hurde), auf jeder Zinne eine Kappe `accents.cap`.
 * feat/tiled-wfc: Lage der Zinnen aus dem Tiled-WFC; dessen Deckplatten-Zinnen haben Vorrang vor der Akzent-Kappe.
 */
function battlements(plan: TowerPlan, put: Put, boundary: readonly Cell[], site: Site, free: (dx: number, y: number, dz: number) => boolean): void {
  const { style: { shape, r, corbels }, topY } = plan;
  const crown: Block = plan.accents?.crown !== undefined ? { ...B.parapet, role: plan.accents.crown } : B.parapet;
  let ring: Cell[];
  if (corbels) {
    ring = outerRing(shape, r);
    for (const [dx, dz] of ring) {
      put(dx, topY, dz, corbel(shape, r, dx, dz), PRIO.feature);
      put(dx, topY + 1, dz, crown, PRIO.feature);
    }
  } else {
    ring = [...boundary];
    for (const [dx, dz] of ring) put(dx, topY + 1, dz, crown, PRIO.feature);
  }
  // Zinnen im Wechsel entlang des Rings (Start im Osten; beim Quadrat sind so die Ecken Zinnen)
  const sorted = [...ring].sort((a, b) => pseudoAngle(a[0], a[1]) - pseudoAngle(b[0], b[1]));
  // feat/tiled-wfc: Zinnen aus dem Tiled-WFC (an beiden Achsen gespiegelt, Ecken Zinnen); unlösbar → fester Takt
  const tiles = site.tiled === undefined ? undefined : towerCrenels(sorted, plan.style.shape, site, plan.id);
  const cap = plan.accents?.cap;
  sorted.forEach(([dx, dz], i) => {
    const t = tiles?.[i];
    if (!(t === undefined ? i % 2 === 0 : isMerlon(t))) return;
    put(dx, topY + 2, dz, crown, PRIO.feature);
    if (t !== undefined && isCapped(t)) put(dx, topY + 3, dz, B.cap, PRIO.feature);
    else if (cap !== undefined && free(dx, topY + 3, dz)) put(dx, topY + 3, dz, { role: cap, shape: 'slab', orient: { half: 'bottom' } }, PRIO.feature);
  });
}

/** Zinnenfolge eines Turmrings (Reihenfolge `sorted`): Spiegel an x- und z-Achse, beim Quadrat Ecken als Zinnen. */
function towerCrenels(sorted: readonly Cell[], shape: TowerShape, site: Site, id: string) {
  const at = new Map(sorted.map(([dx, dz], i) => [`${dx},${dz}`, i] as const));
  const mirror: [number, number][] = [];
  const seen = new Set<string>();
  sorted.forEach(([dx, dz], i) => {
    for (const [mx, mz] of [[-dx, dz], [dx, -dz]] as const) {
      const j = at.get(`${mx},${mz}`);
      if (j === undefined) continue;
      const k = `${Math.min(i, j)},${Math.max(i, j)}`;
      if (!seen.has(k)) {
        seen.add(k);
        mirror.push([Math.min(i, j), Math.max(i, j)]);
      }
    }
  });
  const edge = Math.max(...sorted.map(([dx]) => Math.abs(dx)));
  const merlons = shape === 'square' ? sorted.flatMap(([dx, dz], i) => (Math.abs(dx) === edge && Math.abs(dz) === edge ? [i] : [])) : [];
  const problem = { n: sorted.length, ring: true, mirror, merlons, seed: hashSeed(site.seed, id, 'tower-crenel'), ...(site.tiled?.themeId !== undefined ? { themeId: site.tiled.themeId } : {}) };
  return solveAndLog(problem, id, 'tower', (e) => site.tiledLog.push(e));
}

/** Ring außerhalb des Grundrisses (Radius r + 1): Kragsteine, auskragender Stubenboden. */
const outerRing = (shape: TowerShape, r: number): Cell[] => footprintOffsets(shape, r + 1).filter(([dx, dz]) => !inFootprint(shape, r, dx, dz));

/** Kragstein bzw. Kopfband: umgedrehte Treppe, Rückseite zum Turm (zur Mitte hin bevorzugt); Ecken ohne Turm-Nachbarn → Vollblock. */
function corbel(shape: TowerShape, r: number, dx: number, dz: number): Block {
  let face: HorizontalDir | undefined;
  let bestDot = -Infinity;
  for (const [ax, az, d] of N4) {
    if (!inFootprint(shape, r, dx + ax, dz + az)) continue;
    const dot = -(ax * dx + az * dz);
    if (dot > bestDot) {
      bestDot = dot;
      face = d;
    }
  }
  return face !== undefined ? stair('wall_primary', face, 'top') : B.wall;
}

/** Betonte Zellen eines Rings: Achsen (optional) und je Quadrant die Zellen am nächsten zur Diagonale (eckig: Ecken). */
function accents(ring: readonly Cell[], axes: boolean): Cell[] {
  const out: Cell[] = axes ? ring.filter(([dx, dz]) => dx === 0 || dz === 0) : [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
    const q = ring.filter(([dx, dz]) => Math.sign(dx) === sx && Math.sign(dz) === sz);
    const best = Math.max(...q.map(([dx, dz]) => Math.min(Math.abs(dx), Math.abs(dz))));
    out.push(...q.filter(([dx, dz]) => Math.min(Math.abs(dx), Math.abs(dz)) === best));
  }
  return out;
}

/**
 * Je Quadrant EINE Zelle des Rings am nächsten zur Diagonale (eckig: Ecke). Ohne Diagonalzelle (runde Ringe) liegen
 * zwei gleich nahe Zellen spiegelbildlich; gewählt wird drehsymmetrisch (Windrad): in den Quadranten +/+ und −/−
 * die mit |dz| > |dx|, sonst die mit |dx| > |dz|.
 */
function diagonals(ring: readonly Cell[]): Cell[] {
  const out: Cell[] = [];
  const off = ([dx, dz]: Cell): number => Math.abs(Math.abs(dx) - Math.abs(dz));
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
    const q = ring.filter(([dx, dz]) => Math.sign(dx) === sx && Math.sign(dz) === sz);
    const best = Math.min(...q.map(off));
    const pick = q.find((c) => off(c) === best && (best === 0 || (sx * sz > 0) === (Math.abs(c[1]) > Math.abs(c[0]))));
    if (pick !== undefined) out.push(pick);
  }
  return out;
}

/** Dach über der Wand mit Radius `rw`, Traufe bei `yR` (Profil und Formen: roof.ts). */
function roof(plan: TowerPlan, put: Put, rw: number, yR: number, warn: (m: string) => void): void {
  const { style } = plan;
  const finial = style.finial ?? (plan.spire ? 'pole' : 'none');
  const role = plan.accents?.roof;
  const make = (pitch: number, f: TowerFinial) => towerRoof({
    shape: style.shape, r: rw, roofShape: style.roofShape, pitch, flare: style.flare, finial: f, ...(role !== undefined ? { role } : {}),
  });
  let blocks = make(style.pitch, finial);
  // W4-B: unter der Grenze bleiben (Bergfried führt) – erst ohne Spitze, dann flacher; die Form bleibt, nur niedriger
  const fits = (bs: readonly RoofBlock[]): boolean => plan.maxTop === undefined || Math.max(...bs.map((b) => yR + b.dy)) <= plan.maxTop;
  if (!fits(blocks)) {
    const tries: Array<[number, TowerFinial]> = [];
    for (let p = style.pitch; p >= 1; p--) tries.push(...(p === style.pitch ? [] : [[p, finial] as [number, TowerFinial]]), [p, 'none']);
    const ok = tries.map(([p, f]) => make(p, f)).find(fits);
    if (ok === undefined) warn(`${plan.id}: Dach reicht auch flach über die Grenze y=${plan.maxTop} (Bergfried-Krone)`);
    blocks = ok ?? make(1, 'none');
  }
  for (const { dx, dy, dz, block } of blocks) put(dx, yR + dy, dz, block);
}

/**
 * Hängende Laternen unter der Traufe (O1; research/18 R16 B, T1; research/16 D10): an den Ecken (eckig) bzw.
 * Diagonalen (rund) des Dachüberstands (Ring rw + 1) je eine Kette direkt unter dem Überstand und die Laterne
 * darunter. Nur wo der Überstand eine tragende Unterseite hat (Stufe, Treppe, Fiale – nicht der Fuß der welschen
 * Haube) und beide Zellen frei sind. Ergebnis: Anzahl der Laternen.
 */
function eaveLanterns(
  plan: TowerPlan, put: Put, free: (dx: number, y: number, dz: number) => boolean,
  above: (dx: number, y: number, dz: number) => Block | undefined, rw: number, yR: number,
): number {
  let n = 0;
  for (const [dx, dz] of diagonals(outerRing(plan.style.shape, rw))) {
    if (!carriesBelow(above(dx, yR, dz)) || !free(dx, yR - 1, dz) || !free(dx, yR - 2, dz)) continue;
    put(dx, yR - 1, dz, B.chain, PRIO.feature);
    put(dx, yR - 2, dz, B.hangingLantern, PRIO.feature);
    n++;
  }
  return n;
}

/**
 * W3-CA: Licht je Geschoss (`lit`). Je Geschoss mit mindestens 3 Luftreihen hängt eine Laterne unter dem Boden
 * darüber (eine Reihe über der Kopfhöhe), im Dachgeschoss an einer Kette unter dem Dach. Ort: Zelle des Geschossrings
 * (nie Wendel, nie Wand) gegenüber der Tür, frei und nicht reserviert. Offene Abschlüsse (Plattform, Zinnen,
 * Aussichtsstube) brauchen oben kein Licht. Ergebnis: Anzahl der Laternen.
 */
function towerLights(
  plan: TowerPlan, floors: readonly number[], door: TowerInfo['door'],
  blockAt: (dx: number, y: number, dz: number) => Block | undefined, reserved: (dx: number, y: number, dz: number) => boolean,
  put: Put, isLanding: (dx: number, dz: number) => boolean,
): number {
  const { style: { shape, r, top }, topY, center: [cx, cz] } = plan;
  const [px, pz] = door !== undefined ? [door.pos[0] - cx, door.pos[2] - cz] : plan.doorPref;
  const ring = footprintOffsets(shape, r).filter(([dx, dz]) => isLanding(dx, dz))
    .sort((a, b) => (a[0] * px + a[1] * pz) - (b[0] * px + b[1] * pz) || a[1] - b[1] || a[0] - b[0]);
  const free = (dx: number, y: number, dz: number): boolean => blockAt(dx, y, dz) === undefined && !reserved(dx, y, dz);
  let n = 0;
  for (let i = 0; i < floors.length; i++) {
    const f = floors[i]!;
    const last = i === floors.length - 1;
    if (last && !(f === topY && (top === 'roof' || top === 'belfry'))) continue;
    const lamp = f + 3;
    // zu niedriges Geschoss (2 Luftreihen): kein Platz über der Kopfhöhe
    if (!last && floors[i + 1]! <= lamp) continue;
    for (const [dx, dz] of ring) {
      if (blockAt(dx, f, dz) === undefined || !free(dx, f + 1, dz) || !free(dx, f + 2, dz) || !free(dx, lamp, dz)) continue;
      // Aufhängung: der Boden darüber bzw. (Dachgeschoss) der tiefste Dachblock, dazwischen Kette
      let hook = last ? lamp + 1 : floors[i + 1]!;
      if (last) while (hook <= lamp + 12 && free(dx, hook, dz)) hook++;
      if (![...Array(hook - lamp - 1).keys()].every((k) => free(dx, lamp + 1 + k, dz))) continue;
      if (!carriesBelow(blockAt(dx, hook, dz))) continue;
      for (let y = lamp + 1; y < hook; y++) put(dx, y, dz, B.chain, PRIO.feature);
      put(dx, lamp, dz, B.hangingLantern, PRIO.feature);
      n++;
      break;
    }
  }
  return n;
}

/**
 * Aussichtsstube (T5): Boden 1 auskragend auf Kopfbändern, Pfosten an Achsen und Ecken bis unter das Dach,
 * dazwischen Zaun-Brüstung; darüber 2 Reihen offen. Das Dach deckt Radius r + 2 (Traufe topY+4).
 */
function lookout(plan: TowerPlan, put: Put): void {
  const { style: { shape, r }, topY } = plan;
  const ring = outerRing(shape, r);
  const posts = new Set(accents(ring, true).map(([dx, dz]) => `${dx},${dz}`));
  for (const [dx, dz] of ring) {
    put(dx, topY - 1, dz, corbel(shape, r, dx, dz), PRIO.feature);
    put(dx, topY, dz, B.floor, PRIO.feature);
    if (posts.has(`${dx},${dz}`)) for (let y = topY + 1; y <= topY + 3; y++) put(dx, y, dz, B.post, PRIO.feature);
    else put(dx, topY + 1, dz, B.fence, PRIO.feature);
  }
}

/**
 * Glockenstube (T4): je Seite eine Schallöffnung 3 breit um die Achse – unten Zaun-Brüstung (topY+1), darüber
 * 2 Reihen Luft, Sturz = Wandkrone (topY+4). Die Glocke steht in der Mitte auf dem Stubenboden (Bodenbefestigung)
 * oder hängt (O1, `bell: 'hanging'`) an einer Kette unter dem Glockenbalken (topY+4) auf halber Öffnungshöhe (topY+2).
 */
function belfry(plan: TowerPlan, put: Put, boundary: readonly Cell[], reserve: (dx: number, y: number, dz: number) => void): void {
  const { style: { r }, topY } = plan;
  const onRim = new Set(boundary.map(([dx, dz]) => `${dx},${dz}`));
  for (const [ax, az, d] of N4) {
    if (d === plan.side) continue; // angedockt: zur Hausseite geschlossen
    for (const t of [-1, 0, 1]) {
      const dx = ax * r - az * t;
      const dz = az * r + ax * t;
      if (!onRim.has(`${dx},${dz}`)) continue;
      put(dx, topY + 1, dz, B.fence, PRIO.feature);
      reserve(dx, topY + 2, dz);
      reserve(dx, topY + 3, dz);
    }
  }
}

/** Plattform (T5): Zaun-Geländer auf dem Rand, Laternen auf den Ecken (eckig) bzw. an den Diagonalen (rund). */
function platformTop(plan: TowerPlan, put: Put, boundary: readonly Cell[]): void {
  const { topY } = plan;
  for (const [dx, dz] of boundary) put(dx, topY + 1, dz, B.fence, PRIO.feature);
  for (const [dx, dz] of accents(boundary, false)) put(dx, topY + 2, dz, B.lantern, PRIO.feature);
}

/** Freistehender Turm aus der Nutzervorgabe. */
export function towerFromSpec(site: Site, spec: TowerSpec, index: number): TowerPlan {
  const id = `${site.prefix}:${spec.id ?? `t${index}`}`;
  const style = resolveStyle(spec, (m) => site.warnings.push(m), id);
  const baseY = towerBaseY(site, spec.center, style.shape, style.r);
  const levels = Math.max(1, spec.levels ?? 3);
  const [ax, az] = N4.find((n) => n[2] === (spec.door ?? 'south'))!;
  return {
    id, center: spec.center, style, baseY,
    topY: baseY + levels * style.levelHeight,
    openings: [],
    doorPref: [ax, az],
    spire: hasRoof(style.top) && hashSeed(site.seed, id, 'spire') % 2 === 0,
  };
}

