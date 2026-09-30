import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { exportFile, importFile } from '@mcda/export/node';
import { generate, toExport } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { sampleHouse } from './helpers.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));


describe('Pipeline: Malen → Hülle → Einrichtung → Blöcke → Export', () => {
  for (const version of ['1.21.11', '26.3'] as const) {
    for (const theme of ctx.themes.ids()) {
      it(`${version} · ${theme}: vollständig, physikalisch gültig, exportierbar`, () => {
        const project = sampleHouse(version, theme);
        const world = generate(project, ctx, { roof: 'hip' });
        expect(world.warnings, world.warnings.join('\n')).toEqual([]);
        // jede Raumart hat ihre Pflichtobjekte
        for (const room of project.state.rooms) {
          const rt = ctx.catalog.roomType(room.roomTypeId);
          const tags = project.state.placements.filter((p) => p.roomId === room.id).flatMap((p) => ctx.catalog.get(p.componentId).tags);
          for (const req of rt.required) expect(req.tags.some((t) => tags.includes(t)), `${room.roomTypeId}: ${req.tags}`).toBe(true);
        }
        const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
        expect(hard, JSON.stringify(hard.slice(0, 5), null, 1)).toEqual([]);
        // mob-sicher nach dem Licht-Pass: keine begehbare Zelle mit Blocklicht 0
        expect(world.materialized.light.darkCells).toEqual([]);
        expect(world.materialized.violations.filter((v) => v.kind === 'spawn')).toEqual([]);
        // Export-Round-Trip in allen Formaten
        const ev = toExport(project, world);
        expect(ev.blocks.length).toBeGreaterThan(500);
        for (const fmt of ['nbt', 'schem', 'litematic'] as const) {
          const back = importFile(fmt, exportFile(fmt, ev));
          expect(back.blocks.length, fmt).toBe(ev.blocks.length);
        }
      });
    }
  }

  it('Varianz (research/12): Boden je Raumtyp, Bordüre, Steinverlauf außen, Putz innen, Balkendecke', () => {
    const project = sampleHouse('26.3', 'medieval');
    const world = generate(project, ctx, { roof: 'hip' });
    const vol = world.materialized.volume;
    const shell = world.shell;
    const floorOf = (type: string) => {
      const room = project.state.rooms.find((r) => r.roomTypeId === type)!;
      return [...shell.rooms.get(room.id)!.interior].map(([x, z]) => vol.stateAt([x, 0, z]).name);
    };
    const P7 = /^(smooth_stone|polished_andesite|stone|stone_bricks|cobblestone|tuff|mossy_stone_bricks|cracked_stone_bricks|mossy_cobblestone)$/;
    for (const n of [...floorOf('kitchen'), ...floorOf('smithy')]) expect(n).toMatch(P7);
    // W4 (27.09.2026, Review M7): Lager im Erdgeschoss mit Dielen und Bordüre, kein Erdboden (Lehm nur Stall/Keller)
    for (const n of floorOf('storage')) expect(n).toMatch(/_planks$|^dark_oak_(log|wood)$/);
    const bedroom = floorOf('bedroom');
    expect(bedroom.filter((n) => n === 'dark_oak_log' || n === 'dark_oak_wood').length).toBeGreaterThan(10); // Bordüre
    expect(new Set(bedroom).size).toBeGreaterThanOrEqual(3);
    // Außenwände: mehrere Blöcke, unten dunkler als oben
    const ext = shell.cells.filter((c) => c.kind === 'wall' && c.exterior === true);
    const names = ext.map((c) => vol.stateAt(c.pos).name);
    // W2 (26.09.2026): Regel W4 – Materialbudget: drei Grundblöcke (Steinziegel, Bruchstein am Fuß, Andesit oben)
    expect(new Set(names).size).toBeGreaterThanOrEqual(3);
    expect(new Set(names.map((n) => n.replace(/^(mossy|cracked)_/, ''))).size).toBeLessThanOrEqual(4);
    const dark = (y: number) => ext.filter((c) => c.pos[1] === y && /deepslate|tuff|cobble/.test(vol.stateAt(c.pos).name)).length / ext.filter((c) => c.pos[1] === y).length;
    expect(dark(1)).toBeGreaterThan(dark(3) + 0.2);
    // Innenwände: Vertäfelung unten, Putz darüber
    const inner = shell.cells.filter((c) => c.kind === 'wall' && c.exterior !== true);
    expect(inner.filter((c) => c.pos[1] === 1).every((c) => /spruce|dark_oak/.test(vol.stateAt(c.pos).name))).toBe(true);
    expect(inner.filter((c) => c.pos[1] >= 2).every((c) => /calcite|terracotta|mushroom_stem|diorite/.test(vol.stateAt(c.pos).name))).toBe(true);
    // Decke: Balken (dunkle Eiche) über jedem Raum
    const ceilingLogs = shell.cells.filter((c) => c.kind === 'ceiling' && vol.stateAt(c.pos).name === 'dark_oak_log').length;
    expect(ceilingLogs).toBeGreaterThan(60);
  });

  it('ist deterministisch (gleicher Seed → identischer Export), anderer Seed → andere Einrichtung', () => {
    const run = (seed: number) => {
      const p = sampleHouse('1.21.11', 'medieval', seed);
      return JSON.stringify(toExport(p, generate(p, ctx)).blocks, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });
});
