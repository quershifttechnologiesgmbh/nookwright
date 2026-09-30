/**
 * Licht-Einbindung: Nach Malen, Neu-Würfeln und Raumtyp-Wechsel ergänzt der Licht-Pass (`lightRooms` aus
 * @mcda/pipeline) Lichter; Vorschau und Export lesen denselben Projektzustand → dieselben Lichter, 0 Spawn-Zellen.
 */
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { key3 } from '@mcda/core';
import { toExport, type PipelineContext } from '@mcda/pipeline';
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { exportReport, worldOf } from '../src/exporting.js';
import { lightSession, lightStatus } from '../src/lighting.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;

function lit(s: uc.Session, ctx: PipelineContext): uc.Session {
  expect(s.needsLight).toBe(true);
  const r = lightSession(s, ctx);
  expect(r.session.needsLight).toBe(false);
  expect(r.session.light?.error).toBeUndefined();
  return r.session;
}

const dark = (s: uc.Session, ctx: PipelineContext, roof = s.roof) => exportReport(worldOf(s.project, ctx, roof)).darkCells;

describe('Licht-Pass in der App', () => {
  it('Beispielhaus: nach Malen, Neu würfeln und Raumtyp-Wechsel 0 Spawn-Zellen (Walm- und Flachdach)', async () => {
    const ctx = await pipeline.ready('1.21.11');
    for (const roof of ['hip', 'flat'] as const) {
      let s = sampleSession(catalog);
      if (roof === 'flat') s = uc.setRoof(s, 'flat');
      s = lit(s, ctx);
      expect(dark(s, ctx), `${roof}: nach dem Malen`).toBe(0);
      expect(s.light?.darkCells).toBe(0);

      for (const room of s.project.state.rooms) {
        s = lit(uc.rerollRoom(s, catalog, room.id), ctx);
        expect(dark(s, ctx), `${roof}: nach Neu würfeln ${room.id}`).toBe(0);
      }
      const first = s.project.state.rooms[0]!;
      s = lit(uc.assignRoomType(s, catalog, first.id, 'storage'), ctx);
      expect(dark(s, ctx), `${roof}: nach Raumtyp-Wechsel`).toBe(0);
      expect(exportReport(worldOf(s.project, ctx, roof)).errors).toEqual([]);
    }
  });

  it('niedrige Räume brauchen den Pass: Lichter werden ergänzt, Vorschau und Export haben dieselben', async () => {
    const ctx = await pipeline.ready('1.21.11');
    // Lichte Höhe 2: keine Deckenlaterne möglich, das Raumprogramm allein lässt dunkle Zellen (L1)
    const low = Project.create({ id: 'local', name: 'Halle', seed: 7, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 2 } });
    // ohne Außen-Deko: deren Laternen leuchten durch Fenster und Türen hinein (Test unten)
    let s: uc.Session = { ...uc.sessionFromProject(low, { exterior: uc.PLAIN_EXTERIOR }), needsLight: false };
    for (let i = 0; i < 3; i++) s = uc.paintRect(s, catalog, { x1: 0, z1: i * 8, x2: 26, z2: i * 8 + 6 }, i === 1 ? 'storage' : 'bedroom').session;
    const unlit = worldOf(s.project, ctx, uc.shellStyle(s));
    const before = exportReport(unlit).darkCells;
    const r = lightSession(s, ctx);
    const after = r.session;
    const ids = uc.lightPlacementIds(after.project);
    expect(before, 'ohne Pass gibt es dunkle Zellen').toBeGreaterThan(0);
    expect(ids.size).toBeGreaterThan(0);
    expect(after.light?.added).toBe(ids.size);
    expect(dark(after, ctx)).toBe(0);
    // Die Welt des Passes ist die Welt der Vorschau/des Exports (gemerkt, nicht neu berechnet)
    const world = worldOf(after.project, ctx, uc.shellStyle(after));
    expect(world).toBe(r.world);
    // Mit Außen-Deko: neu materialisiert (dieser Pass lief ohne Außen-Deko), dieselben Lichter plus Außen-Teile
    const decorated = uc.shellStyle({ ...after, exterior: uc.DEFAULT_EXTERIOR });
    const outside = worldOf(after.project, ctx, decorated);
    expect(outside).not.toBe(r.world);
    expect(outside.exterior?.length).toBeGreaterThan(0);
    const lamps = new Set(outside.materialized.light.emitters.map((e) => key3(e.pos)));
    expect(world.materialized.light.emitters.map((e) => key3(e.pos)).every((k) => lamps.has(k))).toBe(true);
    expect(exportReport(outside).darkCells).toBe(0);
    // Jede ergänzte Lichtquelle steht als Block im Export (Positionen relativ zur Minimum-Ecke)
    const exported = toExport(after.project, world);
    const [ox, oy, oz] = world.materialized.volume.origin;
    const exportedAt = new Map(exported.blocks.map((b) => [key3([b.pos[0] + ox, b.pos[1] + oy, b.pos[2] + oz]), b.name]));
    for (const v of uc.placedViews(after.project.state, catalog).filter((x) => ids.has(x.placement.id))) {
      expect(v.placed.cells.some((c) => exportedAt.has(key3(c.pos))), `${v.def.id} fehlt im Export`).toBe(true);
    }
    const emitters = new Set(world.materialized.light.emitters.map((e) => key3(e.pos)));
    expect([...emitters].every((k) => exportedAt.has(k))).toBe(true);
    // Die ergänzten Platzierungen hängen als FurnishingSupplemented an der letzten Aktion
    const extra = after.project.history.slice(s.project.history.length);
    expect(extra.every((e) => e.type === 'FurnishingSupplemented')).toBe(true);
    expect(extra.length).toBeGreaterThan(0);
  });

  it('Undo nimmt Aktion und ergänzte Lichter zusammen zurück', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const s1 = lit(sampleSession(catalog), ctx);
    const room = s1.project.state.rooms[1]!;
    const s2 = lit(uc.rerollRoom(s1, catalog, room.id), ctx);
    const back = uc.undo(s2);
    expect(back.project.history).toEqual(s1.project.history);
    expect(back.needsLight).toBe(false);
    expect(back.light).toEqual(s1.light);
    // Undo auf eine Sitzung, deren Licht-Pass nie lief → der Pass steht wieder aus
    const pending = uc.rerollRoom(s1, catalog, room.id);
    const again = uc.rerollRoom(pending, catalog, room.id);
    expect(uc.undo(again).needsLight).toBe(true);
  });

  it('ohne Bedarf: gleiche Sitzung; ohne Änderung durch den Pass: gleiches Projekt, Welt gemerkt', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const s = lit({ ...sampleSession(catalog), exterior: uc.PLAIN_EXTERIOR }, ctx);
    expect(lightSession(s, ctx).session).toBe(s);
    const roofChanged = uc.setRoof(s, 'flat');
    expect(roofChanged.needsLight).toBe(true);
    const r = lightSession(roofChanged, ctx);
    expect(r.session.project).toBe(roofChanged.project); // Dachform ändert das Licht innen nicht
    expect(worldOf(r.session.project, ctx, uc.shellStyle(r.session))).toBe(r.world);
    // Außen-Deko geändert (C4): Ihre Laternen zählen im Pass mit → neuer Pass; innen war es schon hell, er ergänzt nichts
    // und merkt seine Welt samt Außen-Teilen für Vorschau/Export
    const decorated = uc.setShellStyle(r.session, { exterior: uc.DEFAULT_EXTERIOR });
    expect(decorated.needsLight).toBe(true);
    expect(decorated.project).toBe(r.session.project);
    const d = lightSession(decorated, ctx);
    expect(d.session.project).toBe(decorated.project);
    expect(d.world?.exterior?.length).toBeGreaterThan(0);
    expect(worldOf(d.session.project, ctx, uc.shellStyle(d.session))).toBe(d.world);
    expect(uc.undo(decorated).exterior).toEqual(uc.PLAIN_EXTERIOR);
  });

  it('Außenlicht (C4): Außen-Laternen zählen mit – höchstens so viele Ergänzungen wie ohne Außen-Deko, keine dunklen Stellen', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const low = (exterior: uc.ExteriorChoice): uc.Session => {
      const p = Project.create({ id: 'local', name: 'Halle', seed: 7, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 2 } });
      let s: uc.Session = { ...uc.sessionFromProject(p, { exterior }), needsLight: false };
      for (let i = 0; i < 3; i++) s = uc.paintRect(s, catalog, { x1: 0, z1: i * 8, x2: 26, z2: i * 8 + 6 }, i === 1 ? 'storage' : 'bedroom').session;
      return s;
    };
    const plain = lightSession(low(uc.PLAIN_EXTERIOR), ctx);
    const decorated = lightSession(low({ ...uc.DEFAULT_EXTERIOR, density: 2 }), ctx);
    expect(decorated.world?.exterior?.length).toBeGreaterThan(0);
    expect(decorated.session.light!.added).toBeLessThanOrEqual(plain.session.light!.added);
    expect(decorated.session.light!.darkCells).toBe(0);
    expect(exportReport(worldOf(decorated.session.project, ctx, uc.shellStyle(decorated.session))).darkCells).toBe(0);
  });

  it('Fehler im Pass (Plattform fehlt) → Meldung, Sitzung bleibt benutzbar', () => {
    const broken: PipelineContext = { catalog, themes: load.themeCatalog!, platform: () => { throw new Error('keine Daten'); } };
    const s = sampleSession(catalog);
    const r = lightSession(s, broken);
    expect(r.session.needsLight).toBe(false);
    expect(r.session.light?.error).toContain('keine Daten');
    expect(r.session.project).toBe(s.project);
    expect(lightStatus(r.session.light, false)).toContain('fehlgeschlagen');
  });

  it('Statuszeile', () => {
    expect(lightStatus(undefined, true)).toBe('wird geprüft …');
    expect(lightStatus(undefined, false)).toBe('noch nicht geprüft');
    expect(lightStatus({ added: 3, darkCells: 0, warnings: [], notes: [] }, false)).toBe('+3 ergänzt · keine dunklen Stellen');
    expect(lightStatus({ added: 0, darkCells: 1, warnings: ['x'], notes: [] }, false)).toBe('1 dunkle Zelle');
  });

  it('26.3: Pass läuft mit den Plattform-Daten der Zielversion', async () => {
    const ctx = await pipeline.ready('26.3');
    const s = lit(sampleSession(catalog, { version: '26.3' }), ctx);
    expect(dark(s, ctx)).toBe(0);
    expect(worldOf(s.project, ctx, s.roof).materialized.version).toBe('26.3');
    expect(Project.fromHistory(s.project.history).state).toEqual(s.project.state);
  });
});
