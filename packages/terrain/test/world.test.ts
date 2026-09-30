/**
 * Integration: Beispielhaus + Gelände über `buildWorld(project, ctx, shell, extraCells)` materialisiert
 * (Pipeline unverändert). Geprüft wird die fertige Welt je Zielversion und Theme.
 */
import { describe, expect, it } from 'vitest';
import type { Project } from '@mcda/blueprint';
import { CellSet, key3, type Vec3 } from '@mcda/core';
import { exportFile, importFile } from '@mcda/export/node';
import { buildWorld, generate, toExport, type World } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { isAir } from '@mcda/voxel';
import { Site, buildingFromShell, generateSite, plotAround, type SiteResult } from '../src/index.js';
import { CATALOG_DIR, loadStyles, sampleHouse } from './helpers.js';

const ctx = nodeContext(CATALOG_DIR);
const styles = loadStyles();

/** Grundstück um das Beispielhaus (0…22 × 0…11, Haustür Nord bei x = 11) mit Feld, Garten, Hof und Teich. */
function sampleSite(project: Project, world: World, styleId: string, seed = 5): { site: Site; result: SiteResult } {
  const building = buildingFromShell(world.shell);
  const site = Site.create({ id: 'site', projectId: project.state.id, seed, styleId, plot: plotAround(building, 16) });
  site.paintZone('field', CellSet.rect(-14, -15, -2, -6));
  site.paintZone('garden', CellSet.rect(26, -14, 35, -6));
  site.paintZone('yard', CellSet.rect(8, -9, 15, -4));
  site.paintZone('pond', CellSet.rect(-12, 18, -5, 24));
  return { site, result: generateSite(site.state, styles.get(styleId)!, building) };
}

function houseWithTerrain(version: '1.21.11' | '26.3', themeId: string, styleId = 'meadow'): { project: Project; world: World; result: SiteResult } {
  const project = sampleHouse(version, themeId);
  const house = generate(project, ctx, { roof: 'hip' }); // Einrichtung + Licht-Pass
  const { result } = sampleSite(project, house, styleId);
  return { project, world: buildWorld(project, ctx, house.shell, result.cells), result };
}

describe('Beispielhaus + Gelände (buildWorld mit extraCells)', () => {
  for (const version of ['1.21.11', '26.3'] as const) {
    for (const themeId of ctx.themes.ids()) {
      it(`${version} · ${themeId}: 0 harte Verstöße, Felder funktional, Laub persistent, Fundament dicht`, () => {
        const { world, result } = houseWithTerrain(version, themeId);
        expect(result.warnings).toEqual([]);
        const m = world.materialized;
        const v = m.volume;
        const hard = m.violations.filter((x) => x.kind !== 'spawn');
        expect(hard, JSON.stringify(hard.slice(0, 5), null, 1)).toEqual([]);
        expect(m.light.darkCells).toEqual([]); // das Haus bleibt mob-sicher
        const name = (p: Vec3): string => v.stateAt(p).name;
        const cells = new Map(result.cells.map((c) => [key3(c.pos), c]));

        // Blätter persistent (Bäume + Büsche), Stämme senkrecht
        let leaves = 0;
        for (const c of v.cells()) {
          if (c.state.name.endsWith('_leaves')) {
            leaves++;
            expect(c.state.properties['persistent'], `${c.state.name} bei ${c.pos}`).toBe('true');
          }
        }
        expect(leaves).toBeGreaterThan(50);
        for (const t of result.trees) expect(v.stateAt([t.base[0], t.base[1] + 1, t.base[2]]).properties['axis']).toBe('y');

        // Felder: Früchte auf Ackerland, Wasser ≤ 4, Licht ≥ 9 (Himmel oder Blocklicht)
        const f = result.fields[0]!;
        expect(f.crops.length).toBeGreaterThan(40);
        const sky = (p: Vec3): boolean => {
          for (let y = p[1] + 1; y < v.origin[1] + v.size[1]; y++) if (!isAir(v.stateAt([p[0], y, p[2]]))) return false;
          return true;
        };
        for (const c of f.crops) {
          const p: Vec3 = [c.cell[0], f.level + 1, c.cell[1]];
          expect(name(p)).toMatch(/^(wheat|carrots|potatoes|beetroots)$/);
          expect(name([p[0], f.level, p[2]])).toBe('farmland');
          expect(sky(p) || m.light.levelAt(p) >= 9, `Licht an ${p}`).toBe(true);
          const wet = f.water.some(([wx, wz]) => Math.max(Math.abs(wx - p[0]), Math.abs(wz - p[2])) <= 4 && name([wx, f.level, wz]) === 'water');
          expect(wet, `trocken ${p}`).toBe(true);
        }
        expect(name([f.gate!.cell[0], f.level + 1, f.gate!.cell[1]])).toMatch(/_fence_gate$/);
        for (const l of f.lights) {
          expect(name(l)).toMatch(/lantern$/);
          expect(name([l[0], l[1] - 1, l[2]])).toMatch(/_fence$/);
        }
        // Zaun verbindet sich (Autotiling): jeder Zaunpfosten hat mindestens einen Anschluss
        for (const [x, z] of f.fence) {
          const s = v.stateAt([x, f.level + 1, z]);
          expect(['north', 'east', 'south', 'west'].some((d) => s.properties[d] === 'true'), `Zaun ${x},${z}`).toBe(true);
        }

        // Fundament: unter jeder Außenwand lückenlos volle Blöcke bis zum Geländeboden
        const exteriorCols = new Set(world.shell.cells.filter((c) => (c.kind === 'wall' || c.kind === 'pillar') && c.exterior === true).map((c) => `${c.pos[0]},${c.pos[2]}`));
        expect(exteriorCols.size).toBeGreaterThan(50);
        for (const k of exteriorCols) {
          const [x, z] = k.split(',').map(Number) as [number, number];
          for (let y = result.bottom; y <= 0; y++) {
            const s = v.stateAt([x, y, z]);
            expect(isAir(s), `Lücke unter Außenwand ${x},${y},${z}`).toBe(false);
          }
        }

        // Wege begehbar: Oberfläche trägt, 2 Blöcke Kopffreiheit
        for (const [x, z] of result.paths) {
          const t = result.top[result.grid.idx(x, z)]!;
          expect(isAir(v.stateAt([x, t, z])), `Weg ${x},${z}`).toBe(false);
          expect(isAir(v.stateAt([x, t + 1, z])) && isAir(v.stateAt([x, t + 2, z])), `Weg ${x},${z} verstellt`).toBe(true);
        }
        // Wasser bleibt Wasser (Quellen, eingefasst)
        for (const c of result.cells) if (c.role === 'water') expect(v.stateAt(c.pos)).toMatchObject({ name: 'water', properties: { level: '0' } });
        expect(cells.size).toBe(result.cells.length);
      });
    }
  }

  it('alle Geländestile materialisieren ohne harte Verstöße (26.3, medieval)', () => {
    for (const styleId of styles.keys()) {
      const { world, result } = houseWithTerrain('26.3', 'medieval', styleId);
      const hard = world.materialized.violations.filter((x) => x.kind !== 'spawn');
      expect(hard, `${styleId}: ${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
      expect(result.warnings, styleId).toEqual([]);
    }
  });

  it('Export: Haus + Gelände als .litematic/.schem/.nbt (Round-Trip)', () => {
    const { project, world } = houseWithTerrain('1.21.11', 'rustic');
    const ev = toExport(project, world);
    expect(ev.blocks.length).toBeGreaterThan(8000);
    for (const fmt of ['nbt', 'schem', 'litematic'] as const) {
      expect(importFile(fmt, exportFile(fmt, ev)).blocks.length, fmt).toBe(ev.blocks.length);
    }
  });
});
