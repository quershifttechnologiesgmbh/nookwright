/**
 * W1-G „Ergebnis-Treue“ (Befunde aus plan/spikes/W1E_ergebnisqualitaet.md §5): Die App meldet und baut, was die
 * Engine baut. Blockgleichheit mit `building_generate` prüft `engineParity.test.ts`; hier die Bausteine:
 * - S4a: Fachwerk-Bautyp → Stil der Sitzung ohne Pfeiler-Pflicht (`piers: false`), auch nach Speichern/Laden.
 * - S4b: Bauwerke und Wehrplatten behalten die Plan-IDs (auch mit Bindestrich).
 * - S1a: Feste Vorlage übernimmt Dach & Co. aus `params.shell`; ohne Beschreibung bitgleich.
 * - L4: Was eine feste Vorlage vom bisherigen Projekt erbt, steht in Worten da.
 * - M2: Vorschläge ohne gleichen Grundriss (Reserve), deterministisch; die ersten Seeds wie bisher.
 */
import { describe, expect, it } from 'vitest';
import { FACADE_QUALITY_RULES } from '@mcda/blueprint';
import { BUILDABLE_SETTINGS, distinctCount, distinctPicks, planLayoutKey, settingBuildable } from '@mcda/pipeline';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles, types };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });
const params = (id: string, patch: Partial<bt.TypeParams> = {}): bt.TypeParams => ({ ...bt.defaultParams(types.get(id), ctx.themes.ids(), 'medieval', NEW), ...patch });
const themeName = (id: string): string => ctx.themes.get(id).name;

describe('S4a: Fachwerk-Bautyp ohne Pfeiler-Pflicht – in der Sitzung und in der Datei', () => {
  it('Taverne S Fachwerk: Stil ohne pierFrom (wie die Engine), Stein-Theme mit', () => {
    const timber = bt.typeSession(types.get('tavern'), params('tavern', { size: 'S', themeId: 'timber' }), 3, ctx, NEW).session;
    const style = uc.shellStyle(timber);
    expect(style.facade).toMatchObject({ quality: true, piers: false });
    expect(uc.shellOptions(style).facade?.rules?.pierFrom).toBeUndefined();
    // W13-E (2026-09-28): die Taverne hat im Mittelalter-Theme jetzt ein Fachwerk-Obergeschoss (`facade.upperFrame`) und
    // verliert die Pfeiler-Pflicht wie das Fachwerk-Theme; ein Steinbau ohne Wandkleid (Burg) behält sie (vorher: Taverne
    // medieval mit Pfeilern)
    const framed = uc.shellStyle(bt.typeSession(types.get('tavern'), params('tavern', { size: 'S', themeId: 'medieval' }), 3, ctx, NEW).session);
    expect(framed.facade).toMatchObject({ upperFrame: true, piers: false });
    const stone = uc.shellStyle(bt.typeSession(types.get('castle_compact'), params('castle_compact', { size: 'S', themeId: 'medieval' }), 3, ctx, NEW).session);
    expect(stone.facade.piers).toBeUndefined();
    expect(uc.shellOptions(stone).facade?.rules).toBe(FACADE_QUALITY_RULES);
    // Speichern/Laden ändert nichts an der Hülle
    const r = parseProjectFile(serializeProject(timber), { catalog, themes: ctx.themes });
    expect(r.ok).toBe(true);
    if (r.ok) expect(uc.shellKey(uc.shellStyle(r.session))).toBe(uc.shellKey(style));
  });
});

describe('S4b: Bauwerke mit den IDs des Plans', () => {
  it('Burg: Ringmauer und Wehrplatte behalten die Engine-IDs für bitgleiche Türme und Dachluken', () => {
    const s = bt.typeSession(types.get('castle_compact'), params('castle_compact', { size: 'S' }), 2026, ctx, NEW).session;
    const items = s.surroundings!.structures;
    expect(items.filter((i) => i.kind === 'wall').map((i) => i.id)).toEqual(['ring']);
    expect(items.filter((i) => i.kind === 'parapet').map((i) => i.id)).toEqual(['keep-parapet']);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    // neue Bauwerke des Nutzers bekommen weiter freie IDs
    expect(s.surroundings!.seq).toBeGreaterThan(items.filter((i) => /^[a-z]\d+$/.test(i.id)).length);
  });
});

describe('S1a/L4: feste Vorlagen', () => {
  const house = types.get('house');
  const flatTimber: uc.ShellStyle = { ...NEW, roof: 'flat', roofDetail: { ...NEW.roofDetail, pitch: 'steep' } };

  it('Dach aus der Beschreibung wirkt; ohne Beschreibung erbt die Vorlage wie bisher (bitgleich)', () => {
    // Stil des Plans mit Walmdach aus der Beschreibung: nur mit `params.shell` übernimmt die Vorlage das Dach
    const hip = { ...bt.typeBuildOptions(house), roof: 'hip' as const };
    expect(bt.typeStyle(house, hip, { exterior: true }, flatTimber).roof).toBe('flat');
    expect(bt.typeStyle(house, hip, { exterior: true, shell: { roof: 'hip' } }, flatTimber).roof).toBe('hip');
    expect(bt.typeStyle(house, hip, { exterior: true }, flatTimber)).toEqual(bt.typeStyle(house, hip, { exterior: true, shell: undefined }, flatTimber));
    const described = bt.typeSession(house, params('house', { shell: { roof: 'flat' } }), 2026, ctx, NEW).session;
    expect(uc.shellStyle(described).roof).toBe('flat');
    const plain = bt.typeSession(house, params('house'), 2026, ctx, NEW).session;
    expect(uc.shellStyle(plain).roof).toBe(NEW.roof);
  });

  it('Erbe in Worten: Theme, Flachdach, steiles Dach – nicht, was Bautyp oder Beschreibung setzen; generierte Typen erben nichts', () => {
    const p = params('house', { themeId: 'timber' });
    expect(bt.inheritedStyle(house, p, flatTimber, 'timber', themeName)).toEqual(['Stil Fachwerk', 'Flachdach']); // Neigung zählt beim Flachdach nicht
    expect(bt.inheritedStyle(house, { ...p, shell: { roof: 'gable' } }, flatTimber, 'timber', themeName)).toEqual(['Stil Fachwerk', 'steiles Dach']);
    expect(bt.inheritedStyle(house, params('house'), NEW, 'medieval', themeName)).toEqual([]);
    expect(bt.inheritedStyle(types.get('tavern'), params('tavern'), flatTimber, 'timber', themeName)).toEqual([]);
  });
});

describe('M2: Vorschläge ohne gleichen Grundriss', () => {
  it('Regel (@mcda/pipeline): Doppel überspringen, bei erschöpfter Reserve auffüllen', () => {
    expect(distinctPicks(['a', 'b', 'c', 'd'], 3)).toEqual([0, 1, 2]);
    expect(distinctPicks(['a', 'a', 'b', 'a', 'c'], 3)).toEqual([0, 2, 4]);
    expect(distinctPicks(['a', 'a', 'a'], 3)).toEqual([0, 1, 2]);
    expect(distinctPicks(['a', 'a', 'b'], 3, false)).toEqual([0, 2]);
    expect(distinctPicks([undefined, undefined, 'a'], 3)).toEqual([0, 1, 2]);
    expect(distinctCount(['a', 'a', undefined, 'b'])).toBe(3);
  });

  it('Langhaus S: drei verschiedene Grundrisse, wo die ersten drei Seeds Doppel hatten; deterministisch', () => {
    const def = types.get('longhouse');
    const p = params('longhouse', { size: 'S' });
    let improved = 0;
    for (let base = 1; base <= 6; base++) {
      const first = bt.proposalSeeds(base).map((seed) => planLayoutKey(bt.proposal(def, p, seed, ctx, NEW).plan));
      const round = bt.proposalRound(def, p, base, ctx, NEW);
      const keys = round.map((x) => planLayoutKey(x.plan));
      expect(round).toHaveLength(3);
      expect(new Set(keys).size).toBeGreaterThanOrEqual(new Set(first).size);
      if (new Set(keys).size > new Set(first).size) improved++;
      expect(round.map((x) => x.seed)).toEqual(bt.proposalRound(def, p, base, ctx, NEW).map((x) => x.seed));
    }
    expect(improved).toBeGreaterThan(0);
  });

  it('ohne Doppel dieselben Vorschläge wie vorher (erste drei Seeds); feste Vorlage: einer', () => {
    const tavern = types.get('tavern');
    expect(bt.proposalRound(tavern, params('tavern'), 42, ctx, NEW).map((x) => x.seed)).toEqual(bt.proposalSeeds(42));
    expect(bt.proposalCandidates(tavern, 42).slice(0, 3)).toEqual(bt.proposalSeeds(42));
    expect(bt.proposalRound(types.get('house'), params('house'), 42, ctx, NEW).map((x) => x.seed)).toEqual(bt.proposalSeeds(42, 1));
  });
});

describe('S1b: baubare Lagen (gemeinsame Regel)', () => {
  it('ground und buried, sonst nicht', () => {
    expect([...BUILDABLE_SETTINGS].sort()).toEqual(['buried', 'ground']);
    expect(['cliff', 'carved', 'stilts', 'tree', 'water', 'underwater', 'x'].some(settingBuildable)).toBe(false);
  });
});
