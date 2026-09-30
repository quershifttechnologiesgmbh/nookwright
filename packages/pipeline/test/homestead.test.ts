/**
 * T2 – Gelände-Feinschliff in der fertigen Welt: Vorlage „Gehöft“ (research/18 S1) + Geländestil `homestead`
 * materialisiert mit dem Haus (`generateBase`). Geprüft werden Physik (0 harte Verstöße), Begehbarkeit (Wege zu allen
 * Außentüren und Toren), keine Überschneidung mit Haus/Außenprofil/Außengestaltung/Bauwerken und im Modus
 * „spawnsicher“ 0 spawnfähige Geländezellen mit dem ECHTEN Licht-BFS der Materialisierung.
 *
 * Spawnfähig (Definition wie im Licht-Pass/Spawn-Bericht): Standplatz über einer Gelände-/Pflanzenzelle, begehbar
 * (`isWalkable`), Untergrund `spawnFloor`, Füße/Kopf nicht `spawnBlocked`, Blocklicht 0.
 */
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FacadeStyle, ShellCell } from '@mcda/blueprint';
import { key3, type Vec3 } from '@mcda/core';
import { WorldView, isWalkable, type PlatformView } from '@mcda/materialize';
import { isAir, type BlockState } from '@mcda/voxel';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { completeBase, generateBase, type BaseWorld } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { homesteadBase } from '../src/samples.js';
import { Walker, standKey } from './walk.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const HOMESTEAD = ctx.terrainStyles!.get('homestead')!;
const ALL_FACADE: FacadeStyle = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4 };

/** Messwerte für den Bericht (nur mit T2_METRICS=<Datei>). */
function metric(line: string): void {
  const f = process.env['T2_METRICS'];
  if (f !== undefined) appendFileSync(f, `${line}\n`);
}

/** Spawnfähige Standplätze über Gelände-/Pflanzenzellen mit Blocklicht 0 (echter Licht-BFS der Welt). */
function siteSpawnCells(world: BaseWorld, platform: PlatformView): Vec3[] {
  const view = new WorldView(world.materialized.volume, platform);
  const light = world.materialized.light;
  const blocked = (s: BlockState): boolean => !isAir(s) && view.physicsOf(s).spawnBlocked;
  const out: Vec3[] = [];
  const seen = new Set<string>();
  for (const c of world.surroundings.cells) {
    if (c.kind !== 'terrain' && c.kind !== 'plant') continue;
    const p: Vec3 = [c.pos[0], c.pos[1] + 1, c.pos[2]];
    const k = key3(p);
    if (seen.has(k) || !view.inside(p)) continue;
    seen.add(k);
    if (!isWalkable(view, p) || light.levelAt(p) > 0) continue;
    if (!view.info(c.pos).phys.spawnFloor || blocked(view.state(p)) || blocked(view.state([p[0], p[1] + 1, p[2]]))) continue;
    out.push(p);
  }
  return out;
}

const hard = (w: BaseWorld): unknown[] => w.materialized.violations.filter((v) => v.kind !== 'spawn');

/** Standplatz vor jeder Außentür und vor jedem Tor (außen) – alle von der Haustür aus erreichbar? */
function checkReach(world: BaseWorld, version: string): void {
  const site = world.surroundings.site!;
  const walker = new Walker(world.materialized.volume, ctx.platform(version));
  const stand = ([x, z]: readonly [number, number]): Vec3 => [x, site.top[site.grid.idx(x, z)]! + 1, z];
  const exits = site.doorExits.map(stand);
  const seen = walker.reach([exits[0]!]);
  for (const e of exits) expect(seen.has(standKey(e)), `Außentür-Ausgang ${e}`).toBe(true);
  for (const g of site.features!.gates) {
    const dx = g.facing === 'east' ? 1 : g.facing === 'west' ? -1 : 0;
    const dz = g.facing === 'south' ? 1 : g.facing === 'north' ? -1 : 0;
    const out = stand([g.cell[0] + dx, g.cell[1] + dz]);
    const inner = stand([g.cell[0] - dx, g.cell[1] - dz]);
    expect(seen.has(standKey(out)), `vor dem Tor ${g.kind} ${g.cell}`).toBe(true);
    expect(seen.has(standKey(inner)), `durch das Tor ${g.kind} ${g.cell}`).toBe(true);
  }
  const plot = site.grid.plot;
  expect([...seen].some((k) => {
    const [x, , z] = k.split(',').map(Number) as [number, number, number];
    return x === plot.minX || x === plot.maxX || z === plot.minZ || z === plot.maxZ;
  }), 'Grundstücksrand').toBe(true);
}

/** Keine Gelände-/Pflanzenzelle auf Hüllzellen; keine Pflanze in Außenprofil-Spalten. */
function checkNoOverlap(world: BaseWorld): void {
  // world.shell enthält die Zusatz-Zellen (buildWorld): Hülle = alles außer Gelände, Pflanzen, Bauwerken
  const hull = new Set(world.shell.cells.filter((c) => c.kind !== 'terrain' && c.kind !== 'plant' && c.kind !== 'fort').map((c) => key3(c.pos)));
  const siteCells = world.surroundings.cells.filter((c) => c.kind === 'terrain' || c.kind === 'plant');
  expect(siteCells.filter((c) => hull.has(key3(c.pos))).map((c) => `${c.role}@${c.pos}`)).toEqual([]);
  const facade = new Set(world.shell.cells.filter((c: ShellCell) => c.kind === 'facade').map((c) => `${c.pos[0]},${c.pos[2]}`));
  expect(siteCells.filter((c) => c.kind === 'plant' && facade.has(`${c.pos[0]},${c.pos[2]}`)).map((c) => `${c.role}@${c.pos}`)).toEqual([]);
  expect(new Set(world.surroundings.cells.map((c) => key3(c.pos))).size).toBe(world.surroundings.cells.length);
}

describe('Gehöft (Vorlage + Stil homestead) in der fertigen Welt', () => {
  for (const version of ['1.21.11', '26.3'] as const) {
    for (const theme of ctx.themes.ids()) {
      it(`${version} · ${theme}: 0 harte Verstöße, Gelände ohne Hinweise, Wege zu Türen und Toren, keine Überschneidung`, { timeout: HEAVY_TIMEOUT }, () => {
        const base = homesteadBase(version, theme);
        const world = generateBase(base.project, ctx, base.options);
        expect(hard(world), JSON.stringify(hard(world).slice(0, 4), null, 1)).toEqual([]);
        expect(world.warnings.filter((w) => w.startsWith('Gelände'))).toEqual([]);
        const site = world.surroundings.site!;
        expect(site.features!.wells).toHaveLength(1);
        expect(site.features!.gates.map((g) => g.kind).sort()).toEqual(['field', 'garden', 'paddock']);
        expect(new Set(base.site.state.zones.map((z) => z.kind))).toEqual(new Set(['yard', 'field', 'garden', 'paddock', 'orchard']));
        checkReach(world, version);
        checkNoOverlap(world);
        // Laub persistent, Laternen stehen (Stütze prüft die Physik), Früchte auf Ackerland (Physik), Wasser als Quelle
        const v = world.materialized.volume;
        for (const c of v.cells()) if (c.state.name.endsWith('_leaves')) expect(c.state.properties['persistent'], `${c.state.name}@${c.pos}`).toBe('true');
        for (const c of site.cells) if (c.role === 'water') expect(v.stateAt(c.pos)).toMatchObject({ name: 'water', properties: { level: '0' } });
        // Z1: Zaunfelder verbinden sich mit Pfosten, Nachbarfeldern und Tor
        const f = site.fields[0]!;
        for (const [x, z] of f.fence) {
          const st = v.stateAt([x, f.level + 1, z]);
          expect(['north', 'east', 'south', 'west'].some((d) => st.properties[d] === 'true'), `Zaun ${x},${z}`).toBe(true);
        }
        // W5 (27.09.2026, Review W4-R N10): Stamm nur am Tor, Eckpfosten aus Zaun (2 hoch, ohne Stammfuß)
        const gateNb = new Set(f.gate === undefined ? [] : [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => `${f.gate!.cell[0] + dx!},${f.gate!.cell[1] + dz!}`));
        for (const [x, z] of f.posts ?? []) {
          expect(v.stateAt([x, f.level + 1, z]).name, `Pfosten ${x},${z}`).toMatch(gateNb.has(`${x},${z}`) ? /_log$/ : /_fence$/);
          expect(v.stateAt([x, f.level + 2, z]).name, `Pfosten ${x},${z} oben`).toMatch(gateNb.has(`${x},${z}`) ? /_log$/ : /_fence$/);
        }
      });
    }
  }

  it('spawnsicher: 0 spawnfähige Geländezellen (echter Licht-BFS); ohne Beleuchtung viele', { timeout: HEAVY_TIMEOUT }, () => {
    for (const [version, theme] of [['26.3', 'medieval'], ['1.21.11', 'rustic']] as const) {
      const counts: Record<string, number> = {};
      for (const mode of ['none', 'paths', 'spawnproof'] as const) {
        const base = homesteadBase(version, theme, 2026, mode);
        const world = generateBase(base.project, ctx, base.options);
        expect(hard(world)).toEqual([]);
        counts[mode] = siteSpawnCells(world, ctx.platform(version)).length;
        const l = world.surroundings.site!.features!.lighting;
        metric(`homestead ${version} ${theme} ${mode}: spawnfähig ${counts[mode]}, Pfähle ${l?.lamps ?? 0}, Leuchtbüsche ${l?.leafLights ?? 0}`);
        if (mode === 'spawnproof') {
          const dark = siteSpawnCells(world, ctx.platform(version));
          expect(dark.slice(0, 10).map((p) => p.join(',')), `${version} ${theme}`).toEqual([]);
          expect(world.warnings.filter((w) => w.startsWith('Gelände'))).toEqual([]);
        }
      }
      expect(counts['none']!).toBeGreaterThan(100);
      expect(counts['paths']!).toBeLessThan(counts['none']!);
    }
  });

  it('Beispiel-Base mit Mauerring, Außenprofil und Außengestaltung: Stil homestead spawnsicher, keine Überschneidung', { timeout: HEAVY_TIMEOUT }, () => {
    const base = completeBase('26.3', 'medieval');
    base.site.setLighting('spawnproof');
    const world = generateBase(base.project, ctx, { ...base.options, site: base.site.state, terrainStyle: HOMESTEAD, facade: ALL_FACADE, exterior: {} });
    expect(hard(world), JSON.stringify(hard(world).slice(0, 4), null, 1)).toEqual([]);
    expect(world.warnings.filter((w) => w.startsWith('Gelände') || w.startsWith('Außen'))).toEqual([]);
    checkNoOverlap(world);
    const fort = world.surroundings.structures!;
    const cols = new Set(fort.footprint.map(([x, z]) => `${x},${z}`));
    expect(world.surroundings.cells.filter((c) => c.kind === 'plant' && cols.has(`${c.pos[0]},${c.pos[2]}`))).toEqual([]);
    const dark = siteSpawnCells(world, ctx.platform('26.3'));
    metric(`completeBase 26.3 medieval homestead+Außen spawnproof: spawnfähig ${dark.length}`);
    expect(dark.slice(0, 10).map((p) => p.join(','))).toEqual([]);
    // Vergleich: dieselbe Base im Standardstil ohne Beleuchtung
    const plain = generateBase(completeBase('26.3', 'medieval').project, ctx, completeBase('26.3', 'medieval').options);
    metric(`completeBase 26.3 medieval meadow (ohne T2): spawnfähig ${siteSpawnCells(plain, ctx.platform('26.3')).length}`);
  });
});
