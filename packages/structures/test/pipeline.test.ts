import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { buildWorld, furnishRooms, shellFor } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { buildStructures, type StructuresInput } from '../src/index.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

/** Beispielhaus wie in @mcda/pipeline (Küche, Schlafzimmer, Lager, Schmiede; x 0–22, z 0–11). */
function sampleHouse(version: keyof typeof TARGET_VERSIONS, themeId: string): Project {
  const p = Project.create({ id: 'sample', name: 'Beispielhaus', seed: 2026, themeId, targetVersion: TARGET_VERSIONS[version] });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
  p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
  return p;
}

/**
 * Türme, Windmühle und Gartenmauern (research/18 §5, Z2) rund um das Beispielhaus: alle Dachformen, alle neuen
 * Abschlüsse, Turmspitzen, Glockenfuß, Zauntor, offene Lücke, Laternen und Hecke.
 */
const SHOWCASE: StructuresInput = {
  towers: [
    { center: [-10, -2], shape: 'square', size: 7, top: 'roof', roofShape: 'helm', finial: 'lantern', levels: 2 },
    { center: [-10, 14], shape: 'square', size: 7, top: 'belfry', roofShape: 'spire', finial: 'spike', levels: 3 },
    { center: [34, -2], shape: 'round', top: 'lookout', roofShape: 'bell', levels: 3 },
    { center: [34, 14], shape: 'round', top: 'platform', levels: 2 },
    { center: [11, -14], shape: 'round', top: 'roof', flare: true, finial: 'pole', levels: 2 },
    { center: [11, 26], shape: 'square', size: 9, top: 'lookout', roofShape: 'tent', finial: 'lantern', levels: 2 },
    { center: [-10, 30], shape: 'round', top: 'belfry', roofShape: 'bell', levels: 2 },
  ],
  windmills: [{ center: [50, 5], facing: 'west' }, { center: [50, 30], shape: 'square', size: 9, facing: 'south', sailLength: 6, sailWidth: 3 }],
  walls: [
    { profile: 'garden', points: [[-2, -5], [24, -5]], gates: [{ at: [11, -5], width: 1 }], garden: { lanterns: true } },
    { profile: 'garden', points: [[-2, 16], [24, 16], [24, 20]], gates: [{ at: [6, 16], width: 3 }, { at: [16, 16], width: 2 }], garden: { hedge: true } },
  ],
};

/**
 * O1: senkrecht und hängend – Blitzableiter/Endstab als Spitze, Glocke im Glockenstuhl (ceiling), hängende Laternen
 * unter der Traufe (Dach, Aussichts- und Glockenstube, Windmühlen-Kappe), dazu Mauertürme mit demselben Stil.
 */
const SHOWCASE_O1: StructuresInput = {
  towers: [
    { center: [-10, -2], shape: 'square', size: 7, top: 'belfry', roofShape: 'helm', bell: 'hanging', finial: 'rod', hangingLanterns: true, levels: 2 },
    { center: [-10, 14], shape: 'round', top: 'belfry', roofShape: 'bell', bell: 'hanging', finial: 'end_rod', levels: 3, door: 'east' },
    { center: [34, -2], shape: 'round', top: 'lookout', hangingLanterns: true, finial: 'end_rod', levels: 2 },
    { center: [34, 14], shape: 'square', size: 7, top: 'roof', roofShape: 'spire', hangingLanterns: true, finial: 'rod', levels: 2 },
    { center: [11, -14], shape: 'square', size: 9, top: 'lookout', roofShape: 'tent', hangingLanterns: true, finial: 'rod', levels: 2 },
    { center: [11, 28], shape: 'round', top: 'roof', flare: true, hangingLanterns: true, finial: 'rod', levels: 2 },
  ],
  windmills: [{ center: [52, 5], facing: 'east', finial: 'rod', hangingLanterns: true }],
  walls: [{
    points: [[-24, -24], [-24, 40], [70, 40], [70, -24]], closed: true, towerSpacing: 0, gates: [{ at: [23, 40] }],
    towerStyle: { shape: 'square', top: 'belfry', roofShape: 'tent', bell: 'hanging', hangingLanterns: true, finial: 'rod' },
  }],
};

/** Mauerring mit 4 Ecktürmen und Tor um das Beispielhaus. */
const FORT: StructuresInput = {
  walls: [{ points: [[-8, -8], [30, -8], [30, 19], [-8, 19]], closed: true, towerSpacing: 0, gates: [{ at: [11, 19] }] }],
};

describe('Vertrag: Bauwerke über buildWorld(…, extraCells) materialisiert', () => {
  for (const version of ['1.21.11', '26.3'] as const) {
    for (const theme of ctx.themes.ids()) {
      it(`${version} · ${theme}: Beispielhaus + Mauerring + 4 Türme ohne harte Verstöße`, () => {
        const project = sampleHouse(version, theme);
        const shell = shellFor(project);
        furnishRooms(project, shell, ctx.catalog);
        const fort = buildStructures(FORT, { seed: project.state.seed });
        expect(fort.warnings).toEqual([]);
        expect(fort.towers).toHaveLength(4);
        const world = buildWorld(project, ctx, shell, fort.cells);
        const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
        expect(hard, JSON.stringify(hard.slice(0, 5), null, 1)).toEqual([]);
        // jede Bauwerkszelle ist als Block angekommen (Struktur-Schicht, eigene Herkunft)
        const v = world.materialized.volume;
        for (const c of fort.cells) {
          const got = v.cell(c.pos);
          expect(got?.state.name, c.pos.join(',')).toMatch(/^(?!(minecraft:)?(cave_|void_)?air$)/);
          expect(got?.owner).toBe(`shell:${c.roomId}`);
        }
        // Stichproben der Rollen: Tür, Fenster, Dachtreppe, Wendeltreppen-Säule
        const names = new Set(fort.cells.map((c) => v.stateAt(c.pos).name));
        expect([...names].some((n) => n.endsWith('_door'))).toBe(true);
        expect([...names].some((n) => n.endsWith('_pane') || n.endsWith('_bars'))).toBe(true); // Scharten
        expect([...names].some((n) => n.endsWith('_stairs'))).toBe(true);
        expect([...names].some((n) => n.endsWith('_log') || n.endsWith('_stem'))).toBe(true);
      });
    }
  }

  for (const version of ['1.21.11', '26.3'] as const) {
    for (const theme of ctx.themes.ids()) {
      it(`${version} · ${theme}: Dachformen, Stuben, Windmühlen und Gartenmauern ohne harte Verstöße (Glocke, Laternen, Flügel gestützt)`, () => {
        const project = sampleHouse(version, theme);
        const shell = shellFor(project);
        furnishRooms(project, shell, ctx.catalog);
        const fort = buildStructures(SHOWCASE, { seed: project.state.seed });
        expect(fort.warnings).toEqual([]);
        const world = buildWorld(project, ctx, shell, fort.cells);
        // Physik-Report der Materialisierung: Stütze (Glocke, Laternen, Türen), Schwerkraft, Autotiling, Merge
        const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
        expect(hard, JSON.stringify(hard.slice(0, 5), null, 1)).toEqual([]);
        const v = world.materialized.volume;
        for (const c of fort.cells) expect(v.cell(c.pos)?.owner, c.pos.join(',')).toBe(`shell:${c.roomId}`);
        const names = new Set(fort.cells.map((c) => v.stateAt(c.pos).name));
        for (const n of ['bell', 'white_wool']) expect(names.has(n), n).toBe(true);
        for (const suffix of ['lantern', '_fence', '_fence_gate', '_slab', '_leaves', '_log']) expect([...names].some((n) => n.endsWith(suffix)), suffix).toBe(true);
        // Glocke steht auf dem Boden (Bodenbefestigung) über einem vollen Block, Laternen stehen (nicht hängend)
        for (const t of fort.towers.filter((t) => t.bell !== undefined)) {
          expect(v.stateAt(t.bell!).properties['attachment']).toBe('floor');
        }
        for (const c of fort.cells.filter((c) => c.shape === 'lantern')) expect(v.stateAt(c.pos).properties['hanging']).toBe('false');
        // liegende Ruten und Achsen behalten ihre Achse
        const axes = new Set(fort.cells.filter((c) => c.role === 'beam' && c.shape === 'log').map((c) => v.stateAt(c.pos).properties['axis']));
        expect([...axes].sort()).toEqual(['x', 'y', 'z']);
      });
    }
  }

  for (const version of ['1.21.11', '26.3'] as const) {
    for (const theme of ctx.themes.ids()) {
      it(`${version} · ${theme}: O1 Blitzableiter/Endstab, hängende Glocken und Laternen ohne harte Verstöße`, () => {
        const project = sampleHouse(version, theme);
        const shell = shellFor(project);
        furnishRooms(project, shell, ctx.catalog);
        const fort = buildStructures(SHOWCASE_O1, { seed: project.state.seed });
        expect(fort.warnings).toEqual([]);
        const world = buildWorld(project, ctx, shell, fort.cells);
        // Physik-Report: hängende Laterne (stabile Mitte darüber), Deckenglocke (stabile Mitte darüber), Merge, Autotiling
        const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
        expect(hard, JSON.stringify(hard.slice(0, 5), null, 1)).toEqual([]);
        const v = world.materialized.volume;
        for (const c of fort.cells) expect(v.cell(c.pos)?.owner, c.pos.join(',')).toBe(`shell:${c.roomId}`);
        // Glocken hängen (auch an den 4 Mauertürmen), alle Laternen hängen an einer Kette
        const bells = fort.towers.filter((t) => t.bell !== undefined);
        expect(bells).toHaveLength(6);
        for (const t of bells) expect(v.stateAt(t.bell!).properties, t.id).toMatchObject({ attachment: 'ceiling' });
        const lanterns = fort.cells.filter((c) => c.shape === 'lantern');
        expect(lanterns.length).toBeGreaterThanOrEqual(30);
        for (const c of lanterns) {
          expect(v.stateAt(c.pos).properties['hanging'], c.pos.join(',')).toBe('true');
          expect(v.stateAt([c.pos[0], c.pos[1] + 1, c.pos[2]]).name).toMatch(/chain$/);
        }
        // Spitzen: gewachster Blitzableiter bzw. Endstab, Spitze nach oben, auf einem Zaun
        const tips = fort.cells.filter((c) => c.role === 'finial');
        expect(tips).toHaveLength(11); // 6 Türme, 1 Windmühle, 4 Mauertürme
        for (const c of tips) {
          const s = v.stateAt(c.pos);
          expect(s.name).toMatch(c.shape === 'end_rod' ? /^end_rod$/ : /^waxed_.*lightning_rod$/);
          expect(s.properties['facing']).toBe('up');
          expect(v.stateAt([c.pos[0], c.pos[1] - 1, c.pos[2]]).name).toMatch(/_fence$/);
        }
      });
    }
  }

  it('freistehende Türme (rund mit Kegeldach, eckig mit Zinnen) neben dem Haus', () => {
    const project = sampleHouse('26.3', 'medieval');
    const shell = shellFor(project);
    furnishRooms(project, shell, ctx.catalog);
    const fort = buildStructures({
      towers: [
        { center: [-8, 5], shape: 'round', levels: 4, roofPitch: 2 },
        { center: [32, 5], shape: 'square', levels: 3, top: 'battlements' },
        { center: [11, -10], shape: 'square', levels: 2, top: 'roof', roofPitch: 1, door: 'north' },
      ],
    }, { seed: 1 });
    expect(fort.warnings).toEqual([]);
    const world = buildWorld(project, ctx, shell, fort.cells);
    const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
    expect(hard, JSON.stringify(hard.slice(0, 5), null, 1)).toEqual([]);
  });
});
