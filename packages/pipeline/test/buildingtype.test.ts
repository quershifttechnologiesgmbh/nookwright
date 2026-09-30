/**
 * Anwendungsdienst „Projekt aus Bautyp“ (research/19 §7.3): Prüfsummen der alten App-Vorlagen (vor der Umstellung
 * mit `templateSession` der App angelegt), Übernahme in einem Schritt, Neu-Würfeln, Umgebung, eine Welt je Bautyp.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderPlan } from '@mcda/archetype';
import type { ProjectState } from '@mcda/blueprint';
import { parseBuildingTypeDef, type BuildingTypeDef } from '@mcda/catalog';
import { CellSet, type Cell } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, rerollBuildingType, type BaseOptions } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const TYPES: BuildingTypeDef[] = readdirSync(join(ROOT, 'buildingtypes')).filter((f) => f.endsWith('.json5')).map((f) => {
  const r = parseBuildingTypeDef(readFileSync(join(ROOT, 'buildingtypes', f), 'utf8'), f);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
});
const byId = (id: string): BuildingTypeDef => TYPES.find((t) => t.id === id)!;

const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;

/** Prüfsumme wie beim Anlegen: Name, Etagen, Räume (Etage, Raumtyp, Zellen), Treppen, Stil (`BuildOptions`). */
function digest(st: ProjectState, build: BaseOptions): string {
  const input = JSON.stringify(canon({
    name: st.name,
    floors: st.floors.map((f) => [f.index, f.y0, f.height]),
    rooms: st.rooms.map((r) => JSON.stringify([r.floorIndex, r.roomTypeId, r.cells.toArray().map(([x, z]) => `${x},${z}`).sort().join(';')])).sort(),
    links: st.links.map((l) => [l.type, l.floorIndex, l.origin[0], l.origin[1], l.facing, l.turn ?? '']),
    build,
  }));
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Vor der Umstellung angelegt (23.09.2026): `templateSession(id, catalog, 2026, 'medieval')` der App mit dem Stil neuer
 * Projekte, `shellOptions(shellStyle(s))` + `exteriorOptions` als Stil; Versatz = `centerOffset` im 40 × 30-Raster.
 * **Q2 bewusst erneuert (research/58 §Q2):** der Stil neuer Projekte trägt jetzt die Fassaden-Pflichtregeln
 * (`FacadeStyle.rules` = `FACADE_QUALITY_RULES`): Dachkante mit Überstand ≥ 1, Fensterrahmen mit 1 Block Rücksprung,
 * Sockel in der Theme-Rolle `foundation`, Vorsprung ab 6 Blöcken Wandlänge, Achsenbruch nach 3 gleichen Fensterachsen
 * und ein Fokuspunkt je Fassade. Räume, Etagen, Treppen und Silhouette bleiben unverändert – nur das Stil-Feld
 * wandert mit; die vier Werte wurden einmalig mit dem neuen Stil neu erzeugt (nie still).
 * **W2 (26.09.2026): Regel W1/F1/I4** – `FACADE_QUALITY_RULES` trägt jetzt `skin`, `grid` und `jambs` (Außenhaut,
 * Fassadenraster, Türlaibung); nur das Stil-Feld ändert sich, Räume und Treppen bleiben.
 */
const CHECKSUMS: ReadonlyArray<readonly [string, Cell, string]> = [
  // W2 (26.09.2026): Regel D5 – eingeschossige feste Vorlagen mit lichter Höhe 4 (Traufhöhe ≥ 5, Dach ≤ 50 %) und W1/F1/I4
  // W4 (27.09.2026): Haustür im Mittelfeld (`centerDoor`) und Doppeltür (`doubleDoor`) in `FACADE_QUALITY_RULES` – nur das
  // Stil-Feld ändert sich, Räume und Treppen bleiben
  // W6 (27.09.2026): Beispielhaus mit Trennwänden auf dem Fassadenraster – Lager ins Mittelfeld der Nordseite, Schlafzimmer
  // nach Süden, Schmiede ab Pfosten 13 (vorher '6bfcec8af7adad6d'; Schlafzimmer verlor sein einziges Fenster an die Haustür)
  // W9-G1 (2026-09-27): Baumasse-Akzente – Quergiebel vor der Front (massing.features.cross; vorher '292dcd5a444775d8')
  // W12-A (2026-09-28): Diele mit der Haustür im Quergiebel (Ecke), zweigeschossige Variante per Seed (hier M: zwei
  // Geschosse, Obergeschoss kragt hinten und an der freien Giebelseite auf Konsolen aus, `brackets: 3` im Stil; vorher 'fb60bd3a09b50320')
  // W13-A (2026-09-28): Komposition der Baumasse – die Schmiede ist ein eingeschossiger Nebenbaukörper „Werkstatt“ mit eigenem
  // Dach (First quer, niedriger), oben nur noch über dem Hauptbau (Gästezimmer entfällt); vorher '1b412a98fbd72470'
  // W13-E (2026-09-28): Wandkleid der Obergeschosse (`facade.upperFrame` im Stil; vorher '1b412a98fbd72470')
  // W13-Integration (2026-09-28): A+E zusammen neu gemessen
  // W13-A Runde 2 (2026-09-28): Eckturm hinten an der Ostecke (dritter Baukörper, Zeltdach) und Gauben; vorher '08fb7599940092ed'
  ['house', [8, 9], 'ee575b79b74f8bcc'],
  // W4 (27.09.2026): W4-C centerDoor/doubleDoor + W4-G Große Halle als Speisesaal (Review S1; vorher '6db6c81c5d5f58a0')
  ['hall', [7, 5], 'c576cdaf051ebe10'],
  // W2 (26.09.2026): Regel W1/F1/I4; W4 (27.09.2026): centerDoor/doubleDoor
  // W9-G1 (2026-09-27): Baumasse-Akzente – Auskragung vorn auf Konsolen, Quergiebel an einer Ecke, `brackets: 3` im Stil
  // (vorher '3ecbaadb844a9a5e')
  // W12-A (2026-09-28): eingeschossiger Vorbau mit Diele und Haustür mittig vor der Front statt Quergiebel p 0,75 (Tür lag an der
  // Giebelseite; vorher 'ca7f093c8a8d21ee')
  // W13-E (2026-09-28): Wandkleid der Obergeschosse (`facade.upperFrame` im Stil; vorher '6d14d1c52395dc0c')
  // W13-A Runde 2 (2026-09-28): eingeschossiger Werkstatt-Anbau an der Ostseite; vorher 'd0a8469c9cbb54b4'
  ['twostory', [10, 8], 'c88537a3cce4eaae'],
  // timber neu (23.09.2026): Vorlage nach C4 nachgezogen – ohne Wandvorlagen, Fensterabstand 6, Außen-Deko an
  // Q2 (research/58 §Q2): Fachwerk bleibt ohne Wandvorlagen (`withoutPilastersForTheme` streicht `pierFrom` mit),
  // die übrigen Pflichtregeln gelten auch hier.
  // W2 (26.09.2026): Regel W1/F1/I4; W4 (27.09.2026): centerDoor/doubleDoor
  // W9-G1 (2026-09-27): Baumasse-Akzente – Obergeschoss kragt vorn und hinten aus, Vorbau mit Giebel über der Haustür
  // (vorher '606247c5f5ef0348')
  // W13-E (2026-09-28): Wandkleid der Obergeschosse (`facade.upperFrame` im Stil; vorher '2cab964bb2b33010')
  // W13-A Runde 2 (2026-09-28): eingeschossiger Waschhaus-Anbau an der Ostseite; vorher '5739b1a48149db4c'
  ['timber', [11, 9], '9309d49dce6d1833'],
];

describe('Feste Bautypen = die alten App-Vorlagen (Prüfsummen vor der Umstellung)', () => {
  for (const [id, at, sum] of CHECKSUMS) {
    it(`${id}: exakt das heutige Projekt samt Stil`, () => {
      const res = projectFromBuildingType(byId(id), { at, themeId: 'medieval', surroundings: false }, 2026, ctx);
      expect(res.plan.warnings).toEqual([]);
      expect(digest(res.project.state, res.build)).toBe(sum);
    });
  }
});

describe('projectFromBuildingType', () => {
  it('übernimmt den Plan in EINEM Schritt: Herkunft am Projekt und an den Räumen, ein Undo', () => {
    const res = projectFromBuildingType(byId('tavern'), { size: 'M', themeId: 'timber' }, 11, ctx);
    const st = res.project.state;
    // B4: neue Projekte bekommen die Stimmung des Themes (`MoodChanged`) vor dem Plan
    expect(res.project.history.map((e) => e.type)).toEqual(['ProjectCreated', 'MoodChanged', 'BuildingTypeApplied']);
    expect(st.origin).toMatchObject({ buildingTypeId: 'tavern', seed: 11, rerollCount: 0, params: { size: 'M', front: 'south' } });
    expect(st.rooms.length).toBe(res.plan.rooms.length);
    expect(st.rooms.every((r) => r.origin === 'type')).toBe(true);
    expect(st.links.length).toBe(res.plan.stairs.length);
    expect(st.themeId).toBe('timber');
    expect(res.project.undo(1).state.rooms).toEqual([]);
    // W2 (26.09.2026): Regel D5 – die Taverne hat Neigung 1:1 statt steil (Dachhöhen-Budget)
    expect(res.build).toMatchObject({ roof: 'gable', roofDetail: { pitch: 'normal' }, dormers: { kind: 'gable' }, corridorTypes: ['hallway', 'corridor', 'tavern', 'gallery'] });
  });

  it('Theme: Vorschlag des Bautyps, wenn keins angegeben; Stil-Hinweis bei unpassendem Theme', () => {
    expect(projectFromBuildingType(byId('longhouse'), { surroundings: false }, 1, ctx).project.state.themeId).toBe('nordic');
    const res = projectFromBuildingType(byId('longhouse'), { themeId: 'rustic', surroundings: false }, 1, ctx);
    expect(res.notes.join('\n')).toContain('passt nicht zum Theme rustic');
  });

  it('Grundriss neu würfeln: anderer Grundriss, gleicher Seed, Zähler + 1, Nutzer-Räume bleiben', () => {
    const def = byId('farmhouse');
    const res = projectFromBuildingType(def, { size: 'M', surroundings: false }, 5, ctx);
    const p = res.project;
    const typeRooms = (): string => p.state.rooms.filter((r) => r.origin === 'type').map((r) => `${r.floorIndex}:${r.roomTypeId}:${r.cells.size}`).join();
    const minX = Math.min(...p.state.rooms.map((r) => r.cells.bounds()!.minX));
    p.paintRoom(0, CellSet.rect(minX - 10, 0, minX - 4, 5), 'storage'); // Nutzer malt einen Schuppen neben das Haus
    const before = typeRooms();
    const plan = rerollBuildingType(p, def, ctx);
    expect(plan.warnings).toEqual([]);
    expect(p.history[p.history.length - 1]!.type).toBe('BuildingTypeRerolled');
    expect(p.state.origin).toMatchObject({ buildingTypeId: 'farmhouse', rerollCount: 1, seed: 5 });
    expect(p.state.seed).toBe(5);
    expect(p.state.rooms.filter((r) => r.origin !== 'type').map((r) => r.roomTypeId)).toEqual(['storage']);
    expect(typeRooms()).not.toBe(before);
  });

  it('Umgebung: Gehöft-Vorlage (Taverne) und Platz vor der Haustür (Stadthaus)', () => {
    const tavern = projectFromBuildingType(byId('tavern'), { size: 'S' }, 3, ctx);
    expect(new Set(tavern.site!.state.zones.map((z) => z.kind))).toEqual(new Set(['yard', 'field', 'garden', 'paddock', 'orchard']));
    expect(tavern.site!.state.styleId).toBe('homestead');
    const town = projectFromBuildingType(byId('townhouse'), { size: 'M' }, 3, ctx);
    expect(town.site!.state.zones.map((z) => z.kind)).toEqual(['plaza']);
    expect(town.surroundings.site).toBe(town.site!.state);
  });
});

describe('Eine Welt je Bautyp (generateBase): 0 harte Verstöße, alles erreichbar, Haus spawnsicher', () => {
  for (const def of TYPES.filter((t) => t.status !== 'draft')) {
    it(`${def.id}`, { timeout: HEAVY_TIMEOUT }, () => {
      const res = projectFromBuildingType(def, { size: 'M', targetVersion: { name: '26.3', dataVersion: 5023 } }, 2026, ctx);
      const world = generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
      const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
      expect(hard, `${JSON.stringify(hard.slice(0, 3))}\n${renderPlan(res.plan)}`).toEqual([]);
      expect(world.materialized.light.darkCells).toEqual([]);
      expect(world.warnings.filter((w) => w.startsWith('Gelände') || w.startsWith('Bauwerke'))).toEqual([]);
    });
  }
});

describe('applyBuildingType auf ein bestehendes Projekt', () => {
  it('Nutzer-Räume bleiben, Bautyp-Räume kommen dazu, ein Undo-Schritt', async () => {
    const { Project, TARGET_VERSIONS } = await import('@mcda/blueprint');
    const { applyBuildingType } = await import('../src/index.js');
    const p = Project.create({ id: 't', name: 'T', seed: 3, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
    p.paintRoom(0, CellSet.rect(40, 40, 45, 45), 'study');
    const before = p.history.length;
    const plan = applyBuildingType(p, byId('house'), { at: [0, 0] }, ctx);
    expect(plan.warnings).toEqual([]);
    expect(p.history.length).toBe(before + 1);
    expect(p.state.rooms.some((r) => r.roomTypeId === 'study' && r.origin !== 'type')).toBe(true);
    expect(p.state.rooms.filter((r) => r.origin === 'type').length).toBeGreaterThan(0);
    expect(p.state.origin?.buildingTypeId).toBe('house');
  });
});
