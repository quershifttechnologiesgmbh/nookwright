/**
 * Assistent „Neues Projekt aus Bautyp“ (U4, research/19 §7.7): Galerie, Vorschläge je Seed, Übernehmen als ein
 * Undo-Schritt, Neu würfeln mit Nutzer-Räumen, Parameter, nur Stil, Umgebung, Projektdatei mit Baukörpern und die
 * früheren Vorlagen bitgleich (Prüfsummen vor der Umstellung mit dem alten `templateSession` angelegt).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { planBuilding, reachableRooms, renderPlan } from '@mcda/archetype';
import { Project } from '@mcda/blueprint';
import { catalogMinArea, planBuildOptions, projectFromBuildingType, shellFor, withoutPilastersForTheme, type BuildOptions } from '@mcda/pipeline';
import { expectCpuBelow } from '../../core/test/support/timing.js';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import { siteOf } from '../src/surroundings.js';
import { EMPTY_TEMPLATE, templateSession, templateTypes } from '../src/templates.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles, types };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });
const params = (id: string, patch: Partial<bt.TypeParams> = {}): bt.TypeParams => ({ ...bt.defaultParams(types.get(id), ctx.themes.ids(), 'medieval', NEW), ...patch });

const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(canon(v))).digest('hex').slice(0, 16);
const geometry = (s: uc.Session) => {
  const st = s.project.state;
  return {
    floors: st.floors.map((f) => [f.index, f.y0, f.height]),
    rooms: st.rooms.map((r) => JSON.stringify([r.floorIndex, r.roomTypeId, r.cells.toArray().map(([x, z]) => `${x},${z}`).sort().join(';')])).sort(),
    links: st.links.map((l) => [l.type, l.floorIndex, l.origin[0], l.origin[1], l.facing, l.turn ?? '']),
  };
};
/**
 * Gleichwertige Hüllen-Optionen gleich schreiben: Standards der Domäne (Gauben, Giebelfenster), leeres Außenprofil = keins,
 * Wandvorlagen 0 = aus (so schreibt `withoutPilastersForTheme` es).
 */
const norm = (o: BuildOptions): BuildOptions => {
  const { dormers, facade: f, roofDetail, ...rest } = o;
  const { pilasters, ...fr } = f ?? {};
  const facade = f === undefined ? undefined : { ...fr, ...(pilasters !== undefined && pilasters > 0 ? { pilasters } : {}) };
  return {
    ...rest,
    ...(roofDetail !== undefined ? { roofDetail: { gableWindows: true, ...roofDetail } } : {}),
    ...(dormers !== undefined ? { dormers: { width: 3, minGap: 2, ...dormers } } : {}),
    ...(facade !== undefined && Object.keys(facade).length > 0 ? { facade } : {}),
  };
};
/** Wie beim Anlegen: Name, Theme, Geometrie, Hülle (`shellOptions`) und Außen-Deko der Sitzung. */
const digest = (s: uc.Session): string => {
  const style = uc.shellStyle(s);
  return hash({ name: s.project.state.name, theme: s.project.state.themeId, ...geometry(s), shell: uc.shellOptions(style), exterior: uc.exteriorOptions(style.exterior) ?? null });
};

describe('Katalog: Bautypen laden', () => {
  it('App-Lader liest catalog/buildingtypes (alle gültig, Entwurf dabei)', () => {
    expect(load.errors.filter((e) => e.includes('buildingtypes'))).toEqual([]);
    expect(types.ids()).toEqual(expect.arrayContaining(['farmhouse', 'hall', 'house', 'longhouse', 'tavern', 'timber', 'townhouse', 'townhouse_row', 'twostory', 'watchtower']));
    expect(bt.isDraft(types.get('townhouse_row'))).toBe(true);
    expect(templateTypes(types).map((d) => d.id)).toEqual(['hall', 'house', 'timber', 'twostory']);
  });

  it('Galerie: nur Reiter mit Bautypen, generierte vor festen, Entwürfe zuletzt; Kurztext', () => {
    const tabs = bt.galleryTabs(types);
    expect(tabs[0]!.label).toBe('Haus & Hof');
    expect(tabs.every((t) => t.types.length > 0)).toBe(true);
    expect(tabs.map((t) => t.label)).toEqual(bt.FAMILY_TABS.filter((f) => types.ids().some((id) => f.families.includes(types.get(id).family))).map((f) => f.label));
    const house = tabs[0]!.types;
    expect(bt.isDraft(house[house.length - 1]!)).toBe(true);
    expect(house.findIndex((d) => bt.isFixed(d))).toBeGreaterThan(house.findIndex((d) => d.id === 'tavern'));
    expect(tabs.find((t) => t.id === 'fantasy')!.types.map((d) => d.id)).toContain('longhouse');
    expect(tabs.find((t) => t.id === 'fort')!.types.map((d) => d.id)).toContain('watchtower');
    expect(bt.typeSummary(types.get('tavern'), catalog)).toMatch(/2–3 Etagen · 15–29 breit · .*Keller · Gehöft/);
    // W12-A (2026-09-28): Beispielhaus ein- oder zweigeschossig (`massing.storeys`)
    expect(bt.typeSummary(types.get('house'), catalog)).toMatch(/^Fester Grundriss · 1–2 Etagen/);
  });
});

/**
 * Prüfsummen des alten `templateSession` (23.09.2026, vor der Umstellung): Stil neuer Projekte / schlichter Stil + Theme rustic; Geometrie.
 * **Q2 bewusst erneuert (research/58 §Q2):** Nur die Spalte „Stil neuer Projekte“ ändert sich – der Standard trägt jetzt
 * die Fassaden-Pflichtregeln (`quality`), also Dachkante mit Überstand, Fensterrahmen, Sockel in `foundation`, Vorsprung
 * ab 6 Blöcken, Fensterachsen-Bruch und Fokuspunkt. Räume, Etagen, Treppen (Geometrie) und der schlichte Stil sind
 * unverändert.
 * **W1-G bewusst erneuert (nur `timber`, Befund S4a):** Das Fachwerkhaus nimmt Theme `timber`; dort entfällt die
 * Pfeiler-Pflicht `pierFrom` (gemeinsame Regel `withoutPilastersForTheme`, wie Engine und Galerie). Vorher setzte die
 * App sie über `quality: true` wieder – jetzt trägt der Stil `piers: false`. Geometrie unverändert.
 * **W2 (26.09.2026): Regel W1/F1/I4** – die Pflichtregeln (`quality`) tragen Außenhaut, Fassadenraster und Türlaibung;
 * der Stil-Hash der neuen Projekte ändert sich, Geometrie und schlichter Stil nicht.
 * **W4 (27.09.2026): Haustür im Mittelfeld und Doppeltür** – die Pflichtregeln tragen `centerDoor` und `doubleDoor`;
 * wieder ändert sich nur der Stil-Hash der neuen Projekte.
 */
const OLD_TEMPLATES: ReadonlyArray<readonly [string, string, string, string]> = [
  // W2 (26.09.2026): Regel D5 – eingeschossige feste Vorlagen (Beispielhaus, Große Halle) mit lichter Höhe 4; der
  // Bautyp kennt den Projektstil nicht, daher auch im schlichten Stil (Flachdach)
  // W4 (27.09.2026): W4-C centerDoor/doubleDoor im Stil der neuen Projekte (Spalte 2) + W4-G Große Halle = Speisesaal
  // (Review S1: Raumtyp in Geometrie und Digest; vorher hall '792a269ced55ad82' / '43ffc2f99fec1c35' / 'd28159ffd0caf5bb')
  // W6 (27.09.2026): Beispielhaus mit Trennwänden auf dem Fassadenraster (Lager ins Mittelfeld der Nordseite, Schlafzimmer
  // nach Süden, Schmiede ab Pfosten 13) – alle drei neu (vorher 'c42a07661c01519c', 'a1af559276b6038c', '1bd78d55e148810e')
  // W9-G1 (2026-09-27): Baumasse-Akzente (`massing.features`) – Beispielhaus mit Quergiebel, Zweistöcker mit Quergiebel bzw.
  // Auskragung (+ Konsolen im Stil), Fachwerkhaus mit Auskragung und Vorbau: Geometrie und beide Stil-Spalten neu
  // (vorher house 'f59bbed7fa162960'/'e2ec7e14ab44859c'/'f22d9ecf2a1a61aa', twostory 'b61eac36d01d9b13'/'47ae7b0953473d0e'/
  // '583abacee41fb5d2', timber '0532e66c74a7bbb5' ×2/'a46c3003180fe5d3'); Große Halle unverändert
  // W12-A (2026-09-28): Diele mit der Haustür im Vorsprung (Beispielhaus: Quergiebel an einer Ecke, Zweistöcker: Vorbau
  // mittig), Beispielhaus per Seed zweigeschossig mit Auskragung und Konsolen im Stil: Geometrie und beide Stil-Spalten neu
  // (vorher house '3e003423fb67e54d'/'9d7255e0f8f3c0d2'/'49d87f5fb594cae2', twostory '00f9c4da1f193337'/'189a5f31eec8c652'/
  // 'dfd4066ac6c9f9d2'); Fachwerkhaus unverändert
  // W13-A (2026-09-28): Komposition der Baumasse – Schmiede als eingeschossiger Nebenbaukörper „Werkstatt“ mit eigenem Dach,
  // oben kein Gästezimmer mehr: Geometrie und beide Stil-Spalten neu (vorher house '6b0647aceec24d3f'/'c0c4378a6ecce832'/
  // '5a26ab3e7f33df54'); übrige Vorlagen unverändert
  // W13-E (2026-09-28): Wandkleid der Obergeschosse (`facade.upperFrame` im Stil der Bautypen) – nur die Stil-Spalten neu,
  // Geometrie gleich (vorher house '6b0647aceec24d3f'/'c0c4378a6ecce832', twostory '5fcc7e4455db719f'/'ac94e128ef957c25',
  // timber '8dc70fc8fc68713b' ×2); Große Halle unverändert
  // W13-Integration (2026-09-28): A+E zusammen neu gemessen
  // W13-A Runde 2 (2026-09-28): Beispielhaus mit Eckturm (dritter Baukörper) und Gauben, Zweistöcker mit Werkstatt-Anbau,
  // Fachwerkhaus mit Waschhaus-Anbau – Geometrie und beide Stil-Spalten neu (vorher house '4953d75289501b8b'/
  // '1cfe9ea4ec565c6f'/'01ef28e760b9f85a', twostory '12ed5645f05c9761'/'84dba9cbdc3246ec'/'546f31bd7969f358', timber
  // '4e4500bae849602a' ×2/'23455426f001cf4e')
  ['house', '130a4e9a20d47ec9', 'e69e2b3a695de360', '3a2f2b5d13e2fbaa'],
  ['hall', 'a23221b95d6b188a', '7a6460cf08a056df', 'ac0d99dcade5c937'],
  ['twostory', '1727d51d3f25325e', '000863279c4cd0f5', 'be66167d94f794da'],
  ['timber', '6427ff7fda84ac0d', '6427ff7fda84ac0d', '645c247718541c92'],
];
const PLAIN: Partial<uc.ShellStyle> = { roof: 'flat', overhang: 2, facade: uc.PLAIN_FACADE, roofDetail: uc.PLAIN_ROOF_DETAIL, exterior: uc.PLAIN_EXTERIOR, windows: { enabled: true, spacing: 5 } };

describe('Frühere Vorlagen = feste Bautypen (bitgleich)', () => {
  for (const [id, neu, plain, geo] of OLD_TEMPLATES) {
    it(`${id}: Räume, Etagen, Treppen, Theme und Stil wie vorher (Stil geerbt, wo der Bautyp nichts festlegt)`, () => {
      const a = templateSession(id, ctx, 2026, 'medieval', NEW);
      expect(hash(geometry(a))).toBe(geo);
      expect(digest(a)).toBe(neu);
      expect(digest(templateSession(id, ctx, 2026, 'rustic', PLAIN))).toBe(plain);
      expect(a.past).toHaveLength(0);
      expect(a.project.state.origin).toMatchObject({ buildingTypeId: id, seed: 2026, rerollCount: 0 });
    });
  }

  it('leeres Projekt; unbekannte Vorlage ist ein Fehler', () => {
    expect(templateSession(EMPTY_TEMPLATE, ctx, 1, 'medieval').project.state.rooms).toHaveLength(0);
    expect(() => templateSession('x', ctx, 1, 'medieval')).toThrow(/Vorlage/);
  });
});

describe('Vorschläge', () => {
  it('deterministisch je Seed, drei verschiedene Seeds ergeben verschiedene Grundrisse; schnell genug', () => {
    const def = types.get('tavern');
    const p = params('tavern');
    const seeds = bt.proposalSeeds(42);
    expect(bt.proposalSeeds(42)).toEqual(seeds);
    expect(new Set(seeds).size).toBe(3);
    // Plan ≤ ~250 ms; Grenze je Vorschlag in CPU-Zeit (robust gegen Fremdlast)
    const props = seeds.map((seed) => expectCpuBelow(() => bt.proposal(def, p, seed, ctx, NEW), 1500, `Vorschlag Seed ${seed}`).result);
    expect(renderPlan(bt.proposal(def, p, seeds[0]!, ctx, NEW).plan)).toBe(renderPlan(props[0]!.plan));
    expect(new Set(props.map((x) => renderPlan(x.plan))).size).toBeGreaterThan(1);
    for (const x of props) {
      expect(x.plan.warnings).toEqual([]);
      expect(x.shell.warnings).toEqual([]);
      expect(x.style.corridorTypes).toEqual(['hallway', 'corridor', 'tavern', 'gallery']);
      expect(x.project.state.rooms.every((r) => r.origin === 'type')).toBe(true);
    }
    const f = bt.planFacts(props[0]!.plan);
    expect(f.floors).toBeGreaterThanOrEqual(2);
    expect(f.width).toBeGreaterThanOrEqual(19);
  });

  it('Lage im Raster: mittig für die größte Ausprägung, Front Ost/West tauscht Breite und Tiefe; Plan liegt im Raster', () => {
    const def = types.get('townhouse');
    expect(bt.placementOf(def, { size: 'M', front: 'south' })).toEqual([16, 8]); // 7 × 14
    expect(bt.placementOf(def, { size: 'M', front: 'east' })).toEqual([13, 11]);
    for (const id of ['tavern', 'farmhouse', 'townhouse_row']) {
      for (const size of bt.sizesOf(types.get(id))) {
        const pl = bt.proposal(types.get(id), params(id, { size }), 3, ctx, NEW).plan;
        const cells = pl.rooms.flatMap((r) => r.cells.toArray());
        expect(Math.min(...cells.map((c) => c[0])), `${id} ${size}`).toBeGreaterThanOrEqual(0);
        expect(Math.max(...cells.map((c) => c[0])), `${id} ${size}`).toBeLessThan(uc.GRID.width);
        expect(Math.max(...cells.map((c) => c[1])), `${id} ${size}`).toBeLessThan(uc.GRID.depth);
      }
    }
  });
});

describe('Übernehmen', () => {
  it('Taverne M: ein Undo-Schritt zurück ins alte Projekt; Plan in einem Event; alle Räume eingerichtet; Türen wie geprüft', () => {
    const old = uc.paintRect(uc.createSession(1, 'Alt'), catalog, { x1: 0, z1: 0, x2: 6, z2: 5 }, 'bedroom').session;
    const def = types.get('tavern');
    const p = params('tavern', { size: 'M' });
    const { session, plan } = bt.typeSession(def, p, 11, ctx, uc.shellStyle(old));
    const next = uc.replaceSession(old, session);
    expect(next.past).toHaveLength(0);
    expect(next.project.history.filter((e) => e.type === 'BuildingTypeApplied')).toHaveLength(1);
    // B4 (Stimmung für neue Projekte): nach dem Anlegen `MoodChanged`, dann der Plan in einem Event
    expect(next.project.history.slice(0, 3).map((e) => e.type)).toEqual(['ProjectCreated', 'MoodChanged', 'BuildingTypeApplied']);
    expect(next.project.state.themeId).toBe('timber');
    expect(next.project.state.rooms.length).toBe(plan.rooms.length);
    expect(next.project.state.rooms.every((r) => next.project.state.placements.some((pl) => pl.roomId === r.id))).toBe(true);
    expect(uc.undo(next).project.state).toBe(old.project.state);
    // Stil der Sitzung = Stil des Plans, samt Flur-Rollen → dieselbe Hülle wie der Anwendungsdienst (geprüfter Plan);
    // Fachwerk-Theme: ohne Pfeiler-Pflicht, gemeinsame Regel mit der Engine (W1-G, S4a)
    const style = uc.shellStyle(next);
    expect(style.corridorTypes).toEqual(['hallway', 'corridor', 'tavern', 'gallery']);
    const { exterior: _x, ...planShell } = withoutPilastersForTheme(planBuildOptions(plan), ctx.themes, 'timber');
    expect(norm(uc.shellOptions(style))).toEqual(norm(planShell));
    const shell = uc.shellOf(next.project, style);
    expect(shell.warnings).toEqual([]);
    expect(reachableRooms(shell).size).toBe(next.project.state.rooms.length);
    const res = projectFromBuildingType(def, { size: 'M', front: 'south', themeId: 'timber', at: bt.placementOf(def, p), surroundings: false }, 11, { ...ctx, platform: () => { throw new Error('keine Plattform'); } });
    const doors = (sh: typeof shell) => [...sh.rooms.values()].flatMap((r) => r.doors.map((d) => `${r.floorIndex}:${d.inside}>${d.toward}${d.isMain ? '!' : ''}`)).sort();
    // W2: die Feldbreite des Fassadenrasters kommt aus dem Theme (`facadeForTheme`) – Vergleich mit Theme wie `generateBase`
    expect(doors(shell)).toEqual(doors(shellFor(res.project, res.build, ctx.themes.get('timber'))));
    // ohne Flur-Rollen wählt die Hülle andere Türen (deshalb gehören sie in den Sitzungs-Stil)
    const { corridorTypes: _c, ...without } = style;
    expect(doors(uc.shellOf(next.project, without))).not.toEqual(doors(shell));
  });

  it('Umgebung: Gehöft-Vorlage der Taverne, Platz vor dem Stadthaus; abgewählt = keine; Außenanlagen aus', () => {
    const tavern = bt.typeSession(types.get('tavern'), params('tavern', { size: 'S' }), 3, ctx, NEW).session;
    expect(tavern.surroundings?.terrain).toBe(true);
    expect(new Set(siteOf(tavern.surroundings)!.zones.map((z) => z.kind))).toEqual(new Set(['yard', 'field', 'garden', 'paddock', 'orchard']));
    expect(siteOf(tavern.surroundings)!.styleId).toBe('homestead');
    const town = bt.typeSession(types.get('townhouse'), params('townhouse'), 3, ctx, NEW).session;
    expect(siteOf(town.surroundings)!.zones.map((z) => z.kind)).toEqual(['plaza']);
    const bare = bt.typeSession(types.get('townhouse'), params('townhouse', { site: false, exterior: false }), 3, ctx, NEW).session;
    expect(bare.surroundings).toBeUndefined();
    expect(uc.shellStyle(bare).exterior.enabled).toBe(false);
  });

  it('Bauernhaus L: Scheune als eigener Baukörper mit eigenem Dach in der Vorschau-Hülle', () => {
    const { session } = bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'L', site: false }), 1, ctx, NEW);
    const st = session.project.state;
    const barn = (st.volumes ?? []).find((v) => v.id !== 'v0')!;
    expect(barn.roof).toBe('gambrel');
    const shell = uc.shellOf(session.project, uc.shellStyle(session));
    const barnRooms = new Set(st.rooms.filter((r) => r.volumeId === barn.id).map((r) => r.id));
    const roofOver = (ids: ReadonlySet<string>) => shell.cells.some((c) => c.kind === 'roof' && c.roomId !== undefined && ids.has(c.roomId));
    expect(roofOver(barnRooms)).toBe(true);
    expect(roofOver(new Set(st.rooms.filter((r) => r.volumeId !== barn.id).map((r) => r.id)))).toBe(true);
    expect(shell.warnings.filter((w) => !/Nebeneingang/.test(w))).toEqual([]);
  });
});

describe('Panel „Bautyp“', () => {
  const farm = () => bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'M', site: false }), 5, ctx, NEW).session;
  const shedAt = (s: uc.Session): uc.Rect => {
    const minX = Math.min(...s.project.state.rooms.map((r) => r.cells.bounds()!.minX));
    return { x1: Math.max(0, minX - 8), z1: 0, x2: Math.max(0, minX - 8) + 5, z2: 4 };
  };

  it('Grundriss neu würfeln: anderer Grundriss, Nutzer-Räume bleiben, ein Undo-Schritt', () => {
    const s0 = farm();
    const s1 = uc.paintRect(s0, catalog, shedAt(s0), 'storage').session; // Nutzer malt einen Schuppen
    const user = s1.project.state.rooms.find((r) => r.origin !== 'type')!;
    const typeRooms = (s: uc.Session) => s.project.state.rooms.filter((r) => r.origin === 'type').map((r) => `${r.floorIndex}:${r.roomTypeId}:${r.cells.size}`).join();
    expect(bt.roomOrigins(s1)).toEqual({ type: s0.project.state.rooms.length, user: 1 });
    const s2 = bt.rerollType(s1, types.get('farmhouse'), ctx);
    expect(s2.past.length).toBe(s1.past.length + 1);
    expect(s2.project.state.origin).toMatchObject({ buildingTypeId: 'farmhouse', rerollCount: 1, seed: 5 });
    expect(s2.project.state.rooms.find((r) => r.id === user.id)?.cells.size).toBe(user.cells.size);
    expect(typeRooms(s2)).not.toBe(typeRooms(s1));
    expect(uc.undo(s2).project.state).toEqual(s1.project.state);
  });

  it('Parameter ändern (Größe, Theme) ist EIN Undo-Schritt; Nutzer-Räume bleiben', () => {
    const s0 = farm();
    const s1 = uc.paintRect(s0, catalog, shedAt(s0), 'storage').session;
    const def = types.get('farmhouse');
    const p = bt.originParams(s1, def);
    expect(p).toMatchObject({ size: 'M', front: 'south', themeId: 'rustic', site: false });
    const s2 = bt.changeTypeParams(s1, def, { ...bt.withSize(def, p, 'S'), themeId: 'medieval' }, ctx);
    expect(s2.past.length).toBe(s1.past.length + 1);
    expect(s2.project.state.themeId).toBe('medieval');
    expect(s2.project.state.origin?.params).toMatchObject({ size: 'S', floors: 1 });
    expect(s2.project.state.rooms.filter((r) => r.origin !== 'type')).toHaveLength(1);
    expect(uc.undo(s2).project.state).toEqual(s1.project.state);
  });

  describe('W2-ED U1: Bautyp-Neubau behält Sperren, unveränderte Parameter = gleicher Grundriss', () => {
    const def = types.get('tavern');
    // Taverne aus dem Konzept (W2UX §2): 3 Etagen per Zufall – mit fester Etagenzahl plante der Generator anders
    const tavern = () => bt.typeSession(def, params('tavern', { site: false }), 2851810222, ctx, NEW).session;
    const lockThree = (s: uc.Session): { s: uc.Session; roomId: string; ids: string[] } => {
      const room = s.project.state.rooms.find((r) => r.origin === 'type' && s.project.state.placements.filter((p) => p.roomId === r.id && p.parentId === undefined).length >= 3)!;
      const ids = s.project.state.placements.filter((p) => p.roomId === room.id && p.parentId === undefined).slice(0, 3).map((p) => p.id);
      let next = s;
      for (const id of ids) next = uc.toggleLock(next, catalog, id);
      return { s: next, roomId: room.id, ids };
    };
    const pose = (s: uc.Session, id: string) => JSON.stringify(s.project.state.placements.find((p) => p.id === id));

    it('Grundriss neu würfeln und Parameter anwenden: gesperrte Möbel 3/3, ihr Raum bleibt; Rückfrage nennt den Umfang', () => {
      const { s, roomId, ids } = lockThree(tavern());
      const ask = bt.typeReplaceConfirm(s, 'Grundriss neu würfeln');
      const scope = bt.typeScope(s);
      expect(scope.pinned).toEqual([roomId]);
      expect(scope.lockedPlacements).toBe(3);
      expect(ask?.body).toContain(`Ersetzt ${scope.replaced.length} Räume des Bautyps`);
      expect(ask?.body).toContain('1 Raum mit gesperrten Möbeln');
      const rerolled = bt.rerollType(s, def, ctx);
      for (const id of ids) expect(pose(rerolled, id)).toBe(pose(s, id));
      expect(rerolled.project.state.rooms.find((r) => r.id === roomId)?.cells.size).toBe(s.project.state.rooms.find((r) => r.id === roomId)!.cells.size);
      expect(bt.typeReplaceStatus(s, rerolled, 'Grundriss neu gewürfelt')).toMatch(new RegExp(`^Grundriss neu gewürfelt: ${scope.replaced.length} Räume ersetzt, \\d+ neu · 1 blieb · 3 gesperrte Möbel erhalten$`));
      const moved = bt.changeTypeParams(s, def, { ...bt.originParams(s, def), front: 'east' }, ctx);
      for (const id of ids) expect(moved.project.state.placements.find((p) => p.id === id)?.locked).toBe(true);
      expect(moved.project.state.rooms.some((r) => r.id === roomId)).toBe(true);
    });

    it('unveränderte Parameter: keine Änderung; nur Theme: kein Neubau (Räume und IDs bleiben)', () => {
      const s = tavern();
      const p = bt.originParams(s, def);
      expect(p.floors).toBeUndefined(); // „Zufall“ bleibt „Zufall“ (vorher: aufgelöste 3)
      expect(bt.replansLayout(s, def, p)).toBe(false);
      expect(bt.changeTypeParams(s, def, p, ctx)).toBe(s);
      const themed = bt.changeTypeParams(s, def, { ...p, themeId: 'medieval' }, ctx);
      expect(themed.project.state.themeId).toBe('medieval');
      expect(themed.project.state.rooms.map((r) => r.id)).toEqual(s.project.state.rooms.map((r) => r.id));
      expect(themed.project.history.some((e, i) => i >= s.project.history.length && e.type === 'BuildingTypeApplied')).toBe(false);
    });

    it('Front Ost und zurück nach Süd: derselbe Grundriss wie am Anfang (angeforderte statt aufgelöster Etagen)', () => {
      const s0 = tavern();
      const east = bt.changeTypeParams(s0, def, { ...bt.originParams(s0, def), front: 'east' }, ctx);
      expect(geometry(east)).not.toEqual(geometry(s0));
      const back = bt.changeTypeParams(east, def, { ...bt.originParams(east, def), front: 'south' }, ctx);
      expect(geometry(back)).toEqual(geometry(s0));
      // ältere Projekte ohne `requested`: aufgelöste Etagenzahl wie bisher
      const o = s0.project.state.origin!;
      const { requested: _r, ...legacy } = o.params as Record<string, unknown>;
      const old = { ...s0, project: Project.fromHistory(s0.project.history.map((e) => (e.type === 'BuildingTypeApplied' ? { ...e, origin: { ...e.origin, params: legacy } } : e))) };
      expect(bt.originParams(old, def).floors).toBe(3);
    });

    it('W3-BL: Neu würfeln (Pipeline) behält die angeforderten Parameter; danach Front Ost und zurück = der neu gewürfelte Grundriss', () => {
      const s0 = tavern();
      const requested = (s: uc.Session) => (s.project.state.origin?.params as { requested?: unknown }).requested;
      expect(requested(s0)).toBeDefined();
      const s1 = bt.rerollType(s0, def, ctx);
      expect(s1.project.state.origin?.rerollCount).toBe(1);
      expect(requested(s1)).toEqual(requested(s0));
      expect(bt.originParams(s1, def).floors).toBeUndefined(); // „Zufall“ bleibt „Zufall“ auch nach dem Neu-Wurf
      const east = bt.changeTypeParams(s1, def, { ...bt.originParams(s1, def), front: 'east' }, ctx);
      const back = bt.changeTypeParams(east, def, { ...bt.originParams(east, def), front: 'south' }, ctx);
      expect(geometry(back)).toEqual(geometry(s1));
    });
  });

  it('Nur Stil anwenden: Stil des Bautyps zurück, Räume unverändert', () => {
    const s0 = farm();
    const flat = uc.setShellStyle(s0, { roof: 'flat', facade: uc.PLAIN_FACADE }, catalog);
    const back = bt.applyTypeStyle(flat, types.get('farmhouse'), catalog);
    expect(uc.styleKey(uc.shellStyle(back))).toBe(uc.styleKey(uc.shellStyle(s0)));
    // W2: der Stil ändert mit dem Fassadenraster die Fenster – die Einrichtung wird neu gesetzt, die Räume bleiben gleich
    expect(back.project.state.rooms).toEqual(flat.project.state.rooms);
    expect(bt.applyTypeStyle(back, types.get('farmhouse'), catalog)).toBe(back); // nichts zu tun
  });

  it('Stil ohne Plan = Stil des Plans; Rückübersetzung BuildOptions → Sitzung → BuildOptions', () => {
    for (const id of types.ids()) {
      const def = types.get(id);
      const size = bt.sizesOf(def)[0];
      const plan = planBuilding(def, size !== undefined ? { size } : {}, 1, { minArea: catalogMinArea(catalog) });
      const b = planBuildOptions(plan);
      expect(bt.typeBuildOptions(def), id).toEqual(b);
      const style = bt.styleFromBuild(b);
      const { exterior, ...shell } = b;
      expect(norm(uc.shellOptions(style)), id).toEqual(norm(shell));
      expect(uc.exteriorOptions(style.exterior), id).toEqual(exterior);
    }
  });
});

describe('feat/underground: „Nur Stil anwenden“ mit Unterbau', () => {
  it('die Gänge des Unterbaus behalten die Flur-Rolle (Türen bleiben)', () => {
    const def = types.get('house');
    const s0 = bt.typeSession(def, { ...params('house'), underground: true }, 2026, ctx, NEW).session;
    expect(uc.shellStyle(s0).corridorTypes).toContain('gallery');
    const s1 = bt.applyTypeStyle(s0, def, catalog);
    expect(uc.shellStyle(s1).corridorTypes).toContain('gallery');
    expect(bt.typeBuildOptions(def, false).corridorTypes).toBeUndefined();
  });
});

describe('Projektdatei mit Baukörpern und Bautyp-Herkunft', () => {
  it('Roundtrip: Baukörper, Herkunft, Flur-Rollen, Neu-Würfeln; unbekanntes eingebettetes Event wird abgelehnt', () => {
    const s0 = bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'L' }), 7, ctx, NEW).session;
    const s = bt.rerollType(s0, types.get('farmhouse'), ctx);
    const text = serializeProject(s);
    const r = parseProjectFile(text, { catalog, themes: ctx.themes });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = s.project.state;
    const b = r.session.project.state;
    expect(b.volumes).toEqual(a.volumes);
    expect(b.origin).toEqual(a.origin);
    expect(b.rooms.map((x) => [x.id, x.volumeId, x.origin, x.cells.size])).toEqual(a.rooms.map((x) => [x.id, x.volumeId, x.origin, x.cells.size]));
    expect(uc.shellStyle(r.session).corridorTypes).toEqual(['hallway', 'corridor', 'kitchen']);
    expect(uc.styleKey(uc.shellStyle(r.session))).toBe(uc.styleKey(uc.shellStyle(s)));
    expect(r.session.surroundings?.site).toEqual(s.surroundings?.site);
    expect(r.session.project.history.map((e) => e.type)).toContain('BuildingTypeRerolled');
    const data = JSON.parse(text) as { history: Array<{ type: string; events?: Array<{ type: string }> }> };
    data.history.find((e) => e.type === 'BuildingTypeApplied')!.events![0]!.type = 'Unbekannt';
    const bad = parseProjectFile(JSON.stringify(data));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/Event \d+\.0 \(Unbekannt\) ist unbekannt/);
  });
});
