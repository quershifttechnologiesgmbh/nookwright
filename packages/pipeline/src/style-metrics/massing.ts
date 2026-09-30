/**
 * Baukörper-Kennzahlen: Grundriss-Kontur (LV-5), Dach (LV-9, 10a, 12b, 13, 14) und die Zusammenfassung je Bau
 * für die Ensemble-Kennzahlen (Silhouettenvarianz im Dorf).
 */
import type { HorizontalDir } from '@mcda/core';
import { isMaterial, materialFamily, woodOf } from './blocks.js';
import { lightOf } from './facade.js';
import type { Building, Scene } from './scene.js';
import type { Measure, Measures } from './types.js';

export type RoofForm = 'flat' | 'shed' | 'gable' | 'hip' | 'mixed' | 'none';

/** Zusammenfassung eines Baukörpers für Ensemble-Kennzahlen. */
export interface BuildingSummary {
  readonly form: RoofForm;
  /** Traufhöhe (unterste Dachreihe des Hauptdachs über dem Boden der untersten Etage), Blöcke. */
  readonly eaveHeight: number | null;
  /** Höhe des höchsten Dachkörpers über dem Boden. */
  readonly topHeight: number | null;
  readonly footprintW: number;
  readonly footprintL: number;
}

const measure = (value: number | null, weight: number, details?: Record<string, number | string | boolean | null>): Measure =>
  details === undefined ? { value, weight } : { value, weight, details };

const colKey = (x: number, z: number): string => `${x},${z}`;

/** Spalten des Erdgeschoss-Grundrisses: Bodenplatte unter der untersten Etage, sonst Wandspalten. */
export function footprintOf(b: Building): Set<string> {
  const cols = new Set<string>();
  for (const c of b.cells) if (c.kind === 'floor' && c.pos[1] === b.groundY - 1) cols.add(colKey(c.pos[0], c.pos[2]));
  if (cols.size === 0) for (const c of b.cells) if (c.pos[1] === b.groundY && c.kind !== 'roof') cols.add(colKey(c.pos[0], c.pos[2]));
  return cols;
}

const parse = (k: string): [number, number] => { const i = k.indexOf(','); return [Number(k.slice(0, i)), Number(k.slice(i + 1))]; };

/** Konturkomplexität: Anzahl Ecken und Anteil der Kantenlänge, die >= 2 Blöcke hinter der Umriss-Box liegt. */
export function contourOf(cols: ReadonlySet<string>): { corners: number; offsetShare: number; w: number; l: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const k of cols) { const [x, z] = parse(k); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const has = (x: number, z: number): boolean => cols.has(colKey(x, z));
  let corners = 0;
  for (let x = minX; x <= maxX + 1; x++) {
    for (let z = minZ; z <= maxZ + 1; z++) {
      const a = has(x - 1, z - 1), b = has(x, z - 1), c = has(x - 1, z), d = has(x, z);
      const n = Number(a) + Number(b) + Number(c) + Number(d);
      if (n === 1 || n === 3) corners++;
      else if (n === 2 && a === d) corners += 2; // diagonale Berührung
    }
  }
  let edges = 0, off = 0;
  for (const k of cols) {
    const [x, z] = parse(k);
    if (!has(x, z - 1)) { edges++; if (z - minZ >= 2) off++; }
    if (!has(x, z + 1)) { edges++; if (maxZ - z >= 2) off++; }
    if (!has(x - 1, z)) { edges++; if (x - minX >= 2) off++; }
    if (!has(x + 1, z)) { edges++; if (maxX - x >= 2) off++; }
  }
  return { corners, offsetShare: edges === 0 ? 0 : off / edges, w: maxX - minX + 1, l: maxZ - minZ + 1 };
}

interface RoofCol { readonly y: number; readonly facing: HorizontalDir | null }

/** Oberste Dachzelle je Spalte samt Neigungsrichtung (Treppenblick, sonst null). */
function roofColumns(scene: Scene, b: Building): Map<string, RoofCol> {
  const cols = new Map<string, RoofCol>();
  for (const c of b.roofCells) {
    const [x, y, z] = c.pos;
    if (!scene.vox.solid(x, y, z)) continue;
    const k = colKey(x, z);
    const prev = cols.get(k);
    if (prev === undefined || y > prev.y) cols.set(k, { y, facing: c.shape === 'stairs' ? (c.orient?.facing ?? null) : null });
  }
  return cols;
}

interface Component { readonly keys: string[]; readonly top: number; readonly min: number }

/** Zusammenhängende Dachspalten: Nachbarn mit Höhenunterschied <= 1 (und optional gleicher Neigungsrichtung). */
function components(cols: ReadonlyMap<string, RoofCol>, sameFacing: boolean): Component[] {
  const seen = new Set<string>();
  const out: Component[] = [];
  for (const start of [...cols.keys()].sort()) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const keys: string[] = [];
    let top = -Infinity, min = Infinity;
    while (stack.length > 0) {
      const k = stack.pop()!;
      keys.push(k);
      const cur = cols.get(k)!;
      top = Math.max(top, cur.y); min = Math.min(min, cur.y);
      const [x, z] = parse(k);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nk = colKey(x + dx, z + dz);
        if (seen.has(nk)) continue;
        const n = cols.get(nk);
        if (n === undefined || Math.abs(n.y - cur.y) > 1) continue;
        if (sameFacing && n.facing !== cur.facing) continue;
        seen.add(nk);
        stack.push(nk);
      }
    }
    out.push({ keys, top, min });
  }
  return out;
}

/** Dachform aus den Treppen-Blickrichtungen der Dachzellen (Näherung). */
export function roofFormOf(b: Building): RoofForm {
  if (b.roofCells.length === 0) return 'none';
  const face = new Map<HorizontalDir, number>();
  let stairs = 0;
  for (const c of b.roofCells) {
    if (c.shape !== 'stairs' || c.orient?.facing === undefined) continue;
    stairs++;
    face.set(c.orient.facing, (face.get(c.orient.facing) ?? 0) + 1);
  }
  if (stairs < 6) return 'flat';
  const shares = [...face.entries()].map(([d, n]) => [d, n / stairs] as const).sort((a, c) => c[1] - a[1]);
  if (shares[0]![1] >= 0.8) return 'shed';
  const major = shares.filter((s) => s[1] >= 0.12).map((s) => s[0]);
  const opp: Record<HorizontalDir, HorizontalDir> = { north: 'south', south: 'north', east: 'west', west: 'east' };
  if (major.length === 2 && major[1] === opp[major[0]!]) return 'gable';
  if (major.length === 4) return 'hip';
  return 'mixed';
}

export interface MassingResult {
  readonly measures: Measures;
  readonly summaries: readonly BuildingSummary[];
}

export function measureMassing(scene: Scene): MassingResult {
  const m: Record<string, Measure> = {};
  const summaries: BuildingSummary[] = [];
  const corners: number[] = [], offs: number[] = [];
  const mainShare: number[] = [], famCount: number[] = [], noiseW: number[] = [], noiseN: number[] = [];
  const woodKinds: number[] = [];
  const dL: number[] = [];
  const eaveOK: number[] = [], eaveN: number[] = [];
  const peaks: number[] = [], focus: number[] = [];
  let maxPlane = 0, planeBuildings = 0;

  for (const b of scene.buildings) {
    const fp = footprintOf(b);
    const con = contourOf(fp);
    const big10 = con.w >= 10 && con.l >= 10;
    const big12 = con.w >= 12 && con.l >= 12;
    if (big10) { corners.push(con.corners); offs.push(con.offsetShare); }

    // Dach
    const rc = roofColumns(scene, b);
    const levels = components(rc, false).filter((c) => c.keys.length >= 4);
    const planes = components(rc, true);
    const mainLevel = levels.slice().sort((a, c) => c.keys.length - a.keys.length || a.top - c.top)[0];
    if (planes.length > 0) { planeBuildings++; maxPlane = Math.max(maxPlane, ...planes.map((p) => p.keys.length)); }

    // Dach-Familien
    const fam = new Map<string, number>();
    const rows = new Map<number, Map<string, number>>();
    let roofL = 0, roofN = 0;
    for (const c of b.roofCells) {
      const [x, y, z] = c.pos;
      const nm = scene.vox.name(x, y, z);
      if (nm === 'air' || !isMaterial(nm)) continue;
      const f = materialFamily(nm);
      fam.set(f, (fam.get(f) ?? 0) + 1);
      const r = rows.get(y) ?? new Map<string, number>();
      r.set(f, (r.get(f) ?? 0) + 1);
      rows.set(y, r);
      roofL += lightOf(nm); roofN++;
    }
    if (roofN >= 20) {
      const sorted = [...fam.entries()].sort((a, c) => c[1] - a[1] || (a[0] < c[0] ? -1 : 1));
      mainShare.push(sorted[0]![1] / roofN);
      famCount.push(sorted.filter((e) => e[1] / roofN >= 0.05).length);
      let dominant = 0, tot = 0;
      for (const r of rows.values()) {
        let rt = 0, rmax = 0;
        for (const v of r.values()) { rt += v; rmax = Math.max(rmax, v); }
        dominant += rmax; tot += rt;
      }
      noiseW.push(tot - dominant); noiseN.push(tot);
      if (woodOf(`${sorted[0]![0]}_x`) === sorted[0]![0]) {
        woodKinds.push(sorted.filter((e) => woodOf(`${e[0]}_x`) === e[0] && e[1] / roofN >= 0.05).length);
      }
      // Kontrast Wand ↔ Dach
      let wl = 0, wn = 0;
      for (const f of b.faces) {
        if (f.cell.kind === 'window' || f.cell.kind === 'door' || !isMaterial(f.wallName)) continue;
        wl += lightOf(f.wallName); wn++;
      }
      if (wn >= 10) dL.push(Math.abs(wl / wn - roofL / roofN));
    }

    // Traufüberstand
    const wallCols = new Set<string>();
    for (const c of b.cells) if (c.kind !== 'roof' && c.kind !== 'ceiling' && c.kind !== 'floor' && c.kind !== 'stairs' && c.kind !== 'railing') wallCols.add(colKey(c.pos[0], c.pos[2]));
    for (const comp of levels) {
      let n = 0, over = 0;
      for (const k of comp.keys) {
        const col = rc.get(k)!;
        if (col.y !== comp.min) continue;
        const [x, z] = parse(k);
        const edge = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dz]) => !rc.has(colKey(x + dx, z + dz)));
        if (!edge) continue;
        n++; if (!wallCols.has(k)) over++;
      }
      if (n > 0) { eaveN.push(n); eaveOK.push(over); }
    }

    // Silhouette
    const tops = [...new Set(levels.map((l) => l.top))].sort((a, c) => a - c);
    if (big12 && levels.length > 0) {
      peaks.push(tops.length);
      const mainTop = mainLevel!.top - b.groundY + 1;
      focus.push((tops[tops.length - 1]! - b.groundY + 1) / Math.max(1, mainTop));
    }
    summaries.push({
      form: roofFormOf(b),
      eaveHeight: mainLevel === undefined ? null : mainLevel.min - b.groundY,
      topHeight: tops.length === 0 ? null : tops[tops.length - 1]! - b.groundY + 1,
      footprintW: con.w, footprintL: con.l,
    });
  }

  const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
  const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
  m['LV-5a'] = measure(mean(corners), corners.length);
  m['LV-5b'] = measure(mean(offs), offs.length);
  m['LV-9a'] = measure(mean(mainShare), mainShare.length);
  m['LV-9b'] = measure(mean(famCount), famCount.length);
  m['LV-9c'] = measure(sum(noiseN) === 0 ? null : sum(noiseW) / sum(noiseN), noiseN.length);
  m['LV-9d'] = measure(mean(woodKinds), woodKinds.length);
  m['LV-10a'] = measure(mean(dL), dL.length);
  m['LV-12b'] = measure(sum(eaveN) === 0 ? null : sum(eaveOK) / sum(eaveN), eaveN.length);
  m['LV-13a'] = measure(mean(peaks), peaks.length);
  m['LV-13d'] = measure(mean(focus), focus.length);
  m['LV-14'] = measure(planeBuildings === 0 ? null : maxPlane, planeBuildings);
  return { measures: m, summaries };
}

/** Ensemble-Kennzahlen (LV-13b/c) aus den Zusammenfassungen; ab 4 Bauten, sonst nicht anwendbar. */
export function ensembleMeasures(all: readonly BuildingSummary[]): Measures {
  const m: Record<string, Measure> = {};
  if (all.length < 4) { m['LV-13b'] = measure(null, all.length); m['LV-13c'] = measure(null, all.length); return m; }
  const eaves = all.map((b) => b.eaveHeight).filter((v): v is number => v !== null).sort((a, b) => a - b);
  let classes = 0, last = -Infinity;
  for (const e of eaves) { if (e - last >= 2) classes++; last = e; }
  const tops = all.map((b) => b.topHeight).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const meanE = eaves.length === 0 ? 0 : eaves.reduce((a, b) => a + b, 0) / eaves.length;
  const sd = eaves.length === 0 ? 0 : Math.sqrt(eaves.reduce((a, b) => a + (b - meanE) ** 2, 0) / eaves.length);
  const med = tops.length === 0 ? 0 : tops[Math.floor(tops.length / 2)]!;
  const forms = new Set(all.map((b) => b.form).filter((f) => f !== 'none'));
  m['LV-13b'] = measure(eaves.length === 0 ? null : classes, all.length, { eaveStdDev: sd, focusRatio: med === 0 ? null : tops[tops.length - 1]! / med });
  m['LV-13c'] = measure(forms.size, all.length, { forms: [...forms].sort().join(',') });
  return m;
}
