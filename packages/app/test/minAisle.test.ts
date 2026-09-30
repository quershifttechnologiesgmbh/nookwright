/**
 * P07 im App-Interface (Auftrag `plan/auftraege/PO_qualitaet_abschluss.md`): Das Häkchen „Mittelgang verbindlich“ im
 * Panel „Gebäude“ reicht `FurnishOptions.minAisle` an die Einrichtung durch. Geprüft wird die Verdrahtung: die
 * Einstellung erreicht den Solver (Konfliktbefund „Mittelgang verbindlich …“), ohne Häkchen ist die Einrichtung
 * bitgleich, der Schalter ist ein Undo-Schritt und wird mit dem Projekt gespeichert.
 */
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const catalog = loadBundledCatalog().catalog!;

/** Enger Raum eines Raumtyps mit Mittelgang (Baracke): Gang und Pflichtmöbel passen dort nicht zusammen. */
function narrowRoom(): { session: uc.Session; roomId: string } {
  const r = uc.paintRect(uc.createSession(7), catalog, { x1: 1, z1: 1, x2: 3, z2: 3 }, 'barracks');
  if (r.roomId === undefined) throw new Error('kein Raum');
  return { session: r.session, roomId: r.roomId };
}

const placements = (s: uc.Session): string[] =>
  s.project.state.placements.map((p) => `${p.roomId}:${p.componentId}#${p.variantId ?? ''}@${JSON.stringify(p.pose)}`);

const aisleWarnings = (s: uc.Session): string[] =>
  [...s.warnings.values()].flat().filter((w) => w.startsWith('Mittelgang verbindlich'));

describe('P07: Mittelgang verbindlich im App-Interface', () => {
  it('das Häkchen erreicht die Einrichtung und meldet den Konflikt als Warnung', () => {
    const { session, roomId } = narrowRoom();
    // Ohne Häkchen (Standard) wird der Gang wie bisher aufgegeben – ohne den P07-Befund
    expect(aisleWarnings(session)).toEqual([]);
    const on = uc.setMinAisle(session, catalog, true);
    expect(on.minAisle).toBe(true);
    expect(on.warnings.get(roomId)?.some((w) => w.startsWith('Mittelgang verbindlich') && w.includes('Pflichtobjekt passt nicht'))).toBe(true);
    // … und beim Abwählen verschwindet der Befund wieder
    const off = uc.setMinAisle(on, catalog, false);
    expect(off.minAisle).toBeUndefined();
    expect(aisleWarnings(off)).toEqual([]);
  });

  it('ohne Häkchen bitgleich: kein leerer Schritt, an/aus stellt die Einrichtung wieder her', () => {
    // W7-G: Beim Malen behalten Nachbarn ihre Möbel (Einrichtung hängt am Weg) – Vergleichsbasis ist die frische
    // Einrichtung aller Räume mit ihrem Seed, wie sie der Schalter herstellt
    const s = uc.act(sampleSession(catalog), catalog, () => undefined, { force: sampleSession(catalog).project.state.rooms.map((r) => r.id) });
    // Schon aus → keine Aktion, keine neue Sitzung
    expect(uc.setMinAisle(s, catalog, false)).toBe(s);
    // Einschalten richtet alle Räume neu ein, Ausschalten führt zum selben Ergebnis zurück (gleicher Seed)
    const on = uc.setMinAisle(s, catalog, true);
    const back = uc.setMinAisle(on, catalog, false);
    expect(placements(back)).toEqual(placements(s));
    expect(back.project.state.rooms).toEqual(s.project.state.rooms);
    expect(back.quality).toEqual(on.quality);
  });

  it('der Schalter ist ein Undo-Schritt und wird mit dem Projekt gespeichert', () => {
    const s = sampleSession(catalog);
    const on = uc.setMinAisle(s, catalog, true);
    expect(uc.canUndo(on)).toBe(true);
    const undone = uc.undo(on);
    expect(undone.minAisle).toBeUndefined();
    expect(placements(undone)).toEqual(placements(s));
    // Projektdatei: nur eingeschaltet steht das Feld in der Datei; Laden stellt den Schalter wieder her
    expect((JSON.parse(serializeProject(s)) as Record<string, unknown>)['minAisle']).toBeUndefined();
    expect((JSON.parse(serializeProject(on)) as Record<string, unknown>)['minAisle']).toBe(true);
    const loaded = parseProjectFile(serializeProject(on), { catalog });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.session.minAisle).toBe(true);
  });
});
