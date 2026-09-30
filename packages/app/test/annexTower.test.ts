/**
 * C4 – angedockte Türme in der App (research/18 T1/T3): Klick an eine Außenwand setzt einen Treppen- oder Eckturm mit
 * Tür je Etage. Der Turm ändert die Hülle (Türen, Aussparung im Dach) → betroffene Räume werden neu eingerichtet, der
 * Licht-Pass steht an; Undo/Redo, Projektdatei (alt/neu), Welt mit Turm (Vorschau = Export).
 */
import { DomainError } from '@mcda/blueprint';
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import { exportReport } from '../src/exporting.js';
import { lightSession } from '../src/lighting.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import * as su from '../src/surroundings.js';
import { baseWorldOf, surroundingsInput } from '../src/surroundingsWorld.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;
const styles = loadBundledTerrainStyles().styles;
const refs = { catalog, themes: load.themeCatalog! };
const shellOf = (s: uc.Session) => uc.shellOf(s.project, uc.shellStyle(s));

/** Zweistöckig 15 × 9 ohne Innentreppe (Taverne unten, Schlafzimmer oben) – das OG erreicht nur ein Treppenturm. */
function house(): uc.Session {
  let s = uc.createSession(2026, 'Turmhaus');
  s = uc.paintRect(s, catalog, { x1: 2, z1: 4, x2: 16, z2: 12 }, 'tavern').session;
  const up = uc.addFloor(s, catalog);
  return uc.paintRect(up.session, catalog, { x1: 2, z1: 4, x2: 16, z2: 12 }, 'bedroom', up.floorIndex).session;
}

describe('Angedockter Turm (C4): setzen, ändern, entfernen', () => {
  it('Treppenturm: Klick neben die Ostwand → mittig davor, Tür je Etage, Obergeschoss erreichbar, Räume neu eingerichtet', () => {
    const s0 = house();
    expect(shellOf(s0).warnings.some((w) => /nicht erreichbar/.test(w))).toBe(true);
    const { session: s1, id } = su.addAnnexTower(s0, catalog, [18, 8], su.DEFAULT_ANNEX);
    expect(id).toBe('a1');
    const item = su.structureById(s1.surroundings, id)!;
    expect(item.kind).toBe('annex');
    if (item.kind !== 'annex') return;
    expect(item.spec).toMatchObject({ kind: 'stair', side: 'west', center: [20, 8], shape: 'square', top: 'roof', levels: 1 });
    expect(item.spec.openings).toEqual([{ floorIndex: 0, at: [16, 8] }, { floorIndex: 1, at: [16, 8] }]);
    // Hülle: Türen hinein, keine „nicht erreichbar“-Warnung mehr, Anbau im Leseport
    const shell = shellOf(s1);
    expect(shell.warnings.filter((w) => /nicht erreichbar|Anbau/.test(w))).toEqual([]);
    expect(shell.annexes?.[0]?.doors.map((d) => `${d.floorIndex}:${d.at.join(',')}`)).toEqual(['0:16,8', '1:16,8']);
    expect(uc.shellStyle(s1).towers).toHaveLength(1);
    expect(uc.shellKey(uc.shellStyle(s1))).not.toBe(uc.shellKey(uc.shellStyle(s0)));
    // ein Undo-Schritt; Räume mit neuer Tür neu eingerichtet (neue Events), Licht-Pass steht an
    expect(s1.past.length).toBe(s0.past.length + 1);
    expect(s1.project.history.length).toBeGreaterThan(s0.project.history.length);
    expect(s1.needsLight).toBe(true);
    const back = uc.undo(s1);
    expect(back.project.history).toEqual(s0.project.history);
    expect(back.surroundings).toEqual(s0.surroundings);
    expect(Object.hasOwn(back, 'towers')).toBe(false);
    expect(uc.shellKey(uc.shellStyle(back))).toBe(uc.shellKey(uc.shellStyle(s0)));
    const again = uc.redo(back);
    expect(again.surroundings).toBe(s1.surroundings);
    expect(again.project).toBe(s1.project);
    // Bauwerks-Eingabe: als angedockter Turm, nicht als freistehender
    const input = surroundingsInput(s1.surroundings, styles)!;
    expect(input.structures).toBeUndefined();
    expect(input.attachedTowers).toEqual([{ ...item.spec, id: 'a1' }]);
  });

  it('Eckturm: an der näheren Hausecke, ragt 2 Zellen über sie hinaus, rund 9 mit Aussichtsstube', () => {
    const choice: su.AnnexChoice = { kind: 'corner', tower: su.ANNEX_TOWER_DEFAULTS.corner };
    const { session, id } = su.addAnnexTower(house(), catalog, [14, 2], choice);
    const item = su.structureById(session.surroundings, id)!;
    if (item.kind !== 'annex') throw new Error('kein Anbau');
    // Nordwand z = 4, Ecke bei x = 16: Turm (r = 4) reicht bis x = 18, steht nördlich davor
    expect(item.spec).toMatchObject({ kind: 'corner', side: 'south', center: [14, -1], shape: 'round', top: 'lookout', hangingLanterns: true });
    expect(item.spec.openings?.length).toBe(2);
    expect(shellOf(session).annexes?.[0]?.doors.length).toBe(2);
    expect(su.structureLabel(item)).toBe('Eckturm a1 · rund · Aussicht · 2 Türen ins Haus');
  });

  it('Gestalt ändern richtet neu aus; Verschieben verboten; Entfernen stellt die Hülle wieder her; Fehler verständlich', () => {
    const s0 = house();
    const { session: s1, id } = su.addAnnexTower(s0, catalog, [18, 8]);
    const s2 = su.setAnnexChoice(s1, catalog, id, { kind: 'stair', tower: { ...su.ANNEX_TOWER_DEFAULTS.stair, shape: 'round', roofShape: 'cone', levels: 3 } });
    const item = su.structureById(s2.surroundings, id)!;
    if (item.kind !== 'annex') throw new Error('kein Anbau');
    expect(item.spec).toMatchObject({ shape: 'round', roofShape: 'cone', levels: 3, center: [21, 8], side: 'west' });
    expect(su.annexChoiceOf(item.spec).tower).toMatchObject({ shape: 'round', roofShape: 'cone', levels: 3, top: 'roof' });
    expect(() => su.moveStructure(s2, id, 1, 0)).toThrow(/hängt an der Hauswand/);
    const s3 = su.removeStructure(s2, id, catalog);
    expect(uc.shellKey(uc.shellStyle(s3))).toBe(uc.shellKey(uc.shellStyle(s0)));
    expect(shellOf(s3).annexes ?? []).toEqual([]);
    expect(() => su.addAnnexTower(s0, catalog, [30, 25])).toThrow(DomainError);
    expect(() => su.addAnnexTower(s0, catalog, [30, 25])).toThrow(/Außenwand/);
  });

  it('Projektdatei: Turm bleibt erhalten (Round-Trip), ältere Dateien ohne Turm laden wie gehabt', () => {
    const { session } = su.addAnnexTower(house(), catalog, [18, 8], { kind: 'corner', tower: su.ANNEX_TOWER_DEFAULTS.corner });
    const r = parseProjectFile(serializeProject(session), refs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.session.surroundings?.structures).toEqual(session.surroundings?.structures);
    expect(uc.shellKey(uc.shellStyle(r.session))).toBe(uc.shellKey(uc.shellStyle(session)));
    // kaputter Anbau (ohne Hausseite) fällt einzeln heraus
    const file = JSON.parse(serializeProject(session)) as { surroundings: { structures: Array<Record<string, unknown>> } };
    const broken = { ...file, surroundings: { ...file.surroundings, structures: [{ ...file.surroundings.structures[0], spec: { center: [1, 2] } }] } };
    const r2 = parseProjectFile(JSON.stringify(broken), refs);
    expect(r2.ok && r2.warnings).toEqual(['1 Bauwerk unlesbar – ausgelassen']);
  });

  it('Welt (Vorschau = Export): Turm am Haus, keine harten Fehler, Licht-Pass ohne dunkle Stellen', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const { session } = su.addAnnexTower(house(), catalog, [18, 8]);
    const s = lightSession(session, ctx).session;
    expect(s.light?.darkCells).toBe(0);
    const world = baseWorldOf(s.project, ctx, uc.shellStyle(s), s.surroundings, styles);
    expect(exportReport(world).errors).toEqual([]);
    const tower = [...world.materialized.volume.cells()].filter((c) => su.structureIdFromOwner(c.owner) === 'a1');
    expect(tower.length).toBeGreaterThan(150);
    // Wendel und Türen: Treppenblöcke im Turm, Türen der Hauswand bei x = 16
    expect(tower.some((c) => c.state.name.endsWith('_stairs'))).toBe(true);
    const doors = uc.shellOf(s.project, uc.shellStyle(s)).annexes![0]!.doors;
    expect(doors.length).toBe(2);
    expect(doors.every((d) => world.materialized.volume.stateAt([d.at[0], d.y, d.at[1]]).name.endsWith('_door'))).toBe(true);
  }, HEAVY_TIMEOUT);
});
