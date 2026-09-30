/**
 * Burg übernehmen (BT01): Der Assistent setzt Ringmauer **und Wehrplatten** in den Umgebungszustand; die Vorschau
 * (und damit der Export) zeigt die Zinnen als Bauwerk-Zellen. Vorher kannte die App `parapets` nicht und ließ sie
 * stillschweigend weg.
 *
 * Seit dem BT01-Auftrag ist die Wehrplatte **an ihren Baukörper gebunden**: Der Umgebungszustand trägt nur
 * `volumeId` + Zinnenmaß, Spalten und Höhe entstehen beim Bauen aus der Hülle (`parapetSpecsFor`). Die Tests hier
 * prüfen die App-Kette (Plan → Sitzung → Umgebungs-Eingabe → Projektdatei); die eigentliche Absturzursache (Etage
 * radieren) deckt `parapet.test.ts` ab.
 */
import { DEFAULT_VOLUME, DomainError } from '@mcda/blueprint';
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import * as su from '../src/surroundings.js';
import { volumeOf as volumeOfRoom, surroundingsInput } from '../src/surroundingsWorld.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles, types };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });

function castle(size: 'S' | 'M' | 'L' = 'M') {
  const def = types.get('castle_compact');
  const p = { ...bt.defaultParams(def, ctx.themes.ids(), 'medieval', NEW), size };
  return bt.typeSession(def, p, 2026, ctx, NEW);
}

/** Umgebungs-Eingabe wie im Betrieb: mit Hülle und Raum→Baukörper-Zuordnung. */
const eingabe = (s: uc.Session) =>
  surroundingsInput(s.surroundings, ctx.terrainStyles, uc.shellOf(s.project), volumeOfRoom(s.project.state));

describe('Wehrplatten (parapets) beim Bautyp Burg', () => {
  it('der Plan weist dem Bergfried eine Wehrplatte zu, die Sitzung übernimmt sie als Bauwerk-Bindung', () => {
    const { session, plan } = castle();
    const teile = (plan.parts ?? []).filter((p) => p.parapet === 'crenel');
    expect(teile.length, 'kein Teil mit Wehrplatte im Plan').toBeGreaterThan(0);
    const items = (session.surroundings?.structures ?? []).filter((i) => i.kind === 'parapet');
    expect(items.length, 'Wehrplatten fehlen im Umgebungszustand').toBe(teile.length);
    for (const item of items) {
      if (item.kind !== 'parapet') throw new Error('keine Wehrplatte');
      expect(item.id).toBe('keep-parapet'); // Preserve the generator ID; it determines roof access geometry.
      expect(item.volumeId).toBe(teile[0]!.volumeId);
      // Keine feste Kopie: Zellen und Höhe stehen nicht in der Sitzung (sie kommen aus der Hülle)
      expect(item.cells).toBeUndefined();
      expect(item.y).toBeUndefined();
      // Zinnenmaß ist optional (Standard 2/1 aus @mcda/structures) – der Plan nennt nur `parapet: 'crenel'`
    }
  });

  it('sie gehen als Bauwerk-Eingabe in die Umgebungsberechnung (und damit in die Welt)', () => {
    const { session } = castle();
    const sur = session.surroundings!;
    const input = eingabe(session);
    expect(input?.structures?.parapets?.length).toBeGreaterThan(0);
    expect(sur.structures.some((i) => i.kind === 'wall')).toBe(true);
    const spec = input!.structures!.parapets![0]!;
    // Aufgelöste Spalten und Höhe aus der Hülle des Baukörpers – deutlich mehr als eine Attrappe
    expect(spec.cells.length).toBeGreaterThan(20);
    expect(Number.isFinite(spec.y)).toBe(true);
    const keepRooms = session.project.state.rooms.filter((r) => (r.volumeId ?? DEFAULT_VOLUME) === spec.volumeId);
    expect(keepRooms.length).toBeGreaterThan(0);
    // Und die Vorschau/der Export zeigt die Zinnen (Rolle parapet, Herkunft fort:keep-parapet)
    const around = eingabe(session)!;
    expect(around.structures?.parapets).toHaveLength(1);
  });

  it('Projektdatei: die Bindung überlebt Speichern und Laden', () => {
    const { session } = castle('S');
    const text = serializeProject(session);
    const back = parseProjectFile(text, { catalog, themes: load.themeCatalog! });
    expect(back.ok).toBe(true);
    if (!back.ok) throw new Error(back.error);
    const items = (back.session.surroundings?.structures ?? []).filter((i) => i.kind === 'parapet');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ volumeId: session.surroundings!.structures.find((i) => i.kind === 'parapet')!.kind === 'parapet' ? (session.surroundings!.structures.find((i) => i.kind === 'parapet') as Extract<su.StructureItem, { kind: 'parapet' }>).volumeId : 'v0' });
    expect(items[0]!.kind === 'parapet' ? items[0]!.cells : undefined).toBeUndefined();
    // Und nach dem Laden entstehen dieselben Zellen wie vorher
    const vorher = eingabe(session)!.structures!.parapets![0]!;
    const nachher = surroundingsInput(back.session.surroundings, ctx.terrainStyles, uc.shellOf(back.session.project), volumeOfRoom(back.session.project.state))!.structures!.parapets![0]!;
    expect(nachher.cells).toEqual(vorher.cells);
    expect(nachher.y).toBe(vorher.y);
  });

  it('Verschieben ist gesperrt (die Platte folgt dem Baukörper), Entfernen und Label gehen', () => {
    const { session } = castle('S');
    const item = session.surroundings!.structures.find((i): i is Extract<su.StructureItem, { kind: 'parapet' }> => i.kind === 'parapet')!;
    expect(() => su.moveStructure(session, item.id, 3, -2)).toThrow(DomainError);
    expect(() => su.moveStructure(session, item.id, 3, -2)).toThrow(/folgt dessen Flachdach/);
    const removed = su.removeStructure(session, item.id);
    expect(removed.surroundings!.structures.some((i) => i.id === item.id)).toBe(false);
    expect(su.structureLabel(item)).toMatch(/^Wehrplatte keep-parapet · Baukörper v\d+ · Zinnen \d+\/\d+$/);
  });
});
