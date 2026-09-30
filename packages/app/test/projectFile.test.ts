/**
 * Speichern/Laden (Event-Historie als JSON: Browser-Speicher über Port `KeyValueStore`, Datei), Umbenennen,
 * Dachform. Rein, Node, ohne DOM.
 */
import { DomainError, Project, TARGET_VERSIONS, type ProjectEvent } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { exportFileName, exportProject, worldOf } from '../src/exporting.js';
import { lightSession } from '../src/lighting.js';
import {
  PROJECT_FILE_FORMAT, PROJECT_FILE_VERSION, STORAGE_KEY, loadFromStore, parseProjectFile, projectFileName, saveToStore, serializeProject, storedInfo, type KeyValueStore,
} from '../src/projectFile.js';
import * as uc from '../src/usecases.js';
import { nodeGzip } from '@mcda/export/node';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const refs = { catalog, themes: load.themeCatalog! };
const pipeline = browserContext(load)!;
const SAVED = new Date(Date.UTC(2026, 8, 23, 12, 0));

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

/** Sitzung mit allem, was gespeichert werden muss: Räume, Einrichtung, Licht-Pass, Sperre, Theme, Name, Dach. */
async function richSession(): Promise<uc.Session> {
  const ctx = await pipeline.ready('1.21.11');
  let s = lightSession(sampleSession(catalog), ctx).session;
  const room = s.project.state.rooms[2]!;
  s = lightSession(uc.rerollRoom(s, catalog, room.id), ctx).session;
  const p = s.project.state.placements.find((x) => x.roomId === room.id)!;
  s = uc.toggleLock(s, catalog, p.id);
  s = uc.setTheme(s, catalog, 'nordic');
  s = uc.renameProject(s, 'Burg Nord');
  s = uc.setRoof(s, 'flat');
  return lightSession(s, ctx).session;
}

describe('Projektdatei: Round-Trip der Historie', () => {
  it('serialisieren → parsen: gleiche Historie, gleicher Zustand, Dach und Name bleiben', async () => {
    const s = await richSession();
    const text = serializeProject(s, { savedAt: SAVED });
    const r = parseProjectFile(text, refs);
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings).toEqual([]);
    expect(r.name).toBe('Burg Nord');
    expect(r.savedAt).toBe(SAVED.toISOString());
    expect(r.session.project.history).toEqual(s.project.history);
    expect(r.session.project.state).toEqual(s.project.state);
    expect(r.session.roof).toBe('flat');
    expect(r.session.past).toEqual([]); // kein Undo über das Laden hinaus
    expect(r.session.needsLight).toBe(true); // der Pass prüft einmal nach …
    const ctx = await pipeline.ready('1.21.11');
    const relit = lightSession(r.session, ctx).session;
    expect(relit.project).toBe(r.session.project); // … und findet nichts zu tun: die Lichter sind gespeichert
    expect(relit.light?.darkCells).toBe(0);
    // JSON ist stabil (Datei = localStorage-Inhalt, nur eingerückt)
    expect(JSON.parse(serializeProject(s, { savedAt: SAVED, pretty: true }))).toEqual(JSON.parse(text));
  });

  it('geladenes Projekt exportiert dieselben Blöcke wie das Original', async () => {
    const s = await richSession();
    const r = parseProjectFile(serializeProject(s), refs);
    if (!r.ok) throw new Error(r.error);
    const ctx = await pipeline.ready('1.21.11');
    const a = await exportProject(s.project, worldOf(s.project, ctx, s.roof), 'nbt', nodeGzip, { date: 0 });
    const b = await exportProject(r.session.project, worldOf(r.session.project, ctx, r.session.roof), 'nbt', nodeGzip, { date: 0 });
    expect(b.name).toBe('Burg Nord.nbt');
    expect(b.bytes).toEqual(a.bytes);
  });

  it('ungültige Dateien werden mit verständlicher Meldung abgelehnt', () => {
    const s = sampleSession(catalog);
    const good = JSON.parse(serializeProject(s)) as Record<string, unknown>;
    const bad = (patch: Record<string, unknown>) => parseProjectFile(JSON.stringify({ ...good, ...patch }), refs);
    const error = (r: ReturnType<typeof parseProjectFile>) => (r.ok ? 'ok' : r.error);
    expect(error(parseProjectFile('{kein json', refs))).toContain('kein JSON');
    expect(error(bad({ format: 'litematic' }))).toContain('Keine Projektdatei');
    expect(error(bad({ version: PROJECT_FILE_VERSION + 1 }))).toContain(`Version ${PROJECT_FILE_VERSION + 1}`);
    // Review 3: krumme/zu kleine Versionen sind „unbekannt“, nicht „Materialisierung fehlgeschlagen“
    expect(error(bad({ version: 99.9 }))).toContain('Unbekannte Projektdatei-Version 99.9');
    expect(error(bad({ version: 1.5 }))).toContain('Unbekannte Projektdatei-Version 1.5');
    expect(error(bad({ version: 0 }))).toContain('Unbekannte Projektdatei-Version 0');
    expect(error(bad({ version: 'zwei' }))).toContain('Unbekannte Projektdatei-Version zwei');
    expect(error(bad({ history: [] }))).toContain('ohne Historie');
    const history = good['history'] as ProjectEvent[];
    expect(error(bad({ history: [...history, { type: 'Hacked' }] }))).toContain('unbekannt');
    expect(error(bad({ history: history.slice(1) }))).toContain('beschädigt');
    expect(error(bad({ history: [history[0], { type: 'RoomPainted', roomId: 'r1', floorIndex: 0, cells: 5, roomTypeId: 'bedroom' }] }))).toContain('beschädigt');
    // unbekannte Dachform → Standard
    const r = bad({ roof: 'gothic' });
    expect(r.ok && r.session.roof).toBe(uc.DEFAULT_ROOF);
  });

  it('Hinweise auf unbekannte Raumtypen, Komponenten und Themes (Projekt lädt trotzdem)', () => {
    const s = sampleSession(catalog);
    const history = s.project.history.map((e) =>
      e.type === 'RoomPainted' && e.roomTypeId === 'kitchen'
        ? { ...e, roomTypeId: 'zz_unbekannt' }
        : e.type === 'RoomFurnished' && e.placements.length > 0
          ? { ...e, placements: e.placements.map((p, i) => (i === 0 ? { ...p, componentId: 'zz_weg/sofa' } : p)) }
          : e.type === 'ProjectCreated'
            ? { ...e, themeId: 'zz_steampunk' }
            : e,
    );
    const r = parseProjectFile(JSON.stringify({ ...JSON.parse(serializeProject(s)), history }), refs);
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings.join('\n')).toMatch(/Raumtypen: zz_unbekannt/);
    expect(r.warnings.join('\n')).toMatch(/zz_weg\/sofa/);
    expect(r.warnings.join('\n')).toMatch(/zz_steampunk/);
  });

  it('Dateiname', () => {
    expect(projectFileName('Burg: Nord')).toBe('Burg_ Nord.projekt.json');
    expect(projectFileName('')).toBe('projekt.projekt.json');
  });
});

describe('Browser-Speicher (Port KeyValueStore)', () => {
  it('speichern → Info → laden (Round-Trip), überschreibt den einen Speicherplatz', async () => {
    const store = memoryStore();
    expect(loadFromStore(store, refs)).toBeUndefined();
    expect(storedInfo(store)).toBeUndefined();
    const s = await richSession();
    const saved = saveToStore(store, s, SAVED);
    expect(saved.ok).toBe(true);
    expect(store.data.has(STORAGE_KEY)).toBe(true);
    expect(storedInfo(store)).toEqual({ name: 'Burg Nord', savedAt: SAVED.toISOString() });
    const r = loadFromStore(store, refs)!;
    if (!r.ok) throw new Error(r.error);
    expect(r.session.project.history).toEqual(s.project.history);
    // zweites Speichern überschreibt
    saveToStore(store, uc.renameProject(s, 'Burg Süd'), SAVED);
    expect(storedInfo(store)?.name).toBe('Burg Süd');
    expect(store.data.size).toBe(1);
  });

  it('Fehlerfälle: kein Speicher, voll, gesperrt, fremder Inhalt – nie eine Ausnahme', () => {
    const s = sampleSession(catalog);
    const none = saveToStore(undefined, s);
    expect(none.ok || none.error).toContain('nicht verfügbar');
    const quota: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
      },
      removeItem: () => undefined,
    };
    const full = saveToStore(quota, s);
    expect(full.ok || full.error).toContain('voll');
    const locked: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const r = loadFromStore(locked, refs);
    expect(r?.ok === false && r.error).toContain('nicht lesbar');
    expect(storedInfo(locked)).toBeUndefined();
    const foreign = memoryStore();
    foreign.setItem(STORAGE_KEY, JSON.stringify({ format: 'etwas-anderes' }));
    expect(storedInfo(foreign)).toBeUndefined();
    const lf = loadFromStore(foreign, refs);
    expect(lf?.ok).toBe(false);
    expect(PROJECT_FILE_FORMAT).toBe('basen-projekt');
  });
});

describe('Projekt-Einstellungen: Name und Dach', () => {
  it('Umbenennen: Event ProjectRenamed, eigener Undo-Schritt, Name im Dateinamen', () => {
    const s = sampleSession(catalog);
    const r = uc.renameProject(s, '  Meine   Basis ');
    expect(r.project.state.name).toBe('Meine Basis');
    expect(r.project.history.slice(s.project.history.length)).toEqual([{ type: 'ProjectRenamed', name: 'Meine Basis' }]);
    expect(r.project.history[0]).toEqual(s.project.history[0]); // ProjectCreated bleibt unverändert
    expect(r.past).toHaveLength(s.past.length + 1);
    expect(r.needsLight).toBe(s.needsLight); // Name ändert kein Licht
    expect(exportFileName(r.project.state.name, 'litematic')).toBe('Meine Basis.litematic');
    const back = uc.undo(r);
    expect(back.project.state.name).toBe('Beispielhaus');
    expect(uc.redo(back).project.state.name).toBe('Meine Basis');
    expect(uc.renameProject(r, 'Meine Basis')).toBe(r);
    expect(() => uc.renameProject(s, '   ')).toThrow(DomainError);
    expect(uc.renameProject(s, 'x'.repeat(200)).project.state.name).toHaveLength(uc.MAX_NAME_LENGTH);
    expect(uc.cleanName('a\u0000b\tc')).toBe('a b c');
  });

  it('Dach: Satteldach ist Standard; Umschalten ändert Hülle, nicht die Einrichtung', () => {
    const s = sampleSession(catalog);
    expect(s.roof).toBe('gable');
    const flat = uc.setRoof(s, 'flat');
    expect(flat.project).toBe(s.project);
    expect(flat.needsLight).toBe(true);
    expect(uc.setRoof(flat, 'flat')).toBe(flat);
    const hipShell = uc.shellOf(s.project, 'hip');
    const flatShell = uc.shellOf(s.project, 'flat');
    expect(hipShell.cells.some((c) => c.kind === 'roof')).toBe(true);
    // W2 (26.09.2026): Regel D8 – das Flachdach hat nur noch ein Gesims (umgedrehte Treppen/obere Stufen auf Deckenhöhe
    // außerhalb der Wand), keine Dachfläche
    const ceilingY = Math.max(...flatShell.cells.filter((c) => c.kind === 'ceiling').map((c) => c.pos[1]));
    expect(flatShell.cells.filter((c) => c.kind === 'roof').every((c) => c.role === 'roof_trim' && c.orient?.half === 'top' && c.pos[1] === ceilingY)).toBe(true);
    for (const r of s.project.state.rooms) expect(uc.geometryKey(flatShell.rooms.get(r.id)!)).toBe(uc.geometryKey(hipShell.rooms.get(r.id)!));
    expect(() => uc.setRoof(s, 'gothic' as never)).toThrow(DomainError);
    // Aktionen behalten die Dachform
    const painted = uc.paintRect(flat, catalog, { x1: 30, z1: 20, x2: 36, z2: 26 }, 'bedroom').session;
    expect(painted.roof).toBe('flat');
    expect(uc.undo(painted).roof).toBe('flat');
  });
});

describe('Wehrplatten-Grenzen beim Laden (Auftrag BT01/2)', () => {
  const datei = (parapet: Record<string, unknown>): string =>
    JSON.stringify({
      format: PROJECT_FILE_FORMAT, version: 2, name: 'X', savedAt: '2026-09-24T10:00:00.000Z',
      history: [{ type: 'ProjectCreated', id: 'p', name: 'X', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['26.3'], floor: { y0: 0, height: 3 } }],
      roof: 'gable',
      surroundings: { terrain: false, margin: 12, seq: 2, structures: [{ kind: 'parapet', id: 'p1', volumeId: 'v0', ...parapet }] },
    });

  it('zu viele Zellen und zu große Ausdehnung werden abgelehnt', () => {
    // 2 Mio. Zellen (wie in der Meldung): schon 5000 überschreiten die Grenze, ohne den Test langsam zu machen
    const viele = Array.from({ length: 5_000 }, (_, i) => [i % 100, Math.floor(i / 100)]);
    const r = parseProjectFile(datei({ cells: viele, y: 12 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Wehrplatte p1 hat 5000 Zellen \(erlaubt sind 4000\)/);

    const breit = Array.from({ length: 300 }, (_, i) => [i, 0]);
    const r2 = parseProjectFile(datei({ cells: breit, y: 12 }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/erstreckt sich über 300 × 1 Blöcke/);

    // Eine normale Platte (11 × 11) bleibt erlaubt
    const normal = Array.from({ length: 121 }, (_, i) => [i % 11, Math.floor(i / 11)]);
    expect(parseProjectFile(datei({ cells: normal, y: 12 })).ok).toBe(true);
    // Bindung ohne Zellen (neues Format) erst recht
    expect(parseProjectFile(datei({})).ok).toBe(true);
  });
});

describe('Grenzen beim Laden (Review 3: präparierte Dateien)', () => {
  const datei = (extra: Record<string, unknown>, events: unknown[]): string =>
    JSON.stringify({ format: PROJECT_FILE_FORMAT, version: 2, name: 'X', savedAt: '2026-09-24T10:00:00.000Z', history: events, ...extra });

  it('Wandhöhe außerhalb 2–16 wird abgelehnt', () => {
    for (const height of [0, 1, 17, 500, 2.5]) {
      const r = parseProjectFile(datei({ roof: 'gable' }, [{ type: 'ProjectCreated', id: 'p', name: 'X', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['26.3'], floor: { y0: 0, height } }]));
      expect(r.ok, `Höhe ${height}`).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Wandhöhe/);
    }
    // 2 und 16 sind erlaubt (wie in der Oberfläche)
    for (const height of [2, 16]) {
      const r = parseProjectFile(datei({ roof: 'gable' }, [{ type: 'ProjectCreated', id: 'p', name: 'X', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['26.3'], floor: { y0: 0, height } }]));
      expect(r.ok, `Höhe ${height}`).toBe(true);
    }
  });

  it('riesige Räume werden abgelehnt (statt den Tab einzufrieren)', () => {
    // Echten Projektzustand bauen und serialisieren (so sieht eine gültige Datei aus)
    const p = Project.create({ id: 'p', name: 'X', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['26.3'], floor: { y0: 0, height: 3 } });
    p.paintRoom(0, CellSet.rect(0, 0, 149, 149), 'kitchen');
    const text = serializeProject(uc.sessionFromProject(p, uc.DEFAULT_ROOF));
    const r = parseProjectFile(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Zellen \(erlaubt sind/);
  });

  it('ungültige Zellen (0.5, "a", null) werden abgelehnt', () => {
    for (const zelle of [[0.5, 1], ['a', 1], [null, 1]]) {
      const r = parseProjectFile(datei({ roof: 'gable' }, [
        { type: 'ProjectCreated', id: 'p', name: 'X', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['26.3'], floor: { y0: 0, height: 3 } },
        { type: 'RoomPainted', roomId: 'r1', roomTypeId: 'kitchen', floorIndex: 0, cells: [zelle] },
      ]));
      expect(r.ok, JSON.stringify(zelle)).toBe(false);
    }
  });

  it('Räume weit auseinander werden abgelehnt (5003 × 5003-Export aus zwei Zellen, Red-Team-Review)', () => {
    const r = parseProjectFile(datei({ roof: 'gable' }, [
      { type: 'ProjectCreated', id: 'p', name: 'X', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['26.3'], floor: { y0: 0, height: 3 } },
      { type: 'RoomPainted', roomId: 'r1', roomTypeId: 'kitchen', floorIndex: 0, cells: [[-2000, -2000], [3000, 3000]] },
    ]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Die Räume erstrecken sich über 5001 × 5001 Blöcke (erlaubt sind 256 × 256)');
    // ein großer, aber normaler Grundriss bleibt erlaubt
    const ok = parseProjectFile(datei({ roof: 'gable' }, [
      { type: 'ProjectCreated', id: 'p', name: 'X', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['26.3'], floor: { y0: 0, height: 3 } },
      { type: 'RoomPainted', roomId: 'r1', roomTypeId: 'kitchen', floorIndex: 0, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
      { type: 'RoomPainted', roomId: 'r2', roomTypeId: 'kitchen', floorIndex: 0, cells: [[250, 250], [250, 251]] },
    ]));
    expect(ok.ok).toBe(true);
  });

  it('unbekannte Minecraft-Version wird beim Laden gemeldet statt später „Materialisierung fehlgeschlagen“', () => {
    const r = parseProjectFile(datei({ roof: 'gable' }, [
      { type: 'ProjectCreated', id: 'p', name: 'X', seed: 1, themeId: 'medieval', targetVersion: { name: '99.9', dataVersion: -1 }, floor: { y0: 0, height: 3 } },
    ]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(`Minecraft 99.9 wird nicht unterstützt (verfügbar: ${Object.keys(TARGET_VERSIONS).join(', ')})`);
  });
});

describe('Leeres Projekt im Export (Review 3)', () => {
  it('ohne Räume meldet die Export-Prüfung einen Fehler statt „Keine Fehler“', async () => {
    const { exportReport } = await import('../src/exporting.js');
    const ctx = await browserContext(loadBundledCatalog())!.ready('1.21.11');
    const leer = lightSession(uc.createSession(7, 'X', 'medieval'), ctx).session;
    const r = exportReport(worldOf(leer.project, ctx, uc.shellStyle(leer)));
    expect(r.errors.map((e) => e.message).join(' ')).toContain('Das Projekt ist leer');
    // Review 4: leerer Bau ist kein „Trotzdem"-Fall – der Dialog sperrt den Knopf (Flag `empty`)
    expect(r.empty).toBe(true);
    // Mit einem Raum verschwindet die Meldung wieder
    const mit = uc.paintRect(uc.createSession(7, 'X', 'medieval'), catalog, { x1: 2, z1: 2, x2: 11, z2: 9 }, 'bedroom');
    const r2 = exportReport(worldOf(mit.session.project, ctx, uc.shellStyle(mit.session)));
    expect(r2.errors.map((e) => e.message).join(' ')).not.toContain('Das Projekt ist leer');
    expect(r2.empty).toBe(false);
  });
});

describe('Erschließung in der Export-Prüfung (Review 3: „Keine Fehler“ trotz Zugang fehlt)', () => {
  it('exportReport nimmt die Erschließungs-Hinweise auf', async () => {
    const { exportReport } = await import('../src/exporting.js');
    const ctx = await browserContext(loadBundledCatalog())!.ready('1.21.11');
    const s = lightSession(uc.createSession(7, 'X', 'medieval'), ctx).session;
    const world = worldOf(s.project, ctx, uc.shellStyle(s));
    const ohne = exportReport(world);
    expect(ohne.access).toEqual([]);
    const mit = exportReport(world, ['Etage ohne Treppenzugang (nur über einen Sprung erreichbar): r5']);
    expect(mit.access).toHaveLength(1);
    expect(mit.access[0]).toContain('Treppenzugang');
  });
});
