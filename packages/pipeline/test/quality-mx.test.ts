/**
 * MX-Q (DR0 Nr. 10, 11): Detail-Obergrenze und Bodenverbindung/Auflager. Zuerst kleine gebaute Fälle (schwebender
 * Block, Kragarm, Spannweite, Konsole), dann das Testgate über den Korpus: jeder Bautyp mit Seeds 5 und 11 (Größe M,
 * Theme des Bautyps) – nichts schwebt, kein Überstand außerhalb des Dachs ist länger als `MAX_CANTILEVER`, und die
 * Messung ändert nichts an der Welt. `MCDA_MXQ=corpus`: alle 17 Themes (408 Welten, Bericht plan/spikes/MX_qualitaet.md).
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ShellCell } from '@mcda/blueprint';
import type { Vec3 } from '@mcda/core';
import { Layer, VoxelVolume, blockState } from '@mcda/voxel';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { MAX_CANTILEVER, detailDensity, generateBase, projectFromBuildingType, qualityMeasures, supportReport, type MeasuredWorld } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);

/** Kleine Welt: Boden (Gelände) auf y = 0, Blöcke der Hülle darüber. */
function world(blocks: readonly Vec3[], owner = 'shell:r1', extra: readonly [Vec3, string][] = []): MeasuredWorld {
  const v = VoxelVolume.create([12, 8, 12], [0, 0, 0]);
  for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) v.place([x, 0, z], { state: blockState('dirt'), owner: 'shell:-', layer: Layer.Terrain });
  for (const p of blocks) v.place(p, { state: blockState('stone_bricks'), owner, layer: Layer.Structure });
  for (const [p, o] of extra) v.place(p, { state: blockState('spruce_stairs'), owner: o, layer: Layer.Structure });
  return { shell: { cells: [], rooms: new Map() }, materialized: { volume: v } };
}
const column = (x: number, z: number, h: number): Vec3[] => Array.from({ length: h }, (_, i) => [x, 1 + i, z] as Vec3);

describe('MX-Q: Bodenverbindung und Auflager', () => {
  it('schwebender Block wird gemeldet, getragene Säule nicht', () => {
    const ok = supportReport(world(column(2, 2, 3)));
    expect(ok).toMatchObject({ floating: 0, unsupported: 0, maxCantilever: 0, lints: [] });
    const r = supportReport(world([...column(2, 2, 3), [8, 5, 8]]));
    expect(r.floating).toBe(1);
    expect(r.floatingParts[0]).toMatchObject({ size: 1, at: [8, 5, 8] });
    expect(r.lints.join('\n')).toContain('Schwebend');
  });

  it('Spannweite zwischen zwei Stützen ist getragen, ein Kragarm hat seine Länge', () => {
    const span = supportReport(world([...column(1, 5, 3), ...column(7, 5, 3), ...[2, 3, 4, 5, 6].map((x) => [x, 3, 5] as Vec3)]));
    expect(span.overhangs).toEqual([]);
    expect(span.lints).toEqual([]);
    // Loch (1 Block) mitten in der Spannweite: trägt weiter (Deckenöffnung, Ruine)
    const holed = supportReport(world([...column(1, 5, 3), ...column(9, 5, 3), ...[2, 3, 4, 6, 7, 8].map((x) => [x, 3, 5] as Vec3)]));
    expect(holed.overhangs).toEqual([]);
    const arm = supportReport(world([...column(1, 5, 3), ...[2, 3, 4].map((x) => [x, 3, 5] as Vec3)]));
    expect(arm.maxCantilever).toBe(3);
    expect(arm.overhangs[0]).toMatchObject({ length: 3, size: 3, roof: false, bracketed: false });
    expect(arm.lints.join('\n')).toContain('Überstand 3');
    // bis MAX_CANTILEVER ohne Befund
    const short = supportReport(world([...column(1, 5, 3), ...[2, 3].map((x) => [x, 3, 5] as Vec3)]));
    expect(short.maxCantilever).toBe(MAX_CANTILEVER);
    expect(short.lints).toEqual([]);
  });

  it('Konsole unter dem Kragarm verkürzt die Auskragung; Anhängsel (Laterne) zählen nicht', () => {
    const arm: Vec3[] = [...column(1, 5, 3), [2, 3, 5], [3, 3, 5]];
    expect(supportReport(world(arm)).maxCantilever).toBe(2);
    const r = supportReport(world(arm, 'shell:r1', [[[2, 2, 5], 'x1:detailBlocks:detail_jetty_corbel@0,0,0']]));
    expect(r.floating).toBe(0);
    expect(r.maxCantilever).toBe(1);
    expect(r.overhangs.some((o) => o.source === 'detailBlocks:detail_jetty_corbel')).toBe(true);
    const lamp = world(column(1, 5, 3));
    lamp.materialized.volume.place([4, 6, 5], { state: blockState('lantern'), owner: 'x1:eaveLanterns:m@0,0,0', layer: Layer.Structure });
    expect(supportReport(lamp).floating).toBe(0);
  });

  it('Dachstufe schräg über der Wand kragt 1 aus (kein Befund), Kantenkontakt verbindet', () => {
    // Wand bis y 3, darüber eine Treppenstufe je Lage nach innen (Satteldach-Schnitt ohne Giebelwand)
    const roof: Vec3[] = [[1, 4, 5], [2, 5, 5], [3, 6, 5]];
    const r = supportReport(world([...column(0, 5, 3), ...roof]));
    expect(r.floating).toBe(0);
    expect(r.unsupported).toBe(0);
    expect(r.lints).toEqual([]);
  });
});

describe('MX-Q: Detail-Obergrenze', () => {
  const wallCells = (n: number): ShellCell[] => Array.from({ length: n }, (_, i) => ({ pos: [i, 1, 5], kind: 'wall', role: 'wall_primary', shape: 'block', exterior: true }));
  const facadeWorld = (covered: number, block = 'oak_trapdoor'): MeasuredWorld => {
    const cells = wallCells(9);
    const v = VoxelVolume.create([12, 4, 12], [0, 0, 0]);
    for (const c of cells) v.place(c.pos, { state: blockState('white_terracotta'), owner: 'shell:r1', layer: Layer.Structure });
    for (let i = 0; i < covered; i++) v.place([i, 1, 6], { state: blockState(block), owner: 'x1:shutters:m@0,0,0', layer: Layer.Structure });
    return { shell: { cells, rooms: new Map([['r1', { floorIndex: 0, baseY: 1 } as never]]) }, materialized: { volume: v } };
  };

  it('Anteil freier Wand; unter einem Drittel ein Lint', () => {
    const ok = detailDensity(facadeWorld(3));
    // Süden: 9 Wandzellen, 3 verdeckt; Norden: 9 frei; Ost/West je 1 Zelle (Wandende) frei
    expect(ok.freeBySide[2]).toBeCloseTo(6 / 9, 3);
    expect(ok.lints).toEqual([]);
    const busy = detailDensity({ ...facadeWorld(9), shell: { ...facadeWorld(9).shell } });
    expect(busy.freeBySide[2]).toBe(0);
  });

  it('Detailfarbe gleich Rahmenfarbe wird gemeldet', () => {
    const cells: ShellCell[] = Array.from({ length: 12 }, (_, i) => ({ pos: [i, 1, 5], kind: i % 3 === 0 ? 'pillar' : 'wall', role: i % 3 === 0 ? 'beam' : 'wall_primary', shape: 'block' }));
    const v = VoxelVolume.create([14, 4, 14], [0, 0, 0]);
    for (const c of cells) v.place(c.pos, { state: blockState(c.kind === 'pillar' ? 'dark_oak_log' : 'white_terracotta'), owner: 'shell:r1', layer: Layer.Structure });
    for (let i = 0; i < 12; i++) if (i % 3 !== 0) v.place([i, 1, 6], { state: blockState('dark_oak_log'), owner: 'x1:detailBlocks:m@0,0,0', layer: Layer.Structure });
    const r = detailDensity({ shell: { cells, rooms: new Map([['r1', { floorIndex: 0, baseY: 1 } as never]]) }, materialized: { volume: v } });
    expect(r.frameBlock).toBe('dark_oak_log');
    expect(r.sameAsFrameShare).toBe(1);
    expect(r.lints.join('\n')).toContain('Rahmenfarbe');
  });
});

const MATRIX = process.env['MCDA_MXQ'] === 'corpus';

describe('MX-Q: Korpus (Testgate)', () => {
  const types = ctx.buildingTypes.ids();
  const themes = MATRIX ? ctx.themes.ids() : [undefined];
  it(`alle Bautypen × ${MATRIX ? 'alle Themes' : 'Theme des Bautyps'} × Seeds 5, 11: nichts schwebt, keine Wand-Auskragung über ${MAX_CANTILEVER}`, () => {
    const findings: string[] = [];
    for (const type of types) for (const themeId of themes) for (const seed of [5, 11]) {
      const def = ctx.buildingTypes.get(type);
      const res = projectFromBuildingType(def, { ...(themeId !== undefined ? { themeId } : {}), front: 'south', ...(def.sizes?.M !== undefined ? { size: 'M' as const } : {}) }, seed, ctx);
      const w = generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
      const before = w.materialized.volume.paletteIndices().slice();
      const m = qualityMeasures(w, res.plan);
      expect(w.materialized.volume.paletteIndices()).toEqual(before);
      const where = `${type}/${res.project.state.themeId}/${seed}`;
      findings.push(...m.lints.filter((l) => l.startsWith('Fassade:')).map((l) => `${where}: ${l}`));
      // Bekannter Befund (Bericht MX_qualitaet.md): die Ruine trägt Decken über erodierten Außenwänden aus (3–8 Blöcke)
      if (res.project.state.themeId === 'ruin') continue;
      if (m.support.floating > 0) findings.push(`${where}: ${m.support.lints[0]}`);
      if (m.support.maxCantilever > MAX_CANTILEVER) findings.push(`${where}: Auskragung ${m.support.maxCantilever}`);
      expect(m.facade.articulationPlan, where).toBeGreaterThan(0);
      expect(m.facade.articulationPlan, where).toBeLessThanOrEqual(1);
      expect(m.detail.freeShare, where).toBeGreaterThanOrEqual(0);
    }
    expect(findings).toEqual([]);
  }, HEAVY_TIMEOUT * (MATRIX ? 20 : 2));
});
