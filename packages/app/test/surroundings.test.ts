/**
 * Modus „Umgebung“ (U2b): Use Cases für Gelände und Bauwerke, Undo/Redo gemeinsam mit den Raum-Aktionen,
 * Projektdatei alt/neu, Berechnung mit Zwischenspeicher und Export (Haus + Umgebung als EINE Welt).
 */
import { importFile, nodeGzip } from '@mcda/export/node';
import { toExport } from '@mcda/pipeline';
import type { Cell } from '@mcda/core';
import { TERRAIN_ROLE_SHAPES, brushCells, buildingFromShell, plotAround, type SiteEvent } from '@mcda/terrain';
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import { strokeCells } from '../src/editor/siteGrid.js';
import { exportProject, exportReport, worldOf } from '../src/exporting.js';
import { lightSession } from '../src/lighting.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import * as su from '../src/surroundings.js';
import { OUTDOOR_COLORS, baseWorldOf, buildingKey, surroundingsInput, surroundingsOf, surroundingsVoxels } from '../src/surroundingsWorld.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;
const terrain = loadBundledTerrainStyles();
const styles = terrain.styles;
const refs = { catalog, themes: load.themeCatalog! };
const shellOf = (s: uc.Session) => uc.shellOf(s.project, uc.shellStyle(s));
const sur = (s: uc.Session): su.SurroundingsState => s.surroundings!;
const site = (s: uc.Session) => su.siteOf(s.surroundings)!;

describe('Geländestile im Bundle', () => {
  it('alle Stile aus catalog/terrain (auch „Gehöft“ aus T2), ohne Fehler', () => {
    expect(terrain.errors).toEqual([]);
    expect([...styles.keys()]).toEqual(expect.arrayContaining(['farmland', 'forest', 'hills', 'meadow', 'homestead']));
    expect(styles.size).toBeGreaterThanOrEqual(5);
    expect(terrain.options.find((o) => o.id === 'meadow')?.name).toBe('Wiese');
    expect(terrain.options.find((o) => o.id === 'homestead')?.name).toBe('Gehöft');
    // Stil-Feld `lighting` ist ein Objekt { mode, every, leaves }
    expect(su.styleLighting(styles.get('homestead'))).toBe('paths');
    expect(su.styleLighting(styles.get('meadow'))).toBe(styles.get('meadow')?.lighting?.mode ?? 'none');
    expect(su.styleLighting(undefined)).toBe('none');
  });

  it('jede Gelände-Rolle (auch die neuen aus T2) hat eine Farbe in der Rollen-Vorschau', () => {
    expect(Object.keys(TERRAIN_ROLE_SHAPES).filter((r) => OUTDOOR_COLORS[r] === undefined)).toEqual([]);
  });

  it('Bauwerksrollen haben eine feste Vorschaufarbe (W7-B: Turmsockel fort_base grau statt Hash-Farbe)', () => {
    expect(['parapet', 'walkway', 'tower_floor', 'arrow_slit', 'fort_base'].filter((r) => OUTDOOR_COLORS[r] === undefined)).toEqual([]);
  });
});

describe('Gelände an/aus, Grundstück', () => {
  it('an: Grundstück = Haus + Rand, Stil und Seed des Projekts; aus behält Zonen; wieder an wie vorher', () => {
    const s0 = sampleSession(catalog);
    const on = su.setTerrainEnabled(s0, true);
    expect(sur(on).terrain).toBe(true);
    const st = site(on);
    expect(st.styleId).toBe('meadow');
    expect(st.seed).toBe(s0.project.state.seed);
    expect(st.plot).toEqual(plotAround(buildingFromShell(shellOf(s0)), su.MARGIN_RANGE.standard));
    expect(su.houseInPlot(shellOf(on), st.plot)).toBe(true);
    expect(su.hasSurroundings(sur(on))).toBe(true);

    const zoned = su.paintZone(on, 'field', { x1: 26, z1: 0, x2: 33, z2: 8 }).session;
    const off = su.setTerrainEnabled(zoned, false);
    expect(sur(off).terrain).toBe(false);
    expect(su.hasSurroundings(sur(off))).toBe(false);
    expect(site(off).zones).toHaveLength(1); // Historie bleibt
    const again = su.setTerrainEnabled(off, true);
    expect(sur(again).site).toBe(sur(zoned).site);
    expect(su.setTerrainEnabled(again, true)).toBe(again); // schon an: keine Aktion
    expect(su.setTerrainEnabled(s0, false)).toBe(s0);
  });

  it('ohne Räume: Grundstück um das Raster des Editors', () => {
    const s = su.setTerrainEnabled(uc.createSession(3), true);
    const m = su.MARGIN_RANGE.standard;
    expect(site(s).plot).toEqual({ minX: -m, minZ: -m, maxX: uc.GRID.width - 1 + m, maxZ: uc.GRID.depth - 1 + m });
  });

  it('Rand anpassen, Grundstück aufziehen, Stil, Neu würfeln; ungültige Werte → fachliche Fehler', () => {
    const s = su.setTerrainEnabled(sampleSession(catalog), true);
    const wide = su.fitPlot(s, 20);
    expect(sur(wide).margin).toBe(20);
    expect(site(wide).plot).toEqual(plotAround(buildingFromShell(shellOf(s)), 20));
    expect(su.fitPlot(wide, 20)).toBe(wide);
    expect(() => su.fitPlot(s, 2)).toThrow(/Rand 2 nicht erlaubt/);

    const drawn = su.setPlot(s, { x1: 40, z1: 30, x2: -10, z2: -8 });
    expect(site(drawn).plot).toEqual({ minX: -10, minZ: -8, maxX: 40, maxZ: 30 });
    expect(() => su.setPlot(s, { x1: 0, z1: 0, x2: 2, z2: 9 })).toThrow(/mindestens 4 × 4/);

    const hills = su.setTerrainStyle(s, 'hills');
    expect(site(hills).styleId).toBe('hills');
    expect(su.setTerrainStyle(hills, 'hills')).toBe(hills);
    const rolled = su.rerollTerrain(s);
    expect(site(rolled).rerollCount).toBe(1);
    expect(() => su.setTerrainStyle(sampleSession(catalog), 'hills')).toThrow(/erst „Gelände“ einschalten/);
  });
});

describe('Zonen und Terraforming', () => {
  it('Zone malen legt das Gelände an, übermalt, radiert, ändert die Art; außerhalb → Fehler', () => {
    const s0 = sampleSession(catalog);
    const r = su.paintZone(s0, 'field', { x1: 26, z1: 0, x2: 35, z2: 10 });
    expect(r.zoneId).toBe('z1');
    expect(sur(r.session).terrain).toBe(true); // Gelände entsteht mit der ersten Zone
    expect(r.session.past.length).toBe(s0.past.length + 1); // EIN Undo-Schritt
    const garden = su.paintZone(r.session, 'garden', { x1: 30, z1: 0, x2: 35, z2: 10 });
    const zones = site(garden.session).zones;
    expect(zones.map((z) => [z.id, z.kind, z.cells.size])).toEqual([
      ['z1', 'field', 4 * 11],
      ['z2', 'garden', 6 * 11],
    ]);
    const erased = su.eraseZones(garden.session, { x1: 26, z1: 0, x2: 29, z2: 10 });
    expect(site(erased).zones.map((z) => z.id)).toEqual(['z2']);
    const pond = su.setZoneKind(erased, 'z2', 'pond');
    expect(site(pond).zones[0]!.kind).toBe('pond');
    expect(su.zoneAt(site(pond), [31, 5])?.id).toBe('z2');
    expect(site(su.removeZone(pond, 'z2')).zones).toEqual([]);
    expect(() => su.paintZone(pond, 'yard', { x1: 300, z1: 300, x2: 305, z2: 305 })).toThrow(/Keine Zelle im Grundstück/);
    expect(su.eraseZones(s0, { x1: 0, z1: 0, x2: 3, z2: 3 })).toBe(s0); // ohne Gelände nichts zu radieren
  });

  it('Terraforming: anheben, senken, ebnen, zurücksetzen (Domain Events des Aggregats)', () => {
    const s = su.setTerrainEnabled(sampleSession(catalog), true);
    const up = su.sculpt(s, 'raise', { x1: -8, z1: -8, x2: -4, z2: -4 }, { amount: 3 });
    expect(site(up).sculpt.get('-6,-6')).toEqual({ delta: 3 });
    const down = su.sculpt(up, 'lower', { x1: -6, z1: -6, x2: -6, z2: -6 }, { amount: 5 });
    expect(site(down).sculpt.get('-6,-6')).toEqual({ delta: -2 });
    const flat = su.sculpt(down, 'flatten', { x1: 30, z1: 20, x2: 31, z2: 21 }, { level: -2 });
    expect(site(flat).sculpt.get('30,20')).toEqual({ delta: 0, level: -2 });
    expect(su.siteSummary(site(flat)).sculpted).toBe(25 + 4);
    const reset = su.sculpt(flat, 'reset', { x1: -8, z1: -8, x2: -4, z2: -4 });
    expect(site(reset).sculpt.size).toBe(4);
    expect(site(su.resetAllTerrain(flat)).sculpt.size).toBe(0);
    expect(() => su.sculpt(s, 'flatten', { x1: 0, z1: 0, x2: 1, z2: 1 }, { level: 99 })).toThrow(/Höhe muss ganzzahlig/);
    expect(site(su.sculpt(s, 'raise', { x1: 500, z1: 500, x2: 501, z2: 501 }))).toBe(site(s)); // außerhalb: nichts
  });

  it('T2: Zonenrand, Außenbeleuchtung, Vorlage „Gehöft“ (Domänen-Befehle, ein Undo-Schritt, Roundtrip)', () => {
    const s0 = sampleSession(catalog);
    const field = su.paintZone(s0, 'field', { x1: 26, z1: 0, x2: 33, z2: 8 });
    const hedged = su.setZoneEdge(field.session, field.zoneId!, 'hedge');
    expect(site(hedged).zones[0]!.edge).toBe('hedge');
    expect(su.setZoneEdge(hedged, field.zoneId!, 'hedge')).toBe(hedged);
    const yard = su.paintZone(hedged, 'yard', { x1: -6, z1: 0, x2: -2, z2: 5 });
    expect(() => su.setZoneEdge(yard.session, yard.zoneId!, 'fence')).toThrow(/hat keinen Rand/);
    expect(su.hasEdge('orchard')).toBe(true);
    expect(su.hasEdge('plaza')).toBe(false);
    const lit = su.setSiteLighting(yard.session, 'spawnproof');
    expect(site(lit).lighting).toBe('spawnproof');

    const tpl = su.applySiteTemplate(lit, 'homestead', { styleId: 'meadow' });
    expect(tpl.past.length).toBe(lit.past.length + 1);
    const kinds = site(tpl).zones.map((z) => z.kind).sort();
    expect(kinds).toEqual(expect.arrayContaining(['field', 'garden', 'yard']));
    expect(site(tpl).zones.some((z) => z.id === field.zoneId)).toBe(false); // Vorlage ersetzt die Zonen
    expect(site(tpl).styleId).toBe('meadow');
    expect(site(uc.undo(tpl))).toEqual(site(lit));
    expect(() => su.applySiteTemplate(uc.createSession(1), 'homestead')).toThrow(/erst Räume malen/);

    const r = parseProjectFile(serializeProject(tpl), refs);
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings).toEqual([]);
    expect(su.siteOf(r.session.surroundings)).toEqual(site(tpl));
  });

  it('Vegetationsdichte: Domain Event `VegetationChanged` (Faktor 0–2), wirkt im Generator', () => {
    const on = su.setTerrainEnabled(sampleSession(catalog), true);
    expect(su.vegetationOf(site(on))).toEqual(su.STYLE_VEGETATION);
    const s = su.setVegetation(on, { trees: 0, ground: 2 });
    expect(s.past.length).toBe(on.past.length + 1);
    expect(site(s).vegetation).toEqual({ trees: 0, bushes: 1, ground: 2 });
    expect(sur(s).site!.at(-1)).toEqual({ type: 'VegetationChanged', vegetation: { trees: 0, bushes: 1, ground: 2 } });
    expect('vegetation' in sur(s)).toBe(false); // keine App-Einstellung mehr
    expect(su.setVegetation(s, { trees: 0 })).toBe(s);
    expect(su.setVegetation(on, { bushes: 1 })).toBe(on); // wie der Stil: kein Event
    expect(() => su.setVegetation(s, { bushes: 3 })).toThrow(/Vegetationsdichte muss in 0 … 2/);
    expect(() => su.setVegetation(sampleSession(catalog), { trees: 0 })).toThrow(/erst „Gelände“ einschalten/);
    expect(site(uc.undo(s))).toEqual(site(on));

    // Der Stil geht unverändert in den Anwendungsdienst, die Dichte wirkt über den Gelände-Zustand
    expect(surroundingsInput(s.surroundings, styles)?.terrainStyle).toBe(styles.get('meadow'));
    const shell = shellOf(s);
    const bare = surroundingsOf(shell, s.surroundings, styles, s.project.state.seed)!.site!;
    const plain = surroundingsOf(shell, on.surroundings, styles, s.project.state.seed)!.site!;
    expect(plain.trees.length).toBeGreaterThan(0);
    expect(bare.trees).toHaveLength(0);
    // W4-D (27.09.2026): wieder gegen den Stil (1). Der Regler sättigte (Wiese 0,95 × 2 → 1, 442 gegen 447); jetzt wirkt
    // er nach allen Pässen und monoton (terrain `finish.test.ts`), 2 > 1 > 0,5
    const low = surroundingsOf(shell, su.setVegetation(on, { ground: 0.5 }).surroundings, styles, s.project.state.seed)!.site!;
    expect(bare.groundPlants).toBeGreaterThan(plain.groundPlants);
    expect(plain.groundPlants).toBeGreaterThan(low.groundPlants);
  });

  it('Glätten (Pinsel, `TerrainSmoothed`) und Weg malen (Zone `path` mit rundem Pinsel)', () => {
    const s0 = su.setTerrainEnabled(sampleSession(catalog), true);
    const { minX, minZ } = site(s0).plot;
    const bumped = su.sculpt(s0, 'raise', { x1: minX + 2, z1: minZ + 2, x2: minX + 4, z2: minZ + 4 }, { amount: 4 });
    const brush = [...brushCells([minX + 3, minZ + 3], 2)];
    const smooth = su.sculpt(bumped, 'smooth', brush);
    expect(smooth.past.length).toBe(bumped.past.length + 1);
    expect(sur(smooth).site!.at(-1)?.type).toBe('TerrainSmoothed');
    expect(site(smooth).sculpt.get(`${minX + 3},${minZ + 3}`)).toEqual({ delta: 4, smooth: true });
    expect(site(smooth).sculpt.get(`${minX + 1},${minZ + 3}`)).toEqual({ delta: 0, smooth: true });
    expect(site(su.sculpt(smooth, 'reset', brush)).sculpt.size).toBe(0); // rechts = natürlich (der Pinsel deckt das Rechteck)
    expect(sur(su.sculpt(sampleSession(catalog), 'smooth', brush)).terrain).toBe(true); // legt das Gelände an wie Anheben

    // Weg: Pinselstrich (Radius 1) quer über das Grundstück
    const stroke = strokeCells([minX + 2, minZ + 8], [minX + 2, minZ + 20], 1);
    const path = su.paintZone(s0, 'path', stroke);
    const zone = site(path.session).zones.find((z) => z.id === path.zoneId)!;
    expect(zone.kind).toBe('path');
    expect(zone.cells.size).toBe(stroke.length);
    expect(su.zoneLabel('path')).toBe('Weg');
    expect(su.BRUSH_ZONES.has('path')).toBe(true);
    const around = surroundingsOf(shellOf(path.session), sur(path.session), styles, path.session.project.state.seed)!.site!;
    const ranks = stroke.map(([x, z]) => around.plan.path[around.grid.at(x, z)]!);
    expect(ranks.every((r) => r >= 1)).toBe(true); // alle Zellen werden Weg (Plan-Karte)
    expect(around.plan.zone[around.grid.at(minX + 2, minZ + 14)]).toBe(path.zoneId);
    // rechts radiert entlang des Strichs
    expect(site(su.eraseZones(path.session, stroke)).zones.some((z) => z.id === path.zoneId)).toBe(false);
  });

  it('Außenbeleuchtung: wie Stil bis zur eigenen Wahl; spawnsicher lässt keine dunkle Stelle', () => {
    const s = su.paintZone(sampleSession(catalog), 'field', { x1: 26, z1: 0, x2: 33, z2: 8 }).session;
    expect(site(s).lighting).toBeUndefined();
    expect(su.siteLighting(site(s), styles.get('homestead'))).toBe('paths');
    const lit = su.setSiteLighting(s, 'spawnproof');
    expect(su.siteLighting(site(lit), styles.get('homestead'))).toBe('spawnproof');
    const report = surroundingsOf(shellOf(lit), sur(lit), styles, lit.project.state.seed)!.site!.features!.lighting!;
    expect(report.dark).toBe(0);
    expect(report.lamps + report.leafLights).toBeGreaterThan(0);
    expect(su.lightingSummary(report, 'spawnproof')).toMatch(/spawnsicher$/);
    expect(su.lightingSummary({ lamps: 1, leafLights: 0, dark: 3 }, 'spawnproof')).toBe('1 Laternenpfahl · 3 dunkel');
    expect(su.lightingSummary({ lamps: 5, leafLights: 2, dark: 0 }, 'paths')).toBe('5 Laternenpfähle · 2 Leuchtbüsche');
  });

  it('Vorlage „Gehöft“ mit Stil homestead: Zonen, Wege nach Rang, Brunnen, Tore; alle Rollen mit Farbe', () => {
    const tpl = su.applySiteTemplate(sampleSession(catalog), 'homestead', { styleId: 'homestead' });
    const st = site(tpl);
    expect(st.styleId).toBe('homestead');
    expect(st.lighting).toBe('paths');
    expect(st.zones.map((z) => z.kind)).toEqual(expect.arrayContaining(['yard', 'garden', 'field', 'paddock', 'orchard']));
    expect(st.zones.find((z) => z.kind === 'garden')?.edge).toBe('hedge');
    const a = surroundingsOf(shellOf(tpl), sur(tpl), styles, tpl.project.state.seed)!;
    const r = a.site!;
    expect(r.features?.wells.length).toBeGreaterThan(0);
    expect(r.features?.gates.length).toBeGreaterThan(0);
    expect(new Set(r.plan.path)).toEqual(new Set([0, 1, 2, 3]));
    expect(r.plan.zone.filter((z) => z !== null).length).toBeGreaterThan(0);
    expect([...new Set(a.cells.filter((c) => c.kind === 'terrain' || c.kind === 'plant').map((c) => c.role))].filter((role) => OUTDOOR_COLORS[role] === undefined)).toEqual([]);
  });
});

describe('Bauwerke', () => {
  const ring: Array<[number, number]> = [[-10, -10], [40, -10], [40, 30], [-10, 30]];

  it('Mauerzug anlegen: offen und als Ring, Punkte bereinigt, zu wenige → Fehler', () => {
    const s0 = sampleSession(catalog);
    const open = su.addWall(s0, [[-5, -5], [-5, -5], [20, -5], [20, -12]], false);
    expect(open.id).toBe('w1');
    const w = su.structureById(sur(open.session), 'w1')!;
    expect(w.kind === 'wall' && w.plan).toEqual({ points: [[-5, -5], [20, -5], [20, -12]], closed: false, profile: 'fortress' });
    const closed = su.addWall(open.session, [...ring, [-10, -10]], true, { profile: 'garden', towers: true });
    expect(closed.id).toBe('w2');
    const g = su.structureById(sur(closed.session), 'w2')!;
    expect(g.kind === 'wall' && g.plan.points).toHaveLength(4); // wiederholter Anfangspunkt entfällt
    expect(g.kind === 'wall' && g.plan.profile).toBe('garden');
    expect(() => su.addWall(s0, [[0, 0]], false)).toThrow(/mindestens 2 Punkte/);
    expect(() => su.addWall(s0, [[0, 0], [5, 0]], true)).toThrow(/mindestens 3 Punkte/);
    const noTowers = su.addWall(s0, ring, true, { profile: 'fortress', towers: false });
    const nt = su.structureById(sur(noTowers.session), 'w1')!;
    expect(nt.kind === 'wall' && nt.plan.towers).toBe('none');
  });

  it('Turm und Windmühle dürfen das Haus nicht überbauen (Merge-Verstoß im Nutzertest)', () => {
    const s0 = sampleSession(catalog);
    const room = s0.project.state.rooms[0]!;
    const b = room.cells.bounds()!;
    const { minX: x0, minZ: z0, maxX: x1, maxZ: z1 } = b;
    const mid: Cell = [Math.floor((x0 + x1) / 2), Math.floor((z0 + z1) / 2)];
    // Mitten im Haus: ablehnen, mit Nutzersprache und Abstand im Text
    expect(() => su.addTower(s0, mid)).toThrow(/würde das Haus überbauen/);
    expect(() => su.addWindmill(s0, mid, { facing: 'west', levels: 3 })).toThrow(/würde das Haus überbauen/);
    // Auch direkt an der Außenwand (Grundriss ragt hinein)
    expect(() => su.addTower(s0, [x1, mid[1]])).toThrow(/überbauen/);
    // Mit Abstand daneben: erlaubt
    const rect = su.houseRect(s0.project.state)!;
    const far: Cell = [rect.maxX + 6, rect.minZ + 2];
    const t = su.addTower(s0, far);
    expect(su.structureById(sur(t.session), t.id)?.kind).toBe('tower');
    // Ohne Räume gibt es nichts zu überbauen
    const empty = uc.createSession(1, 'Leer', 'medieval');
    expect(() => su.addTower(empty, [0, 0])).not.toThrow();
  });

  it('Bauwerke überbauen sich nicht gegenseitig (Review 3: „21 Türme stapelbar“)', () => {
    const s0 = uc.createSession(1, 'Leer', 'medieval');
    const a = su.addTower(s0, [40, 40]);
    // Gleiche Stelle: ablehnen, mit Abstand im Text
    expect(() => su.addTower(a.session, [40, 40])).toThrow(/überbauen/);
    expect(() => su.addTower(a.session, [41, 40])).toThrow(/Abstand/);
    // Windmühle braucht wegen der Flügel mehr Platz
    expect(() => su.addWindmill(a.session, [46, 40], { facing: 'north', levels: 3 })).toThrow(/überbauen/);
    // Mit genug Abstand: erlaubt, und Verschieben in den anderen Turm wird abgelehnt
    const b = su.addTower(a.session, [60, 40]);
    expect(su.structureById(sur(b.session), b.id)?.kind).toBe('tower');
    expect(() => su.moveStructure(b.session, b.id, -20, 0)).toThrow(/überbauen/);
    expect(() => su.moveStructure(b.session, b.id, -1, 0)).not.toThrow();
  });

  it('Mauerzug ändern, verschieben, löschen; Tor per Klick auf die Mauer', () => {
    const { session: s, id } = su.addWall(sampleSession(catalog), ring, true);
    const garden = su.updateWall(s, id, { profile: 'garden', height: 3 });
    const gw = su.structureById(sur(garden), id)!;
    expect(gw.kind === 'wall' && [gw.plan.profile, gw.plan.height]).toEqual(['garden', 3]);
    expect(su.updateWall(garden, id, { profile: 'garden' })).toBe(garden); // gleich: keine Aktion
    expect(() => su.updateWall(s, id, { towerSpacing: 99 })).toThrow(/Turmabstand/);
    expect(() => su.updateWall(s, id, { closed: false, points: [[0, 0]] })).toThrow(/mindestens 2 Punkte/);
    const styled = su.updateWall(s, id, { towerStyle: su.towerStyleOf({ ...su.DEFAULT_TOWER, shape: 'square', roofShape: 'cone', top: 'lookout' }) });
    const sw = su.structureById(sur(styled), id)!;
    expect(sw.kind === 'wall' && sw.plan.towerStyle).toMatchObject({ shape: 'square', top: 'lookout', roofShape: 'tent' });

    // Tor: Klick neben die Südmauer (z = 30) → am nächsten Mauerpunkt
    const gated = su.addGate(s, [15, 31], { width: 3, gatehouse: true });
    expect(gated.wallId).toBe(id);
    const gwall = su.structureById(sur(gated.session), id)!;
    expect(gwall.kind === 'wall' && gwall.plan.gates).toEqual([{ at: [15, 31], width: 3, gatehouse: true }]);
    expect(() => su.addGate(gated.session, [16, 30])).toThrow(/schon ein Tor/);
    expect(() => su.addGate(s, [15, 20])).toThrow(/auf \(oder direkt neben\) eine Mauer/);
    const ungated = su.removeGateAt(gated.session, [15, 30]);
    const uw = su.structureById(sur(ungated), id)!;
    expect(uw.kind === 'wall' && uw.plan.gates).toBeUndefined();
    expect(su.removeGateAt(ungated, [15, 30])).toBe(ungated);
    const byIndex = su.removeGate(gated.session, id, 0);
    expect(sur(byIndex).structures).toEqual(sur(ungated).structures);

    const moved = su.moveStructure(gated.session, id, 2, -1);
    const mw = su.structureById(sur(moved), id)!;
    expect(mw.kind === 'wall' && mw.plan.points[0]).toEqual([-8, -11]);
    expect(mw.kind === 'wall' && mw.plan.gates![0]!.at).toEqual([17, 30]); // Tore wandern mit
    const gone = su.removeStructure(moved, id);
    expect(sur(gone).structures).toEqual([]);
    expect(() => su.removeStructure(gone, id)).toThrow(/Unbekanntes Bauwerk/);
  });

  it('Turm setzen mit Gestalt (Dachform folgt der Grundform), ändern; Windmühle; Auswahl per Zelle', () => {
    const s0 = sampleSession(catalog);
    const t = su.addTower(s0, [-12, 5], { ...su.DEFAULT_TOWER, shape: 'square', top: 'belfry', roofShape: 'helm', flare: true, finial: 'lantern', levels: 4 });
    expect(t.id).toBe('t1');
    const tower = su.structureById(sur(t.session), 't1')!;
    expect(tower.kind === 'tower' && tower.spec).toEqual({ center: [-12, 5], shape: 'square', top: 'belfry', roofShape: 'helm', flare: true, finial: 'lantern', levels: 4 });
    const round = su.setTowerChoice(t.session, 't1', { ...su.towerChoiceOf(tower.kind === 'tower' ? tower.spec : {}), shape: 'round', finial: 'auto' });
    const rt = su.structureById(sur(round), 't1')!;
    expect(rt.kind === 'tower' && [rt.spec.shape, rt.spec.roofShape, rt.spec.finial, rt.spec.center]).toEqual(['round', 'cone', undefined, [-12, 5]]);
    expect(() => su.addTower(s0, [0, 0], { ...su.DEFAULT_TOWER, levels: 12 })).toThrow(/Geschosse nicht erlaubt/);

    const m = su.addWindmill(t.session, [55, 10], { facing: 'west', levels: 3 });
    expect(m.id).toBe('m2');
    const mill = su.updateWindmill(m.session, 'm2', { sailLength: 9 });
    const mm = su.structureById(sur(mill), 'm2')!;
    expect(mm.kind === 'windmill' && mm.spec).toEqual({ center: [55, 10], facing: 'west', levels: 3, sailLength: 9 });
    expect(() => su.updateWindmill(mill, 'm2', { sailLength: 1 })).toThrow(/Flügellänge/);
    expect(() => su.updateWindmill(mill, 't1', { levels: 2 })).toThrow(/keine Windmühle/);

    expect(su.structureAt(sur(mill), [-12, 5])?.id).toBe('t1');
    expect(su.structureAt(sur(mill), [-12 + 4, 5])?.id).toBe('t1'); // Rand des Turms (eckig 7)
    expect(su.structureAt(sur(mill), [-12 + 6, 5])).toBeUndefined();
    expect(su.structureIdFromOwner('fort:w3.t1')).toBe('w3');
    expect(su.structureIdFromOwner('shell:fort:t1')).toBe('t1');
    expect(su.structureIdFromOwner('shell:r1')).toBeUndefined();
    expect(su.structureLabel(mm)).toBe('Windmühle m2 · Flügel West');
  });
});

describe('Undo/Redo gemeinsam mit den Raum-Aktionen', () => {
  it('jede Aktion ein Schritt; Undo stellt die Umgebung davor her, Redo wieder her; Raum-Aktionen behalten die Umgebung', () => {
    const s0 = sampleSession(catalog);
    const s1 = su.paintZone(s0, 'field', { x1: 26, z1: 0, x2: 33, z2: 8 }).session;
    const s2 = su.addWall(s1, [[-6, -6], [30, -6]], false).session;
    const s3 = uc.paintRect(s2, catalog, { x1: 0, z1: 12, x2: 8, z2: 18 }, 'kitchen').session; // Raum-Aktion danach
    expect(s3.surroundings).toBe(s2.surroundings);
    const s4 = su.addTower(s3, [-14, 20]).session;
    expect(sur(s4).structures.map((i) => i.id)).toEqual(['w1', 't2']);

    const u1 = uc.undo(s4);
    expect(u1.surroundings).toBe(s3.surroundings);
    const u2 = uc.undo(u1);
    expect(u2.project.state.rooms).toHaveLength(s2.project.state.rooms.length); // Raum weg
    expect(u2.surroundings).toBe(s2.surroundings);
    const u3 = uc.undo(u2);
    expect(sur(u3).structures).toEqual([]);
    expect(site(u3).zones).toHaveLength(1);
    const u4 = uc.undo(u3);
    expect(u4.surroundings).toBeUndefined();
    const r = uc.redo(uc.redo(u4));
    expect(r.surroundings).toBe(s2.surroundings);

    // Licht-Pass und Undo über einen Projektwechsel behalten bzw. verwerfen die Umgebung richtig
    const fresh = uc.replaceSession(s4, uc.createSession(1));
    expect(fresh.surroundings).toBeUndefined();
    expect(uc.undo(fresh).surroundings).toBe(s4.surroundings);
  });

  it('keine Änderung → kein leerer Undo-Schritt', () => {
    const s = su.addWall(sampleSession(catalog), [[0, -5], [10, -5]], false).session;
    expect(su.moveStructure(s, 'w1', 0, 0)).toBe(s);
    expect(su.updateWall(s, 'w1', { closed: false })).toBe(s);
  });
});

describe('Projektdatei mit Umgebung', () => {
  it('Roundtrip: Gelände-Historie, Bauwerke, Rand, Vegetation bleiben; Undo-Stapel nicht', () => {
    let s = sampleSession(catalog);
    s = su.paintZone(s, 'garden', { x1: 2, z1: -9, x2: 12, z2: -4 }).session;
    s = su.sculpt(s, 'raise', { x1: 30, z1: 20, x2: 34, z2: 24 }, { amount: 2 });
    s = su.setVegetation(s, { trees: 1.5 });
    s = su.addWall(s, [[-10, -12], [40, -12], [40, 28], [-10, 28]], true).session;
    s = su.addGate(s, [15, 28]).session;
    s = su.addTower(s, [50, 0], { ...su.DEFAULT_TOWER, top: 'lookout', roofShape: 'bell' }).session;
    s = su.addWindmill(s, [55, 20], { facing: 'east', levels: 2 }).session;
    const r = parseProjectFile(serializeProject(s), refs);
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings).toEqual([]);
    expect(r.session.surroundings).toEqual(s.surroundings);
    expect(su.siteOf(r.session.surroundings)).toEqual(site(s));
    expect(r.session.past).toEqual([]);
    // danach geht es mit fortlaufenden IDs weiter
    expect(su.addTower(r.session, [60, 40]).id).toBe(`t${sur(s).seq}`);
  });

  it('Turm-Optionen aus O1 (Blitzableiter, Endstab, hängende Glocke, Traufenlaternen) überstehen den Roundtrip', () => {
    let s = sampleSession(catalog);
    s = su.addTower(s, [-14, 0], { ...su.DEFAULT_TOWER, top: 'belfry', finial: 'rod', bell: 'hanging', hangingLanterns: true }).session;
    s = su.addTower(s, [50, 0], { ...su.DEFAULT_TOWER, shape: 'square', finial: 'end_rod' }).session;
    s = su.addWindmill(s, [55, 25]).session;
    s = su.updateWindmill(s, 'm3', { hangingLanterns: true });
    s = su.addWall(s, [[-8, -10], [30, -10]], false).session;
    s = su.updateWall(s, 'w4', { towerStyle: su.towerStyleOf({ ...su.DEFAULT_TOWER, top: 'belfry', bell: 'hanging', finial: 'rod', hangingLanterns: true }) });
    const t1 = su.structureById(sur(s), 't1')!;
    expect(t1.kind === 'tower' && t1.spec).toMatchObject({ top: 'belfry', finial: 'rod', bell: 'hanging', hangingLanterns: true });
    const r = parseProjectFile(serializeProject(s), refs);
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings).toEqual([]);
    expect(r.session.surroundings?.structures).toEqual(sur(s).structures);
    // Abschalten entfernt die Felder wieder (Standard der Domäne)
    const plain = su.setTowerChoice(s, 't1', { ...su.towerChoiceOf(t1.kind === 'tower' ? t1.spec : {}), finial: 'auto', bell: 'floor', hangingLanterns: false });
    const p1 = su.structureById(sur(plain), 't1')!;
    expect(p1.kind === 'tower' && [p1.spec.finial, p1.spec.bell, p1.spec.hangingLanterns]).toEqual([undefined, undefined, undefined]);
    expect(su.towerChoiceOf(p1.kind === 'tower' ? p1.spec : {})).toMatchObject({ finial: 'auto', bell: 'floor', hangingLanterns: false });
  });

  it('alle Site-Events aus T2 (Rand, Licht, Vegetation, Glätten, Weg) überstehen den Roundtrip', () => {
    let s = su.paintZone(sampleSession(catalog), 'field', { x1: 26, z1: 0, x2: 33, z2: 8 }).session;
    s = su.setZoneEdge(s, 'z1', 'hedge');
    s = su.setSiteLighting(s, 'spawnproof');
    s = su.setVegetation(s, { trees: 0.5, ground: 1.5 });
    s = su.sculpt(s, 'smooth', [...brushCells([-4, -4], 2)]);
    s = su.paintZone(s, 'path', strokeCells([-6, 14], [-6, 22], 1)).session;
    const types = new Set(sur(s).site!.map((e) => e.type));
    for (const t of ['ZoneEdgeChanged', 'SiteLightingChanged', 'VegetationChanged', 'TerrainSmoothed', 'ZonePainted'] as const) expect(types.has(t), t).toBe(true);
    const r = parseProjectFile(serializeProject(s), refs);
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings).toEqual([]);
    expect(r.session.surroundings).toEqual(s.surroundings);
    expect(su.siteOf(r.session.surroundings)).toEqual(site(s));
  });

  it('alte Datei mit App-Vegetation `{ trees, bushes, flowers }`: wird zum Domain Event; kaputte Werte fallen heraus', () => {
    const on = su.setTerrainEnabled(sampleSession(catalog), true);
    const file = JSON.parse(serializeProject(on)) as { surroundings: Record<string, unknown> };
    const load = (vegetation: unknown, site?: unknown) => {
      const r = parseProjectFile(JSON.stringify({ ...file, surroundings: { ...file.surroundings, vegetation, ...(site !== undefined ? { site } : {}) } }), refs);
      if (!r.ok) throw new Error(r.error);
      return r;
    };
    const old = load({ trees: 0, bushes: 1.5, flowers: 2 });
    expect(old.warnings).toEqual([]);
    expect(su.siteOf(old.session.surroundings)?.vegetation).toEqual({ trees: 0, bushes: 1.5, ground: 2 });
    expect(old.session.surroundings?.site?.at(-1)?.type).toBe('VegetationChanged');
    expect(old.session.surroundings !== undefined && 'vegetation' in old.session.surroundings).toBe(false);
    // Standard (alles 1) bzw. unsinnige Werte → kein Event, Historie wie gespeichert
    expect(load({ trees: 1, bushes: 1, flowers: 1 }).session.surroundings?.site).toEqual(sur(on).site);
    expect(load({ trees: 'viel', bushes: 7 }).session.surroundings?.site).toEqual(sur(on).site);
    // Historie hat schon eine Dichte → die bleibt
    const set = su.setVegetation(on, { bushes: 0 });
    expect(su.siteOf(load({ trees: 0 }, sur(set).site).session.surroundings)?.vegetation).toEqual({ trees: 1, bushes: 0, ground: 1 });
    // kaputtes Event der Domäne → Gelände beschädigt
    const bad: SiteEvent[] = [...sur(on).site!, { type: 'VegetationChanged', vegetation: { trees: 9, bushes: 1, ground: 1 } }];
    expect(load(undefined, bad).warnings).toEqual(['Gelände beschädigt – ohne Gelände geladen']);
  });

  it('alte Datei ohne Umgebung lädt ohne; beschädigte Teile fallen mit Hinweis heraus', () => {
    const s = sampleSession(catalog);
    const old = JSON.parse(serializeProject(s)) as Record<string, unknown>;
    expect('surroundings' in old).toBe(false);
    const r0 = parseProjectFile(JSON.stringify(old), refs);
    expect(r0.ok && r0.session.surroundings).toBeUndefined();

    const withBad = { ...old, surroundings: { site: [{ type: 'Unsinn' }], terrain: true, structures: [{ kind: 'wall', id: 'w1', plan: { points: [[0, 0]] } }, { kind: 'tower', id: 't2', spec: { center: [5, 5], shape: 'oval', levels: 3 } }] } };
    const r1 = parseProjectFile(JSON.stringify(withBad), refs);
    if (!r1.ok) throw new Error(r1.error);
    expect(r1.warnings).toEqual(['Gelände beschädigt – ohne Gelände geladen', '1 Bauwerk unlesbar – ausgelassen']);
    expect(r1.session.surroundings?.site).toBeUndefined();
    expect(r1.session.surroundings?.terrain).toBe(false);
    expect(r1.session.surroundings?.structures).toEqual([{ kind: 'tower', id: 't2', spec: { center: [5, 5], levels: 3 } }]);
    expect(r1.session.surroundings?.seq).toBe(3);
    expect(su.readSurroundings('kaputt').warnings).toEqual(['Umgebung unlesbar – ohne Umgebung geladen']);
  });
});

describe('Berechnung und Export: Haus + Umgebung als EINE Welt', () => {
  const base = (): uc.Session => {
    let s = sampleSession(catalog);
    s = su.paintZone(s, 'field', { x1: 25, z1: 0, x2: 30, z2: 9 }).session;
    s = su.addWall(s, [[-8, -8], [32, -8], [32, 22], [-8, 22]], true, { profile: 'garden', towers: false }).session;
    s = su.addGate(s, [12, 22], { width: 1, gatehouse: false }).session;
    return su.addTower(s, [40, -6], { ...su.DEFAULT_TOWER, top: 'belfry', finial: 'rod', bell: 'hanging', hangingLanterns: true }).session;
  };

  it('Eingabe und Zwischenspeicher: gleiche Gebäude-Sicht → kein Neuberechnen; Raum malen → neu', () => {
    const s = base();
    const input = surroundingsInput(s.surroundings, styles)!;
    expect(input.site?.styleId).toBe('meadow');
    expect(input.structures?.walls?.[0]?.id).toBe('w1');
    expect(input.structures?.towers?.[0]?.id).toBe('t2');
    expect(surroundingsInput(su.setTerrainEnabled(s, false).surroundings, styles)?.site).toBeUndefined();
    expect(surroundingsInput(undefined, styles)).toBeUndefined();

    const shell = shellOf(s);
    const a = surroundingsOf(shell, s.surroundings, styles, s.project.state.seed)!;
    expect(a.site?.fields).toHaveLength(1);
    expect(a.structures?.walls).toHaveLength(1);
    expect(a.cells.some((c) => c.kind === 'fort' && c.roomId?.startsWith('fort:w1') === true)).toBe(true);
    // Möbel-Aktion: neue Hülle (Replay), gleiche Gebäude-Sicht → dasselbe Ergebnis ohne Rechnen
    const locked = uc.toggleLock(s, catalog, s.project.state.placements[0]!.id);
    expect(buildingKey(shellOf(locked))).toBe(buildingKey(shell));
    expect(surroundingsOf(shellOf(locked), locked.surroundings, styles, s.project.state.seed)).toBe(a);
    // Raum malen ändert die Gebäude-Sicht → neu berechnet
    const grown = uc.paintRect(s, catalog, { x1: 0, z1: 12, x2: 8, z2: 18 }, 'kitchen').session;
    expect(buildingKey(shellOf(grown))).not.toBe(buildingKey(shell));
    expect(surroundingsOf(shellOf(grown), grown.surroundings, styles, s.project.state.seed)).not.toBe(a);

    const voxels = surroundingsVoxels(a);
    expect(voxels.length).toBeGreaterThan(0);
    expect(voxels.length).toBeLessThan(a.cells.length); // Gelände nur als Oberfläche
    expect(voxels.some((v) => v.owner === 'fort:t2')).toBe(true);
    expect(() => surroundingsOf(shell, su.setTerrainStyle(s, 'gibtsnicht').surroundings, styles, 1)).toThrow(/Geländestil „gibtsnicht“ unbekannt/);
  });

  it('Export enthält die Umgebung: mehr Blöcke, größeres Volumen, 0 harte Fehler, Round-Trip', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const s = lightSession(base(), ctx).session;
    const style = uc.shellStyle(s);
    const house = worldOf(s.project, ctx, style);
    const world = baseWorldOf(s.project, ctx, style, s.surroundings, styles);
    expect(baseWorldOf(s.project, ctx, style, s.surroundings, styles)).toBe(world); // zwischengespeichert
    expect(baseWorldOf(s.project, ctx, style, undefined, styles)).toBe(house); // ohne Umgebung: Haus allein
    const rh = exportReport(house);
    const rw = exportReport(world);
    expect(rw.blocks).toBeGreaterThan(rh.blocks * 3);
    expect(rw.size[0]).toBeGreaterThan(rh.size[0]);
    expect(rw.size[2]).toBeGreaterThan(rh.size[2]);
    expect(rw.errors).toEqual([]);
    const owners = new Set<string>();
    for (const c of world.materialized.volume.cells()) {
      const id = su.structureIdFromOwner(c.owner);
      if (id !== undefined) owners.add(id);
    }
    expect([...owners].sort()).toEqual(['t2', 'w1']);

    const file = await exportProject(s.project, world, 'litematic', nodeGzip, { date: Date.UTC(2026, 8, 23) });
    const back = importFile('litematic', file.bytes);
    expect(back.blocks.length).toBe(toExport(s.project, world).blocks.length);
    expect(back.blocks.length).toBe(rw.blocks);
  }, HEAVY_TIMEOUT);
});

describe('Überbau-Schutz für Mauern und Verschieben (Review 3)', () => {
  it('Mauer durch das Haus wird abgelehnt, ein Ring um das Haus bleibt erlaubt', () => {
    const s0 = sampleSession(catalog);
    const rect = su.houseRect(s0.project.state)!;
    const mitte: Cell = [Math.floor((rect.minX + rect.maxX) / 2), Math.floor((rect.minZ + rect.maxZ) / 2)];
    // quer durch das Haus
    expect(() => su.addWall(s0, [[mitte[0] - 12, mitte[1]], [mitte[0] + 12, mitte[1]]], false)).toThrow(/durch das Haus laufen/);
    // Ring außen herum (wie im Test oben) ist erlaubt
    const ring: Cell[] = [[-10, -10], [40, -10], [40, 30], [-10, 30]];
    expect(() => su.addWall(s0, ring, true)).not.toThrow();
  });

  it('Mauer in ein Haus hinein verschieben wird abgelehnt', () => {
    const s0 = sampleSession(catalog);
    const wand = su.addWall(s0, [[-10, -10], [40, -10]], false);
    // weit nach innen schieben: der Mauerpfad kreuzt dann das Haus
    const rect = su.houseRect(wand.session.project.state)!;
    const dx = rect.minX + 2 - -10;
    expect(() => su.moveStructure(wand.session, wand.id, dx, rect.minZ + 2 - -10)).toThrow(/durch das Haus laufen|überbauen/);
  });

  it('Turm im Haus wird beim Verschieben geprüft', () => {
    const s0 = sampleSession(catalog);
    const rect = su.houseRect(s0.project.state)!;
    const t = su.addTower(s0, [rect.maxX + 6, rect.minZ + 2]);
    expect(() => su.moveStructure(t.session, t.id, -(rect.maxX + 6 - rect.minX), 0)).toThrow(/würde das Haus überbauen/);
  });
});
