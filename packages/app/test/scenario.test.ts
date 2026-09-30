/**
 * Szenario über die Use Cases der App: 2 Etagen, Treppe, 4+ Raumtypen, Satteldach → Licht-Pass → materialisieren →
 * Export-Round-Trip (alle drei Formate) → Speichern/Laden → gleiche Bytes. 0 harte Verstöße, 0 dunkle Stellen.
 */
import { EXPORT_FORMATS } from '@mcda/export';
import { importFile, nodeGzip } from '@mcda/export/node';
import { toExport, type PipelineContext } from '@mcda/pipeline';
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { exportProject, exportReport, worldOf } from '../src/exporting.js';
import { lightSession } from '../src/lighting.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import { templateSession } from '../src/templates.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;
const DATE = Date.UTC(2026, 8, 23);

function lit(s: uc.Session, ctx: PipelineContext): uc.Session {
  const r = lightSession(s, ctx);
  expect(r.session.light?.error).toBeUndefined();
  return r.session;
}

function paint(s: uc.Session, x1: number, z1: number, x2: number, z2: number, type: string, floor = 0): uc.Session {
  const r = uc.paintRect(s, catalog, { x1, z1, x2, z2 }, type, floor);
  expect(r.roomId, `${type} auf Etage ${floor}`).toBeDefined();
  return r.session;
}

/** Wie ein Nutzer: EG malen, Etage hinzufügen, OG malen, Treppe setzen, Satteldach, Wandhöhe oben 4, umbenennen. */
function build(): uc.Session {
  let s = uc.createSession(2026, 'Unbenannt', 'medieval');
  s = paint(s, 5, 5, 16, 12, 'tavern');
  s = paint(s, 17, 5, 23, 12, 'kitchen');
  s = paint(s, 5, 13, 23, 17, 'storage');
  s = uc.addFloor(s, catalog).session;
  s = paint(s, 5, 5, 13, 12, 'bedroom', 1);
  s = paint(s, 14, 5, 23, 12, 'library', 1);
  s = paint(s, 5, 13, 15, 17, 'alchemy', 1);
  s = uc.placeStairs(s, catalog, { floor: 0, origin: [8, 15], facing: 'east', type: 'straight' }).session;
  s = uc.setRoof(s, 'gable', catalog);
  s = uc.renameProject(s, 'Zwei Etagen');
  return s;
}

describe('Szenario: zweistöckiges Haus', () => {
  it('2 Etagen, Treppe, 6 Raumtypen, Satteldach → materialisieren → Export-Round-Trip, 0 harte Verstöße', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const s = lit(build(), ctx);
    const state = s.project.state;
    expect(state.floors.map((f) => f.index)).toEqual([0, 1]);
    expect(state.links).toHaveLength(1);
    expect(new Set(state.rooms.map((r) => r.roomTypeId)).size).toBeGreaterThanOrEqual(4);
    expect(s.roof).toBe('gable');
    // Einrichtung ohne Warnungen je Raum, mit Qualitätswert
    for (const r of state.rooms) {
      expect(s.warnings.get(r.id) ?? [], `${r.id} (${r.roomTypeId})`).toEqual([]);
      expect(s.quality?.get(r.id), r.id).toBeDefined();
    }
    const shell = uc.shellOf(s.project, uc.shellStyle(s));
    expect(shell.cells.some((c) => c.kind === 'stairs')).toBe(true);
    expect(shell.cells.some((c) => c.kind === 'roof')).toBe(true);
    const world = worldOf(s.project, ctx, uc.shellStyle(s));
    const report = exportReport(world);
    expect(report.errors, report.errors.map((v) => v.message).join('\n')).toEqual([]);
    expect(report.darkCells).toBe(0);
    // Treppenblöcke sind im Volumen (Stufen als echte Treppen)
    expect([...world.materialized.volume.cells()].some((c) => c.state.name.endsWith('_stairs') && c.owner?.startsWith('shell:') === true)).toBe(true);
    const ev = toExport(s.project, world);
    for (const fmt of EXPORT_FORMATS) {
      const file = await exportProject(s.project, world, fmt, nodeGzip, { date: DATE });
      expect(file.name).toBe(`Zwei Etagen.${fmt}`);
      const back = importFile(fmt, file.bytes);
      expect(back.blocks.length, fmt).toBe(ev.blocks.length);
      expect(back.size, fmt).toEqual(ev.size);
    }
    // Speichern → Laden → gleiche Blöcke, gleiche Bytes; der Licht-Pass findet nichts mehr zu tun
    const r = parseProjectFile(serializeProject(s), { catalog, themes: load.themeCatalog! });
    if (!r.ok) throw new Error(r.error);
    const loaded = lightSession(r.session, ctx);
    expect(loaded.session.project.history.length).toBe(s.project.history.length);
    expect(uc.shellStyle(loaded.session)).toEqual(uc.shellStyle(s));
    const a = await exportProject(s.project, world, 'nbt', nodeGzip, { date: DATE });
    const b = await exportProject(loaded.session.project, worldOf(loaded.session.project, ctx, uc.shellStyle(loaded.session)), 'nbt', nodeGzip, { date: DATE });
    expect(b.bytes).toEqual(a.bytes);
  });

  it('Wandhöhe live: OG auf 5 → Treppe (unten) bleibt, Dach steigt, weiter 0 harte Verstöße', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const s0 = lit(build(), ctx);
    const top = (x: uc.Session) => Math.max(...uc.shellOf(x.project, uc.shellStyle(x)).cells.map((c) => c.pos[1]));
    const s = lit(uc.setFloorHeight(s0, catalog, 1, 5), ctx);
    expect(s.project.state.links).toHaveLength(1); // Treppe verbindet EG → OG, EG unverändert
    expect(top(s)).toBe(top(s0) + 2);
    const report = exportReport(worldOf(s.project, ctx, uc.shellStyle(s)));
    expect(report.errors, report.errors.map((v) => v.message).join('\n')).toEqual([]);
    expect(report.darkCells).toBe(0);
    // EG höher → Treppe länger: passt sie nicht mehr, entfernt dieselbe Aktion sie (Meldung in der App)
    const eg = uc.setFloorHeight(s0, catalog, 0, 5);
    const gone = uc.removedStairs(s0.project.state, eg.project.state);
    expect(gone.length + eg.project.state.links.length).toBe(1);
  });

  it('Vorlage „Zweistöckiges Haus“: Treppe, Satteldach, 8 Raumtypen (mit Diele und Werkstatt-Anbau), 0 harte Verstöße', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const s = lit(templateSession('twostory', catalog, 99, 'medieval'), ctx);
    expect(s.past).toEqual([]);
    expect(s.roof).toBe('gable');
    expect(s.project.state.floors).toHaveLength(2);
    expect(s.project.state.links).toHaveLength(1);
    // W12 (2026-09-28): W12-A – Vorbau mit Diele (`hallway`) und Haustür vorn, ein Raumtyp mehr
    // W13-A Runde 2 (2026-09-28): dazu die Tischlerei im eingeschossigen Werkstatt-Anbau (eigener Baukörper); vorher 7 Raumtypen
    expect(new Set(s.project.state.rooms.map((r) => r.roomTypeId))).toEqual(new Set(['tavern', 'kitchen', 'storage', 'bedroom', 'library', 'alchemy', 'hallway', 'carpentry']));
    const report = exportReport(worldOf(s.project, ctx, uc.shellStyle(s)));
    expect(report.errors, report.errors.map((v) => v.message).join('\n')).toEqual([]);
    expect(report.darkCells).toBe(0);
  });
});
