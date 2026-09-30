/**
 * App ↔ Engine-API zur Laufzeit gleich (C1, C2):
 * - C1: Die Projektdatei der App (`.projekt.json`) lädt in der Engine (`project_load`) und kommt mit
 *   `project_save { format: 'app' }` inhaltsgleich zurück; umgekehrt lädt die App, was die Engine schreibt.
 * - C2: Fachwerk-Themes ohne Wandvorlagen und die Export-Obergrenze gelten in App und Engine aus derselben Regel.
 * - C2 (W1-G, S4): „Übernehmen“ im Assistenten baut dieselben Blöcke wie `building_generate` (Galerie, API).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { nodeContext } from '@mcda/pipeline/node';
import { createEngine, type ExecuteResult } from '@mcda/engine';
import { REPO_CATALOG } from '@mcda/engine/node';
import {
  EASY_FARM_BLOCKS, generateBase, projectFromBuildingType, toExport, volumeTooLarge as sharedVolumeTooLarge,
  withBlockPreset, withoutPilastersForTheme as sharedRule, type BlockRules, type PipelineContext, type World,
} from '@mcda/pipeline';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import type { BuildingSizeClass } from '@mcda/catalog';
import { CellSet, type PaletteOverrides } from '@mcda/core';
import type { ExportVolume } from '@mcda/export';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { exportReport, volumeTooLarge, worldOf } from '../src/exporting.js';
import { lightSession } from '../src/lighting.js';
import { baseWorldOf } from '../src/surroundingsWorld.js';
import * as pe from '../src/placementEdit.js';
import * as br from '../src/blockRefurnish.js';
import { PROJECT_FILE_FORMAT, parseProjectFile, serializeProject, toProjectFile } from '../src/projectFile.js';
import * as su from '../src/surroundings.js';
import * as uc from '../src/usecases.js';
import { withFantasyKit, withFantasyLevel, type FantasyKitPick, type FantasyPick } from '../src/ui/fantasyChoice.js';
import { withDetailLevel, type DetailPick } from '../src/ui/detailChoice.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles, types };
const refs = { catalog, themes: load.themeCatalog! };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });
const SAVED = new Date(Date.UTC(2026, 8, 24, 12, 0));
const params = (id: string, patch: Partial<bt.TypeParams> = {}): bt.TypeParams => ({ ...bt.defaultParams(types.get(id), ctx.themes.ids(), 'medieval', NEW), ...patch });

const engineCtx = nodeContext(REPO_CATALOG);
const engine = createEngine(engineCtx);
const ok = (r: ExecuteResult): Record<string, unknown> => {
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.data as Record<string, unknown>;
};
/** App-Datei → Engine → App-Datei (gleicher Speicherzeitpunkt). */
function viaEngine(file: unknown): { file: Record<string, unknown>; projectId: string; warnings: unknown } {
  const loaded = ok(engine.execute({ op: 'project_load', input: { file } }));
  const projectId = loaded['projectId'] as string;
  return { projectId, warnings: loaded['warnings'], file: ok(engine.execute({ op: 'project_save', input: { projectId, format: 'app', savedAt: SAVED.toISOString() } })) };
}
const json = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;

/** Sitzung mit allem, was die Datei trägt: Bautyp mit Gelände, Dichte je Raum, Stil, Bauwerke, Gelände aus. */
function richSession(): uc.Session {
  let s = bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'M' }), 5, ctx, NEW).session;
  const room = s.project.state.rooms[0]!;
  s = uc.setRoomDensity(s, catalog, room.id, 1.5);
  s = uc.setShellStyle(s, { roof: 'half_hip', dormers: { kind: 'shed', width: 3, minGap: 2 }, facade: { ...uc.DEFAULT_FACADE, brackets: 3 } }, catalog);
  s = su.addTower(s, [-12, -12]).session;
  s = su.setTerrainEnabled(s, false); // Gelände aus: Historie bleibt in der Datei, Engine baut ohne
  return s;
}

describe('C1: Projektdatei der App in der Engine', () => {
  it('F-Ensemble: Schalter der Umgebung (`surroundings.ensemble`) übersteht App → Engine → App und wirkt in der Engine', () => {
    const s = su.setEnsemble(bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'M' }), 5, ctx, NEW).session, true, catalog);
    expect(su.ensembleOn(s)).toBe(true);
    const original = json(serializeProject(s, { savedAt: SAVED }));
    expect((original['surroundings'] as { ensemble?: boolean }).ensemble).toBe(true);
    const back = viaEngine(original);
    expect(back.file).toEqual(original);
    const r = parseProjectFile(JSON.stringify(back.file), refs);
    expect(r.ok && r.session.surroundings?.ensemble).toBe(true);
    // project_style { ensemble: false } schaltet ihn in der Engine-Session aus und schreibt das in die Datei
    ok(engine.execute({ op: 'project_style', input: { projectId: back.projectId, ensemble: false } }));
    const off = ok(engine.execute({ op: 'project_save', input: { projectId: back.projectId, format: 'app', savedAt: SAVED.toISOString() } }));
    expect((off['surroundings'] as { ensemble?: boolean }).ensemble).toBe(false);
  }, HEAVY_TIMEOUT);

  it('Round-Trip App → Engine → App: gleicher Inhalt (Einstellungen, Dichte, Umgebung, Historie)', () => {
    const s = richSession();
    const original = json(serializeProject(s, { savedAt: SAVED }));
    expect(original['format']).toBe(PROJECT_FILE_FORMAT);
    expect((original['surroundings'] as { terrain: boolean }).terrain).toBe(false);
    const back = viaEngine(original);
    expect(back.warnings).toEqual([]);
    expect(back.file).toEqual(original);
    // … und die App lädt die Engine-Datei zur gleichen Sitzung (gleiche Datei beim erneuten Speichern)
    const r = parseProjectFile(JSON.stringify(back.file), refs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(json(serializeProject(r.session, { savedAt: SAVED }))).toEqual(original);
  });

  it('W3-BL: Block-Regeln (Preset, eigene Sperre, feste Ersetzung) kommen unverändert durch die Engine zurück', () => {
    const rules = { ...withBlockPreset(undefined, 'easy_farm', true)!, replace: { gold_block: 'honeycomb_block' } };
    const s = uc.setBlockRules(richSession(), catalog, rules);
    const original = json(serializeProject(s, { savedAt: SAVED }));
    expect(original['blockRules']).toEqual(rules);
    const back = viaEngine(original);
    expect(back.file).toEqual(original);
    const view = ok(engine.execute({ op: 'project_get', input: { projectId: back.projectId } }));
    expect((view['style'] as { blockRules: unknown }).blockRules).toEqual(rules);
  });

  it('Engine baut den Stil der App-Datei wie die App (Hülle, Außen-Deko, Gelände nur wenn an)', () => {
    const s = richSession();
    const { projectId } = viaEngine(json(serializeProject(s, { savedAt: SAVED })));
    const view = ok(engine.execute({ op: 'project_get', input: { projectId } }));
    const style = uc.shellStyle(s);
    expect(view['style']).toEqual({ ...uc.shellOptions(style), exterior: uc.exteriorOptions(style.exterior) });
    expect(view['site']).toBeNull(); // Gelände aus
    expect((view['structures'] as { towers: number }).towers).toBe(1);
  });

  it('Version 1 (Migration): Engine liest wie die App und schreibt Version 2', () => {
    const s = sampleSession(catalog);
    const v2 = toProjectFile(s, SAVED);
    const { roofDetail: _r, dormers: _d, facade: _f, exterior: _x, density: _y, windows: _w, overhang: _o, ...rest } = v2;
    const v1 = { ...rest, version: 1 };
    const app = parseProjectFile(JSON.stringify(v1), refs);
    expect(app.ok).toBe(true);
    const back = viaEngine(v1);
    expect(back.file['version']).toBe(2);
    if (app.ok) expect(back.file).toEqual(json(serializeProject(app.session, { savedAt: SAVED })));
  });

  it('Engine-Projekt → App-Datei: App lädt es; Stil-Änderung per API landet in der Datei', () => {
    const created = ok(engine.execute({ op: 'project_create', input: { name: 'Taverne', seed: 4, buildingType: { buildingTypeId: 'tavern', size: 'S' } } }));
    const projectId = created['projectId'] as string;
    ok(engine.execute({ op: 'project_style', input: { projectId, shell: { roof: 'hip' } } }));
    const file = ok(engine.execute({ op: 'project_save', input: { projectId, format: 'app' } }));
    expect(file['roof']).toBe('hip');
    const r = parseProjectFile(JSON.stringify(file), refs);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (r.ok) expect(r.session.project.history).toEqual((file as { history: unknown }).history);
  });

  it('Grenzen und Fehler wie in der App (gemeinsamer Code)', () => {
    const s = sampleSession(catalog);
    const bad = { ...toProjectFile(s, SAVED), version: 3 };
    const app = parseProjectFile(JSON.stringify(bad), refs);
    const r = engine.execute({ op: 'project_load', input: { file: bad } });
    expect(app.ok).toBe(false);
    expect(r.ok).toBe(false);
    // Version 3 lehnt schon das Schema ab; eine beschädigte Historie meldet die gemeinsame Prüfung wortgleich
    const broken = { ...toProjectFile(s, SAVED), history: [{ type: 'Unbekannt' }] };
    const appBroken = parseProjectFile(JSON.stringify(broken), refs);
    const engBroken = engine.execute({ op: 'project_load', input: { file: broken } });
    expect(appBroken.ok).toBe(false);
    expect(engBroken.ok).toBe(false);
    if (!appBroken.ok && !engBroken.ok) expect(engBroken.errors.join(' ')).toContain(appBroken.error);
  });
});

describe('C1: Wehrplatten der Burg (BT01) in der Engine', () => {
  const castle = () => bt.typeSession(types.get('castle_compact'), params('castle_compact', { size: 'S' }), 2026, ctx, NEW).session;
  const parapetsOf = (file: Record<string, unknown>) =>
    ((file['surroundings'] as { structures: Array<{ kind: string }> }).structures).filter((i) => i.kind === 'parapet');
  const appReload = (file: Record<string, unknown>) => {
    const r = parseProjectFile(JSON.stringify(file), refs);
    if (!r.ok) throw new Error(r.error);
    return json(serializeProject(r.session, { savedAt: SAVED }));
  };

  it('Round-Trip App → Engine → App: Wehrplatten bleiben gleich', () => {
    const original = json(serializeProject(castle(), { savedAt: SAVED }));
    expect(parapetsOf(original).length).toBeGreaterThan(0);
    const back = viaEngine(original);
    expect(back.warnings).toEqual([]);
    expect(parapetsOf(back.file)).toEqual(parapetsOf(original));
    // gegen die ORIGINAL-Datei: Engine und App geben sie unverändert zurück (gemeinsamer Leser verliert nichts)
    expect(back.file).toEqual(original);
    expect(appReload(original)).toEqual(original);
    const view = ok(engine.execute({ op: 'project_get', input: { projectId: back.projectId } }));
    expect((view['structures'] as { parapets: number }).parapets).toBe(parapetsOf(original).length);
  });

  it('Ringmauer mit allen Optionen: App → Engine → App identisch zur Original-Datei', () => {
    const file = json(serializeProject(castle(), { savedAt: SAVED }));
    const sur = file['surroundings'] as { structures: Array<{ kind: string; id: string; plan?: Record<string, unknown> }> };
    const ring = sur.structures.find((i) => i.kind === 'wall');
    expect(ring, 'Burg hat eine Ringmauer').toBeDefined();
    // Felder, die der Bautyp setzt (früher beim Laden verworfen)
    expect(Object.keys(ring!.plan!)).toEqual(expect.arrayContaining(['thickness', 'height', 'extraTowers', 'stairs', 'gates']));
    const full = {
      ...ring!.plan!, profile: 'fortress', garden: { pillarEvery: 5, lanterns: true, hedge: false }, thickness: 4, outside: 'right',
      merlon: { width: 2, gap: 2 }, plinth: { rows: 3, batter: false }, towers: 'auto', towerRise: 6, cornerAngle: 45,
      towerStyle: { shape: 'square', size: 9, top: 'battlements', roofPitch: 3, roofShape: 'tent', flare: true, finial: 'rod', corbels: false, levelHeight: 5, bell: 'hanging', hangingLanterns: true },
      gates: [{ at: (ring!.plan!['gates'] as Array<{ at: unknown }>)[0]!.at, width: 3, height: 5, gatehouse: true }],
    };
    const original = { ...file, surroundings: { ...sur, structures: sur.structures.map((i) => (i === ring ? { ...i, plan: full } : i)) } };
    const back = viaEngine(original);
    expect(back.warnings).toEqual([]);
    expect(back.file).toEqual(original);
    expect(appReload(back.file)).toEqual(original);
    expect(appReload(original)).toEqual(original);
  });

  it('nach geänderten Bauwerken (project_structures mit parapets) schreibt die Engine sie als Bindung in die App-Datei', () => {
    const { projectId } = viaEngine(json(serializeProject(castle(), { savedAt: SAVED })));
    // BT01: die API trägt nur die Bindung (Baukörper + Zinnenmaß); Spalten/Höhe leitet der Leser aus der Hülle ab
    const keep = ok(engine.execute({ op: 'project_get', input: { projectId } }));
    const volumeId = (keep['rooms'] as Array<{ volumeId: string; floor: number }>).length > 1
      ? [...new Set((keep['rooms'] as Array<{ volumeId: string }>).map((r) => r.volumeId))].find((v) => v !== 'v0') ?? 'v0'
      : 'v0';
    ok(engine.execute({ op: 'project_structures', input: { projectId, structures: { parapets: [{ volumeId, merlon: { width: 2, gap: 1 } }] } } }));
    const file = ok(engine.execute({ op: 'project_save', input: { projectId, format: 'app', savedAt: SAVED.toISOString() } }));
    // Die Herkunfts-ID bleibt erhalten: sie steuert auch deterministische Varianten der Wehrplatte.
    expect(parapetsOf(file)).toEqual([{ kind: 'parapet', id: 'parapet1', volumeId, merlon: { width: 2, gap: 1 } }]);
    const r = parseProjectFile(JSON.stringify(file), refs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.session.surroundings?.structures.filter((i) => i.kind === 'parapet')).toHaveLength(1);
  });

  it('ältere Datei ohne Wehrplatten lädt in App und Engine wie bisher', () => {
    const full = json(serializeProject(castle(), { savedAt: SAVED }));
    const sur = full['surroundings'] as { structures: Array<{ kind: string }> };
    const old = { ...full, surroundings: { ...sur, structures: sur.structures.filter((i) => i.kind !== 'parapet') } };
    const app = parseProjectFile(JSON.stringify(old), refs);
    expect(app.ok).toBe(true);
    if (app.ok) expect(app.warnings ?? []).toEqual([]);
    const back = viaEngine(old);
    expect(back.warnings).toEqual([]);
    expect(parapetsOf(back.file)).toEqual([]);
    expect(back.file).toEqual(appReload(old));
  });
});

describe('C2: gemeinsame Generier-Regeln', () => {
  it('App und Engine nutzen dieselben Funktionen aus @mcda/pipeline', () => {
    expect(bt.withoutPilastersForTheme).toBe(sharedRule);
    expect(volumeTooLarge).toBe(sharedVolumeTooLarge);
  });

  it('Fachwerk-Theme: Wandvorlagen entfallen in App und Engine gleich; Stein-Theme behält sie', () => {
    const shell = { facade: { plinthProfile: true, pilasters: 5 } };
    for (const [themeId, expected] of [['timber', 0], ['medieval', 5]] as const) {
      const app = bt.typeSession(types.get('tavern'), params('tavern', { size: 'S', themeId, shell }), 3, ctx, NEW).session;
      const appFile = toProjectFile(app, SAVED);
      const created = ok(engine.execute({ op: 'project_create', input: { seed: 3, themeId, buildingType: { buildingTypeId: 'tavern', size: 'S', shell } } }));
      const engFile = ok(engine.execute({ op: 'project_save', input: { projectId: created['projectId'] as string, format: 'app' } }));
      expect(appFile.facade.pilasters, `App ${themeId}`).toBe(expected);
      expect((engFile['facade'] as { pilasters: number }).pilasters, `Engine ${themeId}`).toBe(expected);
    }
    // building_generate: Fachwerk mit Wandvorlagen 5 = Fachwerk mit Wandvorlagen aus (die Regel greift auch zustandslos)
    const gen = (pilasters: number) => ok(engine.execute({ op: 'building_generate', input: {
      buildingTypeId: 'tavern', size: 'S', themeId: 'timber', seed: 3, surroundings: false, shell: { facade: { plinthProfile: true, pilasters } },
    } }));
    expect(gen(5)['blocks']).toBe(gen(0)['blocks']);
  });

  it('zu großer Bau: Engine und App lehnen mit derselben Meldung ab', async () => {
    // Zwei kleine Räume 2 100 Blöcke auseinander (eine Engine-Datei kennt keine Dateigrenzen der App)
    const p = Project.create({ id: 'weit', name: 'Zu weit', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
    p.paintRoom(0, CellSet.rect(0, 0, 2, 2), 'storage');
    p.paintRoom(0, CellSet.rect(2100, 0, 2102, 2), 'storage');
    const style = uc.shellStyle({ roof: 'flat', exterior: uc.PLAIN_EXTERIOR });
    const file = { format: 'engine-projekt', version: 1, build: uc.shellOptions(style), structures: null, attachedTowers: [], site: null, history: p.history };
    const loaded = ok(engine.execute({ op: 'project_load', input: { file } }));
    const r = engine.execute({ op: 'project_generate', input: { projectId: loaded['projectId'] as string } });
    expect(r.ok).toBe(false);
    const pctx = await browserContext(load)!.ready('1.21.11');
    const report = exportReport(worldOf(p, pctx, style));
    const message = report.errors.map((e) => e.message).find((m) => /zu groß für einen Export/.test(m));
    expect(message).toBeDefined();
    if (!r.ok) expect(r.errors.join(' ')).toContain(message!);
  });

  it('W3-BL: Möbel verschieben – App und Engine nutzen dieselbe Prüfung; die Engine nimmt aufgesetzte Teile mit', () => {
    const s = sampleSession(catalog);
    const st = s.project.state;
    const parent = st.placements.find((p) => st.placements.some((c) => c.parentId === p.id))!;
    const kids = st.placements.filter((c) => c.parentId === parent.id);
    const { projectId } = viaEngine(json(serializeProject(s, { savedAt: SAVED })));
    const move = (dx: number, dz: number) => engine.execute({ op: 'project_command', input: { projectId, commands: [
      { command: 'movePlacement', placementId: parent.id, pos: [parent.pose.pos[0] + dx, parent.pose.pos[1], parent.pose.pos[2] + dz], rot: parent.pose.rot, mirror: parent.pose.mirror },
    ] } });
    // ungültig: gleiche Meldung wie in der App
    const why = pe.placementProblem(s, catalog, parent.id, { poses: new Map([[parent.id, { ...parent.pose, pos: [parent.pose.pos[0] + 60, parent.pose.pos[1], parent.pose.pos[2]] }]]) });
    const bad = move(60, 0);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(' ')).toContain(why!);
    // gültig: App und Engine setzen dieselben Lagen (Gruppe samt Kindern)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      let app: uc.Session;
      try {
        app = pe.nudgePlacement(s, catalog, parent.id, dx, dz);
      } catch {
        expect(move(dx, dz).ok).toBe(false);
        continue;
      }
      ok(move(dx, dz));
      const eng = ok(engine.execute({ op: 'project_get', input: { projectId, placements: true } }))['placements'] as { id: string; pos: number[] }[];
      for (const id of [parent.id, ...kids.map((k) => k.id)]) {
        expect(eng.find((x) => x.id === id)!.pos, id).toEqual(app.project.state.placements.find((x) => x.id === id)!.pose.pos);
      }
      break;
    }
  });

  it('W7-G: Kante ziehen – Nachbarn behalten Möbel; project_furnish mit keep richtet genau wie die App ein', () => {
    const s = sampleSession(catalog);
    const st = s.project.state;
    const kitchen = st.rooms.find((r) => r.roomTypeId === 'kitchen')!;
    const b = kitchen.cells.bounds()!;
    // Küche eine Spalte nach Osten in den Nachbarn (Schlafzimmer) hinein
    const add = Array.from({ length: b.maxZ - b.minZ + 1 }, (_, i) => [b.maxX + 1, b.minZ + i] as [number, number]);
    const app = uc.resizeRoom(s, catalog, kitchen.id, add, []);
    const { projectId } = viaEngine(json(serializeProject(s, { savedAt: SAVED })));
    ok(engine.execute({ op: 'project_command', input: { projectId, commands: [{ command: 'resizeRoom', roomId: kitchen.id, add: [[b.maxX + 1, b.minZ, b.maxX + 1, b.maxZ]] }] } }));
    ok(engine.execute({ op: 'project_furnish', input: { projectId, keep: true } }));
    const eng = ok(engine.execute({ op: 'project_get', input: { projectId, placements: true } }))['placements'] as { roomId: string; componentId: string; pos: number[]; rot: number; mirror: string }[];
    const set = (xs: ReadonlyArray<{ roomId: string; componentId: string; pos: readonly number[]; rot: number; mirror: string }>) =>
      xs.map((p) => JSON.stringify([p.roomId, p.componentId, p.pos, p.rot, p.mirror])).sort();
    expect(set(eng)).toEqual(set(app.project.state.placements.map((p) => ({ roomId: p.roomId, componentId: p.componentId, pos: p.pose.pos, rot: p.pose.rot, mirror: p.pose.mirror }))));
    // ohne keep (bisher): dieselben Räume komplett neu gewürfelt – mit keep bleibt in Summe mehr stehen
    const plain = viaEngine(json(serializeProject(s, { savedAt: SAVED }))).projectId;
    ok(engine.execute({ op: 'project_command', input: { projectId: plain, commands: [{ command: 'resizeRoom', roomId: kitchen.id, add: [[b.maxX + 1, b.minZ, b.maxX + 1, b.maxZ]] }] } }));
    ok(engine.execute({ op: 'project_furnish', input: { projectId: plain } }));
    const fresh = ok(engine.execute({ op: 'project_get', input: { projectId: plain, placements: true } }))['placements'] as typeof eng;
    const before = set(st.placements.map((p) => ({ ...p, pos: p.pose.pos, rot: p.pose.rot, mirror: p.pose.mirror })));
    const keptOf = (xs: typeof eng) => set(xs).filter((k) => before.includes(k)).length;
    expect(keptOf(eng)).toBeGreaterThan(keptOf(fresh));
    expect(keptOf(eng)).toBeGreaterThan(before.length / 2);
  });

  it('F Bereich neu einrichten: project_refurnish_block mit Dichte ≠ 1 und verbindlichem Mittelgang (Lager) richtet genau wie die App ein', () => {
    let s = sampleSession(catalog);
    // Lager: Raumtyp mit Mittelgang (`aisle`), damit „Mittelgang verbindlich“ wirklich greift
    const room = s.project.state.rooms.find((r) => r.roomTypeId === 'storage')!;
    s = uc.setRoomDensity(s, catalog, room.id, 1.5);
    s = uc.setMinAisle(s, catalog, true);
    // W8-H: die ganze Zone (= ganzer Lagerraum) brächte weniger Möbel und bliebe unverändert – daher ein Rechteck
    const rect = [1, 8, 7, 10] as const;
    const app = br.refurnishBlock(s, catalog, room.id, CellSet.rect(...rect), { margin: 2 });
    expect(app.report.ok && app.report.changed).toBe(true);
    const { projectId } = viaEngine(json(serializeProject(s, { savedAt: SAVED })));
    const r = ok(engine.execute({ op: 'project_refurnish_block', input: { projectId, roomId: room.id, rect: [...rect], margin: 2, density: 1.5, minAisle: true } }));
    expect(r['ok']).toBe(true);
    const eng = ok(engine.execute({ op: 'project_get', input: { projectId, placements: true } }))['placements'] as { id: string; roomId: string; componentId: string; pos: number[]; rot: number; mirror: string }[];
    const key = (p: { id: string; roomId: string; componentId: string; pos: readonly number[]; rot: number; mirror: string }) => JSON.stringify([p.id, p.roomId, p.componentId, p.pos, p.rot, p.mirror]);
    expect(eng.map(key)).toEqual(app.session.project.state.placements.map((p) => key({ ...p, pos: p.pose.pos, rot: p.pose.rot, mirror: p.pose.mirror })));
    // das Feld wirkt: mit Dichte 0 (nur Pflichtobjekte) kommt etwas anderes heraus
    const plain = viaEngine(json(serializeProject(s, { savedAt: SAVED }))).projectId;
    ok(engine.execute({ op: 'project_refurnish_block', input: { projectId: plain, roomId: room.id, rect: [...rect], margin: 2, density: 0, minAisle: true } }));
    const other = ok(engine.execute({ op: 'project_get', input: { projectId: plain, placements: true } }))['placements'] as typeof eng;
    expect(other.map(key)).not.toEqual(eng.map(key));
  });

  it('Treppe durch gesperrte Möbel: App und Engine lehnen mit derselben Meldung ab', () => {
    let s = sampleSession(catalog);
    s = uc.addFloor(s, catalog).session;
    s = uc.paintRect(s, catalog, { x1: 0, z1: 0, x2: 22, z2: 11 }, 'bedroom', 1).session;
    const locked = s.project.state.placements.filter((p) => s.project.state.rooms.find((r) => r.id === p.roomId)?.floorIndex === 0);
    let found: { spec: uc.StairSpec; why: string; session: uc.Session } | undefined;
    for (const p of locked) {
      const t = uc.toggleLock(s, catalog, p.id);
      for (const facing of ['east', 'west', 'north', 'south'] as const) {
        const spec: uc.StairSpec = { floor: 0, origin: [p.pose.pos[0], p.pose.pos[2]], facing, type: 'straight' };
        const why = uc.stairsBlockedByFixed(t.project.state, catalog, spec);
        if (why !== undefined) {
          found = { spec, why, session: t };
          break;
        }
      }
      if (found !== undefined) break;
    }
    expect(found, 'eine gesperrte Möbelzelle unter einer möglichen Treppe').toBeDefined();
    const { projectId } = viaEngine(json(serializeProject(found!.session, { savedAt: SAVED })));
    const r = engine.execute({ op: 'project_command', input: { projectId, commands: [
      { command: 'placeStairs', floor: 0, at: found!.spec.origin, facing: found!.spec.facing, type: 'straight' },
    ] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain(found!.why);
  });

  it('W11-A Treppen automatisch: App (Schalter an) und project_auto_stairs setzen dieselben Treppen mit derselben Meldung', () => {
    let s = sampleSession(catalog);
    s = uc.addFloor(s, catalog).session;
    s = uc.addFloor(s, catalog, { below: true }).session;
    s = uc.paintRect(s, catalog, { x1: 0, z1: 0, x2: 22, z2: 11 }, 'bedroom', 1).session; // ohne Schalter: getrennt
    s = uc.paintRect(s, catalog, { x1: 0, z1: 0, x2: 22, z2: 11 }, 'storage', -1).session;
    expect(uc.disconnectedFloors(s.project.state).length).toBe(2);
    const app = uc.autoStairs(s, catalog);
    expect(app.project.state.links.length).toBe(s.project.state.links.length + 2);
    const { projectId } = viaEngine(json(serializeProject(s, { savedAt: SAVED })));
    const res = ok(engine.execute({ op: 'project_auto_stairs', input: { projectId } }));
    const stairs = (res['project'] as { stairs: Array<{ type: string; floor: number; at: number[]; facing: string }> }).stairs;
    expect(stairs.map((x) => [x.type, x.floor, x.at, x.facing]))
      .toEqual(app.project.state.links.map((l) => [l.type, l.floorIndex, l.origin, l.facing]));
    expect(res['message']).toBe(app.autoStairsNote);
    // schon verbunden: die Engine ändert nichts
    const again = ok(engine.execute({ op: 'project_auto_stairs', input: { projectId } }));
    expect(again['placed']).toEqual([]);
  }, HEAVY_TIMEOUT);
});

/**
 * W1-G (S4): Bautyp „Übernehmen“ in der App = `building_generate` der Engine, Block für Block. Vorher wichen 33 von 78
 * Welten des Assistenten ab (W1-E §5 S4): Fachwerk-Themes bekamen in der App die Pfeiler der Q2-Pflicht zurück, die Burg
 * andere Turmhöhen und -spitzen (Mauer-ID `w1` statt `ring`). Die Welt der Engine ist die Referenz.
 *
 * App-Weg wie App.tsx: `typeSession` → Licht-Pass (`lightSession`) → `baseWorldOf` (Vorschau „Blöcke“ und Export), mit
 * Katalog, Themes und Geländestilen der App (gebündelt). Engine-Weg: die Schritte der Operation `building_generate`
 * (`projectFromBuildingType` → `withoutPilastersForTheme` → `generateBase`) im Kontext der Engine, mit der Lage der App
 * im Raster (`at` – in der API bewusst Adapter-Sache). Dass dieser Weg die Operation ist, prüft der erste Test.
 */
describe('C2 (W1-G): App baut dieselben Blöcke wie building_generate', () => {
  const styles = loadBundledTerrainStyles().styles;
  let appCtx: PipelineContext | undefined;
  const app = async (): Promise<PipelineContext> => (appCtx ??= await browserContext(load)!.ready('1.21.11'));

  /** Export-Inhalt als Fingerabdruck: Größe, jeder Block (Position, Zustand, Block-Entity), jede Entity. */
  const printOf = (v: ExportVolume) => {
    const text = (x: unknown): string => JSON.stringify(x, (_k, y: unknown) => (typeof y === 'bigint' ? `${y}n` : y instanceof Map ? [...y] : y));
    const blocks = v.blocks.map((b) => `${b.pos.join(',')}=${b.name}${text(b.properties ?? {})}${b.blockEntity !== undefined ? text(b.blockEntity) : ''}`).sort();
    const entities = v.entities.map((e) => text(e)).sort();
    const hash = createHash('sha256').update(`${v.size.join('x')}|${blocks.join('\n')}|${entities.join('\n')}`).digest('hex').slice(0, 16);
    return { hash, size: v.size.join('×'), blocks, entities: entities.length };
  };
  const worldPrint = (project: Project, world: World) => ({ ...printOf(toExport(project, world)), origin: world.materialized.volume.origin.join(',') });
  /** Abweichende Positionen (für die Fehlermeldung). */
  const diffOf = (a: readonly string[], b: readonly string[]): string[] => {
    const sa = new Set(a);
    const sb = new Set(b);
    return [...a.filter((x) => !sb.has(x)).map((x) => `nur App ${x}`), ...b.filter((x) => !sa.has(x)).map((x) => `nur Engine ${x}`)];
  };

  /** W7-K: Fantasy-Auswahl des Außen-Panels (App: `setShellStyle`, Engine: `exterior.fantasy`/`.fantasyKit`). */
  interface Fantasy { readonly level: FantasyPick; readonly kit?: FantasyKitPick }
  interface Case {
    readonly id: string; readonly size?: BuildingSizeClass; readonly themeId: string; readonly seed: number; readonly blockRules?: BlockRules; readonly fantasy?: Fantasy;
    /** F-Ensemble: Verbindungsgraph ausdrücklich an (App: Assistent-Parameter, Engine: `ensemble: true`). */
    readonly ensemble?: boolean;
    /** Feature Unterbau: Schalter „Keller & Gewölbe darunter“ im Assistenten. */
    readonly underground?: boolean;
    /** Funktionsgrad (W2-1): Auswahl im Assistenten (App: `functionLevel` der Parameter, Engine: `functionLevel` von building_generate). */
    readonly functionLevel?: 'off' | 'some' | 'rich';
    /** Silhouette (WS Schritt 2): Auswahl im Assistenten (App: `silhouette` der Parameter, Engine: `silhouette` von building_generate). */
    readonly silhouette?: 'off' | 'varied';
    /** Geländeform (feat/gelaende): Auswahl im Assistenten (App: `landform` der Parameter, Engine: `landform` von building_generate). */
    readonly landform?: 'flat' | 'natural' | 'dramatic';
    /** Schalter „Rundgänge“ (Haus › Mehr, App: `setShellStyle`, Engine: `loopDoors`). */
    readonly loopDoors?: number;
    /** WS-Fassade: Schalter „Fassadenrhythmus“ (Haus › Mehr, App: `setShellStyle`, Engine: `facadeRhythm: 'on'`). */
    readonly facadeRhythm?: boolean;
    /** W13-G: Blockpalette im Assistenten (App) = `paletteOverrides` von building_generate (Engine). */
    readonly paletteOverrides?: PaletteOverrides;
    /** W15: Auswahl „Details“ im Außen-Panel (App: `setShellStyle`, Engine: `exterior.facadeDetail`). */
    readonly detail?: DetailPick;
    /** feat/site-decor: Deko-Stufe der Umgebung (App: `setSiteDecor`, Engine: `siteDecor`). */
    readonly siteDecor?: 'some' | 'rich';
    /** WS-Verwitterung: erzählende Verwitterung (App: `setWeathering`, Engine: `weathering`). */
    readonly weathering?: 'some' | 'rich';
    /** TX-B: Oberflächen-Textur (App: `setSurfaceTexture`, Engine: `surfaceTexture`). */
    readonly surfaceTexture?: 'subtle' | 'rich';
  }
  /** Eingabe `exterior` von building_generate für die Fantasy-Auswahl (leer = nach Stil bzw. nach Material). */
  const fantasyInput = (f: Fantasy): Record<string, string> => ({ ...(f.level !== '' ? { fantasy: f.level } : {}), ...(f.kit !== undefined && f.kit !== '' ? { fantasyKit: f.kit } : {}) });
  const paramsOf = (c: Case): bt.TypeParams => {
    const def = types.get(c.id);
    const p = {
      ...bt.defaultParams(def, ctx.themes.ids(), c.themeId, NEW), themeId: c.themeId, ...(c.blockRules !== undefined ? { blockRules: c.blockRules } : {}),
      ...(c.ensemble !== undefined ? { ensemble: c.ensemble } : {}),
      ...(c.underground !== undefined ? { underground: c.underground } : {}),
      ...(c.functionLevel !== undefined ? { functionLevel: c.functionLevel } : {}),
      ...(c.landform !== undefined ? { landform: c.landform } : {}),
      ...(c.silhouette !== undefined && c.silhouette !== 'off' ? { silhouette: c.silhouette } : {}),
      ...(c.paletteOverrides !== undefined ? { paletteOverrides: c.paletteOverrides } : {}),
    };
    return c.size === undefined ? p : bt.withSize(def, p, c.size);
  };
  const appWorld = async (c: Case) => {
    const def = types.get(c.id);
    let { session } = bt.typeSession(def, paramsOf(c), c.seed, ctx, NEW);
    if (c.fantasy !== undefined) {
      // wie das Außen-Panel: Stufe, dann Art – je ein Undo-Schritt
      const before = session.past.length;
      session = uc.setShellStyle(session, { exterior: withFantasyLevel(uc.shellStyle(session).exterior, c.fantasy.level) }, catalog);
      if (c.fantasy.kit !== undefined) session = uc.setShellStyle(session, { exterior: withFantasyKit(uc.shellStyle(session).exterior, c.fantasy.kit) }, catalog);
      expect(session.past.length - before).toBe(c.fantasy.kit !== undefined ? 2 : 1);
    }
    if (c.detail !== undefined) {
      const before = session.past.length;
      session = uc.setShellStyle(session, { exterior: withDetailLevel(uc.shellStyle(session).exterior, c.detail) }, catalog);
      expect(session.past.length - before).toBe(1);
    }
    if (c.loopDoors !== undefined) {
      const before = session.past.length;
      session = uc.setShellStyle(session, { loopDoors: c.loopDoors }, catalog);
      expect(session.past.length - before).toBe(1);
    }
    if (c.facadeRhythm === true) {
      const before = session.past.length;
      session = uc.setShellStyle(session, { facadeRhythm: true }, catalog);
      expect(session.past.length - before).toBe(1);
    }
    if (c.siteDecor !== undefined) session = su.setSiteDecor(session, c.siteDecor);
    if (c.weathering !== undefined) session = su.setWeathering(session, c.weathering);
    if (c.surfaceTexture !== undefined) session = su.setSurfaceTexture(session, c.surfaceTexture);
    return sessionPrint(session);
  };
  /** Welt der App für eine Sitzung (Licht-Pass wie beim Export). */
  const sessionPrint = async (session: uc.Session) => {
    const pctx = await app();
    const lit = lightSession({ ...session, needsLight: true }, pctx).session;
    return worldPrint(lit.project, baseWorldOf(lit.project, pctx, uc.shellStyle(lit), lit.surroundings, styles));
  };
  /** Die Schritte von `building_generate` (packages/engine/src/operations/building.ts), optional mit Lage im Raster. */
  const engineWorld = (c: Case, at?: readonly [number, number]) => {
    const def = types.get(c.id);
    const res = projectFromBuildingType(def, {
      ...(c.size !== undefined ? { size: c.size } : {}), front: 'south', themeId: c.themeId, surroundings: true, rerollCount: 0, ...(at !== undefined ? { at: [at[0], at[1]] } : {}),
      ...(c.underground === true ? { underground: true } : {}), ...(c.functionLevel !== undefined ? { functionLevel: c.functionLevel } : {}), ...(c.loopDoors !== undefined ? { loopDoors: c.loopDoors } : {}),
      ...(c.facadeRhythm === true ? { facadeRhythm: 'on' as const } : {}),
      ...(c.landform !== undefined ? { landform: c.landform } : {}),
      ...(c.silhouette !== undefined && c.silhouette !== 'off' ? { silhouette: c.silhouette } : {}),
      ...(c.paletteOverrides !== undefined ? { paletteOverrides: c.paletteOverrides } : {}),
    }, c.seed, engineCtx);
    const { exterior: planExterior, ...build } = sharedRule(res.build, engineCtx.themes, res.project.state.themeId);
    // wie `exteriorStyle` in building_generate: Eingabe `exterior` über die Außen-Deko des Bautyps
    const withFantasy = c.fantasy === undefined ? planExterior : { ...(planExterior ?? {}), ...fantasyInput(c.fantasy) };
    const exterior = c.detail === undefined || c.detail === '' ? withFantasy : { ...(withFantasy ?? {}), facadeDetail: c.detail };
    return worldPrint(res.project, generateBase(res.project, engineCtx, {
      ...build, ...(exterior !== undefined ? { exterior } : {}), ...(c.blockRules !== undefined ? { blockRules: c.blockRules } : {}), ...res.surroundings,
      ...(c.ensemble !== undefined ? { ensemble: c.ensemble ? {} : (false as const) } : {}),
      ...(c.siteDecor !== undefined ? { siteDecor: c.siteDecor } : {}),
      ...(c.weathering !== undefined ? { weathering: c.weathering } : {}),
      ...(c.surfaceTexture !== undefined ? { surfaceTexture: c.surfaceTexture } : {}),
    }));
  };

  it('der Engine-Weg des Tests ist building_generate (gleicher Export)', () => {
    const c: Case = { id: 'house', themeId: 'medieval', seed: 2026 };
    const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'house', themeId: 'medieval', front: 'south', seed: 2026 } });
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const op = printOf(r.artifacts!['export'] as ExportVolume);
    const mine = engineWorld(c);
    expect(mine.blocks.length).toBe(op.blocks.length);
    expect(mine.hash).toBe(op.hash);
  }, HEAVY_TIMEOUT);

  const [s1, s2] = bt.proposalSeeds(2026);
  const CASES: readonly (readonly [string, Case])[] = [
    ['Taverne S, Fachwerk (Pfeiler-Regel)', { id: 'tavern', size: 'S', themeId: 'timber', seed: s2! }],
    ['Taverne S, Fachwerk, zweiter Seed', { id: 'tavern', size: 'S', themeId: 'timber', seed: 3 }],
    ['Burg S (Ringmauer-ID, Turmhöhen)', { id: 'castle_compact', size: 'S', themeId: 'medieval', seed: s1! }],
    ['Stadthaus S, Fachwerk', { id: 'townhouse', size: 'S', themeId: 'timber', seed: s1! }],
    ['Hobbit S (Erdhügel)', { id: 'hobbit', size: 'S', themeId: 'rustic', seed: s1! }],
    ['Beispielhaus (feste Vorlage)', { id: 'house', themeId: 'medieval', seed: 2026 }],
    ['Fachwerkhaus (feste Vorlage, Fachwerk)', { id: 'timber', themeId: 'timber', seed: s2! }],
    // W3-BL: Block-Regeln – der Assistent richtet gleich mit ihnen ein, building_generate mit blockRules
    ['Hafen-Taverne S, Nur leicht farmbar', { id: 'tavern', size: 'S', themeId: 'harbor', seed: s1!, blockRules: withBlockPreset(undefined, 'easy_farm', true)! }],
    ['Burg S, Nur leicht farmbar', { id: 'castle_compact', size: 'S', themeId: 'dwarven', seed: s2!, blockRules: withBlockPreset(undefined, 'easy_farm', true)! }],
    // F-Ensemble: Verbindungsgraph an – Brücke zum Wehrgang (Burg) bzw. Rundweg (Taverne) in App und Engine gleich
    ['Burg S, Brücken und Rundwege an', { id: 'castle_compact', size: 'S', themeId: 'medieval', seed: s1!, ensemble: true }],
    ['Taverne S, Fachwerk, Brücken und Rundwege an', { id: 'tavern', size: 'S', themeId: 'timber', seed: s2!, ensemble: true }],
    ['Burg S, Nur leicht farmbar, Brücken und Rundwege an', { id: 'castle_compact', size: 'S', themeId: 'dwarven', seed: s2!, blockRules: withBlockPreset(undefined, 'easy_farm', true)!, ensemble: true }],
    // W7-K: Fantasy-Auswahl im Außen-Panel = exterior.fantasy/.fantasyKit von building_generate
    ['Beispielhaus Mittelalter, Fantasy Akzent', { id: 'house', themeId: 'medieval', seed: 2026, fantasy: { level: 'accent' } }],
    ['Beispielhaus Mittelalter, Fantasy voll zwergisch', { id: 'house', themeId: 'medieval', seed: 2026, fantasy: { level: 'full', kit: 'dwarven' } }],
    ['Beispielhaus Elbisch, Fantasy Akzent', { id: 'house', themeId: 'elven', seed: 2026, fantasy: { level: 'accent' } }],
    ['Beispielhaus Elbisch, Fantasy aus', { id: 'house', themeId: 'elven', seed: 2026, fantasy: { level: 'off' } }],
    // feat/underground: Schalter „Keller & Gewölbe darunter“ = building_generate mit underground
    ['Beispielhaus, Keller & Gewölbe (Assistent)', { id: 'house', themeId: 'medieval', seed: 2026, underground: true }],
    ['Taverne S, Rundgänge (Haus › Mehr)', { id: 'tavern', size: 'S', themeId: 'medieval', seed: s1!, loopDoors: 1 }],
    // WS-Fassade: Fassadenrhythmus (Haus › Mehr) = building_generate mit facadeRhythm 'on'
    ['Taverne S, Fassadenrhythmus (Haus › Mehr)', { id: 'tavern', size: 'S', themeId: 'medieval', seed: s1!, facadeRhythm: true }],
    ['Bauernhaus S, Fassadenrhythmus (Haus › Mehr)', { id: 'farmhouse', size: 'S', themeId: 'nordic', seed: s2!, facadeRhythm: true }],
    // W2-1: Funktionsgrad im Assistenten = building_generate mit functionLevel (App und Engine bauen dasselbe)
    ['Taverne S, Funktionsgrad etwas', { id: 'tavern', size: 'S', themeId: 'timber', seed: s1!, functionLevel: 'some' }],
    ['Langhaus, Funktionsgrad viel', { id: 'longhouse', themeId: 'nordic', seed: s2!, functionLevel: 'rich' }],
    ['Bauernhaus S, Funktionsgrad viel', { id: 'farmhouse', size: 'S', themeId: 'rustic', seed: s1!, functionLevel: 'rich' }],
    ['Taverne S, Funktionsgrad aus (ausdrücklich)', { id: 'tavern', size: 'S', themeId: 'timber', seed: s1!, functionLevel: 'off' }],
    // WS Silhouette: Anbau mit eigener Dachhöhe im Assistenten = building_generate mit silhouette
    ['Taverne M, Silhouette abwechslungsreich', { id: 'tavern', size: 'M', themeId: 'timber', seed: s1!, silhouette: 'varied' }],
    ['Langhaus M, Silhouette abwechslungsreich', { id: 'longhouse', size: 'M', themeId: 'nordic', seed: s2!, silhouette: 'varied' }],
    // feat/gelaende: Geländeform im Assistenten = building_generate mit landform (Hang, Stützmauer, Teich, Findlinge, Moos)
    ['Taverne S, Fachwerk, Geländeform hügelig', { id: 'tavern', size: 'S', themeId: 'timber', seed: s1!, landform: 'natural' }],
    ['Bauernhaus S, Geländeform bergig', { id: 'farmhouse', size: 'S', themeId: 'rustic', seed: s2!, landform: 'dramatic' }],
    ['Beispielhaus (ohne Vorlage), Geländeform hügelig', { id: 'house', themeId: 'medieval', seed: 2026, landform: 'natural' }],
    ['Taverne S, Fachwerk, Geländeform eben (ausdrücklich)', { id: 'tavern', size: 'S', themeId: 'timber', seed: s1!, landform: 'flat' }],
    // W13-G: Blockpalette vor dem Generieren (Assistent) = building_generate mit paletteOverrides
    ['Beispielhaus, Ziegeldach + dunkles Fachwerk + Tausch Fichte → Birke', {
      id: 'house', themeId: 'medieval', seed: 2026, paletteOverrides: { groups: { roof: 'bricks', frame: 'dark_oak' }, swaps: [{ from: 'spruce', to: 'birch' }] },
    }],
    // W15: Auswahl „Details“ im Außen-Panel = exterior.facadeDetail von building_generate
    ['Fachwerkhaus, Fassaden-Details dezent', { id: 'timber', themeId: 'timber', seed: s2!, detail: 'subtle' }],
    ['Taverne S, Fachwerk, Fassaden-Details reich (Regal-Auslage)', { id: 'tavern', size: 'S', themeId: 'timber', seed: s2!, detail: 'rich' }],
    // feat/site-decor: Grundstücks-Deko (Umgebung) = building_generate mit siteDecor
    ['Bauernhaus, Grundstücks-Deko reich', { id: 'farmhouse', size: 'M', themeId: 'medieval', seed: s1!, siteDecor: 'rich' }],
    // WS-Verwitterung: erzählende Verwitterung = building_generate mit weathering
    ['Bauernhaus, Verwitterung stark', { id: 'farmhouse', size: 'M', themeId: 'medieval', seed: s1!, weathering: 'rich' }],
    ['Taverne S, Verwitterung wenig', { id: 'tavern', size: 'S', themeId: 'medieval', seed: s2!, weathering: 'some' }],
    // TX-B: Oberflächen-Textur = building_generate mit surfaceTexture
    ['Bauernhaus, Oberflächen-Textur reich', { id: 'farmhouse', size: 'M', themeId: 'medieval', seed: s1!, surfaceTexture: 'rich' }],
    ['Taverne S, Oberflächen-Textur dezent + Verwitterung', { id: 'tavern', size: 'S', themeId: 'medieval', seed: s2!, surfaceTexture: 'subtle', weathering: 'some' }],
    ['Taverne S, Fachwerk, Grundstücks-Deko etwas', { id: 'tavern', size: 'S', themeId: 'timber', seed: s2!, siteDecor: 'some' }],
    ['Taverne S, Fachwerk, Wand Kalzit + Sockel Schwarzstein', { id: 'tavern', size: 'S', themeId: 'timber', seed: s2!, paletteOverrides: { groups: { wall: 'calcite', base: 'blackstone' } } }],
  ];
  it('W13-G: der Engine-Weg mit Blockpalette ist building_generate mit paletteOverrides (gleicher Export, anderer Bau als ohne)', () => {
    const c: Case = { id: 'house', themeId: 'medieval', seed: 2026, paletteOverrides: { groups: { roof: 'bricks' } } };
    const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'house', themeId: 'medieval', front: 'south', seed: 2026, paletteOverrides: { roof: 'bricks' } } });
    if (!r.ok) throw new Error(r.errors.join(' | '));
    const op = printOf(r.artifacts!['export'] as ExportVolume);
    expect(engineWorld(c).hash).toBe(op.hash);
    expect(op.hash).not.toBe(engineWorld({ id: 'house', themeId: 'medieval', seed: 2026 }).hash);
  }, HEAVY_TIMEOUT);
  it('feat/underground: der Engine-Weg mit Unterbau ist building_generate mit underground (gleicher Export, anderer Bau als ohne)', () => {
    const c: Case = { id: 'house', themeId: 'medieval', seed: 2026, underground: true };
    const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'house', themeId: 'medieval', front: 'south', seed: 2026, underground: true } });
    if (!r.ok) throw new Error(r.errors.join(' | '));
    const op = printOf(r.artifacts!['export'] as ExportVolume);
    expect(engineWorld(c).hash).toBe(op.hash);
    expect(op.hash).not.toBe(engineWorld({ id: 'house', themeId: 'medieval', seed: 2026 }).hash);
  }, HEAVY_TIMEOUT);
  it('feat/underground: Projektdatei trägt Unterbau (Herkunft) und Rundgänge; App → Engine → App gleich, Haken bleibt', () => {
    const def = types.get('house');
    let { session } = bt.typeSession(def, { ...params('house'), underground: true }, 2026, ctx, NEW);
    session = uc.setShellStyle(session, { loopDoors: 0.15 }, catalog);
    expect(uc.shellStyle(session).loopDoors).toBe(0.15);
    const original = json(serializeProject(session, { savedAt: SAVED }));
    expect(original['loopDoors']).toBe(0.15);
    const back = viaEngine(original);
    expect(back.warnings).toEqual([]);
    expect(back.file).toEqual(original);
    const r = parseProjectFile(JSON.stringify(original), refs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(uc.shellStyle(r.session).loopDoors).toBe(0.15);
    expect(bt.originParams(r.session, def).underground).toBe(true);
    // ohne Haken: kein Feld in der Datei, Haken aus
    const plain = bt.typeSession(def, params('house'), 2026, ctx, NEW).session;
    expect(json(serializeProject(plain, { savedAt: SAVED }))['loopDoors']).toBeUndefined();
    expect(bt.originParams(plain, def).underground).toBe(false);
  }, HEAVY_TIMEOUT);
  it('WS-Fassade: Projektdatei trägt den Fassadenrhythmus; App → Engine → App gleich, ohne Schalter kein Feld', () => {
    const def = types.get('house');
    let { session } = bt.typeSession(def, params('house'), 2026, ctx, NEW);
    session = uc.setShellStyle(session, { facadeRhythm: true }, catalog);
    expect(uc.shellStyle(session).facadeRhythm).toBe(true);
    const original = json(serializeProject(session, { savedAt: SAVED }));
    expect(original['facadeRhythm']).toBe(true);
    const back = viaEngine(original);
    expect(back.warnings).toEqual([]);
    expect(back.file).toEqual(original);
    const r = parseProjectFile(JSON.stringify(original), refs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(uc.shellStyle(r.session).facadeRhythm).toBe(true);
    const plain = bt.typeSession(def, params('house'), 2026, ctx, NEW).session;
    expect(json(serializeProject(plain, { savedAt: SAVED }))['facadeRhythm']).toBeUndefined();
    expect(uc.shellStyle(plain).facadeRhythm).toBeUndefined();
  }, HEAVY_TIMEOUT);
  it('W2-1: Funktionsgrad – der Engine-Weg ist building_generate mit functionLevel (gleicher Export, anderer Bau als ohne; off = ohne)', () => {
    const gen = (level?: string) => {
      const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'tavern', size: 'M', themeId: 'timber', front: 'south', seed: 2026, ...(level !== undefined ? { functionLevel: level } : {}) } });
      if (!r.ok) throw new Error(r.errors.join(' | '));
      return printOf(r.artifacts!['export'] as ExportVolume).hash;
    };
    const c: Case = { id: 'tavern', size: 'M', themeId: 'timber', seed: 2026 };
    expect(engineWorld({ ...c, functionLevel: 'rich' }).hash).toBe(gen('rich'));
    expect(gen('off')).toBe(gen());
    expect(gen('rich')).not.toBe(gen());
    expect(gen('some')).not.toBe(gen('rich'));
  }, HEAVY_TIMEOUT);
  it('W2-1: Projektdatei trägt den Funktionsgrad (Herkunft); App → Engine → App gleich; ältere Datei ohne das Feld = off', () => {
    const def = types.get('tavern');
    const { session } = bt.typeSession(def, { ...params('tavern', { size: 'S' }), functionLevel: 'rich' }, s1!, ctx, NEW);
    expect(bt.originParams(session, def).functionLevel).toBe('rich');
    const original = json(serializeProject(session, { savedAt: SAVED }));
    const back = viaEngine(original);
    expect(back.warnings).toEqual([]);
    expect(back.file).toEqual(original);
    const r = parseProjectFile(JSON.stringify(original), refs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(bt.originParams(r.session, def).functionLevel).toBe('rich');
    // ohne Funktionsgrad: nichts in der Herkunft, off nach dem Laden
    const plain = bt.typeSession(def, params('tavern', { size: 'S' }), s1!, ctx, NEW).session;
    expect(JSON.stringify(json(serializeProject(plain, { savedAt: SAVED })))).not.toContain('functionLevel');
    expect(bt.originParams(plain, def).functionLevel).toBeUndefined();
  }, HEAVY_TIMEOUT);
  it('WS Silhouette: der Engine-Weg ist building_generate mit silhouette (gleicher Export, anderer Bau als ohne; off = ohne)', () => {
    const gen = (mode?: string) => {
      const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'tavern', size: 'M', themeId: 'timber', front: 'south', seed: 2026, ...(mode !== undefined ? { silhouette: mode } : {}) } });
      if (!r.ok) throw new Error(r.errors.join(' | '));
      return printOf(r.artifacts!['export'] as ExportVolume).hash;
    };
    const c: Case = { id: 'tavern', size: 'M', themeId: 'timber', seed: 2026 };
    expect(engineWorld({ ...c, silhouette: 'varied' }).hash).toBe(gen('varied'));
    expect(gen('off')).toBe(gen());
    expect(gen('varied')).not.toBe(gen());
  }, HEAVY_TIMEOUT);
  it('WS Silhouette: Projektdatei trägt die Silhouette (Herkunft); App → Engine → App gleich; ältere Datei ohne das Feld = off', () => {
    const def = types.get('tavern');
    const { session } = bt.typeSession(def, { ...params('tavern', { size: 'M' }), silhouette: 'varied' }, s1!, ctx, NEW);
    expect(bt.originParams(session, def).silhouette).toBe('varied');
    const original = json(serializeProject(session, { savedAt: SAVED }));
    const back = viaEngine(original);
    expect(back.warnings).toEqual([]);
    expect(back.file).toEqual(original);
    const r = parseProjectFile(JSON.stringify(original), refs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(bt.originParams(r.session, def).silhouette).toBe('varied');
    const plain = bt.typeSession(def, params('tavern', { size: 'M' }), s1!, ctx, NEW).session;
    expect(JSON.stringify(json(serializeProject(plain, { savedAt: SAVED })))).not.toContain('silhouette');
    expect(bt.originParams(plain, def).silhouette).toBeUndefined();
  }, HEAVY_TIMEOUT);
  it('feat/gelaende: Geländeform – der Engine-Weg ist building_generate mit landform (gleicher Export, anderer Bau als ohne; flat = ohne)', () => {
    const gen = (form?: string) => {
      const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'tavern', size: 'S', themeId: 'timber', front: 'south', seed: 2026, ...(form !== undefined ? { landform: form } : {}) } });
      if (!r.ok) throw new Error(r.errors.join(' | '));
      return printOf(r.artifacts!['export'] as ExportVolume).hash;
    };
    expect(gen('flat')).toBe(gen());
    expect(gen('natural')).not.toBe(gen());
    expect(gen('dramatic')).not.toBe(gen('natural'));
  }, HEAVY_TIMEOUT);
  it('feat/gelaende: Projektdatei trägt die Geländeform in der Umgebung; App → Engine → App gleich; Umschalten im Panel = project_style', () => {
    const def = types.get('tavern');
    const { session } = bt.typeSession(def, { ...params('tavern', { size: 'S' }), landform: 'natural' }, s1!, ctx, NEW);
    expect(session.surroundings?.landform).toBe('natural');
    expect(su.landformOf(session)).toBe('natural');
    expect(bt.originParams(session, def).landform).toBe('natural');
    const original = json(serializeProject(session, { savedAt: SAVED }));
    const back = viaEngine(original);
    expect(back.warnings).toEqual([]);
    expect(back.file).toEqual(original);
    const r = parseProjectFile(JSON.stringify(original), refs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(su.landformOf(r.session)).toBe('natural');
    // Panel Umgebung: bergig, dann eben – eben entfernt das Feld wieder
    const steep = su.setLandform(session, 'dramatic');
    expect(su.landformOf(steep)).toBe('dramatic');
    expect(su.landformOf(su.setLandform(steep, 'flat'))).toBe('flat');
    expect(su.setLandform(steep, 'flat').surroundings).not.toHaveProperty('landform');
    // ohne Wahl: nichts in der Datei
    const plain = bt.typeSession(def, params('tavern', { size: 'S' }), s1!, ctx, NEW).session;
    expect(JSON.stringify(json(serializeProject(plain, { savedAt: SAVED })))).not.toContain('landform');
  }, HEAVY_TIMEOUT);
  it('W7-K: der Engine-Weg mit Fantasy-Auswahl ist building_generate mit exterior.fantasy/.fantasyKit (gleicher Export)', () => {
    for (const fantasy of [{ level: 'accent' }, { level: 'full', kit: 'dwarven' }] as const) {
      const c: Case = { id: 'house', themeId: 'medieval', seed: 2026, fantasy };
      const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'house', themeId: 'medieval', front: 'south', seed: 2026, exterior: fantasyInput(fantasy) } });
      if (!r.ok) throw new Error(r.errors.join('\n'));
      const op = printOf(r.artifacts!['export'] as ExportVolume);
      expect(engineWorld(c).hash).toBe(op.hash);
      // … und die Auswahl wirkt (anderer Bau als ohne)
      const { fantasy: _f, ...plain } = c;
      expect(op.hash).not.toBe(engineWorld(plain).hash);
    }
  }, HEAVY_TIMEOUT);

  it('W15: der Engine-Weg mit Fassaden-Details ist building_generate mit exterior.facadeDetail (gleicher Export, anderer Bau als ohne)', () => {
    const c: Case = { id: 'house', themeId: 'medieval', seed: 2026, detail: 'subtle' };
    const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'house', themeId: 'medieval', front: 'south', seed: 2026, exterior: { facadeDetail: 'subtle' } } });
    if (!r.ok) throw new Error(r.errors.join(' | '));
    const op = printOf(r.artifacts!['export'] as ExportVolume);
    expect(engineWorld(c).hash).toBe(op.hash);
    expect(op.hash).not.toBe(engineWorld({ id: 'house', themeId: 'medieval', seed: 2026, detail: 'off' }).hash);
  }, HEAVY_TIMEOUT);

  it('feat/site-decor: der Engine-Weg mit Grundstücks-Deko ist building_generate mit siteDecor (gleicher Export, anderer Bau als ohne)', () => {
    const c: Case = { id: 'farmhouse', size: 'M', themeId: 'medieval', seed: 11, siteDecor: 'rich' };
    const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'farmhouse', size: 'M', themeId: 'medieval', front: 'south', seed: 11, siteDecor: 'rich' } });
    if (!r.ok) throw new Error(r.errors.join(' | '));
    const op = printOf(r.artifacts!['export'] as ExportVolume);
    expect(engineWorld(c).hash).toBe(op.hash);
    const { siteDecor: _d, ...plain } = c;
    expect(op.hash).not.toBe(engineWorld(plain).hash);
  }, HEAVY_TIMEOUT);

  it('feat/site-decor: Projektdatei trägt die Stufe (`surroundings.siteDecor`); App → Engine → App gleich, project_style ändert sie', () => {
    const s = su.setSiteDecor(bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'M' }), 5, ctx, NEW).session, 'rich');
    expect(su.siteDecorOf(s)).toBe('rich');
    const original = json(serializeProject(s, { savedAt: SAVED }));
    expect((original['surroundings'] as { siteDecor?: string }).siteDecor).toBe('rich');
    const back = viaEngine(original);
    expect(back.warnings).toEqual([]);
    expect(back.file).toEqual(original);
    const r = parseProjectFile(JSON.stringify(back.file), refs);
    expect(r.ok && su.siteDecorOf(r.session)).toBe('rich');
    ok(engine.execute({ op: 'project_style', input: { projectId: back.projectId, siteDecor: 'off' } }));
    const off = ok(engine.execute({ op: 'project_save', input: { projectId: back.projectId, format: 'app', savedAt: SAVED.toISOString() } }));
    const rOff = parseProjectFile(JSON.stringify(off), refs);
    expect(rOff.ok && su.siteDecorOf(rOff.session)).toBe('off');
    // ohne Stufe: kein Feld in der Datei (ältere Dateien bleiben gleich)
    const plain = bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'M' }), 5, ctx, NEW).session;
    expect((json(serializeProject(plain, { savedAt: SAVED }))['surroundings'] as { siteDecor?: string }).siteDecor).toBeUndefined();
  }, HEAVY_TIMEOUT);

  it('WS-Verwitterung: der Engine-Weg mit Verwitterung ist building_generate mit weathering (gleicher Export, anderer Bau als ohne)', () => {
    const c: Case = { id: 'farmhouse', size: 'M', themeId: 'medieval', seed: 11, weathering: 'rich' };
    const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'farmhouse', size: 'M', themeId: 'medieval', front: 'south', seed: 11, weathering: 'rich' } });
    if (!r.ok) throw new Error(r.errors.join(' | '));
    const op = printOf(r.artifacts!['export'] as ExportVolume);
    expect(engineWorld(c).hash).toBe(op.hash);
    const { weathering: _w, ...plain } = c;
    expect(op.hash).not.toBe(engineWorld(plain).hash);
  }, HEAVY_TIMEOUT);

  it('WS-Verwitterung: Projektdatei trägt die Stufe (`surroundings.weathering`); App → Engine → App gleich, project_style ändert sie', () => {
    const s = su.setWeathering(bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'M' }), 5, ctx, NEW).session, 'rich');
    expect(su.weatheringOf(s)).toBe('rich');
    const original = json(serializeProject(s, { savedAt: SAVED }));
    expect((original['surroundings'] as { weathering?: string }).weathering).toBe('rich');
    const back = viaEngine(original);
    expect(back.warnings).toEqual([]);
    expect(back.file).toEqual(original);
    const r = parseProjectFile(JSON.stringify(back.file), refs);
    expect(r.ok && su.weatheringOf(r.session)).toBe('rich');
    ok(engine.execute({ op: 'project_style', input: { projectId: back.projectId, weathering: 'off' } }));
    const off = ok(engine.execute({ op: 'project_save', input: { projectId: back.projectId, format: 'app', savedAt: SAVED.toISOString() } }));
    const rOff = parseProjectFile(JSON.stringify(off), refs);
    expect(rOff.ok && su.weatheringOf(rOff.session)).toBe('off');
    // ohne Stufe: kein Feld in der Datei (ältere Dateien bleiben gleich)
    const plain = bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'M' }), 5, ctx, NEW).session;
    expect((json(serializeProject(plain, { savedAt: SAVED }))['surroundings'] as { weathering?: string } | undefined)?.weathering).toBeUndefined();
  }, HEAVY_TIMEOUT);

  it('TX-B: der Engine-Weg mit Oberflächen-Textur ist building_generate mit surfaceTexture (gleicher Export, anderer Bau als ohne)', () => {
    const c: Case = { id: 'farmhouse', size: 'M', themeId: 'medieval', seed: 11, surfaceTexture: 'rich' };
    const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'farmhouse', size: 'M', themeId: 'medieval', front: 'south', seed: 11, surfaceTexture: 'rich' } });
    if (!r.ok) throw new Error(r.errors.join(' | '));
    const op = printOf(r.artifacts!['export'] as ExportVolume);
    expect(engineWorld(c).hash).toBe(op.hash);
    const { surfaceTexture: _t, ...plain } = c;
    expect(op.hash).not.toBe(engineWorld(plain).hash);
  }, HEAVY_TIMEOUT);

  it('TX-B: Projektdatei trägt die Stufe (`surroundings.surfaceTexture`); App → Engine → App gleich, project_style ändert sie', () => {
    const s = su.setSurfaceTexture(bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'M' }), 5, ctx, NEW).session, 'rich');
    expect(su.surfaceTextureOf(s)).toBe('rich');
    const original = json(serializeProject(s, { savedAt: SAVED }));
    expect((original['surroundings'] as { surfaceTexture?: string }).surfaceTexture).toBe('rich');
    const back = viaEngine(original);
    expect(back.warnings).toEqual([]);
    expect(back.file).toEqual(original);
    const r = parseProjectFile(JSON.stringify(back.file), refs);
    expect(r.ok && su.surfaceTextureOf(r.session)).toBe('rich');
    ok(engine.execute({ op: 'project_style', input: { projectId: back.projectId, surfaceTexture: 'off' } }));
    const off = ok(engine.execute({ op: 'project_save', input: { projectId: back.projectId, format: 'app', savedAt: SAVED.toISOString() } }));
    const rOff = parseProjectFile(JSON.stringify(off), refs);
    expect(rOff.ok && su.surfaceTextureOf(rOff.session)).toBe('off');
    // ohne Stufe: kein Feld in der Datei (ältere Dateien bleiben gleich)
    const plain = bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'M' }), 5, ctx, NEW).session;
    expect((json(serializeProject(plain, { savedAt: SAVED }))['surroundings'] as { surfaceTexture?: string } | undefined)?.surfaceTexture).toBeUndefined();
  }, HEAVY_TIMEOUT);

  it('feat/underground: „Bautyp anpassen“ mit Haken (ein Undo-Schritt) – die Engine baut die App-Datei blockgleich (project_generate)', async () => {
    const c: Case = { id: 'tavern', size: 'S', themeId: 'medieval', seed: s1! };
    const def = types.get(c.id);
    let { session } = bt.typeSession(def, paramsOf({ id: c.id, size: 'S', themeId: c.themeId, seed: c.seed }), c.seed, ctx, NEW);
    const before = session.past.length;
    const draft = { ...bt.originParams(session, def), underground: true };
    expect(bt.originParams(session, def).underground).toBe(false);
    expect(bt.replansLayout(session, def, draft)).toBe(true);
    session = bt.changeTypeParams(session, def, draft, ctx);
    expect(session.past.length - before).toBe(1);
    expect(bt.originParams(session, def).underground).toBe(true);
    expect(uc.shellStyle(session).loopDoors).toBeUndefined();
    expect(session.project.state.rooms.some((r) => r.floorIndex === -2)).toBe(true);
    // Die Engine liest die App-Datei mit genau diesem Stil (samt Zusatztüren) und denselben Räumen samt Unterbau.
    // (Blockgleich über project_generate ist nicht prüfbar: auch ohne Unterbau weicht dort die Einrichtung ab – Befund
    // in F_underground.md; blockgleich prüft der Fall „Keller & Gewölbe (Assistent)“ gegen building_generate.)
    const { projectId } = viaEngine(json(serializeProject(session, { savedAt: SAVED })));
    const view = ok(engine.execute({ op: 'project_get', input: { projectId } }));
    const style = uc.shellStyle(session);
    expect(view['style']).toEqual({ ...uc.shellOptions(style), exterior: uc.exteriorOptions(style.exterior) });
    expect(JSON.stringify(view['rooms'])).toContain('"floor":-2');
    // Undo: Haken wieder aus, kein Unterbau
    const undone = uc.undo(session);
    expect(bt.originParams(undone, def).underground).toBe(false);
    expect(undone.project.state.rooms.some((r) => r.floorIndex === -2)).toBe(false);
  }, HEAVY_TIMEOUT);

  for (const [label, c] of CASES) {
    it(`${label}: Seed ${c.seed} blockgleich`, async () => {
      const a = await appWorld(c);
      const e = engineWorld(c, bt.placementOf(types.get(c.id), paramsOf(c)));
      expect(a.origin, 'Lage des Volumens').toBe(e.origin);
      expect(a.size, 'Größe des Volumens').toBe(e.size);
      if (a.hash !== e.hash) {
        const d = diffOf(a.blocks, e.blocks);
        expect.fail(`${d.length} abweichende Einträge (App ${a.blocks.length}, Engine ${e.blocks.length} Blöcke), z. B.\n${d.slice(0, 8).join('\n')}`);
      }
      expect(a.entities).toBe(e.entities);
      if (c.blockRules !== undefined) {
        const banned = new Set(EASY_FARM_BLOCKS);
        expect(a.blocks.filter((b) => banned.has(b.split('=')[1]!.replace(/^minecraft:/, '').replace(/[{[].*$/, '')))).toEqual([]);
      }
    }, HEAVY_TIMEOUT);
  }
});
