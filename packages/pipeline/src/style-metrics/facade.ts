/**
 * Fassaden-Kennzahlen: Relief (LV-1, 2, 3, 4, 18), Material (LV-6, 7), Verlauf (LV-8), Kontrast (LV-10),
 * Nicht-Vollblöcke (LV-11), Kanten (LV-12, Sockel und Ecken). Alles über die sichtbaren Außenflächen der Baukörper.
 */
import type { HorizontalDir } from '@mcda/core';
import {
  baseBlock, blockLightness, isClimber, isFullBlock, isMaterial, isWeathered, materialFamily, stoneOf,
} from './blocks.js';
import { DIRS, OwnerKind, type Building, type Face, type Scene } from './scene.js';
import type { Measure, Measures } from './types.js';

const OPPOSITE: Readonly<Record<HorizontalDir, HorizontalDir>> = { north: 'south', south: 'north', east: 'west', west: 'east' };

/** Eine zusammenhängende Wandseite: Baukörper × Außenrichtung × Wandebene. */
export interface Side {
  readonly building: number;
  readonly dir: HorizontalDir;
  readonly plane: number;
  readonly faces: readonly Face[];
  readonly minA: number; readonly maxA: number;
  readonly minY: number; readonly maxY: number;
  /** Breite/Höhe des umschließenden Rechtecks in Zellen. */
  readonly width: number;
  readonly height: number;
  readonly isFront: boolean;
  readonly isBack: boolean;
  readonly grid: ReadonlyMap<number, Face>;
}

const gridKey = (y: number, a: number, minY: number, minA: number, w: number): number => (y - minY) * w + (a - minA);

/** Richtung der Haustür eines Baukörpers (Haupttür, sonst erste Außentür), `undefined` ohne Türen. */
export function frontDirOf(b: Building): HorizontalDir | undefined {
  for (const r of b.rooms) for (const d of r.doors) if (d.isMain) return d.toward;
  return undefined;
}

export function computeSides(scene: Scene): Side[] {
  const out: Side[] = [];
  for (const b of scene.buildings) {
    const front = frontDirOf(b);
    const groups = new Map<string, Face[]>();
    for (const f of b.faces) {
      const k = `${f.dir}|${f.plane}`;
      const g = groups.get(k);
      if (g) g.push(f); else groups.set(k, [f]);
    }
    for (const faces of groups.values()) {
      let minA = Infinity, maxA = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const f of faces) { minA = Math.min(minA, f.a); maxA = Math.max(maxA, f.a); minY = Math.min(minY, f.y); maxY = Math.max(maxY, f.y); }
      const width = maxA - minA + 1;
      const grid = new Map<number, Face>();
      for (const f of faces) grid.set(gridKey(f.y, f.a, minY, minA, width), f);
      const dir = faces[0]!.dir;
      out.push({
        building: b.index, dir, plane: faces[0]!.plane, faces, minA, maxA, minY, maxY, width, height: maxY - minY + 1,
        isFront: front === dir, isBack: front !== undefined && OPPOSITE[front] === dir, grid,
      });
    }
  }
  return out;
}

const MIN_SIDE = 6;

/** Relief-Zelle: Vorsprung oder Öffnung (Fenster/Tür). */
export const isRelief = (f: Face): boolean => f.depth >= 1 || f.cell.kind === 'window' || f.cell.kind === 'door';
const isFlat = (f: Face): boolean => f.depth === 0 && (f.cell.kind === 'wall' || f.cell.kind === 'pillar' || f.cell.kind === 'lintel');

/** Ebene einer Fassadenzelle: -1 Öffnung, 0 Wandebene, 1..3 Vorsprung. */
const planeLevel = (f: Face): number => (f.cell.kind === 'window' || f.cell.kind === 'door' ? -1 : f.depth);

/** Breitestes ebenes Rechteck je Mindesthöhe: `result[h]` = größte Breite eines Rechtecks ohne Relief mit Höhe >= h. */
export function flatWidths(side: Side): number[] {
  const W = side.width, H = side.height;
  const heights = new Array<number>(W).fill(0);
  const best = new Array<number>(H + 2).fill(0);
  for (let r = 0; r < H; r++) {
    const y = side.minY + r;
    for (let c = 0; c < W; c++) {
      const f = side.grid.get(gridKey(y, side.minA + c, side.minY, side.minA, W));
      heights[c] = f !== undefined && isFlat(f) ? heights[c]! + 1 : 0;
    }
    for (let h = 1; h <= H; h++) {
      let run = 0;
      for (let c = 0; c < W; c++) {
        if (heights[c]! >= h) { run++; if (run > best[h]!) best[h] = run; } else run = 0;
      }
    }
  }
  return best;
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const measure = (value: number | null, weight: number, details?: Record<string, number | string | boolean | null>): Measure =>
  details === undefined ? { value, weight } : { value, weight, details };

// OKLab-Helligkeit mit Cache
const lightCache = new Map<string, number>();
export function lightOf(name: string): number {
  let v = lightCache.get(name);
  if (v === undefined) { v = blockLightness(name); lightCache.set(name, v); }
  return v;
}

/** Aussage über Anteile einer Familienzählung: sortierte Anteile. */
function sharesOf(counts: ReadonlyMap<string, number>): { readonly name: string; readonly share: number }[] {
  let total = 0;
  for (const v of counts.values()) total += v;
  return [...counts.entries()].map(([name, n]) => ({ name, share: total === 0 ? 0 : n / total })).sort((a, b) => b.share - a.share || (a.name < b.name ? -1 : 1));
}

export function measureFacade(scene: Scene): Measures {
  const sides = computeSides(scene);
  const m: Record<string, Measure> = {};
  const big = sides.filter((s) => s.width >= MIN_SIDE);

  // --- LV-1: Reliefquote ---
  const frontSides = big.filter((s) => s.isFront);
  const otherSides = big.filter((s) => !s.isFront);
  const reliefOf = (ss: readonly Side[]): { share: number; n: number; prot: number; open: number } => {
    let n = 0, rel = 0, prot = 0, open = 0;
    for (const s of ss) for (const f of s.faces) { n++; if (isRelief(f)) rel++; if (f.depth >= 1) prot++; else if (f.cell.kind === 'window' || f.cell.kind === 'door') open++; }
    return { share: n === 0 ? 0 : rel / n, n, prot: n === 0 ? 0 : prot / n, open: n === 0 ? 0 : open / n };
  };
  const rf = reliefOf(frontSides), ro = reliefOf(otherSides);
  m['LV-1a'] = measure(rf.n === 0 ? null : rf.share, rf.n, { protrusion: rf.prot, openings: rf.open, sides: frontSides.length });
  m['LV-1b'] = measure(ro.n === 0 ? null : ro.share, ro.n, { protrusion: ro.prot, openings: ro.open, sides: otherSides.length });

  // --- LV-2: Blöcke je Wandzelle (Tiefe <= 1) ---
  {
    let n = 0, blocks = 0;
    for (const s of sides) {
      for (const f of s.faces) {
        n++;
        blocks += 1 + (f.depth >= 1 ? 1 : 0);
        const [dx, dz] = DIRS[f.dir];
        if (scene.vox.solid(f.x - dx, f.y, f.z - dz)) {
          const o = scene.vox.owner(f.x - dx, f.y, f.z - dz);
          if (o === OwnerKind.Shell || o === OwnerKind.Exterior) blocks++;
        }
      }
    }
    m['LV-2'] = measure(n === 0 ? null : blocks / n, n);
  }

  // --- LV-3 / LV-18b: ebene Wandstücke ---
  {
    const runs: number[] = [];
    let okShare = 0;
    let patchSides = 0, patchViol = 0;
    for (const s of big) {
      const w = flatWidths(s);
      const run = s.height >= 2 ? w[2] ?? 0 : w[1] ?? 0;
      runs.push(run);
      const limit = s.width <= 8 ? 5 : s.width >= 12 ? 4 : 4.5;
      if (run <= limit) okShare++;
      if (s.height >= 5) { patchSides++; if ((w[5] ?? 0) >= 6) patchViol++; }
    }
    m['LV-3'] = measure(runs.length === 0 ? null : mean(runs), runs.length, { compliant: runs.length === 0 ? null : okShare / runs.length, max: runs.length === 0 ? null : Math.max(...runs) });
    m['LV-18b'] = measure(patchSides === 0 ? null : patchViol / patchSides, patchSides);
  }

  // --- LV-4: Tiefenebenen je Seite ---
  {
    let n = 0, ge3 = 0, gt3 = 0, planesSum = 0;
    for (const s of sides) {
      if (s.width <= 5 || s.height <= 4) continue;
      const counts = new Map<number, number>();
      for (const f of s.faces) counts.set(planeLevel(f), (counts.get(planeLevel(f)) ?? 0) + 1);
      let planes = 0;
      for (const c of counts.values()) if (c / s.faces.length >= 0.03) planes++;
      n++; planesSum += planes;
      if (planes >= 3) ge3++;
      if (planes > 3) gt3++;
    }
    m['LV-4a'] = measure(n === 0 ? null : ge3 / n, n, { meanPlanes: n === 0 ? null : planesSum / n });
    m['LV-4b'] = measure(n === 0 ? null : gt3 / n, n);
  }

  // --- LV-18a: Rückseite gegen Front ---
  {
    const ratios: number[] = [];
    for (const b of scene.buildings) {
      const front = frontDirOf(b);
      if (front === undefined) continue;
      const pool = (d: HorizontalDir): { n: number; share: number; width: number } => {
        const ss = sides.filter((s) => s.building === b.index && s.dir === d);
        const n = ss.reduce((a, s) => a + s.faces.length, 0);
        const rel = ss.reduce((a, s) => a + s.faces.filter(isRelief).length, 0);
        const width = ss.reduce((a, s) => Math.max(a, s.width), 0);
        return { n, share: n === 0 ? 0 : rel / n, width };
      };
      const fr = pool(front), bk = pool(OPPOSITE[front]);
      if (fr.width < MIN_SIDE || bk.width < MIN_SIDE || fr.share <= 0) continue;
      ratios.push(bk.share / fr.share);
    }
    m['LV-18a'] = measure(ratios.length === 0 ? null : mean(ratios), ratios.length);
  }

  // --- LV-6: Materialanteile je Seite ---
  {
    const lead: number[] = [], second: number[] = [], accent: number[] = [], kinds: number[] = [];
    const weights: number[] = [];
    for (const s of big) {
      const fam = new Map<string, number>();
      const blocks = new Map<string, number>();
      let n = 0;
      for (const f of s.faces) {
        if (f.cell.kind === 'window' || f.cell.kind === 'door' || !isMaterial(f.wallName)) continue;
        n++;
        const fm = materialFamily(f.wallName);
        fam.set(fm, (fam.get(fm) ?? 0) + 1);
        const bb = baseBlock(f.wallName);
        blocks.set(bb, (blocks.get(bb) ?? 0) + 1);
      }
      if (n < 20) continue;
      const sh = sharesOf(fam);
      lead.push(sh[0]?.share ?? 0);
      second.push(sh[1]?.share ?? 0);
      accent.push(sh.slice(2).reduce((a, x) => a + x.share, 0));
      kinds.push([...blocks.values()].filter((c) => c / n >= 0.02).length);
      weights.push(n);
    }
    const w = weights.reduce((a, b) => a + b, 0);
    const wmean = (xs: readonly number[]): number => (w === 0 ? 0 : xs.reduce((a, x, i) => a + x * weights[i]!, 0) / w);
    m['LV-6a'] = measure(lead.length === 0 ? null : wmean(lead), lead.length);
    m['LV-6b'] = measure(lead.length === 0 ? null : wmean(second), lead.length);
    m['LV-6c'] = measure(lead.length === 0 ? null : wmean(accent), lead.length);
    m['LV-6d'] = measure(lead.length === 0 ? null : mean(kinds), lead.length);
  }

  // --- LV-7: Steintöne ---
  {
    const fam = new Map<string, number>();
    const all: Face[] = [];
    for (const s of sides) for (const f of s.faces) {
      if (f.cell.kind === 'window' || f.cell.kind === 'door') continue;
      const st = stoneOf(f.wallName);
      if (st === undefined) continue;
      fam.set(st, (fam.get(st) ?? 0) + 1);
      all.push(f);
    }
    if (all.length < 20) {
      m['LV-7a'] = measure(null, all.length); m['LV-7b'] = measure(null, all.length); m['LV-7c'] = measure(null, all.length);
    } else {
      const sh = sharesOf(fam);
      const leadName = sh[0]!.name;
      m['LV-7a'] = measure(sh[0]!.share, all.length, { lead: leadName, tones: sh.length });
      m['LV-7b'] = measure(sh.slice(1).filter((x) => x.share >= 0.05).length, all.length);
      // Flecken: Nicht-Leitstein mit gleichartigem 4-Nachbarn in derselben Seite
      let others = 0, patched = 0;
      const sideOf = new Map<Face, Side>();
      for (const s of sides) for (const f of s.faces) sideOf.set(f, s);
      for (const f of all) {
        const st = stoneOf(f.wallName)!;
        if (st === leadName) continue;
        others++;
        const s = sideOf.get(f)!;
        const same = (y: number, a: number): boolean => {
          const g = s.grid.get(gridKey(y, a, s.minY, s.minA, s.width));
          return g !== undefined && stoneOf(g.wallName) === st;
        };
        if (same(f.y + 1, f.a) || same(f.y - 1, f.a) || (f.a + 1 <= s.maxA && same(f.y, f.a + 1)) || (f.a - 1 >= s.minA && same(f.y, f.a - 1))) patched++;
      }
      m['LV-7c'] = measure(others < 10 ? null : patched / others, others);
    }
  }

  // --- LV-8: vertikaler Verlauf ---
  {
    const rowN = new Map<number, number>(), rowW = new Map<number, number>();
    for (const b of scene.buildings) {
      if (b.faces.length === 0) continue;
      const y0 = Math.min(...b.faces.map((f) => f.y));
      for (const f of b.faces) {
        if (f.cell.kind === 'window' || f.cell.kind === 'door' || !isMaterial(f.wallName)) continue;
        const r = f.y - y0;
        rowN.set(r, (rowN.get(r) ?? 0) + 1);
        if (isWeathered(f.wallName) || isClimber(f.k1Name)) rowW.set(r, (rowW.get(r) ?? 0) + 1);
      }
    }
    const band = (lo: number, hi: number): { share: number; n: number } => {
      let n = 0, w = 0;
      for (const [r, c] of rowN) if (r >= lo && r <= hi) { n += c; w += rowW.get(r) ?? 0; }
      return { share: n === 0 ? 0 : w / n, n };
    };
    const b0 = band(0, 2), b1 = band(3, 5), b2 = band(6, 999);
    m['LV-8a'] = measure(b0.n === 0 ? null : b0.share, b0.n);
    m['LV-8b'] = measure(b1.n === 0 ? null : b1.share, b1.n);
    m['LV-8c'] = measure(b2.n === 0 ? null : b2.share, b2.n);
    const rows = [...rowN.keys()].filter((r) => (rowN.get(r) ?? 0) >= 8).sort((a, b) => a - b);
    let jump = 0, pairs = 0;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]! !== rows[i - 1]! + 1) continue;
      const a = (rowW.get(rows[i - 1]!) ?? 0) / rowN.get(rows[i - 1]!)!, b = (rowW.get(rows[i]!) ?? 0) / rowN.get(rows[i]!)!;
      jump = Math.max(jump, Math.abs(a - b)); pairs++;
    }
    m['LV-8d'] = measure(pairs === 0 ? null : jump, pairs);
  }

  // --- LV-10b/c: Kontrast der Fassade ---
  {
    let pillarL = 0, pillarN = 0, fillL = 0, fillN = 0;
    let pairs = 0, hard = 0;
    for (const f of sides.flatMap((s) => s.faces)) {
      if (!isMaterial(f.wallName) || f.cell.kind === 'window' || f.cell.kind === 'door') continue;
      const l = lightOf(f.wallName);
      if (f.cell.kind === 'pillar') { pillarL += l; pillarN++; } else if (f.cell.kind === 'wall') { fillL += l; fillN++; }
    }
    m['LV-10b'] = measure(pillarN >= 10 && fillN >= 10 ? Math.abs(pillarL / pillarN - fillL / fillN) : null, Math.min(pillarN, fillN));
    for (const s of sides) {
      for (const f of s.faces) {
        if (!isMaterial(f.wallName)) continue;
        const l = lightOf(f.wallName);
        for (const [dy, da] of [[1, 0], [0, 1]] as const) {
          const g = s.grid.get(gridKey(f.y + dy, f.a + da, s.minY, s.minA, s.width));
          if (g === undefined || !isMaterial(g.wallName) || f.a + da > s.maxA) continue;
          pairs++;
          if (Math.abs(lightOf(g.wallName) - l) > 0.35) hard++;
        }
      }
    }
    m['LV-10c'] = measure(pairs === 0 ? null : hard / pairs, pairs);
  }

  // --- LV-11: Nicht-Vollblock-Anteil ---
  {
    let n = 0, partial = 0;
    for (const s of sides) {
      for (const f of s.faces) {
        n++; if (!isFullBlock(f.wallName)) partial++;
        const [dx, dz] = DIRS[f.dir];
        for (let k = 1; k <= f.depth; k++) { n++; if (!isFullBlock(scene.vox.name(f.x + dx * k, f.y, f.z + dz * k))) partial++; }
      }
    }
    m['LV-11'] = measure(n === 0 ? null : partial / n, n);
  }

  // --- LV-12a: Außenecken mit eigenem Eckelement, LV-12c: Sockel ---
  {
    const byCell = new Map<string, Face[]>();
    for (const b of scene.buildings) for (const f of b.faces) {
      if (f.cell.kind !== 'pillar') continue;
      const k = `${f.x},${f.y},${f.z}`;
      const g = byCell.get(k);
      if (g) g.push(f); else byCell.set(k, [f]);
    }
    const sideByKey = new Map<string, Side>();
    for (const s of sides) sideByKey.set(`${s.building}|${s.dir}|${s.plane}`, s);
    let corners = 0, distinct = 0;
    for (const fs of byCell.values()) {
      if (fs.length < 2) continue;
      const dirs = new Set(fs.map((f) => f.dir));
      const perp = (dirs.has('north') || dirs.has('south')) && (dirs.has('east') || dirs.has('west'));
      if (!perp) continue;
      const f0 = fs[0]!;
      const neigh = new Set<string>();
      for (const f of fs) {
        const s = sideByKey.get(`${f.building}|${f.dir}|${f.plane}`);
        if (s === undefined) continue;
        for (const da of [-1, 1]) {
          const g = s.grid.get(gridKey(f.y, f.a + da, s.minY, s.minA, s.width));
          if (g !== undefined && g.cell.kind === 'wall') neigh.add(g.wallName);
        }
      }
      if (neigh.size === 0) continue;
      corners++;
      if (!neigh.has(f0.wallName)) distinct++;
    }
    m['LV-12a'] = measure(corners === 0 ? null : distinct / corners, corners);

    let bn = 0, plinth = 0;
    for (const b of scene.buildings) {
      const fs = b.faces.filter((f) => f.cell.kind !== 'window' && f.cell.kind !== 'door' && isMaterial(f.wallName));
      if (fs.length < 30) continue;
      const y0 = Math.min(...fs.map((f) => f.y));
      const low = fs.filter((f) => f.y - y0 <= 1), up = fs.filter((f) => f.y - y0 >= 2 && f.y - y0 <= 4);
      if (low.length < 8 || up.length < 8) continue;
      bn++;
      const cnt = (xs: readonly Face[], key: (n: string) => string): Map<string, number> => {
        const c = new Map<string, number>();
        for (const f of xs) c.set(key(f.wallName), (c.get(key(f.wallName)) ?? 0) + 1);
        return c;
      };
      const lowKinds = [...cnt(low, baseBlock).values()].filter((c) => c / low.length >= 0.05).length;
      const lowLead = sharesOf(cnt(low, materialFamily))[0]!.name, upLead = sharesOf(cnt(up, materialFamily))[0]!.name;
      if (lowKinds <= 2 && lowLead !== upLead) plinth++;
    }
    m['LV-12c'] = measure(bn === 0 ? null : plinth / bn, bn);
  }

  return m;
}
