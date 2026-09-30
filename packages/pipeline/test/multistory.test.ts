import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, type Shell, type StairTurn, type StairType } from '@mcda/blueprint';
import { CellSet, type Cell, type HorizontalDir } from '@mcda/core';
import { exportFile, importFile } from '@mcda/export/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generate, placedFor, toExport, twoStoryHouse, type World } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const STEP: Readonly<Record<HorizontalDir, Cell>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** Räume, die vom Haupteingang über Türen (je Etage) und Treppen (gleiche linkId) erreichbar sind. */
function reachable(shell: Shell): Set<string> {
  const groups = new Map<string, string[]>();
  let main: string | undefined;
  for (const [id, r] of shell.rooms) {
    for (const d of r.doors) {
      const k = `${r.floorIndex}:${d.inside[0] + STEP[d.toward][0]},${d.inside[1] + STEP[d.toward][1]}`;
      groups.set(k, [...(groups.get(k) ?? []), id]);
      if (d.isMain) main = id;
    }
    for (const s of r.stairs ?? []) groups.set(s.linkId, [...(groups.get(s.linkId) ?? []), id]);
  }
  const seen = new Set<string>(main !== undefined ? [main] : []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of groups.values()) if (g.some((r) => seen.has(r))) for (const r of g) if (!seen.has(r)) (seen.add(r), (grew = true));
  }
  return seen;
}

/** Gemeinsame Abnahme: 0 harte Verstöße, 0 Spawn-Zellen, alles erreichbar, Treppe und Zugänge frei von Möbeln. */
function accept(project: Project, world: World & { warnings: string[] }): void {
  expect(world.warnings, world.warnings.join('\n')).toEqual([]);
  const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
  expect(hard, JSON.stringify(hard.slice(0, 5), null, 1)).toEqual([]);
  expect(world.materialized.light.darkCells).toEqual([]);
  expect(world.materialized.violations.filter((v) => v.kind === 'spawn')).toEqual([]);
  expect([...reachable(world.shell)].sort()).toEqual(project.state.rooms.map((r) => r.id).sort());
  for (const p of project.state.placements) {
    const info = world.shell.rooms.get(p.roomId)!;
    const access = new Set((info.stairs ?? []).map((s) => `${s.inside[0]},${s.inside[1]}`));
    for (const c of placedFor(p, ctx.catalog).cells) {
      expect(info.blocked?.has(c.pos[0], c.pos[2]), `${p.componentId} (${p.id}) auf Treppe/Öffnung bei ${c.pos}`).toBe(false);
      if (c.pos[1] <= info.baseY + 1 && !placedFor(p, ctx.catalog).expanded.walkable) {
        expect(access.has(`${c.pos[0]},${c.pos[2]}`), `${p.componentId} (${p.id}) im Treppenzugang ${c.pos}`).toBe(false);
      }
    }
  }
  // Treppenblöcke sind wirklich gebaut: Stufen, Unterbau, Geländer
  const vol = world.materialized.volume;
  for (const c of world.shell.cells) {
    if (c.kind === 'stairs' && c.shape !== 'ladder') expect(vol.stateAt(c.pos).name, `Treppe ${c.pos}`).toMatch(c.shape === 'stairs' ? /_stairs$/ : /_(planks|log|wood)$/);
    if (c.kind === 'railing') expect(vol.stateAt(c.pos).name, `Geländer ${c.pos}`).toMatch(/_fence$/);
  }
}

describe('Pipeline: zweistöckiges Beispielhaus (Etagen, Treppe, Pultdach)', () => {
  for (const version of ['1.21.11', '26.3'] as const) {
    for (const theme of ctx.themes.ids()) {
      it(`${version} · ${theme}: alle Etagen eingerichtet und beleuchtet, begehbar, mob-sicher, exportierbar`, () => {
        const project = twoStoryHouse(version, theme);
        const world = generate(project, ctx, { roof: 'hip' });
        accept(project, world);
        expect(new Set(project.state.rooms.map((r) => r.floorIndex))).toEqual(new Set([0, 1]));
        // jede Raumart hat ihre Pflichtobjekte, auch oben
        for (const room of project.state.rooms) {
          const rt = ctx.catalog.roomType(room.roomTypeId);
          const tags = project.state.placements.filter((p) => p.roomId === room.id).flatMap((p) => ctx.catalog.get(p.componentId).tags);
          for (const req of rt.required) expect(req.tags.some((t) => tags.includes(t)), `${room.id} ${room.roomTypeId}: ${req.tags}`).toBe(true);
        }
        const upstairs = project.state.placements.filter((p) => project.room(p.roomId).floorIndex === 1);
        expect(upstairs.length).toBeGreaterThan(10);
        expect(upstairs.every((p) => p.pose.pos[1] >= 5)).toBe(true);
        const ev = toExport(project, world);
        for (const fmt of ['nbt', 'schem', 'litematic'] as const) expect(importFile(fmt, exportFile(fmt, ev)).blocks.length, fmt).toBe(ev.blocks.length);
      });
    }
  }

  it('Satteldach: ebenfalls 0 Verstöße, Giebelwände gebaut', () => {
    for (const version of ['1.21.11', '26.3'] as const) {
      const project = twoStoryHouse(version, 'medieval');
      const world = generate(project, ctx, { roof: 'gable' });
      accept(project, world);
      const gable = world.shell.cells.filter((c) => c.kind === 'wall' && c.pos[1] > 8);
      expect(gable.length).toBeGreaterThan(10);
    }
  });
});

describe('Pipeline: Treppenarten in einer zweistöckigen Halle', () => {
  const cases: ReadonlyArray<readonly [StairType, Cell, HorizontalDir, StairTurn | undefined]> = [
    ['l', [3, 6], 'east', 'left'],
    ['u', [3, 5], 'east', 'right'],
    ['spiral', [4, 5], 'north', 'right'],
    // Leiter (I2: Rolle `ladder` in allen Themes, Stützregel „volle Fläche dahinter“): an Pfosten bzw. Außenwand
    ['ladder', [5, 5], 'north', undefined],
    ['ladder', [5, 1], 'north', undefined],
  ];
  for (const [type, origin, facing, turn] of cases) {
    it(`${type} ${origin.join(',')}: 0 harte Verstöße, 0 Spawn-Zellen, oben erreichbar`, { timeout: HEAVY_TIMEOUT }, () => {
      for (const version of ['1.21.11', '26.3'] as const) {
        const p = Project.create({ id: 'hall', name: 'Halle', seed: 11, themeId: 'rustic', targetVersion: TARGET_VERSIONS[version] });
        p.paintRoom(0, CellSet.rect(0, 0, 12, 10), 'storage');
        p.addFloor();
        p.paintRoom(1, CellSet.rect(0, 0, 12, 10), 'library');
        p.placeStairs(0, origin, facing, type, turn !== undefined ? { turn } : {});
        const world = generate(p, ctx, { roof: 'hip' });
        accept(p, world);
        if (type === 'ladder') {
          const ladders = world.shell.cells.filter((c) => c.shape === 'ladder');
          expect(ladders.length).toBeGreaterThan(0);
          for (const c of ladders) expect(world.materialized.volume.stateAt(c.pos), `${c.pos}`).toMatchObject({ name: 'ladder', properties: { facing: 'south' } });
        }
      }
    });
  }
});
