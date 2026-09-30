/**
 * W14 Performance: Die Beschleunigungen ändern keine Ergebnisse.
 * - Blöcke-Worker (`blocksJob`): Projektdatei → Welt → Quader gleich dem Haupt-Thread-Weg von `useWorld`
 *   (`baseWorldOf`/`worldOf` → `buildBlockVoxels`), mit und ohne Umgebung, samt Kennzahlen der Statuszeile.
 * - Spielbarkeits-Worker (`playabilityJob`, eigener gebündelter Katalog) = `proposalPlayability` im Haupt-Thread.
 * - Rückgängig nimmt das gemerkte Projekt (gleiche Events) statt neu abzuspielen – gleicher Zustand, gleiche Objekte.
 * - Der Grundriss eines Vorschlags hängt nicht von Farbwelt und Blockpalette ab (Zwischenspeicher im Assistenten).
 * - Pixel-Atlas: gleiche Blöcke → derselbe Atlas; Rechtecke wie ohne Zwischenspeicher.
 */
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { parseJson5Text } from '../../catalog/src/json5Text.js';
import { planBuilding } from '@mcda/archetype';
import { archetypeContext, withBlockPreset, type PipelineContext } from '@mcda/pipeline';
import { HEAVY_TIMEOUT, expectCpuBelow, timeCpu } from '../../core/test/support/timing.js';
import { blocksJob, packVoxels, unpackVoxels, type BlocksSource } from '../src/adapters/blocksJob.js';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { playabilityJob } from '../src/adapters/playabilityJob.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { exportProject, exportReport, worldOf } from '../src/exporting.js';
import { streamGzip } from '../src/adapters/gzip.js';
import { lightSession } from '../src/lighting.js';
import { buildPixelAtlas, classifyTexture } from '../src/pixelTextures.js';
import { serializeProject } from '../src/projectFile.js';
import * as su from '../src/surroundings.js';
import { baseWorldOf } from '../src/surroundingsWorld.js';
import * as uc from '../src/usecases.js';
import { buildBlockVoxels } from '../src/viewer/blocks.js';
import { materialDataOf, materialView } from '../src/ui/materialRows.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes;
const styles = loadBundledTerrainStyles().styles;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: styles, ...(load.paletteCatalog !== undefined ? { palettes: load.paletteCatalog } : {}) };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });
const params = (id: string, patch: Partial<bt.TypeParams> = {}): bt.TypeParams => ({ ...bt.defaultParams(types.get(id), ctx.themes.ids(), 'medieval', NEW), ...patch });

const pipeline = browserContext(load)!;
let pctx: PipelineContext | undefined;
const ready = async (): Promise<PipelineContext> => (pctx ??= await pipeline.ready('1.21.11'));
/** Wie der Worker: eigener Katalog aus dem Bundle (nicht die Objekte dieses Tests). */
const workerLoad = loadBundledCatalog();
const workerPipeline = browserContext(workerLoad)!;
const workerSource: BlocksSource = {
  ready: (v) => workerPipeline.ready(v),
  terrainStyles: loadBundledTerrainStyles().styles,
  refs: { catalog: workerPipeline.catalog, themes: workerPipeline.themes },
};

/** Haupt-Thread-Weg wie `useWorld` + `buildBlockVoxels` in App.tsx. */
async function mainPreview(s: uc.Session, around: boolean) {
  const c = await ready();
  const style = uc.shellStyle(s);
  const world = around && su.hasSurroundings(s.surroundings) ? baseWorldOf(s.project, c, style, s.surroundings, styles) : worldOf(s.project, c, style);
  const r = exportReport(world);
  return { voxels: buildBlockVoxels(world), stats: { blocks: r.blocks, version: r.version, darkCells: r.darkCells }, material: materialDataOf(world) };
}

async function lit(s: uc.Session): Promise<uc.Session> {
  return lightSession({ ...s, needsLight: true }, await ready()).session;
}

describe('W14: Blöcke-Worker rechnet wie der Haupt-Thread', () => {
  it('Packen und Entpacken der Quader ist verlustfrei (Werte, Reihenfolge, fehlende Felder)', () => {
    const list = [
      { center: [0.5, 1.25, 3.5] as const, size: [1, 0.5, 1] as const, color: 0x123456, layer: 'wall' as const, owner: 'shell:r1', block: 'minecraft:oak_slab' },
      { center: [2.5, 0.03125, -7.5] as const, size: [0.875, 0.0625, 0.875] as const, color: 0xffffff, layer: 'light' as const },
      { center: [1 / 3, 2 / 3, 0.1] as const, size: [0.1, 0.2, 0.3] as const, color: 0, layer: 'furniture' as const, owner: 'p7' },
    ];
    expect(unpackVoxels(packVoxels(list))).toEqual(list);
  });

  it('Bautyp mit Gelände (Umgebung an und aus) und Sitzung mit Turm, Stil und Block-Regeln: dieselben Quader', async () => {
    const farm = await lit(bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'M' }), 5, ctx, NEW).session);
    let rich = bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'S' }), 11, ctx, NEW).session;
    rich = uc.setShellStyle(rich, { roof: 'half_hip', dormers: { kind: 'shed', width: 3, minGap: 2 } }, catalog);
    rich = su.addTower(rich, [-12, -12]).session;
    rich = uc.setBlockRules(rich, catalog, { ...withBlockPreset(undefined, 'easy_farm', true)!, replace: { gold_block: 'honeycomb_block' } });
    rich = await lit(rich);
    for (const [s, around] of [[farm, true], [farm, false], [rich, true]] as const) {
      const main = await mainPreview(s, around);
      const reply = await blocksJob({ id: 1, file: serializeProject(s), around }, workerSource);
      if (!('voxels' in reply)) throw new Error('error' in reply ? reply.error : 'keine Quader');
      expect(reply.voxels.count).toBe(main.voxels.length);
      expect(unpackVoxels(reply.voxels)).toEqual(main.voxels);
      expect(reply.stats).toEqual(main.stats);
      // Tab „Material“: dieselben Daten wie aus der Welt des Haupt-Threads
      expect(reply.material).toEqual(main.material);
      expect(materialView(reply.material, undefined, 'all', '', 50)).toEqual(materialView(main.material, undefined, 'all', '', 50));
    }
  }, HEAVY_TIMEOUT * 2);

  it('Vorschaubild im Assistenten: Vorschlag als Projektdatei → dieselben Quader wie worldOf im Haupt-Thread', async () => {
    const c = await ready();
    for (const [id, seed, patch] of [['farmhouse', 3, {}], ['tavern', 8, { paletteOverrides: { groups: { roof: 'bricks' } } }]] as const) {
      const p = bt.proposal(types.get(id), params(id, patch), seed, ctx, NEW);
      const reply = await blocksJob({ id: 1, file: serializeProject(uc.sessionFromProject(p.project, p.style), { savedAt: new Date(0) }), around: false }, workerSource);
      if (!('voxels' in reply)) throw new Error('error' in reply ? reply.error : 'keine Quader');
      expect(unpackVoxels(reply.voxels)).toEqual(buildBlockVoxels(worldOf(p.project, c, p.style)));
    }
  }, HEAVY_TIMEOUT * 2);

  it('Export im Worker: gleiche Datei wie im Haupt-Thread; Prüfbericht gleich exportReport', async () => {
    const c = await ready();
    const s = await lit(bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'S' }), 21, ctx, NEW).session);
    const file = serializeProject(s, { savedAt: new Date(0) });
    const source = { ...workerSource, gzip: streamGzip };
    const main = baseWorldOf(s.project, c, uc.shellStyle(s), s.surroundings, styles);
    for (const format of ['schem', 'litematic', 'nbt'] as const) {
      const reply = await blocksJob({ id: 3, file, around: true, export: format }, source, { date: 0 });
      if (!('file' in reply)) throw new Error('error' in reply ? reply.error : 'keine Datei');
      const expected = await exportProject(s.project, main, format, streamGzip, { date: 0 });
      expect(reply.file.name).toBe(expected.name);
      expect(Buffer.from(await streamGzip.gunzip(reply.file.bytes)).equals(Buffer.from(await streamGzip.gunzip(expected.bytes)))).toBe(true);
    }
    const preview = await blocksJob({ id: 4, file, around: true }, source);
    if (!('report' in preview)) throw new Error('kein Bericht');
    const { access: _a, ...report } = exportReport(main);
    expect(preview.report).toEqual(report);
  }, HEAVY_TIMEOUT * 2);

  it('ungültige Projektdatei → Fehlermeldung statt Absturz', async () => {
    const reply = await blocksJob({ id: 9, file: '{kein json', around: true }, workerSource);
    expect('error' in reply && reply.id === 9).toBe(true);
  });
});

describe('W14: Spielbarkeits-Worker und Grundriss-Zwischenspeicher', () => {
  it('playabilityJob (eigener Katalog) = proposalPlayability im Haupt-Thread', () => {
    for (const [id, seed] of [['farmhouse', 3], ['tavern', 8]] as const) {
      const p = params(id);
      const reply = playabilityJob({ id: 1, typeId: id, params: p, seed });
      if (!('issues' in reply)) throw new Error(reply.error);
      expect(reply.issues).toEqual(bt.proposalPlayability(types.get(id), p, seed, ctx));
    }
    expect('error' in playabilityJob({ id: 2, typeId: 'gibt_es_nicht', params: params('farmhouse'), seed: 1 })).toBe(true);
  }, HEAVY_TIMEOUT);

  it('Grundriss ohne Einfluss von Farbwelt und Blockpalette (Voraussetzung des Zwischenspeichers)', () => {
    const def = types.get('farmhouse');
    const actx = archetypeContext(catalog, ctx.themes);
    const pal = load.palettes[0]?.id;
    const plain = planBuilding(def, { front: 'south', themeId: 'medieval', reroll: 0 }, 4, actx);
    const colored = planBuilding(def, { front: 'south', themeId: 'medieval', reroll: 0, ...(pal !== undefined ? { paletteId: pal } : {}), paletteOverrides: { groups: { wall: 'stone_bricks' } } } as Parameters<typeof planBuilding>[1], 4, actx);
    expect(colored).toEqual(plain);
    // Vorschlag mit anderer Palette: gleicher Plan, aber das Projekt trägt die neue Palette
    const a = bt.proposal(def, params('farmhouse'), 4, ctx, NEW);
    const b = bt.proposal(def, { ...params('farmhouse'), paletteOverrides: { groups: { wall: 'stone_bricks', roof: 'bricks' } } }, 4, ctx, NEW);
    expect(b.plan).toBe(a.plan);
    expect(b.project.state.paletteOverrides).toEqual({ groups: { wall: 'stone_bricks', roof: 'bricks' } });
    expect(a.project.state.paletteOverrides).toBeUndefined();
  }, HEAVY_TIMEOUT);
});

describe('W14: Rückgängig ohne Neuabspielen', () => {
  const paint = (s: uc.Session, x1: number, z1: number, x2: number, z2: number, type = 'bedroom') => uc.paintRect(s, catalog, { x1, z1, x2, z2 }, type).session;
  it('gemerktes Projekt = Neuabspielen der Historie; Zwischenspeicher treffen wieder', () => {
    const s0 = paint(uc.createSession(7), 0, 0, 7, 6);
    const s1 = paint(s0, 8, 0, 14, 6, 'kitchen');
    const s2 = paint(s1, 0, 7, 14, 11, 'storage');
    const u1 = uc.undo(s2);
    expect(u1.project).toBe(s1.project);
    const u0 = uc.undo(u1);
    expect(u0.project).toBe(s0.project);
    // inhaltlich gleich dem Neuabspielen
    expect(u0.project.state).toEqual(s2.project.undo(s2.project.history.length - s0.project.history.length).state);
    // die Hülle des alten Zustands kommt aus dem Zwischenspeicher (dasselbe Objekt)
    expect(uc.shellOf(u1.project, uc.shellStyle(u1))).toBe(uc.shellOf(s1.project, uc.shellStyle(s1)));
    // Wiederholen wie gehabt
    expect(uc.redo(u0).project).toBe(u1.project);
  });
});

describe('W14: Katalog-Text schnell lesen', () => {
  it('parseJson5Text = JSON5.parse (gültiges JSON, JSON5 mit Kommentaren, Fehler mit derselben Meldung)', () => {
    const texts = ['{"a":1,"b":[1.5,-0,"x"],"c":{"d":null}}', '// Kommentar\n{ a: 1, b: [0x10, .5,], }', '{"a":1e400}', '"\\u2028"', '["\u2028"]'];
    for (const t of texts) expect(parseJson5Text(t)).toEqual(JSON5.parse(t));
    expect(Object.is((parseJson5Text('{"z":-0}') as { z: number }).z, -0)).toBe(true);
    const bad = '{ a: 1,, }';
    expect(() => parseJson5Text(bad)).toThrow((() => { try { JSON5.parse(bad); } catch (e) { return (e as Error).message; } return ''; })());
  });
});

describe('W14: Pixel-Atlas', () => {
  it('gleiche Blöcke → derselbe Atlas; Rechtecke wie direkt berechnet', () => {
    const blocks: Array<[string, number]> = [['minecraft:oak_planks', 0xa4834f], ['minecraft:stone_bricks', 0x7a7a7a], ['minecraft:grass_block', 0x5f9f35]];
    const a = buildPixelAtlas(blocks);
    expect(buildPixelAtlas(blocks.map((b) => [...b] as [string, number]))).toBe(a);
    expect(buildPixelAtlas([...blocks].reverse())).not.toBe(a);
    for (const [id, color] of blocks) for (const face of ['top', 'side', 'bottom'] as const) {
      const first = a.rect(id, color, face);
      expect(first).toBeDefined();
      expect(a.rect(id, color, face)).toBe(first);
    }
    expect(classifyTexture('minecraft:oak_planks', 0).fam).toBe('planks');
    expect(a.rect('minecraft:diamond_block', 1, 'top')).toBeUndefined();
  });
});

/**
 * Budgets (großzügig – die Maschine ist oft ausgelastet; CPU-Zeit des Threads, `MCDA_PERF_SLACK` streckt sie). Sie
 * fangen den Rückfall in die alten Wege: jede Palettenänderung plant neu, jedes Rückgängig spielt die Historie ab,
 * jeder Umbau der 3D-Ansicht klassifiziert je Quader neu.
 */
describe('W14: Budgets', () => {
  it('Palettenänderung im Assistenten: Vorschlag ohne neuen Grundriss (< 40 % der ersten Planung, höchstens 400 ms)', () => {
    const def = types.get('tavern');
    const first = timeCpu(() => bt.proposal(def, params('tavern'), 77, ctx, NEW)).ms;
    const again = expectCpuBelow(() => bt.proposal(def, { ...params('tavern'), paletteOverrides: { groups: { roof: 'bricks' } } }, 77, ctx, NEW), 400, 'Vorschlag nach Palettenwechsel');
    expect(again.result.plan).toBe(bt.proposal(def, params('tavern'), 77, ctx, NEW).plan);
    expect(again.ms).toBeLessThan(Math.max(first * 0.4, 5) + 150);
  }, HEAVY_TIMEOUT);

  it('Rückgängig in einem Bautyp-Projekt: < 5 ms statt Neuabspielen der Historie', () => {
    let s = bt.typeSession(types.get('farmhouse'), params('farmhouse', { size: 'S' }), 9, ctx, NEW).session;
    s = uc.paintRect(s, catalog, { x1: 2, z1: 2, x2: 6, z2: 6 }, 'bedroom').session;
    s = uc.paintRect(s, catalog, { x1: 7, z1: 2, x2: 11, z2: 6 }, 'kitchen').session;
    const u = expectCpuBelow(() => uc.undo(s), 5, 'Rückgängig');
    expect(u.result.project.history.length).toBeLessThan(s.project.history.length);
  }, HEAVY_TIMEOUT);

  it('Pixel-Atlas: 60 000 Rechteck-Abfragen (Umbau der 3D-Ansicht) < 60 ms', () => {
    const blocks: Array<[string, number]> = [
      ['minecraft:oak_planks', 0xa4834f], ['minecraft:stone_bricks', 0x7a7a7a], ['minecraft:grass_block', 0x5f9f35],
      ['minecraft:spruce_log', 0x6b5233], ['minecraft:cobblestone', 0x7d7d7d], ['minecraft:white_wool', 0xeeeeee],
    ];
    const atlas = buildPixelAtlas(blocks);
    expectCpuBelow(() => {
      for (let i = 0; i < 20000; i++) {
        const [id, color] = blocks[i % blocks.length]!;
        atlas.rect(id, color, 'top');
        atlas.rect(id, color, 'side');
        atlas.rect(id, color, 'bottom');
      }
    }, 60, 'Atlas-Rechtecke');
  });
});
