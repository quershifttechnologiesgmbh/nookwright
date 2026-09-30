/**
 * Teilen per URL (DR5 K4): Link → gleiches Projekt (Projektdatei und Blöcke bitgleich), nur Parameter im Link;
 * Bauplan-Export der App = `build_guide` der Engine (DR5 K2).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { nodeContext } from '@mcda/pipeline/node';
import { createEngine } from '@mcda/engine';
import { REPO_CATALOG } from '@mcda/engine/node';
import { toExport, withBlockPreset, type PipelineContext } from '@mcda/pipeline';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { exportGuide, guideFileName } from '../src/exporting.js';
import { lightSession } from '../src/lighting.js';
import { serializeProject } from '../src/projectFile.js';
import { sessionFromShare, shareBuildOf, shareLosesEdits, shareUrlOf } from '../src/shareLink.js';
import { baseWorldOf } from '../src/surroundingsWorld.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes!;
const styles = loadBundledTerrainStyles().styles;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: styles, types };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });
const SAVED = new Date(Date.UTC(2026, 8, 29, 12, 0));
const BASE = 'https://nookwright.example/app/?embed=1';
let appCtx: PipelineContext | undefined;
const app = async (): Promise<PipelineContext> => (appCtx ??= await browserContext(load)!.ready('1.21.11'));

const sessionOf = (id: string, patch: Partial<bt.TypeParams>, seed: number, reroll = 0): uc.Session => {
  const def = types.get(id);
  const p = { ...bt.defaultParams(def, ctx.themes.ids(), 'medieval', NEW), ...patch };
  return bt.typeSession(def, p, seed, ctx, NEW, reroll).session;
};
const file = (s: uc.Session): string => serializeProject(s, { savedAt: SAVED });
const worldOfSession = async (s: uc.Session) => {
  const lit = lightSession({ ...s, needsLight: true }, await app()).session;
  return { project: lit.project, world: baseWorldOf(lit.project, await app(), uc.shellStyle(lit), lit.surroundings, styles) };
};
const hashOf = async (s: uc.Session): Promise<string> => {
  const { project, world } = await worldOfSession(s);
  const v = toExport(project, world);
  const blocks = v.blocks.map((b) => `${b.pos.join(',')}=${b.name}${JSON.stringify(b.properties ?? {})}`).sort();
  return createHash('sha256').update(`${v.size.join('x')}|${blocks.join('\n')}`).digest('hex');
};

describe('Teilen per URL (App)', () => {
  const cases: Array<[string, string, Partial<bt.TypeParams>, number, number]> = [
    ['Taverne, Standard', 'tavern', {}, 2026, 0],
    ['Bauernhaus, viele Schalter, gewürfelt', 'farmhouse', {
      size: 'L', front: 'east', themeId: 'terracotta_birch', storyState: 'verlassen', functionLevel: 'some', landform: 'natural',
      facadeRhythm: 'on', ensemble: true, blockRules: withBlockPreset(undefined, 'easy_farm', true)!,
    }, 77, 2],
    ['Wachturm mit Silhouette und Unterbau', 'watchtower', { silhouette: 'varied', underground: true, front: 'west' }, 5, 1],
  ];
  for (const [label, id, patch, seed, reroll] of cases) {
    it(`${label}: Link → gleiche Projektdatei (bitgleich)`, () => {
      expect(types.ids()).toContain(id);
      const s = sessionOf(id, patch, seed, reroll);
      const url = shareUrlOf(s, types, `${BASE}#alt`)!;
      expect(url.startsWith(`${BASE}#b=1.`)).toBe(true);
      expect(url.length).toBeLessThan(400);
      const back = sessionFromShare(url, ctx);
      if (!back.ok) throw new Error(back.error);
      expect(back.warnings).toEqual([]);
      expect(file(back.session)).toBe(file(s));
      // noch einmal teilen: gleicher Link
      expect(shareUrlOf(back.session, types, BASE)).toBe(url.replace('#alt', ''));
    }, HEAVY_TIMEOUT);
  }

  it('Link → gleiche Blöcke (Export-Prüfsumme)', async () => {
    const s = sessionOf('tavern', { themeId: 'nordic' }, 9);
    const back = sessionFromShare(shareUrlOf(s, types, BASE)!, ctx);
    if (!back.ok) throw new Error(back.error);
    expect(await hashOf(back.session)).toBe(await hashOf(s));
  }, HEAVY_TIMEOUT);

  it('keine Nutzerdaten: Projektname fehlt im Link; Editor-Änderungen werden erkannt', () => {
    const plain = sessionOf('tavern', {}, 3);
    const s = uc.renameProject(plain, 'Geheimes Versteck von Elias');
    const b = shareBuildOf(s, types)!;
    expect(JSON.stringify(b)).not.toMatch(/Geheim|Elias/);
    const hash = shareUrlOf(s, types, BASE)!.split('#')[1]!;
    expect(Buffer.from(hash.slice(4), 'base64url').toString('utf8')).not.toMatch(/Geheim|Elias/);
    expect(shareLosesEdits(plain)).toBe(false);
    expect(shareLosesEdits(s)).toBe(true);
    expect(shareBuildOf(uc.createSession(1), types)).toBeUndefined();
  });

  it('Fehler: unbekannter Bautyp, kaputter Link', () => {
    const url = shareUrlOf(sessionOf('tavern', {}, 3), types, BASE)!;
    expect(sessionFromShare(`${BASE}#b=1.zzzz`, ctx).ok).toBe(false);
    const fewer = { ids: () => types.ids().filter((i) => i !== 'tavern'), get: types.get.bind(types) } as unknown as typeof types;
    const r = sessionFromShare(url, { ...ctx, types: fewer });
    expect(r.ok ? '' : r.error).toMatch(/Bautyp/);
  });
});

describe('Bauplan-Export der App = build_guide der Engine', () => {
  const engine = createEngine(nodeContext(REPO_CATALOG));
  it('Markdown und CSV gleich: App-Projektdatei → project_load → build_guide (project_generate)', async () => {
    const s = sessionOf('tavern', { size: 'S', themeId: 'timber' }, 2026);
    const { project, world } = await worldOfSession(s);
    const loaded = engine.execute({ op: 'project_load', input: { file: JSON.parse(file(s)) as unknown } });
    if (!loaded.ok) throw new Error(loaded.errors.join('; '));
    const projectId = (loaded.data as { projectId: string }).projectId;
    for (const kind of ['markdown', 'csv'] as const) {
      const f = exportGuide(project, world, kind);
      expect(f.name).toBe(guideFileName(project.state.name, kind));
      const r = engine.execute({ op: 'build_guide', input: { source: { op: 'project_generate', input: { projectId } }, sheet: kind, grids: kind === 'markdown' } });
      if (!r.ok) throw new Error(r.errors.join('; '));
      expect(new TextDecoder().decode(f.bytes)).toBe((r.data as { text: string }).text);
    }
  }, HEAVY_TIMEOUT);
});
