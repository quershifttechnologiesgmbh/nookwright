import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, type Placement } from '@mcda/blueprint';
import { CellSet, resolveRelDir, type HorizontalDir } from '@mcda/core';
import { analyzeRoom, neighbor } from '@mcda/furnishing';
import { WorldView, materialize } from '@mcda/materialize';
import { isLightFixture, lightBudget } from '@mcda/catalog';
import { furnishRooms, generate, lightRooms, placedFor, shellFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const VERSIONS = ['1.21.11', '26.3'] as const;

/** Beispielhaus wie in pipeline.test.ts; `height` = lichte Höhe der Etage (Standard 3). */
function house(version: keyof typeof TARGET_VERSIONS, themeId: string, seed = 2026, height = 3): Project {
  const p = Project.create({ id: 'sample', name: 'Beispielhaus', seed, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
  p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
  return p;
}

/** Platzierungen, die der Licht-Pass ergänzt hat (Event `FurnishingSupplemented`). */
function supplemented(p: Project): Placement[] {
  const ids = new Set(p.history.flatMap((e) => (e.type === 'FurnishingSupplemented' ? e.placements.map((x) => x.id) : [])));
  return p.state.placements.filter((x) => ids.has(x.id));
}

describe('Licht-Pass: Beispielhaus – 0 Spawn-Zellen in allen Räumen, allen Themes, beiden Versionen', () => {
  for (const version of VERSIONS) {
    for (const theme of ctx.themes.ids()) {
      for (const height of [3, 2]) {
        it(`${version} · ${theme} · lichte Höhe ${height}`, () => {
          const p = house(version, theme, 2026, height);
          const world = generate(p, ctx, { roof: 'hip' });
          expect(world.warnings, world.warnings.join('\n')).toEqual([]);
          expect(world.materialized.light.darkCells).toEqual([]);
          expect(world.materialized.violations.filter((v) => v.kind === 'spawn')).toEqual([]);
          const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
          expect(hard, JSON.stringify(hard.slice(0, 5), null, 1)).toEqual([]);
          // Stimmungs-Ziel je Raumtyp erreicht (Schlafzimmer ≥ 7, Küche ≥ 8, Lager ≥ 4, Schmiede ≥ 9)
          const rooms = world.lighting!.rooms;
          expect(rooms).toHaveLength(4);
          for (const r of rooms) {
            const rt = ctx.catalog.roomType(p.room(r.roomId).roomTypeId);
            expect(r.target).toBe(rt.lighting?.minLevel ?? 1);
            expect(r, `${rt.id}: ${JSON.stringify(r)}`).toMatchObject({ darkCells: 0, belowTarget: 0 });
            expect(r.minLevel).toBeGreaterThanOrEqual(r.target);
          }
          expect(world.lighting!.notes).toEqual([]);
        });
      }
    }
  }
});

describe('Licht-Pass ergänzt, wo es nötig ist', () => {
  it('niedrige Decke (keine Deckenlaternen möglich): ohne Pass viele dunkle Zellen, mit Pass keine', () => {
    for (const version of VERSIONS) {
      const off = generate(house(version, 'medieval', 2026, 2), ctx, { lighting: false });
      // Seit dem korrigierten Lichtmodell (Türen/Scheiben/Leuchtblöcke leiten Licht, T5) sind es wenige, aber > 0.
      expect(off.materialized.light.darkCells.length).toBeGreaterThan(0);
      expect(off.lighting).toBeUndefined();
      const p = house(version, 'medieval', 2026, 2);
      const on = generate(p, ctx);
      expect(on.materialized.light.darkCells).toEqual([]);
      const added = supplemented(p);
      expect(added.length).toBeGreaterThanOrEqual(4);
      expect(added.every((x) => x.origin === 'auto' && !x.locked)).toBe(true);
      expect(added.every((x) => ctx.catalog.get(x.componentId).functionTags?.includes('light'))).toBe(true);
    }
  });

  it('Wandlichter des Passes: vor fester Wand, Rücken zur Wand, nie in Türzone oder vor Fenster', () => {
    let walls = 0;
    for (const theme of ctx.themes.ids()) {
      for (const seed of [1, 2, 3]) {
        const p = house('26.3', theme, seed, 2);
        const world = generate(p, ctx);
        for (const pl of supplemented(p)) {
          if (ctx.catalog.get(pl.componentId).mount !== 'wall') continue;
          walls++;
          const g = world.shell.rooms.get(pl.roomId)!;
          const a = analyzeRoom(g);
          const back = resolveRelDir('back', pl.pose) as HorizontalDir;
          const cell = [pl.pose.pos[0], pl.pose.pos[2]] as const;
          expect(pl.pose.pos[1]).toBe(g.baseY + 1);
          expect(a.info.get(`${cell[0]},${cell[1]}`)?.solidWalls).toContain(back);
          expect(a.doorZone.has(cell[0], cell[1])).toBe(false);
          expect(g.windows.some((w) => w.inside[0] === cell[0] && w.inside[1] === cell[1])).toBe(false);
          const behind = neighbor(cell, back);
          expect(g.interior.has(behind[0], behind[1])).toBe(false);
        }
      }
    }
    expect(walls).toBeGreaterThan(10);
  });

  it('Schlafzimmer (prefer: candles): Kerzen landen auf vorhandenen Abstellflächen, als Kind mit Socket', () => {
    let candles = 0;
    for (const theme of ctx.themes.ids()) {
      for (const seed of [2026, 1, 2, 3, 4]) {
        const p = house('1.21.11', theme, seed, 2);
        generate(p, ctx);
        for (const pl of supplemented(p).filter((x) => x.componentId === 'decor/candles')) {
          candles++;
          const parent = p.placement(pl.parentId!);
          expect(parent.roomId).toBe(pl.roomId);
          expect(pl.socketId).toBeDefined();
          expect(placedFor(parent, ctx.catalog).sockets.some((s) => s.def.id === pl.socketId && s.pos?.join() === pl.pose.pos.join())).toBe(true);
        }
      }
    }
    expect(candles).toBeGreaterThan(3);
  });

  it('mood: false → nur Spawn-Schutz (weniger Lichter), trotzdem 0 dunkle Zellen', () => {
    const moody = house('1.21.11', 'rustic', 7, 2);
    const plain = house('1.21.11', 'rustic', 7, 2);
    const a = generate(moody, ctx);
    const b = generate(plain, ctx, { lighting: { mood: false } });
    expect(b.materialized.light.darkCells).toEqual([]);
    expect(b.lighting!.rooms.every((r) => r.target === 1)).toBe(true);
    expect(supplemented(plain).length).toBeLessThan(supplemented(moody).length);
    expect(a.lighting!.rooms.some((r) => r.target > 1)).toBe(true);
  });
});

describe('W3-IN (I7): Licht-Budget und bevorzugte Lichtpunkte im Licht-Pass', () => {
  it('je Raum höchstens das Budget an Leuchten (Spawn-Schutz ausgenommen), Abstell-/Hängelichter nur an Ankern, 0 dunkle Zellen', () => {
    for (const version of VERSIONS) {
      for (const theme of ['medieval', 'rustic', 'nordic']) {
        const p = house(version, theme);
        const world = generate(p, ctx, { roof: 'hip' });
        expect(world.materialized.light.darkCells).toEqual([]);
        const byId = new Map(p.state.placements.map((x) => [x.id, x]));
        for (const room of p.state.rooms) {
          const rt = ctx.catalog.roomType(room.roomTypeId);
          const info = world.shell.rooms.get(room.id)!;
          const area = info.interior.difference(info.blocked ?? CellSet.empty()).size;
          const fixtures = p.state.placements.filter((x) => x.roomId === room.id && isLightFixture(ctx.catalog.get(x.componentId)));
          // Ergänzungen über dem Budget gibt es nur für den Spawn-Schutz – und der braucht im Beispielhaus keine
          expect(fixtures.length, `${theme} ${rt.id}: ${fixtures.map((f) => f.componentId).join(', ')}`).toBeLessThanOrEqual(lightBudget(rt.lighting, area));
          const anchors = rt.lighting?.anchors;
          if (anchors === undefined) continue;
          for (const f of fixtures.filter((x) => x.parentId !== undefined)) {
            const host = byId.get(f.parentId!)!;
            expect(ctx.catalog.get(host.componentId).tags.some((t) => anchors.includes(t)), `${theme} ${rt.id}: ${f.componentId} auf ${host.componentId}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('Licht-Pass: Determinismus, Neu-Würfeln, Sperren', () => {
  const snapshot = (p: Project) => JSON.stringify(p.state.placements);

  it('gleicher Seed → gleiche Lichter; anderer Seed → andere', () => {
    const run = (seed: number) => {
      const p = house('26.3', 'nordic', seed, 2);
      generate(p, ctx);
      return snapshot(p);
    };
    expect(run(11)).toBe(run(11));
    expect(run(11)).not.toBe(run(12));
  });

  it('Neu-Würfeln ersetzt die ergänzten Lichter, gesperrte bleiben; erneuter Pass hält den Raum hell', () => {
    const p = house('1.21.11', 'medieval', 2026, 2);
    const shell = shellFor(p);
    furnishRooms(p, shell, ctx.catalog);
    lightRooms(p, shell, ctx);
    // W3 (27.09.2026): Licht-Budget und Lichtpunkte (I7) – im Schlafzimmer landen die Ergänzungen jetzt auf dem
    // Nachttisch (Kinder); geprüft wird der erste Raum mit einem frei hängenden bzw. an der Wand ergänzten Licht
    const bedroom = p.state.rooms.find((r) => supplemented(p).some((x) => x.roomId === r.id && x.parentId === undefined))!;
    const lights = supplemented(p).filter((x) => x.roomId === bedroom.id);
    expect(lights.length).toBeGreaterThan(0);
    const keep = lights.find((x) => x.parentId === undefined)!;
    p.lockPlacement(keep.id);
    p.rerollRoom(bedroom.id);
    furnishRooms(p, shell, ctx.catalog, [bedroom.id]);
    const survivors = p.state.placements.filter((x) => x.roomId === bedroom.id && lights.some((l) => l.id === x.id));
    expect(survivors.map((x) => x.id)).toEqual([keep.id]);
    const again = lightRooms(p, shell, ctx, { roomIds: [bedroom.id] });
    expect(again.rooms).toEqual([expect.objectContaining({ roomId: bedroom.id, darkCells: 0, belowTarget: 0 })]);
    expect(again.world.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
  });

  it('ohne Bedarf ergänzt der Pass nichts (keine zusätzliche Materialisierung)', () => {
    const p = house('1.21.11', 'medieval', 2026, 3);
    const shell = shellFor(p);
    furnishRooms(p, shell, ctx.catalog);
    lightRooms(p, shell, ctx);
    const before = p.history.length;
    const second = lightRooms(p, shell, ctx);
    expect(second.rounds).toBe(0);
    expect(p.history.length).toBe(before);
  });
});

describe('walkable im Katalog stimmt mit der Physik überein (beide Versionen, alle Themes)', () => {
  it('jede walkable-Komponente besteht nur aus durchlaufbaren Blöcken (air/thin/flat)', () => {
    const walkable = ctx.catalog.all().filter((d) => d.walkable === true);
    expect(walkable.map((d) => d.id)).toEqual(expect.arrayContaining(['light/wall_torch', 'light/soul_wall_torch', 'light/copper_wall_torch']));
    const empty = { cells: [], rooms: new Map(), warnings: [] };
    for (const version of VERSIONS) {
      const platform = ctx.platform(version);
      for (const theme of ctx.themes.ids()) {
        for (const def of walkable) {
          for (const variantId of def.variants?.map((v) => v.id) ?? [undefined]) {
            const placed = placedFor({ id: 'x', roomId: 'r', componentId: def.id, ...(variantId !== undefined ? { variantId } : {}), pose: { pos: [0, 0, 0], rot: 0, mirror: 'none' }, seed: 1, locked: false, origin: 'auto' }, ctx.catalog);
            const r = materialize({ shell: empty, placements: [{ id: 'x', placed }], theme: ctx.themes.get(theme), platform, seed: 1 });
            const view = new WorldView(r.volume, platform);
            for (const c of r.volume.cells()) {
              expect(['air', 'thin', 'flat'], `${def.id} ${c.state.name} (${version})`).toContain(view.physicsOf(c.state).cls);
            }
          }
        }
      }
    }
  });

  it('nicht-walkable Lichter mit Zellen in Laufhöhe haben dort wirklich Kollision (Wandlaterne, Stehlampe)', () => {
    const platform = ctx.platform('26.3');
    const empty = { cells: [], rooms: new Map(), warnings: [] };
    for (const [id, variantId] of [['light/wall_lantern', 'fence'], ['light/wall_lantern', 'bars'], ['light/floor_lamp', 'short']] as const) {
      const placed = placedFor({ id: 'x', roomId: 'r', componentId: id, variantId, pose: { pos: [0, 0, 0], rot: 0, mirror: 'none' }, seed: 1, locked: false, origin: 'auto' }, ctx.catalog);
      const r = materialize({ shell: empty, placements: [{ id: 'x', placed }], theme: ctx.themes.get('medieval'), platform, seed: 1 });
      const view = new WorldView(r.volume, platform);
      expect(['air', 'thin', 'flat'], id).not.toContain(view.physicsOf(r.volume.stateAt([0, 0, 0])).cls);
    }
  });
});
