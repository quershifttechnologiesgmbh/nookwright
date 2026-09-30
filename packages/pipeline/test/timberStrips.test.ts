/**
 * W7 (27.09.2026, `plan/spikes/W7C_fachwerk.md`, Review W4-R Runde 4, Baustandard W1): Fachwerk im Theme `timber` über
 * den Galerie-Weg (`projectFromBuildingType` + `generateBase`, Seed 2026 wie die goldene Galerie).
 *
 * - Kein 1 breiter Putzstreifen zwischen zwei Ständern in den Wandreihen (vorher 82 in den vier Fachwerkbauten).
 * - Ein Stamm an einem Innenwand-Anschluss steht nur dort, wo ihn das Fassadenraster oder eine Öffnung (Laibung)
 *   verlangt – nie wegen der Innenwand allein (W1).
 * - Harte Regeln: 0 Physik-Verstöße, deterministisch.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS, type ShellCell } from '@mcda/blueprint';
import { parseBuildingTypeDef } from '@mcda/catalog';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, type BaseWorld } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);

function build(type: string, seed = 2026): BaseWorld {
  const r = parseBuildingTypeDef(readFileSync(`${ROOT}/buildingtypes/${type}.json5`, 'utf8'), `${type}.json5`);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  const res = projectFromBuildingType(r.value, { size: 'M', themeId: 'timber', targetVersion: TARGET_VERSIONS['1.21.11'] }, seed, ctx);
  return generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
}

const k3 = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const WALLISH = new Set(['wall', 'pillar', 'door', 'window', 'lintel']);

/** Fachwerk-Kennzahlen einer Welt: Putzstreifen zwischen Ständern und Stämme an Innenwand-Anschlüssen ohne Raster/Öffnung. */
function measure(w: BaseWorld): { strips: string[]; junctionTrunks: string[]; infill: number } {
  const vol = w.materialized.volume;
  const byPos = new Map<string, ShellCell>(w.shell.cells.map((c) => [k3(...c.pos), c] as const));
  const name = (x: number, y: number, z: number): string => (vol.isEmpty([x, y, z]) ? 'air' : String(vol.stateAt([x, y, z]).name));
  const upright = (x: number, y: number, z: number): boolean => {
    if (vol.isEmpty([x, y, z])) return false;
    const s = vol.stateAt([x, y, z]);
    return /_log$/.test(s.name) && (s.properties['axis'] ?? 'y') === 'y';
  };
  const wallish = (c: ShellCell | undefined): boolean => c !== undefined && WALLISH.has(c.kind);
  const opening = (c: ShellCell | undefined): boolean => c !== undefined && (c.kind === 'window' || c.kind === 'door');
  const grid = new Set<string>();
  for (const g of w.shell.facadeGrid ?? []) {
    const ns = g.out === 'north' || g.out === 'south';
    for (const p of g.posts) grid.add(`${g.floorIndex}|${ns ? k3(p, 0, g.plane) : k3(g.plane, 0, p)}`);
  }
  const strips: string[] = [];
  const junctionTrunks: string[] = [];
  let infill = 0;
  const seenCol = new Set<string>();
  for (const c of w.shell.cells) {
    if (!wallish(c) || c.exterior !== true || c.roomId === undefined) continue;
    const info = w.shell.rooms.get(c.roomId);
    const [x, y, z] = c.pos;
    if (info === undefined || info.floorIndex < 0 || y < info.baseY || y >= info.baseY + info.height) continue;
    // Laufrichtung: Außenwand-Nachbarn derselben Reihe
    const ext = (dx: number, dz: number): boolean => { const n = byPos.get(k3(x + dx, y, z + dz)); return wallish(n) && n!.exterior === true; };
    const [ax, az] = ext(1, 0) || ext(-1, 0) ? [1, 0] : [0, 1];
    const b = name(x, y, z);
    if (b === 'calcite') {
      infill++;
      if (upright(x + ax, y, z + az) && upright(x - ax, y, z - az)) strips.push(k3(x, y, z));
    }
    // Innenwand-Anschluss quer zur Laufrichtung
    const col = `${info.floorIndex}|${k3(x, 0, z)}`;
    if (seenCol.has(col)) continue;
    const inner = [[az, ax], [-az, -ax]].some(([dx, dz]) => { const n = byPos.get(k3(x + dx!, y, z + dz!)); return wallish(n) && n!.exterior !== true; });
    if (!inner) continue;
    seenCol.add(col);
    let trunk = true;
    let jamb = false;
    for (let h = info.baseY; h < info.baseY + info.height; h++) {
      const cc = byPos.get(k3(x, h, z));
      if (cc === undefined || opening(cc)) continue;
      if (!upright(x, h, z)) trunk = false;
      if (opening(byPos.get(k3(x + ax, h, z + az))) || opening(byPos.get(k3(x - ax, h, z - az)))) jamb = true;
    }
    if (trunk && !jamb && !grid.has(col)) junctionTrunks.push(col);
  }
  return { strips, junctionTrunks, infill };
}

describe('W7: Fachwerk ohne 1 breite Putzstreifen, Ständer nur nach Raster und Öffnungen', () => {
  for (const type of ['tavern', 'timber', 'townhouse', 'townhouse_row']) {
    it(`${type}/timber: 0 Putzstreifen zwischen Ständern, 0 Anschluss-Stämme ohne Raster/Laibung, 0 Verstöße`, () => {
      const w = build(type);
      const m = measure(w);
      expect(m.infill).toBeGreaterThan(50);
      expect(m.strips, JSON.stringify(m.strips)).toEqual([]);
      expect(m.junctionTrunks, JSON.stringify(m.junctionTrunks)).toEqual([]);
      expect(w.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
    }, HEAVY_TIMEOUT);
  }
  it('Taverne M, Seeds 1–3: 0 Putzstreifen zwischen Ständern', () => {
    for (const seed of [1, 2, 3]) {
      const m = measure(build('tavern', seed));
      expect(m.strips, `Seed ${seed}: ${JSON.stringify(m.strips)}`).toEqual([]);
    }
  }, HEAVY_TIMEOUT);
});
