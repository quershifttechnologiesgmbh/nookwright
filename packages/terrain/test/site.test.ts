import { describe, expect, it } from 'vitest';
import { CellSet } from '@mcda/core';
import { SCULPT_LIMIT, Site, SiteError, applySiteEvent, siteSeed, type SiteState } from '../src/index.js';

const plot = { minX: 0, minZ: 0, maxX: 19, maxZ: 19 };
const make = (): Site => Site.create({ id: 's1', projectId: 'p1', seed: 42, styleId: 'meadow', plot });

describe('Aggregat Site (Gelände)', () => {
  it('entsteht mit Grundstück, Stil und Projektbezug; Events sind serialisierbar', () => {
    const s = make();
    expect(s.state).toMatchObject({ id: 's1', projectId: 'p1', seed: 42, styleId: 'meadow', rerollCount: 0, zones: [] });
    expect(s.history).toEqual([{ type: 'SiteCreated', id: 's1', projectId: 'p1', seed: 42, styleId: 'meadow', plot }]);
    expect(JSON.parse(JSON.stringify(s.history))).toEqual(s.history);
  });

  it('prüft das Grundstück (4 … 512, ganzzahlig)', () => {
    expect(() => Site.create({ id: 'x', projectId: 'p', seed: 1, styleId: 'm', plot: { minX: 0, minZ: 0, maxX: 2, maxZ: 10 } })).toThrow(SiteError);
    expect(() => Site.create({ id: 'x', projectId: 'p', seed: 1, styleId: 'm', plot: { minX: 0, minZ: 0, maxX: 600, maxZ: 10 } })).toThrow(/außerhalb/);
    expect(() => Site.create({ id: 'x', projectId: 'p', seed: 1, styleId: '', plot })).toThrow(/Geländestil/);
  });

  it('Malen übermalt andere Zonen, leere Zonen verschwinden, Zellen außerhalb werden abgeschnitten', () => {
    const s = make();
    s.paintZone('field', CellSet.rect(0, 0, 5, 5));
    s.paintZone('garden', CellSet.rect(18, 18, 25, 25)); // teilweise außerhalb
    expect(s.zone('z2').cells.size).toBe(4);
    const ev = s.paintZone('pond', CellSet.rect(3, 3, 8, 8));
    expect(ev.map((e) => e.type)).toEqual(['ZoneCellsLost', 'ZonePainted']);
    expect(s.zone('z1').cells.has(4, 4)).toBe(false);
    expect(s.zone('z1').cells.size).toBe(36 - 9);
    s.paintZone('yard', CellSet.rect(0, 0, 5, 5));
    expect(s.state.zones.map((z) => z.id)).toEqual(['z2', 'z3', 'z4']);
    // Invariante: jede Zelle höchstens in einer Zone
    const seen = new Set<string>();
    for (const z of s.state.zones) for (const [x, y] of z.cells) {
      expect(seen.has(`${x},${y}`)).toBe(false);
      seen.add(`${x},${y}`);
    }
    expect(() => s.paintZone('field', CellSet.rect(50, 50, 51, 51))).toThrow(/Keine Zelle/);
  });

  it('Radieren und Art ändern', () => {
    const s = make();
    s.paintZone('field', CellSet.rect(0, 0, 3, 3));
    s.eraseZones(CellSet.rect(0, 0, 3, 1));
    expect(s.zone('z1').cells.size).toBe(8);
    s.setZoneKind('z1', 'garden');
    expect(s.zone('z1').kind).toBe('garden');
    expect(s.setZoneKind('z1', 'garden')).toEqual([]);
    s.eraseZones(CellSet.rect(0, 0, 9, 9));
    expect(s.state.zones).toEqual([]);
  });

  it('Terraforming: Deltas addieren sich (begrenzt), Ebnen setzt feste Höhe, Zurücksetzen löscht', () => {
    const s = make();
    const c = CellSet.rect(2, 2, 3, 3);
    s.sculpt('raise', c, 2);
    s.sculpt('lower', CellSet.rect(3, 3, 3, 3), 5);
    expect(s.state.sculpt.get('2,2')).toEqual({ delta: 2 });
    expect(s.state.sculpt.get('3,3')).toEqual({ delta: -3 });
    for (let k = 0; k < 20; k++) s.sculpt('raise', CellSet.rect(2, 2, 2, 2), 3);
    expect(s.state.sculpt.get('2,2')?.delta).toBe(SCULPT_LIMIT);
    s.flatten(c, -2);
    expect(s.state.sculpt.get('3,2')).toEqual({ delta: 0, level: -2 });
    s.sculpt('raise', c, 1);
    expect(s.state.sculpt.get('3,2')).toEqual({ delta: 1, level: -2 });
    s.resetTerrain(CellSet.rect(2, 2, 2, 3));
    expect(s.state.sculpt.has('2,2')).toBe(false);
    expect(s.state.sculpt.has('3,2')).toBe(true);
    expect(() => s.flatten(c, 99)).toThrow(SiteError);
    expect(() => s.sculpt('raise', c, 0)).toThrow(/Pinselstärke/);
    expect(s.sculpt('raise', CellSet.rect(40, 40, 41, 41))).toEqual([]); // außerhalb: nichts
  });

  it('Grundstück verkleinern entfernt Zonen-Zellen und Terraforming außerhalb', () => {
    const s = make();
    s.paintZone('field', CellSet.rect(0, 0, 4, 4));
    s.paintZone('pond', CellSet.rect(15, 15, 18, 18));
    s.sculpt('raise', CellSet.rect(16, 16, 16, 16));
    const ev = s.resizePlot({ minX: 0, minZ: 0, maxX: 9, maxZ: 9 });
    expect(ev.map((e) => e.type)).toEqual(['ZoneRemoved', 'PlotResized']);
    expect(s.state.zones.map((z) => z.id)).toEqual(['z1']);
    expect(s.state.sculpt.size).toBe(0);
  });

  it('Neu würfeln ändert nur den Generator-Seed; Stil wechseln', () => {
    const s = make();
    const a = s.generatorSeed;
    s.reroll();
    expect(s.state.rerollCount).toBe(1);
    expect(s.generatorSeed).not.toBe(a);
    expect(siteSeed(s.state)).toBe(s.generatorSeed);
    s.setStyle('hills');
    expect(s.state.styleId).toBe('hills');
    expect(s.setStyle('hills')).toEqual([]);
  });

  it('Undo und Replay: Zustand folgt allein aus der Historie', () => {
    const s = make();
    s.paintZone('field', CellSet.rect(0, 0, 4, 4));
    s.sculpt('raise', CellSet.rect(1, 1, 2, 2), 2);
    s.paintZone('garden', CellSet.rect(3, 3, 6, 6));
    const replay = Site.fromHistory(JSON.parse(JSON.stringify(s.history)));
    expect(dump(replay.state)).toEqual(dump(s.state));
    const back = s.undo(2); // Malen des Gartens = 2 Events (ZoneCellsLost + ZonePainted)
    expect(back.state.zones.map((z) => [z.id, z.cells.size])).toEqual([['z1', 25]]);
    expect(back.state.sculpt.size).toBe(4);
    expect(() => make().undo()).toThrow(/Nichts mehr/);
    expect(() => Site.fromHistory([])).toThrow(/SiteCreated/);
    expect(() => applySiteEvent(undefined, { type: 'SiteRerolled', rerollCount: 1 })).toThrow();
  });
});

function dump(s: SiteState): unknown {
  return { ...s, zones: s.zones.map((z) => ({ ...z, cells: z.cells.toArray() })), sculpt: [...s.sculpt].sort() };
}
