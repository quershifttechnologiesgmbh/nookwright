/**
 * Außen-Deko (U3, X1 in der App): Einstellung der Sitzung, Undo/Redo, Plan (`exteriorOf`), Vorschau = Export, mit
 * Umgebung, Projektdatei alt/neu, Rollen-Vorschau. Dazu die Stil-Kette an der Einrichtung (Signatur-Tausch, Hinweise),
 * die Qualitäts-Hinweise, der Passt-Hinweis der Raumtyp-Palette und die Raumtyp-Gruppen.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { key3 } from '@mcda/core';
import { EXTERIOR_GROUPS, furnishRoomsDetailed, moodOption, styleChainOf, toExport } from '@mcda/pipeline';
import { isAir } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import { worldOf } from '../src/exporting.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import * as su from '../src/surroundings.js';
import { baseWorldOf, surroundingsOf } from '../src/surroundingsWorld.js';
import { templateSession } from '../src/templates.js';
import { explainNote, qualitySummary } from '../src/ui/quality.js';
import { OTHER_GROUP, ROOM_TYPE_GROUPS, roomTypeGroupOf, roomTypeInfos, roomTypeMisfits } from '../src/ui/roomTypeGroups.js';
import * as uc from '../src/usecases.js';
import { buildPreviewVoxels } from '../src/viewer/voxels.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;
const terrain = loadBundledTerrainStyles().styles;

const ext = (s: uc.Session, patch: Partial<uc.ExteriorChoice>): uc.Session => uc.setShellStyle(s, { exterior: { ...uc.shellStyle(s).exterior, ...patch } }, catalog);
const planOf = (s: uc.Session) => uc.exteriorOf(s.project, catalog, uc.shellStyle(s));
const countOf = (s: uc.Session) => planOf(s)?.placements.length ?? 0;

describe('Außen-Deko: Einstellung der Sitzung', () => {
  it('neue Projekte: an, alle Gruppen, Dichte 1; `ExteriorStyle` nur mit Abweichungen, aus = weglassen', () => {
    const s = sampleSession(catalog);
    expect(uc.shellStyle(s).exterior).toEqual(uc.DEFAULT_EXTERIOR);
    expect(EXTERIOR_GROUPS.every((g) => uc.DEFAULT_EXTERIOR.groups[g])).toBe(true);
    expect(uc.exteriorOptions(uc.DEFAULT_EXTERIOR)).toEqual({ density: 1 }); // = „alles an“
    expect(uc.exteriorOptions(uc.PLAIN_EXTERIOR)).toBeUndefined(); // aus = kein `exterior`
    const custom: uc.ExteriorChoice = { ...uc.DEFAULT_EXTERIOR, density: 1.5, variation: 3, groups: { ...uc.DEFAULT_EXTERIOR.groups, shutters: false, ridgeDecor: false } };
    expect(uc.exteriorOptions(custom)).toEqual({ density: 1.5, variation: 3, shutters: false, ridgeDecor: false });
  });

  it('ein Undo-Schritt je Änderung, Wiederholen; Hülle, Einrichtung und Licht bleiben; Statuszeile', () => {
    const s0 = sampleSession(catalog);
    const off = ext(s0, { enabled: false });
    expect(off.past).toHaveLength(s0.past.length + 1);
    expect(off.project).toBe(s0.project); // nichts neu eingerichtet
    expect(uc.shellOf(off.project, uc.shellStyle(off))).toBe(uc.shellOf(s0.project, uc.shellStyle(s0))); // gleiche Hülle
    expect(uc.shellKey(uc.shellStyle(off))).toBe(uc.shellKey(uc.shellStyle(s0)));
    expect(uc.styleKey(uc.shellStyle(off))).not.toBe(uc.styleKey(uc.shellStyle(s0)));
    expect(off.needsLight).toBe(s0.needsLight);
    expect(uc.shellStyle(uc.undo(off)).exterior).toEqual(uc.DEFAULT_EXTERIOR);
    expect(uc.shellStyle(uc.redo(uc.undo(off))).exterior.enabled).toBe(false);
    expect(ext(off, { enabled: false })).toBe(off); // keine Änderung → keine Aktion
    const before = uc.shellStyle(s0);
    const label = (patch: Partial<uc.ExteriorChoice>) => uc.styleChangeLabel(before, { exterior: { ...before.exterior, ...patch } });
    expect(label({ enabled: false })).toBe('Außen-Deko: aus');
    expect(label({ groups: { ...before.exterior.groups, chimneys: false } })).toBe('Schornsteine: aus');
    expect(label({ density: 1.5 })).toBe('Außen-Dichte: 150 %');
    expect(label({ variation: 2 })).toBe('Außen-Deko neu gewürfelt (Variante 2)');
  });

  it('ungültige Werte → fachlicher Fehler', () => {
    const s0 = sampleSession(catalog);
    expect(() => ext(s0, { density: 3 })).toThrow(/Außen-Dichte 3/);
    expect(() => ext(s0, { variation: -1 })).toThrow(/Außen-Variante/);
    expect(() => ext(s0, { variation: 1.5 })).toThrow(/Außen-Variante/);
  });
});

describe('Außen-Deko: Plan, Vorschau und Export', () => {
  it('Plan aus Hülle, Einrichtung und Stil: zwischengespeichert, Gruppen-Schalter, Dichte, Neu würfeln', () => {
    const s0 = sampleSession(catalog);
    const plan = planOf(s0)!;
    expect(plan.placements.length).toBeGreaterThan(20);
    expect(planOf(s0)).toBe(plan);
    expect(plan.counts.chimneys).toBeGreaterThan(0); // Küche und Schmiede haben Feuerstellen
    expect(planOf(ext(s0, { enabled: false }))).toBeUndefined();
    const noChimney = ext(s0, { groups: { ...uc.DEFAULT_EXTERIOR.groups, chimneys: false } });
    expect(planOf(noChimney)!.counts.chimneys).toBe(0);
    expect(planOf(noChimney)!.placements.some((p) => p.group === 'chimneys')).toBe(false);
    expect(countOf(ext(s0, { density: 0 }))).toBeLessThan(plan.placements.length);
    expect(countOf(ext(s0, { density: 2 }))).toBeGreaterThan(plan.placements.length);
    const rolled = (v: number) => planOf(ext(s0, { variation: v }))!.placements.map((p) => `${p.id}#${p.variantId ?? ''}`).join();
    expect(new Set([0, 1, 2, 3].map(rolled)).size).toBeGreaterThan(1);
    // Rollen-Vorschau: Außen-Teile als eigene Herkunft, Dachteile mit dem Dach, Fassade mit den Wänden
    const voxels = buildPreviewVoxels(uc.shellOf(s0.project, uc.shellStyle(s0)), uc.placedViews(s0.project.state, catalog), uc.exteriorViews(plan, catalog));
    const outside = voxels.filter((v) => v.owner?.startsWith('x1:') === true);
    expect(outside.length).toBeGreaterThan(0);
    expect(new Set(outside.filter((v) => v.owner!.startsWith('x1:chimneys')).map((v) => v.layer))).toEqual(new Set(['ceiling']));
    expect(new Set(outside.filter((v) => v.owner!.startsWith('x1:shutters')).map((v) => v.layer))).toEqual(new Set(['wall']));
  });

  it('Vorschau = Export: dieselbe Welt mit Außen-Teilen; aus = Welt ohne; keine harten Verstöße', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const s = sampleSession(catalog);
    const world = worldOf(s.project, ctx, uc.shellStyle(s));
    expect(world.exterior).toEqual(planOf(s)!.placements);
    expect(worldOf(s.project, ctx, uc.shellStyle(s))).toBe(world);
    expect(world.materialized.violations.filter((v) => v.severity === 'error' && v.kind !== 'spawn')).toEqual([]);
    const off = ext(s, { enabled: false });
    const plain = worldOf(off.project, ctx, uc.shellStyle(off));
    expect(plain.exterior).toBeUndefined();
    // Außen-Zellen stehen im Export (und nur dort kommen Blöcke dazu)
    const exported = toExport(s.project, world);
    const [ox, oy, oz] = world.materialized.volume.origin;
    const at = new Set(exported.blocks.map((b) => key3([b.pos[0] + ox, b.pos[1] + oy, b.pos[2] + oz])));
    const cells = world.exterior!.flatMap((p) => p.cells.filter((c) => !isAir(world.materialized.volume.cell(c)!.state)));
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => at.has(key3(c)))).toBe(true);
    const solid = (w: typeof world) => [...w.materialized.volume.cells()].filter((c) => !isAir(c.state)).length;
    expect(solid(world)).toBeGreaterThan(solid(plain));
  });

  it('mit Umgebung: Gelände hält die bodennahen Außen-Teile frei, nichts entfällt; Cache je Außen-Deko', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const s = su.setTerrainEnabled(sampleSession(catalog), true);
    const style = uc.shellStyle(s);
    const shell = uc.shellOf(s.project, style);
    const plan = planOf(s)!;
    const ground = uc.groundExterior(plan);
    expect(ground.length).toBeGreaterThan(0);
    expect(ground.some((p) => uc.EXTERIOR_ROOF_GROUPS.has(p.group))).toBe(false);
    const around = surroundingsOf(shell, s.surroundings, terrain, s.project.state.seed, ground)!;
    expect(surroundingsOf(shell, s.surroundings, terrain, s.project.state.seed, [...ground])).toBe(around); // Schlüssel = Zellen
    const occupied = new Set(around.cells.map((c) => key3(c.pos)));
    expect(plan.placements.flatMap((p) => p.cells).some((c) => occupied.has(key3(c)))).toBe(false);
    const world = baseWorldOf(s.project, ctx, style, s.surroundings, terrain);
    expect(world.exterior).toHaveLength(plan.placements.length);
    expect(world.materialized.violations.filter((v) => v.severity === 'error' && v.kind !== 'spawn')).toEqual([]);
    // ohne Außen-Deko: dieselbe Kette, Welt ohne Außen-Teile
    const off = ext(s, { enabled: false });
    expect(baseWorldOf(off.project, ctx, uc.shellStyle(off), off.surroundings, terrain).exterior).toBeUndefined();
  });

  it('Vorlagen übernehmen die Außen-Deko des bisherigen Projekts', () => {
    const s = ext(sampleSession(catalog), { density: 2, variation: 4 });
    const t = templateSession('twostory', catalog, 9, 'medieval', uc.shellStyle(s));
    expect(uc.shellStyle(t).exterior).toEqual(uc.shellStyle(s).exterior);
    expect(countOf(t)).toBeGreaterThan(0);
  });
});

describe('Außen-Deko: Projektdatei', () => {
  it('Round-Trip; ältere Dateien ohne Außen-Deko laden ohne; kaputte Felder fallen einzeln zurück', () => {
    const s = ext(sampleSession(catalog), { density: 0.75, variation: 5, groups: { ...uc.DEFAULT_EXTERIOR.groups, flowerBoxes: false } });
    const text = serializeProject(s);
    const r = parseProjectFile(text, { catalog });
    expect(r.ok && uc.shellStyle(r.session).exterior).toEqual(uc.shellStyle(s).exterior);
    const data = JSON.parse(text) as Record<string, unknown>;
    delete data['exterior'];
    const old = parseProjectFile(JSON.stringify(data));
    expect(old.ok && uc.shellStyle(old.session).exterior).toEqual(uc.PLAIN_EXTERIOR);
    data['exterior'] = { enabled: true, density: 9, variation: 'x', groups: { shutters: false, portal: 'nein', unknown: false } };
    const broken = parseProjectFile(JSON.stringify(data));
    expect(broken.ok && uc.shellStyle(broken.session).exterior).toEqual({
      enabled: true, density: 1, variation: 0, groups: { ...uc.DEFAULT_EXTERIOR.groups, shutters: false },
    });
  });
});

describe('Stil-Kette an der Einrichtung (Signatur-Tausch wie in der Pipeline)', () => {
  const solar = (theme: string) => uc.paintRect(uc.createSession(7, 'x', theme), catalog, { x1: 5, z1: 5, x2: 16, z2: 13 }, 'solar').session;
  const signature = (s: uc.Session) => s.project.state.placements.map((p) => p.componentId).filter((id) => catalog.get(id).tags.includes('fireplace'));

  it('Theme-Kette umgedreht; ohne angemeldete Themes oder unbekanntes Theme: keine', () => {
    expect(uc.styleChain(catalog, 'medieval')).toEqual(['medieval']);
    expect(uc.styleChain(catalog, 'nordic')).toEqual(['nordic', 'medieval']);
    expect(uc.styleChain(catalog, 'rustic')).toBe(uc.styleChain(catalog, 'rustic'));
    expect(uc.styleChain(catalog, 'gibtsnicht')).toBeUndefined();
  });

  it('App richtet ein wie `furnishRoomsDetailed` mit `styleChainOf`: Rustikal nimmt den rustikalen Kamin', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const rustic = solar('rustic');
    const medieval = solar('medieval');
    expect(signature(rustic)).not.toEqual(signature(medieval));
    for (const s of [rustic, medieval]) {
      const copy = uc.createSession(7, 'x', s.project.state.themeId).project;
      copy.paintRoom(0, s.project.state.rooms[0]!.cells, 'solar');
      const res = furnishRoomsDetailed(copy, uc.shellOf(copy, uc.shellStyle(s)), catalog, { styles: styleChainOf(copy, ctx), ...moodOption(copy, ctx) }); // wie generateWith/project_furnish (Stimmung)
      expect(res.warnings).toEqual([]);
      expect(copy.state.placements.map((p) => [p.componentId, p.pose])).toEqual(s.project.state.placements.map((p) => [p.componentId, p.pose]));
    }
  });

  it('Theme-Wechsel richtet mit der neuen Kette neu ein (ein Undo-Schritt), zurück ergibt die alte Einrichtung', () => {
    const medieval = solar('medieval');
    const rustic = uc.setTheme(medieval, catalog, 'rustic');
    expect(signature(rustic)).toEqual(signature(solar('rustic')));
    expect(rustic.past).toHaveLength(medieval.past.length + 1);
    const back = uc.setTheme(rustic, catalog, 'medieval');
    const layout = (s: uc.Session) => s.project.state.placements.map((p) => [p.componentId, p.variantId, p.pose]);
    expect(layout(back)).toEqual(layout(medieval));
    expect(uc.undo(rustic).project.state).toEqual(medieval.project.state);
  });

  it('unpassender Raumtyp: Hinweis in der Qualität, sichtbar als wichtiger Hinweis', () => {
    const s = uc.paintRect(uc.createSession(3, 'x', 'rustic'), catalog, { x1: 2, z1: 2, x2: 12, z2: 10 }, 'barracks').session;
    const q = s.quality!.get(s.project.state.rooms[0]!.id)!;
    expect(q.notes.join()).toMatch(/passt nicht zum Stil rustic\/medieval/);
    expect(qualitySummary(q).alerts.join()).toMatch(/„Kaserne“ passt nicht zum Stil des Themes \(rustic → medieval\)/);
  });
});

describe('Qualitäts-Hinweise und Passt-Hinweis der Palette', () => {
  it('Notizen des Solvers → verständliche Sätze; Theme und Wandhöhe oben, der Rest im Aufklapper', () => {
    expect(explainNote('lichte Höhe 4 unter der Mindesthöhe 5 für „Portalraum“: Signatur in Kompaktform')).toEqual({
      kind: 'height',
      text: 'Raum zu niedrig: Wandhöhe 4, „Portalraum“ braucht 5. Das Hauptmöbel steht deshalb in Kompaktform – Wandhöhe der Etage erhöhen (Klick auf die aktive Etage in der Etagen-Leiste).',
    });
    expect(explainNote('Layout gelockert (Mittelgang 2 breit): Pflichtobjekt passte sonst nicht').kind).toBe('layout');
    expect(explainNote('ohne Mittelgang/Freifläche eingerichtet: Pflichtobjekt passte sonst nicht').text).toMatch(/^Ohne Mittelgang/);
    expect(explainNote('Pflichtobjekt bed|cot per Backtracking platziert (table/x umgestellt)').text).toBe('Pflichtmöbel (bed|cot) erst nach Umstellen untergebracht: table/x umgestellt.');
    // W8-B: Rückfall der Regel `useAccess`
    expect(explainNote('Nutzungsseite von bunk_bed in Engstelle oder Sackgasse: Pflichtobjekt passte sonst nicht')).toEqual({
      kind: 'layout',
      text: 'Pflichtmöbel (bunk_bed) ist nur über eine Engstelle oder Sackgasse zu benutzen, sonst hätte es nicht gepasst. Ein größerer Raum hilft.',
    });
    // W8-E: Stücke über der Mindestzahl
    expect(explainNote('1 × corner_shelf über der Mindestzahl entfällt: kein Platz im Raum')).toEqual({
      kind: 'layout',
      text: '1 × corner_shelf weniger als gewünscht (kein Platz mehr an Wand oder Boden); die Mindestzahl steht. Ein größerer Raum hilft.',
    });
    expect(explainNote('2 × counter über der Mindestzahl entfällt: Hauptweg hat Vorrang').text).toMatch(/der Hauptweg hat Vorrang/);
    expect(explainNote('Von Hand entfernt: Tisch')).toEqual({ kind: 'other', text: 'Von Hand entfernt: Tisch' });
    const q = qualitySummary({
      score: 0.8,
      parts: [],
      notes: ['Raumtyp „Kaserne“ passt nicht zum Stil rustic/medieval (styleTags)', 'Layout gelockert (Freifläche 6 Zellen): Pflichtobjekt passte sonst nicht'],
    });
    expect(q.alerts).toHaveLength(1);
    expect(q.notes).toEqual(['Layout gelockert (Freifläche 6 Zellen), sonst hätte ein Pflichtmöbel nicht gepasst. Ein größerer Raum lässt Gang bzw. Freifläche wie vorgesehen.']);
  });

  it('Palette: Stil-Filter und Mindesthöhe gegen Theme-Kette und aktive Etage', () => {
    const info = new Map(roomTypeInfos(catalog).map((t) => [t.id, t]));
    const rustic = { styles: uc.styleChain(catalog, 'rustic'), themeName: 'Rustikal', height: 4, floorName: 'EG' };
    expect(roomTypeMisfits(info.get('barracks')!, rustic)).toEqual(['passt nicht zum Theme „Rustikal“ (nicht für rustic)']);
    expect(roomTypeMisfits(info.get('barracks')!, { ...rustic, styles: uc.styleChain(catalog, 'medieval') })).toEqual([]);
    expect(roomTypeMisfits(info.get('portal_room')!, rustic)).toEqual(['braucht Wandhöhe 5, EG hat 4: Hauptmöbel nur in Kompaktform']);
    expect(roomTypeMisfits(info.get('portal_room')!, { ...rustic, height: 5 })).toEqual([]);
    expect(roomTypeMisfits(info.get('bedroom')!, rustic)).toEqual([]);
    expect(roomTypeMisfits({ id: 'x', name: 'X', styleTags: { require: ['nordic'] } }, rustic)[0]).toMatch(/gedacht für nordic/);
    expect(roomTypeMisfits(info.get('barracks')!, {})).toEqual([]); // ohne Theme-Kette kein Hinweis
  });
});

describe('Raumtyp-Gruppen: jeder Katalog-Typ in einer benannten Gruppe', () => {
  const dir = fileURLToPath(new URL('../../../catalog/roomtypes/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.json5')).map((f) => f.slice(0, -'.json5'.length));

  it('alle Dateien aus catalog/roomtypes sind geladen und stehen ausdrücklich in ROOM_TYPE_GROUPS (nicht „Weitere“)', () => {
    expect(files.length).toBeGreaterThanOrEqual(45);
    expect([...catalog.roomTypeIds()].sort()).toEqual([...files].sort());
    const mapped = new Map(ROOM_TYPE_GROUPS.flatMap((g) => g.ids.map((id) => [id, g.id] as const)));
    for (const id of files) {
      expect(mapped.get(id), `${id} fehlt in ROOM_TYPE_GROUPS`).toBeDefined();
      expect(roomTypeGroupOf(catalog.roomType(id))).not.toBe(OTHER_GROUP.id);
    }
  });
});
