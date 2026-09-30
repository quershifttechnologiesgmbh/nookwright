/**
 * Integration Außengestaltung (X1): Projekt → Hülle (+ Außenprofil) → Einrichtung → Außen-Komponenten →
 * Materialisierung. Beispielhaus, zweistöckig und L-Grundriss × alle 9 Dachformen × mit/ohne Außenprofil (1.21.11),
 * dazu alle Themes × beide Zielversionen:
 *  - keine Kollision (Merge wirft sonst), keine neuen Physik-/Masken-Verstöße, keiner an einer Außen-Komponente,
 *  - additiv: außerhalb der Außen-Zellen bleibt jeder Block gleich; ohne `exterior` gibt es kein Feld `exterior`,
 *  - Türen frei (Zelle vor der Tür und eine weiter, 2 hoch), Scheiben frei (davor nur Luft oder Kastenpflanze),
 *  - deterministisch.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, type FacadeStyle, type RoofStyle } from '@mcda/blueprint';
import { CellSet, key3, type Vec3 } from '@mcda/core';
import { WorldView } from '@mcda/materialize';
import { isAir } from '@mcda/voxel';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { buildWorld, exteriorFor, generate, shellFor, type BuildOptions, type World } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { sampleHouse, twoStoryHouse } from './helpers.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
type Version = keyof typeof TARGET_VERSIONS;
const ALL_FACADE: FacadeStyle = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4 };
const ROOFS: readonly RoofStyle[] = ['flat', 'hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox'];
const STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] } as const;

function lHouse(version: Version, themeId: string): Project {
  const p = Project.create({ id: 'l', name: 'L-Haus', seed: 7, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 14), 'entrance_hall');
  p.paintRoom(0, CellSet.rect(9, 8, 20, 14), 'tavern');
  return p;
}
const HOUSES: Record<string, (v: Version, t: string) => Project> = { Beispielhaus: sampleHouse, zweistöckig: twoStoryHouse, 'L-Grundriss': lHouse };

const hard = (w: World): string[] => w.materialized.violations.filter((v) => v.kind !== 'spawn').map((v) => `${v.kind}@${v.pos?.join(',') ?? '-'}`).sort();

/** Eingerichtetes Projekt, Welt ohne und mit Außengestaltung (gleiche Hülle, gleiche Einrichtung). */
function worlds(project: Project, opts: BuildOptions): { plain: World; ext: World } {
  const g = generate(project, ctx, { ...opts, lighting: false, exterior: opts.exterior ?? {} });
  const shell = g.shell;
  const plain = buildWorld(project, ctx, shell);
  return { plain, ext: g };
}

function check(project: Project, opts: BuildOptions, label: string): World {
  const { plain, ext } = worlds(project, opts);
  const exterior = ext.exterior ?? [];
  expect(exterior.length, `${label}: Außen-Komponenten`).toBeGreaterThan(3);
  expect(plain.exterior).toBeUndefined();
  // Physik: keine neuen Verstöße, keiner an einer Außen-Komponente
  expect(hard(ext), label).toEqual(hard(plain));
  const own = ext.materialized.violations.filter((v) => v.owner?.startsWith('x1:') === true);
  expect(own.map((v) => v.message), label).toEqual([]);
  // jede Außen-Zelle ist gesetzt und gehört ihrer Platzierung
  const vol = ext.materialized.volume;
  const extPos = new Set<string>();
  for (const p of exterior) {
    expect(vol.cellsOf(p.id).length, `${label}: ${p.id}`).toBe(p.cells.length);
    for (const c of p.cells) extPos.add(key3(c));
  }
  // additiv: außerhalb der Außen-Zellen jeder Block gleich. W2 (26.09.2026, Regel D7): Ausnahme Schnee unter einer
  // Außen-Zelle derselben Spalte – die Krone des Schornsteins überdeckt Nachbarspalten, darunter fällt kein Schnee
  const extCols = new Map<string, number>();
  for (const p of exterior) for (const c of p.cells) extCols.set(`${c[0]},${c[2]}`, Math.max(extCols.get(`${c[0]},${c[2]}`) ?? -Infinity, c[1]));
  const base = plain.materialized.volume;
  const diff: string[] = [];
  for (const c of base.cells()) {
    if (extPos.has(key3(c.pos))) continue;
    if (/^(minecraft:)?snow(_block)?$/.test(c.state.name) && (extCols.get(`${c.pos[0]},${c.pos[2]}`) ?? -Infinity) > c.pos[1]) continue;
    // W13-B (2026-09-28): die Torf-Auflage (`decor:turf`) richtet sich nach der Dachzier (Schornstein, gekreuzte
    // Windbretter): unter einer Außen-Zelle liegt kein Soden, die Windbrett-Spitzen stehen über dem Torf
    if (c.owner === 'decor:turf') continue;
    const s = vol.contains(c.pos) ? vol.stateAt(c.pos) : undefined;
    if (s === undefined || s.name !== c.state.name || JSON.stringify(s.properties) !== JSON.stringify(c.state.properties)) diff.push(`${c.pos}: ${c.state.name} → ${s?.name}`);
  }
  expect(diff.slice(0, 5), `${label}: Blöcke außerhalb der Außen-Zellen geändert`).toEqual([]);
  // Türen frei: Zelle vor der Tür und eine weiter, 2 hoch
  for (const d of ext.shell.cells.filter((c) => c.kind === 'door' && c.exterior === true && c.orient?.half === 'lower')) {
    const f = d.orient!.facing!;
    const [dx, dz] = STEP[f];
    for (const k of [1, 2]) for (const h of [0, 1]) {
      const q: Vec3 = [d.pos[0] + dx * k, d.pos[1] + h, d.pos[2] + dz * k];
      if (ext.shell.cells.some((c) => key3(c.pos) === key3(q))) continue; // Innentür (Nachbarraum)
      expect(!vol.contains(q) || isAir(vol.stateAt(q)), `${label}: Laufweg vor Tür ${d.pos} bei ${q}`).toBe(true);
    }
  }
  // Scheiben frei: davor Luft oder eine durchsichtige Kastenpflanze
  const view = new WorldView(vol, ctx.platform(project.state.targetVersion.name));
  for (const w of ext.shell.cells.filter((c) => c.kind === 'window')) {
    for (const [dx, dz] of Object.values(STEP)) {
      const q: Vec3 = [w.pos[0] + dx, w.pos[1], w.pos[2] + dz];
      if (!extPos.has(key3(q))) continue;
      expect(['air', 'thin', 'flat'], `${label}: vor Scheibe ${w.pos}: ${vol.stateAt(q).name}`).toContain(view.info(q).phys.cls);
    }
  }
  return ext;
}

describe('Pipeline: Außengestaltung (X1) an allen Dachformen', () => {
  for (const [name, make] of Object.entries(HOUSES)) {
    for (const facade of [undefined, ALL_FACADE]) {
      it(`${name}${facade !== undefined ? ' · Außenprofil' : ''}: alle 9 Dachformen – kollisionsfrei, physikalisch gültig, Türen und Fenster frei`, { timeout: HEAVY_TIMEOUT }, () => {
        for (const roof of ROOFS) {
          const opts: BuildOptions = { roof, ...(facade !== undefined ? { facade } : {}), exterior: { density: 2 } };
          check(make('1.21.11', 'medieval'), opts, `${name} · ${roof}`);
        }
      });
    }
  }

  it('alle Themes und beide Zielversionen: Außen-Rollen lösen auf, keine neuen Verstöße', { timeout: HEAVY_TIMEOUT }, () => {
    for (const version of ['1.21.11', '26.3'] as const) {
      for (const theme of ctx.themes.ids()) {
        check(twoStoryHouse(version, theme), { roof: 'gable', facade: ALL_FACADE, exterior: { density: 2 } }, `${version} · ${theme}`);
        check(sampleHouse(version, theme), { roof: 'hip', exterior: {} }, `${version} · ${theme} · Standard`);
      }
    }
  });

  it('deterministisch; ohne `exterior` bleibt die Welt ohne Außen-Komponenten', () => {
    const a = generate(sampleHouse('1.21.11', 'medieval'), ctx, { roof: 'gable', exterior: {}, lighting: false });
    const b = generate(sampleHouse('1.21.11', 'medieval'), ctx, { roof: 'gable', exterior: {}, lighting: false });
    expect(a.exterior).toEqual(b.exterior);
    const plain = generate(sampleHouse('1.21.11', 'medieval'), ctx, { roof: 'gable', lighting: false });
    expect('exterior' in plain).toBe(false);
    expect(plain.warnings.some((w) => w.startsWith('Außen'))).toBe(false);
    // Variation würfelt neu, der Projekt-Seed bleibt
    const p = sampleHouse('1.21.11', 'medieval');
    const shell = shellFor(p, { roof: 'gable' });
    const ids = (v?: number) => exteriorFor(p, shell, ctx.catalog, v === undefined ? {} : { variation: v }).placements.map((x) => `${x.componentId}#${x.variantId}`);
    expect([1, 2, 3, 4].some((v) => JSON.stringify(ids(v)) !== JSON.stringify(ids()))).toBe(true);
  });

  it('mit Licht-Pass: Außen-Komponenten gehören zu keinem Raum, Räume bleiben spawnsicher gemessen', () => {
    const w = generate(twoStoryHouse('26.3', 'medieval'), ctx, { roof: 'hip', exterior: {} });
    expect(w.exterior!.length).toBeGreaterThan(0);
    expect(w.lighting!.rooms.length).toBeGreaterThan(0);
    // Die Endwelt enthält die Außen-Komponenten, der Licht-Bericht misst nur die Räume
    for (const p of w.exterior!) expect(w.materialized.volume.cellsOf(p.id).length).toBe(p.cells.length);
    expect(w.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
  });
});
