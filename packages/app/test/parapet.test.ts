/**
 * BT01 Wehrplatten (Auftrag 1): Die Wehrplatte des Bergfrieds ist an ihren **Baukörper** gebunden (`volumeId` +
 * Zinnenmaß); Spalten und Höhe leitet die App beim Bauen aus der Hülle ab (`parapetSpecsFor`). Vorher stand sie als
 * feste Kopie in der Projektdatei: Wurde die oberste Etage radiert, sank das Dach, die Platte blieb in der Luft.
 */
import { DEFAULT_VOLUME } from '@mcda/blueprint';
import { parapetSpecsFor, type ParapetSpec, type StructuresInput } from '@mcda/pipeline';
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { projectFileName, serializeProject, parseProjectFile } from '../src/projectFile.js';
import { roomCellsOf } from '@mcda/pipeline';
import { parapetNotice } from '../src/surroundings.js';
import { structuresInput, volumeOf as volumeOfRoom } from '../src/surroundingsWorld.js';
import * as su from '../src/surroundings.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles, types };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });

/** Burg bauen; liefert Sitzung, Plan und den Baukörper des Bergfrieds. */
function burg(size: 'S' | 'M' = 'M', seed = 3) {
  const def = types.get('castle_compact');
  const params = { ...bt.defaultParams(def, ctx.themes.ids(), 'medieval', NEW), size };
  const { session, plan } = bt.typeSession(def, params, seed, ctx, NEW);
  const keep = plan.parts?.find((p) => p.id === 'keep');
  expect(keep, 'Bergfried im Plan').toBeDefined();
  return { session, plan, keepVolume: keep!.volumeId };
}

/** Wehrplatte, wie sie die App aus der Umgebung baut (aufgelöste Spalten + Höhe). */
function parapetOf(s: uc.Session): ParapetSpec | undefined {
  const shell = uc.shellOf(s.project);
  const volumeOf = volumeOfRoom(s.project.state);
  const input: StructuresInput | undefined = structuresInput(s.surroundings!, (item) => (item.volumeId === undefined ? undefined : parapetSpecsFor(shell, [{ volumeId: item.volumeId }], volumeOf)[0]));
  return input?.parapets?.[0];
}

describe('BT01 Wehrplatte hängt am Baukörper (Auftrag 1)', () => {
  it('wird als Bindung gespeichert (kein Zellen-Abzug) und beim Bauen aus der Hülle aufgelöst', () => {
    const { session, keepVolume } = burg();
    const items = session.surroundings!.structures.filter((i) => i.kind === 'parapet');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'parapet', volumeId: keepVolume });
    // Kein Altbestand: die Datei trägt keine Zellen/Höhe mehr
    expect(items[0]!.cells).toBeUndefined();
    expect(items[0]!.y).toBeUndefined();

    const spec = parapetOf(session);
    expect(spec, 'aufgelöste Wehrplatte').toBeDefined();
    expect(spec!.volumeId).toBe(keepVolume);
    expect(spec!.cells.length).toBeGreaterThan(20);

    // Gegenprobe: die alte, feste Kopie wäre jetzt schon falsch – die Bindung liefert dieselben Werte nur, weil das
    // Dach noch steht. Nach dem Radieren (nächster Test) wandert sie mit.
    const shell = uc.shellOf(session.project);
    expect(parapetSpecsFor(shell, [{ id: 'p1', volumeId: keepVolume }], volumeOfRoom(session.project.state))[0]!.y).toBe(spec!.y);
  });

  it('nach dem Radieren der obersten Bergfried-Etage sitzen die Zinnen auf dem neuen Dach', () => {
    const { session, keepVolume } = burg();
    const vorher = parapetOf(session)!;
    const rooms = session.project.state.rooms.filter((r) => (r.volumeId ?? DEFAULT_VOLUME) === keepVolume);
    const top = Math.max(...rooms.map((r) => r.floorIndex));
    const oben = rooms.filter((r) => r.floorIndex === top);
    expect(oben.length).toBeGreaterThan(0);
    const xs = oben.flatMap((r) => r.cells.toArray().map(([x]) => x));
    const zs = oben.flatMap((r) => r.cells.toArray().map(([, z]) => z));
    const rect = { x1: Math.min(...xs), z1: Math.min(...zs), x2: Math.max(...xs), z2: Math.max(...zs) };

    const radiert = uc.eraseRect(session, catalog, rect, top);
    expect(radiert.project.state.rooms.filter((r) => r.floorIndex === top && (r.volumeId ?? DEFAULT_VOLUME) === keepVolume)).toHaveLength(0);

    const nachher = parapetOf(radiert)!;
    // Das Dach ist gesunken: die Wehrplatte folgt (vorher blieb sie als feste Kopie oben stehen)
    expect(nachher.y).toBeLessThan(vorher.y);
    expect(nachher.volumeId).toBe(keepVolume);
    // Und sie sitzt auf der neuen obersten Hülle dieses Baukörpers – keine Zinne über Luft
    const shell = uc.shellOf(radiert.project);
    const topY = shell.cells.reduce((m, c) => (nachher.cells.some(([x, z]) => x === c.pos[0] && z === c.pos[2]) ? Math.max(m, c.pos[1]) : m), -Infinity);
    expect(nachher.y).toBe(topY);
    // Die Spalten der Platte liegen im (kleineren) Grundriss der neuen obersten Etage
    const neueOben = radiert.project.state.rooms.filter((r) => (r.volumeId ?? DEFAULT_VOLUME) === keepVolume);
    const neueTop = Math.max(...neueOben.map((r) => r.floorIndex));
    const erlaubt = new Set(neueOben.filter((r) => r.floorIndex === neueTop).flatMap((r) => r.cells.toArray().map(([x, z]) => `${x},${z}`)));
    for (const [x, z] of nachher.cells) expect(erlaubt.has(`${x},${z}`), `Zelle ${x},${z} außerhalb`).toBe(true);
  });

  it('Projektdatei: Bindung bleibt Bindung, Altbestand bleibt lesbar', () => {
    const { session, keepVolume } = burg('S');
    const text = serializeProject(session as never);
    expect(text).toContain('"parapet"');
    const back = parseProjectFile(text, { catalog, themes: load.themeCatalog! });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const items = back.session.surroundings?.structures.filter((i) => i.kind === 'parapet') ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'parapet', volumeId: keepVolume });
    expect(items[0]!.cells).toBeUndefined();

    // Altbestand (feste Zellen + Höhe): wird gelesen und ohne Resolver unverändert weitergegeben
    const alt = JSON.parse(text) as Record<string, unknown>;
    const sur = alt['surroundings'] as { structures: Array<Record<string, unknown>> };
    const p = sur.structures.find((i) => i['kind'] === 'parapet')!;
    p['cells'] = [[0, 0], [1, 0], [0, 1], [1, 1]];
    p['y'] = 12;
    const altBack = parseProjectFile(JSON.stringify(alt), { catalog, themes: load.themeCatalog! });
    expect(altBack.ok).toBe(true);
    if (!altBack.ok) return;
    const legacy = altBack.session.surroundings!.structures.find((i) => i.kind === 'parapet')!;
    expect(legacy.cells).toHaveLength(4);
    expect(legacy.y).toBe(12);
  });
});

describe('BT01-Nachbefunde (Review e5108a5)', () => {
  it('Befund 1: der Zinnenkranz sitzt bündig auf der Außenkante der Dachplatte', () => {
    const { session, keepVolume } = burg('M', 2026); // Review-Messung: Burg M, Seed 2026 → Bergfried 11 × 11
    const shell = uc.shellOf(session.project);
    const input = structuresInput(session.surroundings!, (item) =>
      item.volumeId === undefined ? undefined : parapetSpecsFor(shell, [{ volumeId: item.volumeId }], volumeOfRoom(session.project.state), roomCellsOf(session.project.state))[0]);
    const spec = input!.parapets![0]!;
    expect(spec.volumeId).toBe(keepVolume);
    const xs = spec.cells.map(([x]) => x);
    const zs = spec.cells.map(([, z]) => z);
    // Dachplatte = Hüllzellen derselben Spalten auf der Höhe der Platte
    const slab = shell.cells.filter((c) => xs.includes(c.pos[0]) && zs.includes(c.pos[2]) && c.pos[1] === spec.y);
    const sx = slab.map((c) => c.pos[0]);
    const sz = slab.map((c) => c.pos[2]);
    expect(spec.cells.length).toBe(121); // Burg M: 11 × 11 – vorher 9 × 9 (81), um `interior` eingerückt
    expect([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)])
      .toEqual([Math.min(...sx), Math.max(...sx), Math.min(...sz), Math.max(...sz)]);
  });

  it('Befund 3: eine Wehrplatte ohne Baukörper wird im Panel als „wird nicht gebaut“ gekennzeichnet', () => {
    const { session } = burg('S');
    const item = session.surroundings!.structures.find((i) => i.kind === 'parapet')!;
    const mitVolumes = new Set(session.project.state.rooms.map((r) => r.volumeId ?? 'v0'));
    expect(parapetNotice(item, mitVolumes)).toBeUndefined();
    // Alle Räume des Bergfrieds weg → Baukörper existiert nicht mehr
    expect(parapetNotice(item, new Set(['v0']))).toMatch(/ohne Baukörper .* wird nicht gebaut/);
    // Altbestand (feste Zellen, keine Bindung) wird gebaut und als solcher gekennzeichnet
    expect(parapetNotice({ kind: 'parapet', id: 'p9', cells: [[0, 0]], y: 12 }, new Set())).toMatch(/Altbestand/);
    expect(parapetNotice({ kind: 'parapet', id: 'p8' }, new Set())).toMatch(/ohne Baukörper und ohne Zellen/);
  });
});
