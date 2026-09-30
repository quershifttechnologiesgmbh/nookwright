/**
 * F „Bereich neu einrichten“ in der App (plan/spikes/F_zone_refurnish.md): Use Case über `act` (ein Undo-Schritt),
 * eingefrorener Teil bytegleich, Projektdatei-Round-Trip des neuen Events, Schalter standardmäßig aus.
 */
import { describe, expect, it } from 'vitest';
import { CellSet } from '@mcda/core';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import * as br from '../src/blockRefurnish.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;

describe('F Bereich neu einrichten (App)', () => {
  it('Schalter: Standard an, ?bereich=1 an, ?bereich=0 aus', () => {
    expect(br.BLOCK_REFURNISH).toBe(true);
    expect(br.blockRefurnishEnabled('')).toBe(true);
    expect(br.blockRefurnishEnabled('?bereich=1')).toBe(true);
    expect(br.blockRefurnishEnabled('?x=2&bereich=0')).toBe(false);
  });

  it('Zone neu: Rest bytegleich, ein Undo-Schritt, Projektdatei liest das Event', () => {
    const s = sampleSession(catalog);
    const room = s.project.state.rooms.find((r) => r.roomTypeId === 'smithy')!;
    const zones = br.roomZonesOf(s, catalog, room.id);
    expect(zones.length).toBeGreaterThanOrEqual(1);
    const { session, report } = br.refurnishBlock(s, catalog, room.id, zones[0]!);
    expect(report.ok).toBe(true);
    expect(br.blockRefurnishText(report)).toMatch(/^Bereich neu eingerichtet/);
    const removed = new Set(report.removed);
    const kept = s.project.state.placements.filter((p) => !removed.has(p.id));
    expect(JSON.stringify(session.project.state.placements.slice(0, kept.length))).toBe(JSON.stringify(kept));
    // Raum-Einrichtung sonst unangetastet (kein Neu-Einrichten durch `act`), Warnungen der anderen Räume bleiben
    expect(session.project.history.length).toBe(s.project.history.length + 1);
    expect(uc.canUndo(session)).toBe(true);
    const back = uc.undo(session);
    expect(JSON.stringify(back.project.state)).toBe(JSON.stringify(s.project.state));
    // Projektdatei
    const r = parseProjectFile(serializeProject(session));
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.session.project.state)).toBe(JSON.stringify(session.project.state));
  });

  it('Rechteck nur auf der Wand: freundlich abgelehnt (kein interner Fehler); Möbel → seine Zone', () => {
    const s = sampleSession(catalog);
    const room = s.project.state.rooms[0]!;
    const b = room.cells.bounds()!;
    const wall = CellSet.rect(b.minX, b.minZ, b.maxX, b.minZ);
    expect(wall.intersection(room.cells).isEmpty).toBe(false); // liegt im Raum (Wandring) …
    expect(br.blockCellsIn(s, catalog, room.id, wall).isEmpty).toBe(true); // … aber nicht im Inneren → Meldung in App.tsx
    const r = br.refurnishBlock(s, catalog, room.id, wall);
    expect(r.session).toBe(s);
    expect(r.report.ok).toBe(false);
    expect(br.blockRefurnishText(r.report)).toMatch(/nicht im Rauminneren.*nichts geändert/);
    expect(br.blockRefurnishText({ ...r.report, ok: true, changed: false })).toMatch(/nichts geändert/);
    const p = s.project.state.placements.find((x) => x.roomId === room.id && x.parentId === undefined)!;
    const z = br.zoneOfPlacement(s, catalog, p.id);
    expect(z?.roomId).toBe(room.id);
    expect(z!.cells.has(p.pose.pos[0], p.pose.pos[2]) || z!.cells.size > 0).toBe(true);
  });

  it('W8-H Wohnstube (Tutorial): früher „1 Möbel ersetzt durch 0“ – erst leer, jetzt Versuch 2 mit Möbeln', () => {
    // per Scan gefunden (Seed 3, Rechteck 2 × 2 vor dem Kamin): der erste Versuch räumte den Bereich nur leer.
    // FN-Integration (2026-09-29): Die dichte Wohnstube (Ecknischen, Teppiche, Wandbehänge) richtet Seed 3 schon im ersten
    // Versuch mit Möbeln ein („1 Möbel ersetzt durch 1“) – gleichwertig bis besser, der Fall „erst leer“ tritt dort nicht mehr
    // auf. Der Regressionsfall wandert auf Seed 23 (Scan Seeds 1–40, gleicher Aufbau): Versuch 2, 2 Möbel → 3.
    let s = uc.createSession(23, 'Tutorial');
    s = uc.paintRect(s, catalog, { x1: 14, z1: 11, x2: 22, z2: 18 }, 'solar').session;
    s = uc.paintRect(s, catalog, { x1: 23, z1: 11, x2: 28, z2: 18 }, 'kitchen').session;
    const room = s.project.state.rooms.find((r) => r.roomTypeId === 'solar')!;
    const { session, report } = br.refurnishBlock(s, catalog, room.id, CellSet.rect(19, 14, 20, 15));
    // Versuch 1 (leer) wird verworfen, Versuch 2 stellt wieder etwas auf
    expect(report.ok).toBe(true);
    expect(report.attempts).toBe(2);
    expect(report.added).toBeGreaterThan(0);
    expect(session.project.history.length).toBe(s.project.history.length + 1);
    expect(br.blockRefurnishText(report)).not.toMatch(/ersetzt durch 0/);
  });
});
