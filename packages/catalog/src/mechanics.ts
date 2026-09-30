import { RESERVED_AIR, RESERVED_EMPTY, type ComponentDef, type Masks, type MaterialSpec } from './schema.js';
import { blockName, isBed, isFullBlock, isMobHead, isNoteBlock, isWaterSource, jobSiteOf } from './blocks.js';

/**
 * Mechanik-Prüfungen je Komponente (research/17 §7.4): Regeln, die nur an den Komponentendaten hängen und für
 * jede Form (Basis + Varianten) gelten. Ergebnis = Fehlertexte; leer = in Ordnung. Nicht Teil des
 * Ladens (`validateComponentDef`), sondern Katalog-Lint mit Test über alle Komponenten. Die Regeln zwischen
 * Komponenten (Block über fremdem Bett, Gefahr neben dem Laufweg …) prüft der Solver.
 *  - `bedObstructed`: kein erstickender Block direkt über Kopf- oder Fußteil (Faktencheck #8, Code).
 *  - `noteBlockAirAbove`: über jedem Notenblock Luft oder ein Kopf (Wiki).
 *  - `stallGeometry` (Tag `villager_stall`): Villager-Platz 2 Luft hoch mit Decke, Arbeitsblock im Nachbarfeld auf
 *    Fußhöhe (`jobSiteReachable`), über dem Arbeitsblock höchstens 1 Block frei, Seiten geschlossen.
 *  - `portalFrameValid` + `portalClearance` (Tag `nether_portal` oder Portalblöcke): Obsidian-Rahmen innen
 *    2×3 … 21×21, Öffnung ganz Luft (`_`) oder ganz Portal mit passender Achse; harte Freifläche ≥ 2 vorn.
 *  - `infiniteWater` (functionTag `water_source` mit Wasser-Quellblöcken): ein Quellblock mit ≥ 2 Quell-Nachbarn
 *    und festem Grund (2×2 oder 1×3), Rand geschlossen.
 * Gedehnte Formen (`stretch`) werden in jeder Länge 0 … max geprüft; bei `fill: ceiling` liegt die Raumdecke direkt
 * über der Form, außer bei der größten Länge (höhere Räume).
 */

type Cell = MaterialSpec | null; // null = '_' (muss Luft bleiben); fehlt = '.'

interface Shape {
  readonly where: string;
  readonly at: ReadonlyMap<string, Cell>;
  readonly size: readonly [number, number, number];
  readonly masks: Masks;
  /** Raumdecke direkt über der obersten Schicht (Dehnung bis unter die Decke, `maxRoomHeight` = Höhe). */
  readonly ceilingAbove: boolean;
}

const k = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Formen einer Komponente (Basis bzw. jede Variante, gedehnt in jeder Länge) als Zellraster in lokalen Koordinaten. */
function shapesOf(def: ComponentDef): Shape[] {
  const parts = def.variants === undefined ? [{ id: undefined, v: undefined }] : def.variants.map((v) => ({ id: v.id, v }));
  return parts.flatMap(({ id, v }) => {
    const src = v !== undefined && (v.layers !== undefined || v.cells !== undefined) ? v : def;
    const stretch = v?.stretch ?? def.stretch;
    const maxRoomHeight = v?.maxRoomHeight ?? def.maxRoomHeight;
    const masks = v?.masks ?? def.masks ?? {};
    const lengths = stretch === undefined ? [0] : Array.from({ length: stretch.max + 1 }, (_, n) => n);
    return lengths.map((n): Shape => {
      const at = new Map<string, Cell>();
      let size: [number, number, number] = [0, 0, 0];
      const put = (x: number, y: number, z: number, c: Cell | undefined): void => {
        size = [Math.max(size[0], x + 1), Math.max(size[1], y + 1), Math.max(size[2], z + 1)];
        if (c !== undefined) at.set(k(x, y, z), c);
      };
      const lift = (y: number): number => (stretch !== undefined && y > stretch.layer ? y + n : y);
      const layers = src.layers === undefined || stretch === undefined || n === 0
        ? src.layers
        : [...src.layers.slice(0, stretch.layer + 1), ...Array.from({ length: n }, () => stretch.rows ?? src.layers![stretch.layer]!), ...src.layers.slice(stretch.layer + 1)];
      layers?.forEach((layer, y) =>
        layer.forEach((row, z) => [...row].forEach((ch, x) => put(x, y, z, ch === RESERVED_EMPTY ? undefined : ch === RESERVED_AIR ? null : (src.legend?.[ch] ?? null)))),
      );
      for (const c of src.cells ?? []) {
        put(c.at[0], lift(c.at[1]), c.at[2], c.mat);
        if (stretch !== undefined && c.at[1] === stretch.layer) for (let i = 1; i <= n; i++) put(c.at[0], c.at[1] + i, c.at[2], c.mat);
      }
      for (const [x, y, z] of masks.air ?? []) if (!at.has(k(x, lift(y), z))) put(x, lift(y), z, null);
      const ceilingAbove = (stretch?.fill === 'ceiling' && n < stretch.max) || (maxRoomHeight !== undefined && maxRoomHeight <= size[1]);
      const where = `${id === undefined ? def.id : `${def.id}#${id}`}${stretch !== undefined ? `~${n}` : ''}`;
      return { where, at, size, masks, ceilingAbove };
    });
  });
}

/** Ohne Kollision (Villager steht darin, research/17 Stand: Fackel auf dem Platz). */
const passable = (c: Cell | undefined): boolean =>
  c === null || c === undefined || (c.block !== undefined && /(^|_)torch$|_pressure_plate$|_button$|^light$/.test(blockName(c.block)) && !/wall_torch$/.test(blockName(c.block)));

const HORIZONTAL: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function checkShape(def: ComponentDef, s: Shape, out: string[]): void {
  const cells = [...s.at].map(([key, mat]) => ({ pos: key.split(',').map(Number) as [number, number, number], mat }));
  const get = (x: number, y: number, z: number): Cell | undefined => s.at.get(k(x, y, z));
  for (const { pos: [x, y, z], mat } of cells) {
    if (mat === null) continue;
    const above = get(x, y + 1, z);
    if (isBed(mat) && above != null && isFullBlock(above)) out.push(`${s.where}: bedObstructed – erstickender Block über Kopf- oder Fußteil des Betts bei ${x},${y},${z}`);
    if (isNoteBlock(mat) && above != null && !isMobHead(above)) out.push(`${s.where}: noteBlockAirAbove – über dem Notenblock bei ${x},${y},${z} liegt ${above.block ?? `${above.role}.${above.shape}`}`);
  }
  if (def.tags.includes('villager_stall')) checkStall(def, s, get, cells, out);
  const portal = cells.some(({ mat }) => mat?.block !== undefined && blockName(mat.block) === 'nether_portal');
  if (def.tags.includes('nether_portal') || portal) checkPortal(s, get, out);
  if (def.functionTags?.includes('water_source') === true && cells.some(({ mat }) => mat !== null && isWaterSource(mat))) checkWater(s, get, cells, out);
}

/** `stallGeometry` + `jobSiteReachable` (research/17 §4.24, Wiki Villager/Trading). */
function checkStall(def: ComponentDef, s: Shape, get: (x: number, y: number, z: number) => Cell | undefined, cells: readonly { pos: [number, number, number]; mat: Cell }[], out: string[]): void {
  const jobs = cells.filter(({ mat }) => mat !== null && jobSiteOf(mat) !== undefined);
  if (jobs.length === 0) {
    out.push(`${s.where}: stallGeometry – kein Arbeitsblock im Stand`);
    return;
  }
  const solid = (c: Cell | undefined): boolean => !passable(c);
  /** Deckel über (x, y, z): Block der Komponente oder – oben offen – die Raumdecke direkt über der Form. */
  const lidded = (x: number, y: number, z: number): boolean => solid(get(x, y, z)) || (y >= s.size[1] && s.ceilingAbove);
  for (const { pos: [jx, jy, jz] } of jobs) {
    // über dem Arbeitsblock höchstens 1,0 frei: Luft darüber braucht den Deckel eine Zelle höher
    if (!solid(get(jx, jy + 1, jz)) && !lidded(jx, jy + 2, jz)) out.push(`${s.where}: stallGeometry – über dem Arbeitsblock bei ${jx},${jy},${jz} mehr als 1 Block frei (Villager steigt auf)`);
    // Villager-Platz: Luft im 8er-Nachbarfeld auf Fußhöhe (oder eine Ebene höher), 2 hoch, darüber Deckel
    const spots: [number, number, number][] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const dy of [0, 1]) {
      if (dx === 0 && dz === 0) continue;
      const [vx, vy, vz] = [jx + dx, jy + dy, jz + dz];
      const inside = s.at.has(k(vx, vy, vz)) || s.at.has(k(vx, vy + 1, vz));
      const ground = vy === 0 || solid(get(vx, vy - 1, vz));
      if (inside && ground && passable(get(vx, vy, vz)) && passable(get(vx, vy + 1, vz)) && lidded(vx, vy + 2, vz)) spots.push([vx, vy, vz]);
    }
    if (spots.length === 0) {
      out.push(`${s.where}: stallGeometry/jobSiteReachable – kein Villager-Platz (2 Luft mit Decke) neben dem Arbeitsblock bei ${jx},${jy},${jz}`);
      continue;
    }
    // Seiten geschlossen: Block, der Arbeitsblock (bzw. die Luft darüber unter dem Deckel) oder die Wand im Rücken
    for (const [vx, vy, vz] of spots) {
      for (const dy of [0, 1]) for (const [dx, dz] of HORIZONTAL) {
        const [nx, ny, nz] = [vx + dx, vy + dy, vz + dz];
        const c = get(nx, ny, nz);
        if (solid(c)) continue;
        if (nx === jx && nz === jz && ny === jy + 1) continue; // Luft über dem Arbeitsblock (Deckel geprüft)
        if (nz < 0 && def.rotations === 'backToWall') continue; // Raumwand im Rücken
        out.push(`${s.where}: stallGeometry – Villager-Platz ${vx},${vy},${vz} seitlich offen bei ${nx},${ny},${nz}`);
      }
    }
  }
}

/** `portalFrameValid` + `portalClearance` (Wiki Nether Portal: Rahmen 4×5 … 23×23, Ecken beliebig). */
function checkPortal(s: Shape, get: (x: number, y: number, z: number) => Cell | undefined, out: string[]): void {
  const kind = (c: Cell | undefined): 'O' | 'P' | 'A' | '-' => {
    if (c === null) return 'A';
    if (c === undefined || c.block === undefined) return '-';
    const n = blockName(c.block);
    return n === 'obsidian' ? 'O' : n === 'nether_portal' ? 'P' : '-';
  };
  const [sx, sy, sz] = s.size;
  let frames = 0;
  // Ebenen: z fest (Rahmen entlang x) und x fest (Rahmen entlang z); (u, v) = (horizontal, y)
  const planes: { axis: 'x' | 'z'; n: number; at: (u: number, v: number) => Cell | undefined; w: number }[] = [
    ...Array.from({ length: sz }, (_, z) => ({ axis: 'x' as const, n: z, at: (u: number, v: number) => get(u, v, z), w: sx })),
    ...Array.from({ length: sx }, (_, x) => ({ axis: 'z' as const, n: x, at: (u: number, v: number) => get(x, v, u), w: sz })),
  ];
  for (const pl of planes) {
    const K = (u: number, v: number) => kind(pl.at(u, v));
    const open = (u: number, v: number) => K(u, v) === 'A' || K(u, v) === 'P';
    for (let v = 1; v < sy; v++) for (let u = 1; u < pl.w; u++) {
      if (!open(u, v) || K(u - 1, v) !== 'O' || K(u, v - 1) !== 'O') continue;
      let u1 = u;
      while (open(u1 + 1, v) && K(u1 + 1, v - 1) === 'O') u1++;
      if (K(u1 + 1, v) !== 'O') continue;
      let v1 = v;
      const rowOpen = (vv: number) => { for (let uu = u; uu <= u1; uu++) if (!open(uu, vv)) return false; return K(u - 1, vv) === 'O' && K(u1 + 1, vv) === 'O'; };
      while (rowOpen(v1 + 1)) v1++;
      let top = true;
      for (let uu = u; uu <= u1; uu++) if (K(uu, v1 + 1) !== 'O') top = false;
      const w = u1 - u + 1;
      const h = v1 - v + 1;
      if (!top || w < 2 || h < 3 || w > 21 || h > 21) continue;
      const inner: Cell[] = [];
      for (let uu = u; uu <= u1; uu++) for (let vv = v; vv <= v1; vv++) inner.push(pl.at(uu, vv) ?? null);
      const lit = inner.filter((c) => c !== null).length;
      if (lit > 0 && lit < inner.length) out.push(`${s.where}: portalFrameValid – Öffnung teils Portal, teils Luft`);
      if (lit === inner.length) {
        const ax = inner[0]!.orient?.axis;
        const ok = pl.axis === 'x' ? ax === 'x' || ax === 'along' : ax === 'z' || ax === 'across';
        if (!ok) out.push(`${s.where}: portalFrameValid – Portalblöcke brauchen axis ${pl.axis === 'x' ? '"along"' : '"across"'} (Rahmen entlang ${pl.axis})`);
      }
      frames++;
    }
  }
  if (frames === 0) out.push(`${s.where}: portalFrameValid – Portalblöcke nur mit vollständigem Obsidian-Rahmen (innen 2×3 … 21×21)`);
  const clear = s.masks.clearance?.some((c) => c.hard && c.depth >= 2 && (c.side === 'front' || c.side === 'all')) === true;
  if (!clear) out.push(`${s.where}: portalClearance – harte Freifläche vorn (masks.clearance side front, depth ≥ 2, hard) fehlt`);
}

/** `infiniteWater`: Quellblock mit ≥ 2 Quell-Nachbarn auf festem Grund; Rand geschlossen (research/17 §3.2). */
function checkWater(s: Shape, get: (x: number, y: number, z: number) => Cell | undefined, cells: readonly { pos: [number, number, number]; mat: Cell }[], out: string[]): void {
  const water = (c: Cell | undefined): boolean => c != null && isWaterSource(c);
  const ground = (x: number, y: number, z: number): boolean => y === 0 || get(x, y - 1, z) != null;
  const src = cells.filter(({ mat }) => water(mat));
  const infinite = src.some(({ pos: [x, y, z] }) => ground(x, y, z) && HORIZONTAL.filter(([dx, dz]) => water(get(x + dx, y, z + dz))).length >= 2);
  if (!infinite) out.push(`${s.where}: infiniteWater – keine unendliche Quelle (2×2 oder 1×3 Wasser auf festem Grund)`);
  for (const { pos: [x, y, z] } of src) {
    if (!ground(x, y, z)) out.push(`${s.where}: infiniteWater – Wasser bei ${x},${y},${z} ohne Grund`);
    for (const [dx, dz] of HORIZONTAL) if (get(x + dx, y, z + dz) == null) out.push(`${s.where}: infiniteWater – Wasser läuft bei ${x + dx},${y},${z + dz} aus (Rand offen)`);
  }
}

/** Alle Mechanik-Befunde einer Komponente (leer = in Ordnung). */
export function checkComponentMechanics(def: ComponentDef): string[] {
  const out: string[] = [];
  for (const s of shapesOf(def)) checkShape(def, s, out);
  return out;
}
