/**
 * Angedockte Türme (C4, research/18 T1 Eckturm, T3 Treppenturm): der Turm aus tower.ts auf dem Anbau-Grundriss der
 * Hülle (`ShellAnnex`). Die Hülle bereitet das Haus vor (Türen in der Hauswand, Aussparung im Dach); hier entsteht
 * das Bauwerk:
 *  - Bodenplatte auf dem Boden der untersten Tür, Geschossböden auf jeder Türhöhe (plus Zwischenböden im Takt).
 *  - Hinter jeder Haustür ein Durchgang durch die Turmwand (2 Reihen frei) auf den Geschossring; die Wendeltreppe um
 *    die Mittelsäule erreicht den Ring auf jeder Höhe – so verbindet der Turm alle Etagen-Öffnungen.
 *  - Höhe: mindestens `levels` Geschosse und ein volles Geschoss über der obersten Tür; die Wand reicht bis zur
 *    Kontaktlinie (`contactTop`, Eckturm: das oberste Geschoss liegt ganz darüber), alles Auskragende über `clearTop`.
 *  - Zur Hausseite keine Scharten und keine Tür; Treppenturm: Scharten steigen mit der Wendel.
 *
 * Schnitt Treppenturm (eckig 7 vor der Hauswand x = 14 mit Türen auf y = 1 und 5, contactTop 13; Blick nach Norden,
 * `|` Mittelsäule, `^` Wendelstufe, `g` Scharte; Test test/annex.test.ts):
 *   .#.....#.   Wandkrone = contactTop
 *   .#.....g.   Dachgeschoss, Scharten nur weg vom Haus
 *   .#######.   Boden des Dachgeschosses (topY), Luke über der Wendel
 *   .#..|..#.
 *   .#.^|..#.
 *   ....|..#.   Durchgang OG (Tür y = 5) – Hauswand links davon
 *   ....|..g.
 *   .##.|.##.   Ringboden auf Türhöhe, Kern offen
 *   .#..|^.#.
 *   ....|..#.   Durchgang EG (Tür y = 1)
 *   .#######.   Bodenplatte = Boden der Haustür
 */
import { hashSeed, opposite, type Cell, type HorizontalDir, type Vec3 } from '@mcda/core';
import type { Site } from './canvas.js';
import { DIR_XZ, N4, footprintOffsets, inFootprint } from './geometry.js';
import { buildTower, hasRoof, resolveStyle, type ResolvedStyle } from './tower.js';
import type { AnnexKind, AnnexTowerSpec, TowerInfo, TowerStyle, TowerTop } from './types.js';

/** Gestalt mit den Vorgaben der Art: Treppenturm eckig mit Dach, Eckturm rund mit Aussichtsstube. */
function annexStyle(spec: AnnexTowerSpec): TowerStyle {
  const corner = (spec.kind ?? 'stair') === 'corner';
  const shape = spec.shape ?? (corner ? 'round' : 'square');
  return { ...spec, shape, top: spec.top ?? (corner ? 'lookout' : 'roof') };
}

/** Wandkrone über topY (Dachgeschoss 3, Glockenstube 4), sonst ist der Boden bei topY der oberste Teil der Wandsäule. */
const bodyOffset = (top: TowerTop): number => (top === 'roof' ? 3 : top === 'belfry' ? 4 : 0);

/** Tiefster auskragender Teil außerhalb des Grundrisses relativ zu topY (undefined = nichts kragt aus). */
function overhangOffset(s: ResolvedStyle): number | undefined {
  const lanterns = s.hangingLanterns === true ? 2 : 0;
  switch (s.top) {
    case 'roof': return 4 - lanterns;
    case 'belfry': return 5 - lanterns;
    case 'lookout': return -1; // Kopfbänder unter dem auskragenden Stubenboden
    case 'battlements': return s.corbels ? 0 : undefined;
    case 'platform': return undefined;
  }
}

/** Geschossböden: Platte, jede Türhöhe, oben; dazwischen im Takt h (mindestens 3 Luftreihen). */
function annexFloors(y0: number, topY: number, h: number, doorFloors: readonly number[]): number[] {
  const fixed = [...new Set([y0, ...doorFloors, topY])].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < fixed.length - 1; i++) {
    out.push(fixed[i]!);
    for (let f = fixed[i]! + h; fixed[i + 1]! - f >= 4; f += h) out.push(f);
  }
  out.push(topY);
  return out;
}

interface Resolved {
  readonly id: string;
  readonly kind: AnnexKind;
  readonly style: ResolvedStyle;
  /** Gültige Durchgänge: Randzelle hinter der Haustür, Türhöhe, Standplatz auf dem Ring dahinter. */
  readonly passages: readonly { readonly cell: Cell; readonly y: number; readonly stand: Vec3 }[];
  readonly baseY: number;
  readonly topY: number;
}

/** Durchgänge prüfen, Bodenplatte und Höhe bestimmen (ohne zu bauen); Hinweise über `warn`. */
function resolve(spec: AnnexTowerSpec, warn: (m: string) => void, id: string, ground?: (x: number, z: number) => number): Resolved {
  const kind = spec.kind ?? 'stair';
  const style = resolveStyle(annexStyle(spec), warn, id);
  const { shape, r } = style;
  const [cx, cz] = spec.center;
  const inFp = (dx: number, dz: number): boolean => inFootprint(shape, r, dx, dz);
  const isBoundary = (dx: number, dz: number): boolean => inFp(dx, dz) && N4.some(([ax, az]) => !inFp(dx + ax, dz + az));
  const isLanding = (dx: number, dz: number): boolean => inFp(dx, dz) && !isBoundary(dx, dz) && (Math.abs(dx) > 1 || Math.abs(dz) > 1);
  let passages: { cell: Cell; y: number; stand: Vec3 }[] = [];
  for (const p of spec.passages ?? []) {
    const [fx, fz] = DIR_XZ[p.facing];
    const bx = p.pos[0] + fx - cx;
    const bz = p.pos[2] + fz - cz;
    if (isBoundary(bx, bz) && isLanding(bx + fx, bz + fz)) {
      passages.push({ cell: [cx + bx, cz + bz], y: p.pos[1], stand: [cx + bx + fx, p.pos[1], cz + bz + fz] });
    } else {
      warn(`${id}: Durchgang bei ${p.pos[0]},${p.pos[2]} (y=${p.pos[1]}) trifft keinen Geschossring des Turms – bleibt zu`);
    }
  }
  const baseY = spec.baseY ?? (passages.length > 0 ? Math.min(...passages.map((p) => p.y - 1))
    : ground !== undefined ? (() => {
      let g = -Infinity;
      for (const [dx, dz] of footprintOffsets(shape, r)) g = Math.max(g, ground(cx + dx, cz + dz));
      return g + 1;
    })() : 0);
  const below = passages.filter((p) => p.y - 1 < baseY);
  if (below.length > 0) warn(`${id}: ${below.length} Durchgang/Durchgänge unter der Bodenplatte – bleiben zu`);
  passages = passages.filter((p) => p.y - 1 >= baseY);

  const h = style.levelHeight;
  let topY: number;
  if (spec.wallTop !== undefined) {
    topY = spec.wallTop - bodyOffset(style.top);
  } else {
    topY = baseY + Math.max(1, spec.levels ?? 1) * h;
    if (passages.length > 0) topY = Math.max(topY, Math.max(...passages.map((p) => p.y - 1)) + h);
    if (spec.contactTop !== undefined && Number.isFinite(spec.contactTop)) {
      topY = Math.max(topY, kind === 'corner' ? spec.contactTop + 1 : spec.contactTop - bodyOffset(style.top));
    }
    const over = overhangOffset(style);
    if (spec.clearTop !== undefined && Number.isFinite(spec.clearTop) && over !== undefined) topY = Math.max(topY, spec.clearTop + 1 - over);
  }
  const high = passages.filter((p) => p.y - 1 > topY - 3);
  if (high.length > 0) warn(`${id}: ${high.length} Durchgang/Durchgänge über dem obersten Geschoss – bleiben zu`);
  passages = passages.filter((p) => p.y - 1 <= topY - 3);
  return { id, kind, style, passages, baseY, topY };
}

/** Grundriss eines angedockten Turms (absolute Zellen, sortiert z, x) – der `ShellAnnex.footprint` der Hülle. */
export function annexFootprint(spec: Pick<AnnexTowerSpec, 'center' | 'kind' | 'shape' | 'size'>): Cell[] {
  const style = resolveStyle(annexStyle({ ...spec, side: 'north' }), () => undefined, 'annex');
  return footprintOffsets(style.shape, style.r).map(([dx, dz]): Cell => [spec.center[0] + dx, spec.center[1] + dz]);
}

/**
 * Oberste Wandreihe eines angedockten Turms (`ShellAnnex.top`): Wandkrone (Dach, Glockenstube) bzw. Boden des
 * obersten Geschosses (Stube, Zinnen, Plattform) – aus Geschossen, Türen, `contactTop` und `clearTop`.
 */
export function annexWallTop(spec: AnnexTowerSpec): number {
  const r = resolve(spec, () => undefined, 'annex');
  return r.topY + bodyOffset(r.style.top);
}

/**
 * Hauswandzellen, von denen aus ein Durchgang in den Turm möglich ist (Tür dort, Blick in den Turm): gerade gegenüber
 * einer Randzelle auf der Hausseite mit Geschossring dahinter. Für die UI (Öffnungen je Etage) und Tests.
 */
export function annexContacts(spec: Pick<AnnexTowerSpec, 'center' | 'kind' | 'shape' | 'size' | 'side'>): { readonly at: Cell; readonly facing: HorizontalDir }[] {
  const style = resolveStyle(annexStyle(spec), () => undefined, 'annex');
  const { shape, r } = style;
  const [sx, sz] = DIR_XZ[spec.side];
  const inFp = (dx: number, dz: number): boolean => inFootprint(shape, r, dx, dz);
  const inner = (dx: number, dz: number): boolean => inFp(dx, dz) && N4.every(([ax, az]) => inFp(dx + ax, dz + az)) && (Math.abs(dx) > 1 || Math.abs(dz) > 1);
  const out: { at: Cell; facing: HorizontalDir }[] = [];
  for (const [dx, dz] of footprintOffsets(shape, r)) {
    if (inFp(dx + sx, dz + sz) || !inner(dx - sx, dz - sz)) continue;
    out.push({ at: [spec.center[0] + dx + sx, spec.center[1] + dz + sz], facing: opposite(spec.side) as HorizontalDir });
  }
  return out;
}

export function buildAnnexTower(site: Site, spec: AnnexTowerSpec, index: number): TowerInfo {
  const id = `${site.prefix}:${spec.id ?? `a${index}`}`;
  const res = resolve(spec, (m) => site.warnings.push(m), id, (x, z) => site.groundY(x, z));
  const { style, passages, baseY, topY } = res;
  const [ax, az] = DIR_XZ[opposite(spec.side) as HorizontalDir];
  const info = buildTower(site, {
    id, center: spec.center, style, baseY, topY, openings: [], doorPref: [ax, az],
    spire: hasRoof(style.top) && hashSeed(site.seed, id, 'spire') % 2 === 0,
    floors: annexFloors(baseY, topY, style.levelHeight, passages.map((p) => p.y - 1)),
    passages: passages.map(({ cell, y }) => ({ cell, y })),
    side: spec.side,
    ...(spec.entrance === true ? {} : { entrance: false as const }),
    ...(res.kind === 'stair' ? { slits: 'spiral' as const } : {}),
  });
  return { ...info, annex: { kind: res.kind, side: spec.side, passages: passages.map((p) => p.stand) } };
}
