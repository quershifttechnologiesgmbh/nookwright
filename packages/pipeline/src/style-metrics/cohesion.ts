/**
 * Kohärenz-Kennzahlen KM1, KM3, KM4, KM5, KM6 (`plan/spikes/LV_tiefe_detail.md` Kap. 5.4): Familien-Fokus, Rastertreffer,
 * Farbton-Cluster, Innen-Außen-Schnitt, Umgebungsmaterial. KM2/KM7/KM8/KM9 sind im Voxelmodell nicht messbar (`UNMEASURABLE`).
 */
import { alongOf, OwnerKind, planeOf, type Scene } from './scene.js';
import { dyeHue, dyeOf, groupOf, isMaterial, materialFamily, woodOf, stoneOf } from './blocks.js';
import { footprintOf } from './massing.js';
import { NATURAL_GROUND_BLOCKS, plotSurface } from './terrain.js';
import type { Measure, Measures } from './types.js';

const measure = (value: number | null, weight: number, details?: Record<string, number | string | boolean | null>): Measure =>
  details === undefined ? { value, weight } : { value, weight, details };

const BUILT = new Set<number>([OwnerKind.Shell, OwnerKind.Lining, OwnerKind.Exterior, OwnerKind.Placed]);

/** Holz-/Steinfamilie eines Blocks, sonst `undefined` (für KM5/KM6). */
const woodStone = (name: string): string | undefined => (woodOf(name) !== undefined || stoneOf(name) !== undefined ? materialFamily(name) : undefined);

export function measureCohesion(scene: Scene): Measures {
  const m: Record<string, Measure> = {};
  const { vox } = scene;

  // --- KM1: Familien-Fokus ---
  const fam = new Map<string, number>();
  const shellFam = new Map<string, number>();
  const innerFam = new Map<string, number>();
  const outerFam = new Map<string, number>();
  const dyes = new Map<string, number>();
  const x1Fam = new Map<string, number>();
  let total = 0;
  for (const c of vox.solids()) {
    if (c.owner === OwnerKind.Other) { const ws = woodStone(c.name); if (ws !== undefined) x1Fam.set(ws, (x1Fam.get(ws) ?? 0) + 1); continue; }
    if (!BUILT.has(c.owner)) continue;
    const dye = dyeOf(c.name);
    if (dye !== undefined) dyes.set(dye, (dyes.get(dye) ?? 0) + 1);
    const ws = woodStone(c.name);
    if (ws !== undefined) {
      const inner = c.owner === OwnerKind.Lining || c.owner === OwnerKind.Placed;
      const bag = inner ? innerFam : outerFam;
      bag.set(ws, (bag.get(ws) ?? 0) + 1);
      if (c.owner === OwnerKind.Shell) shellFam.set(ws, (shellFam.get(ws) ?? 0) + 1);
    }
    if (groupOf(c.name) === 'nature' || !isMaterial(c.name)) continue;
    const f = materialFamily(c.name);
    fam.set(f, (fam.get(f) ?? 0) + 1);
    total++;
  }
  {
    const top = [...fam.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
    m['KM1'] = measure(total === 0 ? null : top / total, total, { families: fam.size });
  }

  // --- KM3: Rastertreffer der Fenster- und Türachsen ---
  {
    const grid = scene.shell.facadeGrid;
    let n = 0, hit = 0;
    if (grid !== undefined && grid.length > 0) {
      for (const a of scene.shell.anchors ?? []) {
        if (a.kind !== 'window' && a.kind !== 'door') continue;
        const line = grid.find((g) => g.floorIndex === a.floorIndex && g.out === a.facing && Math.abs(g.plane - planeOf(a.facing, a.pos[0], a.pos[2])) <= 1);
        if (line === undefined) continue;
        const start = alongOf(a.facing, a.pos[0], a.pos[2]);
        const cols: number[] = [];
        for (let i = 0; i < Math.max(1, a.span ?? 1); i++) cols.push(start + i);
        const onAxis = line.bays.some((b) => b.axis.some((ax) => cols.includes(ax)));
        const onPost = line.posts.some((p) => cols.includes(p));
        n++;
        if (onAxis && !onPost) hit++;
      }
    }
    m['KM3'] = measure(n === 0 ? null : hit / n, n);
  }

  // --- KM4: Farbton-Cluster gefärbter Blöcke ---
  {
    let dyedTotal = 0;
    for (const v of dyes.values()) dyedTotal += v;
    const hues: number[] = [];
    for (const [d, v] of dyes) {
      if (v / dyedTotal < 0.03) continue;
      const h = dyeHue(d);
      if (h !== undefined) hues.push(h);
    }
    hues.sort((a, b) => a - b);
    let clusters: number | null = null;
    if (hues.length > 0) {
      let gaps = 0;
      for (let i = 0; i < hues.length; i++) {
        const next = i === hues.length - 1 ? hues[0]! + 360 : hues[i + 1]!;
        if (next - hues[i]! >= 40) gaps++;
      }
      clusters = Math.max(1, gaps);
    }
    m['KM4'] = measure(clusters, dyedTotal, { dyes: dyes.size });
  }

  // --- KM5: Innenfamilien, die auch außen vorkommen ---
  {
    let innerTotal = 0, outerTotal = 0;
    for (const v of innerFam.values()) innerTotal += v;
    for (const v of outerFam.values()) outerTotal += v;
    let n = 0, ok = 0;
    for (const [f, v] of innerFam) {
      if (v / innerTotal < 0.02) continue;
      n++;
      if ((outerFam.get(f) ?? 0) / outerTotal >= 0.01) ok++;
    }
    m['KM5'] = measure(n === 0 || outerTotal === 0 ? null : ok / n, n);
  }

  // --- KM6a: Umgebungsmaterial in Gebäudefamilien ---
  {
    let shellTotal = 0;
    for (const v of shellFam.values()) shellTotal += v;
    const buildingFams = new Set<string>();
    for (const [f, v] of shellFam) if (shellTotal > 0 && v / shellTotal >= 0.03) buildingFams.add(f);
    let n = 0, ok = 0;
    for (const [f, v] of x1Fam) { n += v; if (buildingFams.has(f)) ok += v; }
    for (const s of plotSurface(scene, 6).values()) {
      if (NATURAL_GROUND_BLOCKS.has(s.name) || groupOf(s.name) === 'nature' || s.name === 'water') continue;
      const ws = woodStone(s.name);
      if (ws === undefined) continue;
      n++;
      if (buildingFams.has(ws)) ok++;
    }
    m['KM6a'] = measure(n === 0 ? null : ok / n, n);
  }

  // --- KM6b: Fundamentring enthält Wand-/Sockelfamilie ---
  {
    let n = 0, ok = 0;
    for (const b of scene.buildings) {
      if (b.faces.length === 0) continue;
      const baseFam = new Map<string, number>();
      const lowest = new Map<string, number>();
      for (const f of b.faces) { const k = `${f.x},${f.z}`; const v = lowest.get(k); if (v === undefined || f.y < v) lowest.set(k, f.y); }
      for (const f of b.faces) {
        if (f.y !== lowest.get(`${f.x},${f.z}`)) continue;
        const ws = woodStone(f.wallName);
        if (ws !== undefined) baseFam.set(ws, (baseFam.get(ws) ?? 0) + 1);
      }
      const wallFam = [...baseFam.entries()].sort((a, c) => c[1] - a[1]).slice(0, 2).map(([f]) => f);
      if (wallFam.length === 0) continue;
      const fp = footprintOf(b);
      const ring = new Set<string>();
      for (const k of fp) {
        const [xs, zs] = k.split(',');
        const x = Number(xs), z = Number(zs);
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
          const q = `${x + dx},${z + dz}`;
          if (!fp.has(q)) ring.add(q);
        }
      }
      const found = new Set<string>();
      for (const k of ring) {
        const [xs, zs] = k.split(',');
        const x = Number(xs), z = Number(zs);
        for (let y = b.groundY - 1; y <= b.groundY + 1; y++) {
          if (vox.owner(x, y, z) === OwnerKind.Shell) continue;
          const ws = woodStone(vox.name(x, y, z));
          if (ws !== undefined) found.add(ws);
        }
      }
      n++;
      if (wallFam.some((f) => found.has(f))) ok++;
    }
    m['KM6b'] = measure(n === 0 ? null : ok / n, n);
  }
  return m;
}
