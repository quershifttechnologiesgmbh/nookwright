import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Catalog, parseComponentDef, parseRoomTypeDef, type ComponentDef, type RoomTypeDef } from '@mcda/catalog';
import { CellSet, cellKey, pose, resolveRelDir, type Cell, type HorizontalDir } from '@mcda/core';
import { RoomPlanner, analyzeRoom, expandComponent, furnishRoom, neighbor, placeComponent, type PlacedComponent, type RoomGeometry } from '../src/index.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json5') ? [p] : [];
  });
const unwrap = <T,>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T => {
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
};
const catalog = Catalog.of(
  walk(join(ROOT, 'components')).map((f) => unwrap(parseComponentDef(readFileSync(f, 'utf8'), f))),
  walk(join(ROOT, 'roomtypes')).map((f) => unwrap(parseRoomTypeDef(readFileSync(f, 'utf8'), f))),
);
const DV = 4671;

/** 7×5 mit Tür Süd, Fenster Nord und West (wie solver.test.ts, plus zweites Fenster). */
function rectRoom(height = 3): RoomGeometry {
  return {
    roomId: 'r1',
    baseY: 1,
    height,
    interior: CellSet.rect(0, 0, 6, 4),
    doors: [{ inside: [3, 4], toward: 'south', isMain: true }],
    windows: [{ inside: [3, 0], toward: 'north' }, { inside: [0, 2], toward: 'west' }],
  };
}

/** L-Raum mit zwei Türen (Innenecke: Zellen mit Wänden in zwei Richtungen). */
function lRoom(): RoomGeometry {
  return {
    roomId: 'r2',
    baseY: 1,
    height: 4,
    interior: CellSet.rect(0, 0, 6, 2).union(CellSet.rect(0, 3, 2, 6)),
    doors: [{ inside: [1, 6], toward: 'south', isMain: true }, { inside: [6, 1], toward: 'east', isMain: false }],
    windows: [{ inside: [4, 0], toward: 'north' }],
  };
}

/** Flur 1 × 6, Tür am Südende: jede blockierte Innenzelle (außer am Ende) zerteilt die Lauffläche. */
function corridor(): RoomGeometry {
  return {
    roomId: 'c',
    baseY: 1,
    height: 3,
    interior: CellSet.rect(0, 0, 0, 5),
    doors: [{ inside: [0, 5], toward: 'south', isMain: true }],
    windows: [],
  };
}

const at = (p: PlacedComponent): Cell => [p.pose.pos[0], p.pose.pos[2]];

/** Harte Garantien der Wand-Montage für eine Pose. */
function assertWallPose(g: RoomGeometry, p: PlacedComponent, wallHeight = 1): void {
  const a = analyzeRoom(g);
  const back = resolveRelDir('back', p.pose) as HorizontalDir;
  expect(p.pose.pos[1], 'Höhe').toBe(g.baseY + wallHeight);
  for (const c of p.cells.filter((x) => x.local[1] === 0)) {
    const cell: Cell = [c.pos[0], c.pos[2]];
    const behind = neighbor(cell, back);
    expect(g.interior.has(behind[0], behind[1]), `hinter ${cell} muss Wand sein`).toBe(false);
    expect(g.doors.some((d) => d.inside[0] === cell[0] && d.inside[1] === cell[1] && d.toward === back), 'Rücken zur Tür').toBe(false);
    expect(g.windows.some((w) => w.inside[0] === cell[0] && w.inside[1] === cell[1]), 'vor einem Fenster').toBe(false);
    expect(a.doorZone.has(cell[0], cell[1]), 'in der Türzone').toBe(false);
  }
}

describe('Wand-Montage (mount: wall)', () => {
  const torch = catalog.get('light/wall_torch');
  const lantern = catalog.get('light/wall_lantern');

  it('Wandfackel: jede Pose steht vor fester Wand, Rücken zur Wand, y = baseY + 1, nie vor Tür/Fenster', () => {
    for (const g of [rectRoom(), lRoom()]) {
      const poses = new RoomPlanner(g).poses(torch);
      expect(poses.length).toBeGreaterThan(8);
      for (const p of poses) assertWallPose(g, p);
    }
  });

  it('findet jede zulässige Wandstelle genau einmal (Vollständigkeit)', () => {
    const g = rectRoom();
    const a = analyzeRoom(g);
    const expected = new Set<string>();
    for (const i of a.info.values()) {
      if (a.doorZone.has(i.cell[0], i.cell[1]) || i.nearWindow) continue;
      for (const w of i.solidWalls) expected.add(`${cellKey(i.cell[0], i.cell[1])}>${w}`);
    }
    const got = new RoomPlanner(g).poses(torch).map((p) => `${cellKey(...at(p))}>${resolveRelDir('back', p.pose)}`);
    expect(new Set(got).size).toBe(got.length);
    expect(new Set(got)).toEqual(expected);
  });

  it('Ecke mit zwei festen Wänden → zwei Ausrichtungen; Ecke in der Türzone → keine', () => {
    const poses = new RoomPlanner(lRoom()).poses(torch);
    const atCell = (x: number, z: number) => poses.filter((p) => at(p)[0] === x && at(p)[1] === z).map((p) => resolveRelDir('back', p.pose)).sort();
    expect(atCell(0, 0)).toEqual(['north', 'west']);
    expect(atCell(0, 6)).toEqual([]); // Nachbar der Tür (1,6)
  });

  it('wallHeight wählt die Höhe; nie über Möbeln höher als 1 Block', () => {
    const high: ComponentDef = { ...torch, id: 'test/high_torch', wallHeight: 2 };
    const g = rectRoom(4);
    for (const p of new RoomPlanner(g).poses(high)) assertWallPose(g, p, 2);
    // 2 hoher Tisch (Zaun + Druckplatte) an der Nordwand bei x=1: darüber keine Wandfackel (weder Höhe 1 noch 2)
    const table = placeComponent(expandComponent(catalog.get('table/small'), 'fence_plate'), pose([1, 1, 0]));
    const withTable = new RoomPlanner(g, [table]);
    const over = (p: PlacedComponent): boolean => at(p)[0] === 1 && at(p)[1] === 0;
    expect(withTable.poses(high).filter(over)).toEqual([]);
    expect(withTable.poses(torch).filter(over)).toEqual([]);
    // 1 hohe Truhe an der Nordwand bei x=5: Wandfackel darüber (Höhe 1) ist erlaubt
    const chest = placeComponent(expandComponent(catalog.get('storage/chest')), pose([5, 1, 0], 0));
    const withChest = new RoomPlanner(g, [chest]);
    expect(withChest.poses(torch).some((p) => at(p)[0] === 5 && at(p)[1] === 0 && resolveRelDir('back', p.pose) === 'north')).toBe(true);
  });

  it('der Solver platziert Wandlichter aus dem Raumprogramm (bisher lieferte candidates() für wall nichts)', () => {
    const rt: RoomTypeDef = {
      id: 'gallery', name: 'Galerie', minArea: 4, coverage: { target: 0.2 },
      required: [{ tags: ['light_wall'], count: [3, 3] }],
      optional: [{ tags: ['chest'], count: [0, 2], weight: 1, placement: { zones: ['edge'] } }],
    };
    for (let seed = 0; seed < 25; seed++) {
      for (const g of [rectRoom(), lRoom()]) {
        const r = furnishRoom(g, rt, catalog, { seed, dataVersion: DV });
        expect(r.warnings, `seed ${seed}`).toEqual([]);
        const walls = r.placed.filter((p) => p.expanded.mount === 'wall');
        expect(walls).toHaveLength(3);
        for (const p of walls) assertWallPose(g, p);
      }
    }
  });

  it('Versions-Gating: Kupfer-Wandfackel erst ab 1.21.9', () => {
    expect(catalog.byTags(['light_wall'], 3955).map((d) => d.id)).not.toContain('light/copper_wall_torch');
    expect(catalog.byTags(['light_wall'], DV).map((d) => d.id)).toContain('light/copper_wall_torch');
  });
});

describe('walkable: durchlaufbare Komponenten belegen keinen Boden', () => {
  const torch = catalog.get('light/wall_torch');
  const lantern = catalog.get('light/wall_lantern');

  it('Katalog: Wandfackeln sind walkable, Wandlaterne (Halter in Kopfhöhe) und Stehlampe nicht', () => {
    for (const id of ['light/wall_torch', 'light/soul_wall_torch', 'light/copper_wall_torch']) expect(catalog.get(id).walkable, id).toBe(true);
    for (const id of ['light/wall_lantern', 'light/floor_lamp', 'light/ceiling_lantern']) expect(catalog.get(id).walkable ?? false, id).toBe(false);
    expect(expandComponent(torch).walkable).toBe(true);
    expect(expandComponent(lantern, 'fence').walkable).toBe(false);
  });

  it('Flur: Wandfackel überall (Laufweg bleibt), Wandlaterne nur am Ende (sonst zerfällt die Lauffläche)', () => {
    const g = corridor();
    const planner = new RoomPlanner(g);
    const torchCells = new Set(planner.poses(torch).map((p) => at(p)[1]));
    // z = 4..5 ist Türzone; die Fackel darf an alle anderen Zellen (je Zelle zwei Wandseiten)
    expect([...torchCells].sort()).toEqual([0, 1, 2, 3]);
    const lanternCells = new Set(planner.poses(lantern, 'fence').map((p) => at(p)[1]));
    expect([...lanternCells]).toEqual([0]); // nur die Sackgasse, z = 1..3 würden den Flur teilen
    // billige Kandidaten ohne Konnektivität enthalten z = 1/2 noch – connected() verwirft sie
    const cheap = planner.candidates(lantern, 'fence');
    expect(cheap.some((p) => at(p)[1] === 1)).toBe(true);
    expect(cheap.filter((p) => at(p)[1] === 1).every((p) => !planner.connected(p))).toBe(true);
  });

  it('eine platzierte Wandfackel lässt die Bodenzelle frei, eine Wandlaterne nicht', () => {
    const g = corridor();
    const planner = new RoomPlanner(g);
    const t = planner.poses(torch).find((p) => at(p)[1] === 1)!;
    planner.add(t);
    expect(planner.floorFree(0, 1)).toBe(true);
    // Nach der Fackel ist der Flur weiter durchgängig → die Laterne am Ende bleibt möglich
    expect(planner.poses(lantern, 'fence').map((p) => at(p)[1])).toContain(0);
    const l = planner.poses(lantern, 'fence').find((p) => at(p)[1] === 0)!;
    planner.add(l);
    expect(planner.floorFree(0, 0)).toBe(false);
  });

  it('Solver: vorhandene Wandfackeln blockieren keine Nutzungsfelder und keine Laufwege', () => {
    const g = rectRoom();
    // Fackeln vor jeder zulässigen Wandstelle als feste Platzierungen – das Schlafzimmer bekommt trotzdem sein Bett
    const torches = new RoomPlanner(g).poses(torch);
    const fixed: PlacedComponent[] = [];
    const planner = new RoomPlanner(g);
    for (const p of torches) {
      if (planner.poses(torch).some((q) => q.pose.pos.join() === p.pose.pos.join() && q.pose.rot === p.pose.rot)) {
        planner.add(p);
        fixed.push(p);
      }
    }
    expect(fixed.length).toBeGreaterThan(8);
    for (let seed = 0; seed < 15; seed++) {
      const r = furnishRoom(g, catalog.roomType('bedroom'), catalog, { seed, dataVersion: DV, fixed });
      expect(r.placements.some((p) => catalog.get(p.componentId).tags.includes('bed')), `seed ${seed}`).toBe(true);
    }
  });
});
