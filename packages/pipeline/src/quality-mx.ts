/**
 * MX-Q (DR0 Nr. 9–11): weiche Messwerte und Lints der fertigen Welt. Reines Messen, ändert nichts am Bau.
 *
 * - `detailDensity` (DR5 K1, research/37 §2): Anteil der sichtbaren Wandfläche (Frontraster aller vier Seiten, nur
 *   Wandzellen, keine Öffnungen), vor der kein Detailblock sitzt (Außenprofil `facade`, Außen-Komponenten `x…`).
 *   Richtwert der Community: mindestens ein Drittel der Wand bleibt sichtbar. Dazu Detailfarbe gegen Rahmenfarbe
 *   (Pfosten, Balken, Eckquader): Anteil der Detailblöcke, deren Farbe (OKLab, `blockLook`) der Rahmenfarbe gleicht.
 * - `supportReport` (DR1 Nr. 1): Bodenverbindung (Flächen- und Kantenkontakt vom Gelände aus) und Auflager je Schicht von unten:
 *   ein Block ruht auf einem getragenen Block, liegt zwischen zwei Auflagern (Decke, Sturz, Dachreihe) oder kragt
 *   aus (Länge = Schritte bis zum nächsten Auflager). Was nur von oben gehalten wird, hängt (Konsole, Laterne).
 *   Überstände über `maxCantilever` und Blöcke ohne jedes Auflager werden gemeldet; Dachüberstände zählen getrennt.
 *   Die Spiel-Physik (Laternen, Fackeln …) prüft schon `@mcda/materialize` (physics.ts), Bauwerke `floatingCells`
 *   (@mcda/structures); dieser Prüfer schließt nur die Lücke „ganzes Haus inkl. Außen-Komponenten“.
 */
import type { Shell, ShellCell } from '@mcda/blueprint';
import type { HorizontalDir, Vec3 } from '@mcda/core';
import { facadeMeasureLints, frontRaster, planFacadeMeasures, type BuildingPlan, type FacadeMeasures } from '@mcda/archetype';
import { Layer, type VoxelVolume } from '@mcda/voxel';
import { blockLook } from './blockColors.js';
import { oklab } from './colorMetrics.js';

/** Welt, wie sie `generate`/`generateBase` liefern (nur die gelesenen Teile). */
export interface MeasuredWorld {
  readonly shell: Pick<Shell, 'cells' | 'rooms'>;
  readonly materialized: { readonly volume: VoxelVolume };
  readonly surroundings?: { readonly cells: readonly ShellCell[]; readonly ground?: { groundY(x: number, z: number): number } };
}

const SIDES: readonly [HorizontalDir, Vec3][] = [['north', [0, 0, -1]], ['east', [1, 0, 0]], ['south', [0, 0, 1]], ['west', [-1, 0, 0]]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const k3 = (p: Vec3): string => `${p[0]},${p[1]},${p[2]}`;
const nameOf = (s: { readonly name: string }): string => s.name.replace(/^minecraft:/, '');
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Richtwert (DR5 K1, Forumsregel): mindestens so viel Wandfläche bleibt ohne Detailblock. */
export const DETAIL_FREE_MIN = 1 / 3;
/** OKLab-Abstand, unter dem ein Detailblock als „gleiche Farbe wie der Rahmen“ gilt. */
export const DETAIL_FRAME_DELTA = 0.04;
/** Lint „Detailfarbe = Rahmenfarbe“ ab diesem Anteil gleichfarbiger Detailblöcke. */
export const DETAIL_FRAME_SHARE_MAX = 0.5;
/** Farb-Lint erst ab so vielen Schmuck-Detailblöcken (wenige Blöcke sind kein Muster). */
export const DETAIL_FRAME_MIN_BLOCKS = 8;

export interface DetailDensity {
  /** Sichtbare Wandzellen (ohne Fenster und Türen), alle vier Seiten. */
  readonly wallCells: number;
  /** Anteil davon ohne Detailblock davor (0–1). */
  readonly freeShare: number;
  /** Je Seite (Nord, Ost, Süd, West) der freie Anteil; -1 = keine Wand. */
  readonly freeBySide: readonly [number, number, number, number];
  readonly detailBlocks: number;
  /** Häufigster Rahmenblock (Pfosten, Balken, Eckquader) oder `null`. */
  readonly frameBlock: string | null;
  /** Anteil der Schmuck-Detailblöcke (ohne Balken/Eckquader) mit Rahmenfarbe (OKLab-Abstand < {@link DETAIL_FRAME_DELTA}). */
  readonly sameAsFrameShare: number;
  /** Die häufigsten Schmuck-Detailblöcke (höchstens 3). */
  readonly topDetails: readonly string[];
  /** Weiche Befunde (Text), leer = Richtwerte eingehalten. */
  readonly lints: readonly string[];
}

const FRAME_ROLES: ReadonlySet<string> = new Set(['beam', 'wall_quoin', 'window_frame']);
const isFrame = (c: ShellCell): boolean => c.kind === 'pillar' || FRAME_ROLES.has(c.role);

function cellIndex(world: MeasuredWorld): Map<string, ShellCell> {
  const m = new Map<string, ShellCell>();
  for (const c of world.surroundings?.cells ?? []) m.set(k3(c.pos), c);
  for (const c of world.shell.cells) m.set(k3(c.pos), c);
  return m;
}

function lowestFloorY(shell: Pick<Shell, 'rooms'>): number {
  const ys = [...shell.rooms.values()].filter((r) => r.floorIndex >= 0).map((r) => r.baseY);
  return ys.length > 0 ? Math.min(...ys) : 0;
}

const deltaE = (a: string, b: string): number => {
  const p = oklab(blockLook(a).color), q = oklab(blockLook(b).color);
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
};

/** Detail-Obergrenze (DR5 K1) der fertigen Welt. */
export function detailDensity(world: MeasuredWorld): DetailDensity {
  const v = world.materialized.volume;
  const cells = cellIndex(world);
  const y0 = lowestFloorY(world.shell);
  let wall = 0, free = 0;
  const bySide: number[] = [];
  const frames = new Map<string, number>();
  const details: { readonly block: string; readonly frame: boolean }[] = [];
  const seenDetail = new Set<string>();
  for (const [side, n] of SIDES) {
    let w = 0, f = 0;
    for (const r of frontRaster(world.shell.cells, side, y0).values()) {
      if (r.cls !== 'wall') continue;
      if (isFrame(r.cell) && v.contains(r.cell.pos)) {
        const b = nameOf(v.stateAt(r.cell.pos));
        frames.set(b, (frames.get(b) ?? 0) + 1);
      }
      const q = add(r.cell.pos, n);
      const at = cells.get(k3(q));
      const vc = v.contains(q) ? v.cell(q) : undefined;
      const detail = vc !== undefined && vc.state.name !== 'air' && vc.layer !== Layer.Terrain
        && (at?.kind === 'facade' || (at === undefined && vc.owner.startsWith('x')));
      w++;
      if (!detail) f++;
      else if (!seenDetail.has(k3(q))) {
        seenDetail.add(k3(q));
        // Balken und Eckquader des Außenprofils sind selbst Rahmen: sie verdecken Wand, zählen aber nicht zur Detailfarbe
        details.push({ block: nameOf(vc!.state), frame: at !== undefined && FRAME_ROLES.has(at.role) });
      }
    }
    wall += w;
    free += f;
    bySide.push(w === 0 ? -1 : r3(f / w));
  }
  const byCount = (m: Map<string, number>): string[] => [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([b]) => b);
  const frameBlock = byCount(frames)[0] ?? null;
  const decor = details.filter((d) => !d.frame).map((d) => d.block);
  const same = frameBlock === null ? 0 : decor.filter((d) => deltaE(d, frameBlock) < DETAIL_FRAME_DELTA).length;
  const freeShare = wall === 0 ? 1 : r3(free / wall);
  const sameAsFrameShare = decor.length === 0 ? 0 : r3(same / decor.length);
  const counts = new Map<string, number>();
  for (const d of decor) counts.set(d, (counts.get(d) ?? 0) + 1);
  const lints: string[] = [];
  if (wall > 0 && freeShare < DETAIL_FREE_MIN) lints.push(`Detail-Obergrenze: nur ${Math.round(freeShare * 100)} % der Wandfläche ohne Detailblock (Richtwert ≥ 33 %)`);
  if (decor.length >= DETAIL_FRAME_MIN_BLOCKS && sameAsFrameShare > DETAIL_FRAME_SHARE_MAX) {
    lints.push(`Detailfarbe gleicht der Rahmenfarbe (${frameBlock}): ${Math.round(sameAsFrameShare * 100)} % der Detailblöcke`);
  }
  return {
    wallCells: wall, freeShare, freeBySide: bySide as unknown as [number, number, number, number], detailBlocks: details.length,
    frameBlock, sameAsFrameShare, topDetails: byCount(counts).slice(0, 3), lints,
  };
}

/** Standard: Auskragung bis 2 Blöcke ohne Befund (Dachüberstand, Auskragung, Balkon 2 tief). */
export const MAX_CANTILEVER = 2;
/** Größte Lücke in einer Spannweite (Deckenöffnung, Loch), über die hinweg zwei Auflager noch tragen. */
const SPAN_GAP = 2;

/** Angehängte, nicht tragende Blöcke (Physik prüft sie einzeln in @mcda/materialize). */
const ATTACHED = /lantern|chain|torch|trapdoor|button|lever|sign|banner|ladder|vine|flower_pot|potted_|candle|bell|_head|skull|carpet|pressure_plate|lightning_rod|end_rod|lichen|cobweb|hanging_roots|item_frame|tripwire/;

export interface SupportPart {
  /** Zahl der Blöcke. */
  readonly size: number;
  /** Erster Block (kleinste Lage) als Ort. */
  readonly at: Vec3;
  /** Herkunft: Hüllenart/Rolle bzw. Außen-Komponente. */
  readonly source: string;
}

export interface SupportOverhang extends SupportPart {
  /** Größte Auskraglänge (Schritte bis zum Auflager). */
  readonly length: number;
  /** Dachfläche (Traufe, Ortgang). */
  readonly roof: boolean;
  /** Darunter sitzt mindestens ein Block (Konsole, Knagge). */
  readonly bracketed: boolean;
}

export interface SupportReport {
  /** Geprüfte tragende Blöcke (Haus, Außen-Komponenten, Bauwerke; ohne Möbel, Gelände, Pflanzen, Anhängsel). */
  readonly blocks: number;
  /** Blöcke ohne Kontakt-Kette (Fläche oder Kante) zum Gelände (schweben). */
  readonly floating: number;
  readonly floatingParts: readonly SupportPart[];
  /** Blöcke, die nur von oben gehalten werden (Konsolen, Zapfen). */
  readonly hanging: number;
  /** Blöcke ohne Auflager von unten, zwischen Auflagern oder von oben (aber mit Kontakt zum Rest). */
  readonly unsupported: number;
  /** Auskragende Teile (Länge ≥ 1), Dach und Nicht-Dach. */
  readonly overhangs: readonly SupportOverhang[];
  /** Größte Auskraglänge außerhalb des Dachs. */
  readonly maxCantilever: number;
  readonly lints: readonly string[];
}

/** Bodenverbindung und Auflager (DR1 Nr. 1). `maxCantilever`: erlaubte Auskraglänge ohne Befund. */
export function supportReport(world: MeasuredWorld, maxCantilever = MAX_CANTILEVER): SupportReport {
  const v = world.materialized.volume;
  const cells = cellIndex(world);
  const ground = world.surroundings?.ground;
  const [X0, Y0, Z0] = v.origin;
  const [W, H, D] = v.size;
  const idx = (x: number, y: number, z: number): number => (x - X0) + (z - Z0) * W + (y - Y0) * W * D;
  const inside = (x: number, y: number, z: number): boolean => x >= X0 && y >= Y0 && z >= Z0 && x < X0 + W && y < Y0 + H && z < Z0 + D;
  const N = W * H * D;
  const solid = new Uint8Array(N); // 1 = geprüfter Block
  const terrain = new Uint8Array(N);
  const source: string[] = new Array<string>(N);
  let minY = Infinity;
  for (let y = Y0; y < Y0 + H; y++) for (let z = Z0; z < Z0 + D; z++) for (let x = X0; x < X0 + W; x++) {
    const c = v.cell([x, y, z]);
    if (c === undefined || c.state.name === 'air' || c.state.name === 'minecraft:air') continue;
    const i = idx(x, y, z);
    const sc = cells.get(`${x},${y},${z}`);
    if (c.layer === Layer.Terrain || sc?.kind === 'terrain') { terrain[i] = 1; continue; }
    if (sc?.kind === 'plant') continue;
    if (!(c.owner.startsWith('shell:') || c.owner.startsWith('x'))) continue;
    if (ATTACHED.test(nameOf(c.state))) continue;
    solid[i] = 1;
    source[i] = c.owner.startsWith('x') ? c.owner.split('@')[0]!.split(':').slice(1).join(':') : sc !== undefined ? `${sc.kind}/${sc.role}` : 'shell';
    minY = Math.min(minY, y);
  }
  const isSolid = (x: number, y: number, z: number): boolean => inside(x, y, z) && solid[idx(x, y, z)] === 1;
  const onGround = (x: number, y: number, z: number): boolean =>
    (ground !== undefined && y <= ground.groundY(x, z) + 1) || (inside(x, y - 1, z) && terrain[idx(x, y - 1, z)] === 1) || (ground === undefined && y === minY);
  const N4: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // 1) Bodenverbindung ab Blöcken auf dem Gelände
  const linked = new Uint8Array(N);
  const stack: number[] = [];
  const pos = (i: number): Vec3 => {
    const y = Math.floor(i / (W * D)), r = i - y * W * D, z = Math.floor(r / W);
    return [r - z * W + X0, y + Y0, z + Z0];
  };
  let blocks = 0;
  for (let i = 0; i < N; i++) {
    if (solid[i] !== 1) continue;
    blocks++;
    const [x, y, z] = pos(i);
    if (onGround(x, y, z) || N4.some(([dx, dz]) => inside(x + dx, y, z + dz) && terrain[idx(x + dx, y, z + dz)] === 1)) { linked[i] = 1; stack.push(i); }
  }
  // Flächen- und Kantenkontakt (18er): Dachtreppen stufen über die Kante, der Stufenblock schließt optisch an
  const N18: Vec3[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    if (m === 1 || m === 2) N18.push([dx, dy, dz]);
  }
  while (stack.length > 0) {
    const [x, y, z] = pos(stack.pop()!);
    for (const [dx, dy, dz] of N18) {
      if (!isSolid(x + dx, y + dy, z + dz)) continue;
      const j = idx(x + dx, y + dy, z + dz);
      if (linked[j] === 0) { linked[j] = 1; stack.push(j); }
    }
  }
  // 2) Auflager je Schicht von unten: 1 = getragen, 2 = hängt, 3 = ohne Auflager
  const state = new Uint8Array(N);
  const reach = new Float64Array(N).fill(Infinity);
  for (let y = Y0; y < Y0 + H; y++) {
    const rest: number[] = [];
    for (let z = Z0; z < Z0 + D; z++) for (let x = X0; x < X0 + W; x++) {
      const i = idx(x, y, z);
      if (solid[i] !== 1) continue;
      if (onGround(x, y, z) || (inside(x, y - 1, z) && state[idx(x, y - 1, z)] === 1)) { state[i] = 1; reach[i] = 0; } else rest.push(i);
    }
    const open = new Set(rest);
    const carried = (x: number, z: number): boolean => inside(x, y, z) && state[idx(x, y, z)] === 1 && reach[idx(x, y, z)] === 0;
    // zwischen zwei Auflagern (in x oder z) = Spannweite, getragen
    const spanned: number[] = [];
    for (const i of rest) {
      const [x, , z] = pos(i);
      // Lücken bis SPAN_GAP (Deckenöffnung, Ruinen-Loch) unterbrechen die Spannweite nicht
      const ends = (dx: number, dz: number): boolean => {
        for (let s = 1, gap = 0; gap <= SPAN_GAP; s++) {
          const px = x + dx * s, pz = z + dz * s;
          if (!inside(px, y, pz)) return false;
          if (carried(px, pz)) return gap === 0;
          if (open.has(idx(px, y, pz))) gap = 0;
          else gap++;
        }
        return false;
      };
      if ((ends(1, 0) && ends(-1, 0)) || (ends(0, 1) && ends(0, -1))) spanned.push(i);
    }
    for (const i of spanned) { state[i] = 1; reach[i] = 0; open.delete(i); }
    // Auskragung: Schritte in der Schicht bis zum nächsten Auflager; ein Block schräg über einem getragenen (Dachstufe,
    // Vorkragung um eine Lage) kragt 1 aus
    const below = (x: number, z: number): boolean => inside(x, y - 1, z) && state[idx(x, y - 1, z)] === 1;
    let front = [...open].filter((i) => { const [x, , z] = pos(i); return N4.some(([dx, dz]) => carried(x + dx, z + dz) || below(x + dx, z + dz)); });
    for (let d = 1; front.length > 0; d++) {
      for (const i of front) { state[i] = 1; reach[i] = d; open.delete(i); }
      const next = new Set<number>();
      for (const i of front) {
        const [x, , z] = pos(i);
        for (const [dx, dz] of N4) if (inside(x + dx, y, z + dz) && open.has(idx(x + dx, y, z + dz))) next.add(idx(x + dx, y, z + dz));
      }
      front = [...next];
    }
    for (const i of open) state[i] = 3;
  }
  // 3) Von oben gehalten (hängend), von oben nach unten
  for (let y = Y0 + H - 1; y >= Y0; y--) for (let z = Z0; z < Z0 + D; z++) for (let x = X0; x < X0 + W; x++) {
    const i = idx(x, y, z);
    if (state[i] === 3 && inside(x, y + 1, z) && (state[idx(x, y + 1, z)] === 1 || state[idx(x, y + 1, z)] === 2)) state[i] = 2;
  }
  const parts = (pick: (i: number) => boolean): number[][] => {
    const seen = new Uint8Array(N);
    const out: number[][] = [];
    for (let i = 0; i < N; i++) {
      if (seen[i] === 1 || !pick(i)) continue;
      const comp: number[] = [];
      const st = [i];
      seen[i] = 1;
      while (st.length > 0) {
        const j = st.pop()!;
        comp.push(j);
        const [x, y, z] = pos(j);
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
          if (!inside(x + dx, y + dy, z + dz)) continue;
          const n = idx(x + dx, y + dy, z + dz);
          if (seen[n] === 0 && pick(n)) { seen[n] = 1; st.push(n); }
        }
      }
      out.push(comp);
    }
    return out;
  };
  const label = (comp: number[]): string => {
    const count = new Map<string, number>();
    for (const i of comp) count.set(source[i] ?? '?', (count.get(source[i] ?? '?') ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
  };
  const part = (comp: number[]): SupportPart => ({ size: comp.length, at: pos(comp[0]!), source: label(comp) });
  const floatingParts = parts((i) => solid[i] === 1 && linked[i] === 0).map(part);
  const isRoof = (i: number): boolean => /^roof\//.test(source[i] ?? '') || /roof|ridge|eave/.test(source[i] ?? '');
  const overhangs = parts((i) => solid[i] === 1 && state[i] === 1 && reach[i]! >= 1 && reach[i] !== Infinity).map((comp): SupportOverhang => {
    const length = Math.max(...comp.map((i) => reach[i]!));
    const own = new Set(comp);
    const bracketed = comp.some((i) => { const [x, y, z] = pos(i); return isSolid(x, y - 1, z) && !own.has(idx(x, y - 1, z)); });
    return { ...part(comp), length, roof: comp.every(isRoof), bracketed };
  });
  let hanging = 0, unsupported = 0;
  for (let i = 0; i < N; i++) {
    if (solid[i] !== 1 || linked[i] === 0) continue;
    if (state[i] === 2) hanging++;
    else if (state[i] === 3) unsupported++;
  }
  const walls = overhangs.filter((o) => !o.roof);
  const maxCant = walls.reduce((m, o) => Math.max(m, o.length), 0);
  const lints: string[] = [];
  const floating = floatingParts.reduce((s, p) => s + p.size, 0);
  if (floating > 0) lints.push(`Schwebend: ${floating} Block/Blöcke ohne Verbindung zum Boden (${floatingParts.slice(0, 3).map((p) => `${p.source} bei ${p.at.join(',')}`).join('; ')})`);
  for (const o of overhangs.filter((x) => x.length > maxCantilever)) {
    lints.push(`Überstand ${o.length} Blöcke ohne Stütze: ${o.source} bei ${o.at.join(',')} (${o.size} Blöcke${o.bracketed ? ', mit Konsole' : ''})`);
  }
  if (unsupported > 0) lints.push(`Ohne Auflager: ${unsupported} Block/Blöcke nur seitlich gehalten`);
  return { blocks, floating, floatingParts, hanging, unsupported, overhangs, maxCantilever: maxCant, lints };
}

export interface QualityMeasures {
  readonly facade: FacadeMeasures;
  readonly detail: DetailDensity;
  readonly support: SupportReport;
  /** Alle weichen Befunde (Fassadenband, Detail, Auflager) zusammen. */
  readonly lints: readonly string[];
}

/** MX-Q: alle drei Messungen einer fertigen Welt samt Plan (Grundriss, Front). Rein, ändert nichts. */
export function qualityMeasures(world: MeasuredWorld, plan: Pick<BuildingPlan, 'rooms' | 'params'>): QualityMeasures {
  const facade = planFacadeMeasures(plan, world.shell);
  const detail = detailDensity(world);
  const support = supportReport(world);
  return { facade, detail, support, lints: [...facadeMeasureLints(facade), ...detail.lints, ...support.lints] };
}
