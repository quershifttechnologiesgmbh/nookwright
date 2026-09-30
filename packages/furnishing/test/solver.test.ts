import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Catalog, parseComponentDef, parseRoomTypeDef } from '@mcda/catalog';
import { CellSet, cellKey, key3, type Cell } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { furnishRoom, renderAscii, type RoomGeometry } from '../src/index.js';

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

function rectRoom(w: number, d: number, height = 3): RoomGeometry {
  return {
    roomId: 'r1',
    baseY: 1,
    height,
    interior: CellSet.rect(0, 0, w - 1, d - 1),
    doors: [{ inside: [Math.floor(w / 2), d - 1], toward: 'south', isMain: true }],
    windows: [{ inside: [Math.floor(w / 2), 0], toward: 'north' }],
  };
}

function lRoom(): RoomGeometry {
  return {
    roomId: 'r2',
    baseY: 1,
    height: 4,
    interior: CellSet.rect(0, 0, 6, 2).union(CellSet.rect(0, 3, 2, 6)),
    doors: [{ inside: [1, 6], toward: 'south', isMain: true }, { inside: [6, 1], toward: 'east', isMain: false }],
    windows: [],
  };
}

/** Harte Garantien, die für JEDES Ergebnis gelten müssen (research/02 §7.21). */
function assertHardGuarantees(geom: RoomGeometry, res: ReturnType<typeof furnishRoom>): void {
  const blocks = new Set<string>();
  const floor = new Set<string>();
  const furniture = new Set<string>();
  const low: string[] = [];
  for (const p of res.placed) {
    for (const c of p.cells) {
      const k = key3(c.pos);
      if (p.expanded.mount !== 'ceiling' && c.pos[1] <= geom.baseY + 1 && !p.expanded.walkable) furniture.add(cellKey(c.pos[0], c.pos[2]));
      expect(blocks.has(k), `Kollision bei ${k}`).toBe(false);
      blocks.add(k);
      expect(geom.interior.has(c.pos[0], c.pos[2]), `außerhalb bei ${k}`).toBe(true);
      expect(c.pos[1]).toBeGreaterThanOrEqual(geom.baseY);
      expect(c.pos[1]).toBeLessThan(geom.baseY + geom.height);
      // Kopffreiheit über Laufwegen: tiefer als Boden + 2 nur über Möbeln (Socket `hang`, z. B. Laterne über dem Tisch)
      if (p.expanded.mount === 'ceiling' && c.pos[1] < geom.baseY + 2) low.push(cellKey(c.pos[0], c.pos[2]));
      // durchlaufbare Komponenten (Teppich, Wandfackel) belegen keinen Boden – wie im Solver
      if (c.pos[1] <= geom.baseY + 1 && !p.expanded.walkable) floor.add(cellKey(c.pos[0], c.pos[2]));
    }
  }
  for (const k of low) expect(furniture.has(k), `Kopffreiheit über dem Laufweg bei ${k}`).toBe(true);
  const free = CellSet.of([...geom.interior].filter(([x, z]) => !floor.has(cellKey(x, z))));
  expect(free.isConnected(), 'freie Bodenfläche zerfällt in Taschen').toBe(true);
  for (const d of geom.doors) {
    expect(free.has(d.inside[0], d.inside[1]), 'Tür blockiert').toBe(true);
    for (const n of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Cell[]) {
      const x = d.inside[0] + n[0];
      const z = d.inside[1] + n[1];
      if (geom.interior.has(x, z)) expect(floor.has(cellKey(x, z)), 'Türzone belegt').toBe(false);
    }
  }
}

describe('furnishRoom', () => {
  it('ist deterministisch: gleicher Seed → gleiches Ergebnis', () => {
    const g = rectRoom(7, 5);
    const a = furnishRoom(g, catalog.roomType('bedroom'), catalog, { seed: 42, dataVersion: DV });
    const b = furnishRoom(g, catalog.roomType('bedroom'), catalog, { seed: 42, dataVersion: DV });
    expect(a.placements).toEqual(b.placements);
  });

  it('Neu-Würfeln (anderer Seed) liefert Varianten', () => {
    const g = rectRoom(7, 5);
    const layouts = new Set<string>();
    for (let seed = 0; seed < 12; seed++) {
      const r = furnishRoom(g, catalog.roomType('bedroom'), catalog, { seed, dataVersion: DV });
      layouts.add(renderAscii(g, r.placed, (id) => catalog.get(id).tags));
    }
    expect(layouts.size).toBeGreaterThan(6);
  });

  it('Schlafzimmer hat IMMER ein Bett (Pflichtobjekt) – über viele Seeds und Raumgrößen', () => {
    for (const [w, d] of [[4, 3], [5, 4], [7, 5], [9, 7], [12, 8]] as const) {
      for (let seed = 0; seed < 25; seed++) {
        const g = rectRoom(w, d);
        const r = furnishRoom(g, catalog.roomType('bedroom'), catalog, { seed, dataVersion: DV });
        const beds = r.placements.filter((p) => catalog.get(p.componentId).tags.includes('bed'));
        expect(beds.length, `${w}×${d} seed ${seed}\n${renderAscii(g, r.placed, (id) => catalog.get(id).tags)}`).toBeGreaterThanOrEqual(1);
        assertHardGuarantees(g, r);
      }
    }
  });

  it('harte Garantien im L-Raum mit zwei Türen, alle Raumtypen', { timeout: HEAVY_TIMEOUT }, () => {
    expect(catalog.roomTypeIds()).toEqual(expect.arrayContaining(['alchemy', 'bedroom', 'kitchen', 'library', 'smithy', 'storage', 'tavern']));
    for (const type of catalog.roomTypeIds()) {
      for (let seed = 0; seed < 40; seed++) {
        const g = lRoom();
        const r = furnishRoom(g, catalog.roomType(type), catalog, { seed, dataVersion: DV });
        assertHardGuarantees(g, r);
      }
    }
  });

  it('Pflichtobjekte aller Raumtypen werden in einem 8×6-Raum immer platziert', { timeout: HEAVY_TIMEOUT }, () => {
    for (const type of catalog.roomTypeIds()) {
      const rt = catalog.roomType(type);
      // nur Raumtypen, die so kleine Räume zulassen (Handelshalle, Kapelle … verlangen mehr Fläche)
      if (rt.minArea > rectRoom(8, 6).interior.size) continue;
      for (let seed = 0; seed < 20; seed++) {
        const g = rectRoom(8, 6);
        const r = furnishRoom(g, rt, catalog, { seed, dataVersion: DV });
        const ascii = renderAscii(g, r.placed, (id) => catalog.get(id).tags);
        expect(r.warnings, `${type} seed ${seed}
${ascii}`).toEqual([]);
        for (const req of rt.required) {
          const hit = r.placements.some((p) => catalog.get(p.componentId).tags.some((t) => req.tags.includes(t)));
          expect(hit, `${type}: ${req.tags.join('|')} fehlt (seed ${seed})
${ascii}`).toBe(true);
        }
        assertHardGuarantees(g, r);
      }
    }
  });

  it('Tischdeko landet auf Abstellflächen (Kind-Socket surface), nie auf dem Boden', () => {
    let onSurface = 0;
    for (let seed = 0; seed < 30; seed++) {
      const r = furnishRoom(rectRoom(8, 6), catalog.roomType('kitchen'), catalog, { seed, dataVersion: DV });
      r.placed.forEach((p, i) => {
        if (p.expanded.mount !== 'surface') return;
        onSurface++;
        // nie auf dem Boden (baseY 1); V3: auch auf Borden in Kopfhöhe → y ≥ 2, immer auf dem Elternteil
        expect(p.pose.pos[1]).toBeGreaterThanOrEqual(2);
        const parentKey = r.placements[i]!.parentKey;
        expect(parentKey, 'Tischdeko ohne Elternteil').toBeDefined();
        const parent = r.placed[r.placements.findIndex((x) => x.key === parentKey)]!;
        const under = new Set(parent.cells.map((c) => key3(c.pos)));
        for (const c of p.cells) expect(under.has(key3([c.pos[0], c.pos[1] - 1, c.pos[2]])), 'steht auf dem Elternteil').toBe(true);
      });
    }
    expect(onSurface).toBeGreaterThan(5);
  });

  it('Betten stehen mit dem Kopfende an einer festen Wand, nie vor Tür oder Fenster', () => {
    for (let seed = 0; seed < 30; seed++) {
      const g = rectRoom(8, 6);
      const r = furnishRoom(g, catalog.roomType('bedroom'), catalog, { seed, dataVersion: DV });
      for (const p of r.placed.filter((x) => x.expanded.defId === 'bed/single')) {
        const head = p.cells.find((c) => c.mat.orient?.part === 'head')!.pos;
        const back = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] }[p.pose.rot]!;
        const behind: Cell = [head[0] + back[0]!, head[2] + back[1]!];
        expect(g.interior.has(behind[0], behind[1]), 'hinter dem Kopfende muss Wand sein').toBe(false);
        expect(g.windows.some((w) => w.inside[0] === head[0] && w.inside[1] === head[2])).toBe(false);
      }
    }
  });

  it('Kinder-Sockets: Nachttische hängen am Bett und haben parentKey', () => {
    let withNightstand = 0;
    for (let seed = 0; seed < 30; seed++) {
      const r = furnishRoom(rectRoom(8, 6), catalog.roomType('bedroom'), catalog, { seed, dataVersion: DV });
      for (const p of r.placements.filter((x) => x.componentId === 'storage/nightstand_barrel' && x.parentKey !== undefined)) {
        withNightstand++;
        const parent = r.placements.find((x) => x.key === p.parentKey)!;
        // Einzelbett oder Himmelbett-Familie (K1): jedes Bett bietet Nachttisch-Sockets
        expect(catalog.get(parent.componentId).tags).toContain('bed');
        expect(p.socketId).toMatch(/^nightstand_/);
      }
    }
    expect(withNightstand).toBeGreaterThan(5);
  });

  it('Lager: Truhen stehen an Wänden und ihre Vorderseite bleibt erreichbar', () => {
    const g = rectRoom(6, 5);
    const r = furnishRoom(g, catalog.roomType('storage'), catalog, { seed: 3, dataVersion: DV });
    const chests = r.placed.filter((p) => p.expanded.defId === 'storage/chest');
    expect(chests.length).toBeGreaterThanOrEqual(2);
    assertHardGuarantees(g, r);
  });

  it('zu kleiner Raum → Warnung statt stiller Fehler', () => {
    const tiny: RoomGeometry = { ...rectRoom(2, 2), doors: [{ inside: [1, 1], toward: 'south', isMain: true }] };
    const r = furnishRoom(tiny, catalog.roomType('bedroom'), catalog, { seed: 1, dataVersion: DV });
    expect(r.warnings.join()).toMatch(/kleiner als das Minimum|passt nicht/);
  });

  it('Katalog-Lint: alle Tags der Raumtypen haben Komponenten', () => {
    for (const id of catalog.roomTypeIds()) expect(catalog.missingTags(id, DV), id).toEqual([]);
  });
});
