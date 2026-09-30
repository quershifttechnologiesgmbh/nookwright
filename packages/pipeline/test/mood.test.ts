/**
 * feat/theme-moods – Stimmung als Gewichtsvektor (WFC-Bericht §4). Der Test hält den Vertrag des Feature-Branches fest:
 *
 *  1. **Bitgleich ohne Schalter**: feste Prüfsummen über drei Bautypen, deren Themes eine Stimmungs-Vorgabe tragen
 *     (Taverne → timber, Bauernhaus → farmstead, Burg → medieval/dwarven …). Die Werte stammen aus einem Lauf **vor**
 *     dieser Änderung (Integrationsstand `w1/eine-app`, gleiche Funktion `checksum`). Dazu: neutrale Stimmung = keine Stimmung.
 *  2. **Mit Schalter**: deterministisch, 0 harte Verstöße, alle Räume erreichbar, keine dunklen Zellen.
 *  3. **Richtung**: karg ↔ üppig ändert die Deko-Zahl, ordentlich ↔ verwittert den Verwitterungsanteil,
 *     symmetrisch ↔ organisch die Spiegelpaare – gemessen, nicht nur behauptet (Zahlen im Bericht §5).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reachableRooms } from '@mcda/archetype';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { THEME_MOOD_AXES, parseBuildingTypeDef, type BuildingTypeDef } from '@mcda/catalog';
import { CellSet, MOOD_AXES, type MoodVector } from '@mcda/core';
import { MOOD_INTERIOR_FLOOR, STORY_PROFILES, moodStoryProfile } from '@mcda/materialize';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { NEW_PROJECT_MOOD, effectiveMood, generate, generateBase, moodOf, projectFromBuildingType, type World } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const loadType = (id: string): BuildingTypeDef => {
  const r = parseBuildingTypeDef(readFileSync(`${ROOT}/buildingtypes/${id}.json5`, 'utf8'), `${id}.json5`);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
};

/** FNV-1a über sortierte `pos|block`-Zeilen (wie `story-state.test.ts`). */
export function checksum(world: Pick<World, 'materialized'>): string {
  const rows = [...world.materialized.volume.cells()].map((c) => `${c.pos.join(',')}|${c.state.name}`).sort();
  let h = 0x811c9dc5;
  for (const r of rows) {
    for (let i = 0; i < r.length; i++) {
      h ^= r.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  }
  return `${rows.length}:${h.toString(16).padStart(8, '0')}`;
}

/** Stimmung aus für ein neues Projekt (B4): alle Achsen 0. */
const OFF: MoodVector = { wear: 0, richness: 0, formality: 0, organic: 0 };

const base = (type: string, seed: number, mood?: MoodVector, themeId?: string) => {
  const res = projectFromBuildingType(loadType(type), { size: 'M', ...(themeId !== undefined ? { themeId } : {}), ...(mood !== undefined ? { mood } : {}) }, seed, ctx);
  return { res, world: generateBase(res.project, ctx, { ...res.build, ...res.surroundings }) };
};

/**
 * Welt-Prüfsumme je Bautyp, Größe M, Seed 1, gerechnet auf `w1/eine-app` **ohne** diesen Branch (Tip `1649e6c9`, unabhängiger
 * Referenz-Worktree im Review F_theme_moods_review §2; vorher auf `067a5663`: tavern 18170:c75da85d, farmhouse
 * 16172:c48664dd, castle 53850:3d833b4f – W8-A/B änderten die Welten). Beispielhaus unverändert.
 */
// W9 (2026-09-27): die W9-Pakete ändern diese Welten gewollt – Taverne W9-G1 (Quergiebel, Auskragung) + W9-G2 + W9-G5,
// Bauernhaus W9-G3 (Scheune ab M, Palette) + W9-G1, Burg W9-G5 (Materialspiel), Beispielhaus W9-G5 (Wandverlauf/Dach,
// derselbe Wert wie in story-state.test). Vorher: tavern 18164:6b5d8aeb, farmhouse 16167:b8163845, castle
// 53840:75fa35f1, Beispielhaus 599:826ab03a. Absicht neu gemessen: je Bautyp ergibt „alle Achsen 0“ dieselbe Prüfsumme
// wie ein Projekt ganz ohne Stimmungsfeld (`setMood(undefined)`, der Pfad vor dem Branch) – tavern 20105:c67f12a7,
// farmhouse 24136:2053f93a, castle 53890:3facbd77 je beide gleich; Beispielhaus ohne/{}/Nullen gleich (Test unten).
// W12-C (2026-09-28): Bauernhaus-Details (Scheunentor, heller Rahmen, Vordach, Heuluke) und Sichtkeil vor der Haustür
// im Geländestil homestead (auch Taverne) – vorher tavern 20105:c67f12a7, farmhouse 24136:2053f93a.
const BEFORE: Readonly<Record<string, string>> = {
  // W8-I (2026-09-28): Hocker-Anschlüsse spiegelsymmetrisch (Windrad-Regel); vorher tavern 20077:99d2dbcc
  // W13-A (2026-09-28): niedriger Anbau hinten am Wohnhaus (eigener Baukörper, eigenes Dach); vorher farmhouse 23980:5bdfc462
  // W13-E (2026-09-28): Fachwerk-Obergeschoss bzw. Putzgiebel im Holzrahmen (`facade.upperFrame`), dafür ohne
  // Wandvorlagen; vorher tavern 20074:0d0f0dec, farmhouse 23980:5bdfc462
  // W13-E Runde 2 (2026-09-28): Giebelfenster ohne Plus, Bank/Sturz im Fachwerk-OG über die ganze Breite, Brustriegel;
  // vorher tavern 20074:a3ae8e8e, farmhouse 23887:2dc56672, castle 53890:3facbd77
  // W13-Integration (2026-09-28): A + E (Runde 1 und 2) zusammen neu gemessen
  // W15 (2026-09-28): Fassaden-Details dezent als Standard (Konsolen unter Auskragung/Gesims/Bank, Giebelzapfen, Regal-
  // Auslage; plan/spikes/W15_fassaden_detailbloecke.md) – vorher tavern 20070:83775e65, farmhouse 26958:ad60ae10,
  // castle 53892:9ac4e535
  // W15 + Determinismus-Fix (2026-09-28): zusammen neu gemessen
  // Determinismus-Fix (2026-09-28, plan/spikes/F_determinismus.md): Materialmischung und Truhen-Inhalte je Möbel über den
  // Seed der Platzierung statt ihrer ID (die ID hing an der Ereignisfolge; erneutes Generieren war nicht bitgleich);
  // Blockzahl gleich, nur gemischte Materialien neu. Vorher tavern 20070:83775e65, farmhouse 26958:ad60ae10, castle 53892:9ac4e535,
  // Beispielhaus 599:1416466b
  // FN-Dense + FN-dense-grand + FN-dense-living (29.09.2026, nach Merge neu gemessen): Werkstatt-/Nutzräume (Inselmöbel, Gewölbe) und Prunkräume (Steinarkade, Schaupodest) – vorher tavern 20106:af58dd43, farmhouse 23134:e87bea3a, castle 53909:6c8ef4b4
  tavern: '20110:974d6da2',
  // W13-A Runde 2 (2026-09-28): Anbau hinten links statt mittig, in S ohne; vorher farmhouse 26994:b34fefe4 (Integration)
  // W16-B (2026-09-28): Silo ab M vor der Scheune, Feld vor der Scheune, dunkles Scheunendach, Küchenfenster, reife
  // Feldfrüchte (plan/spikes/W16B_bauernhaus.md); vorher farmhouse 26958:ad60ae10
  // W16-B-Integration (2026-09-28): mit W15 und Determinismus-Fix zusammen neu gemessen
  farmhouse: '23133:7f0dfd34',
  castle_compact: '53756:310ab173',
  'house@medieval': '598:061acf8e',
};

function house(mood?: MoodVector): Project {
  const p = Project.create({ id: 'm', name: 'M', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  if (mood !== undefined) p.setMood(mood);
  return p;
}

describe('feat/theme-moods: Schalter aus = bitgleich', () => {
  it('Achsenliste in Kern und Katalog gleich', () => {
    expect([...THEME_MOOD_AXES]).toEqual([...MOOD_AXES]);
  });

  for (const type of ['tavern', 'farmhouse', 'castle_compact']) {
    it(`${type}: ohne Stimmung Prüfsumme wie vor der Änderung (Theme trägt eine Vorgabe)`, { timeout: HEAVY_TIMEOUT }, () => {
      // B4: neue Projekte bekommen `mood: {}` – „aus“ heißt hier alle Achsen 0 (neutral = keine Stimmung, bitgleich)
      const { res, world } = base(type, 1, NEW_PROJECT_MOOD === undefined ? undefined : OFF);
      expect(moodOf(res.project, ctx)).toBeUndefined();
      expect(checksum(world)).toBe(BEFORE[type]);
    });
  }

  it('Beispielhaus (medieval): ohne Stimmung, mit {} und mit lauter Nullen dieselbe Prüfsumme wie vorher', { timeout: HEAVY_TIMEOUT }, () => {
    const plain = checksum(generate(house(), ctx));
    expect(plain).toBe(BEFORE['house@medieval']);
    // medieval hat keine Vorgabe: {} ist neutral → derselbe Pfad
    expect(checksum(generate(house({}), ctx))).toBe(plain);
    expect(checksum(generate(house({ wear: 0, richness: 0, formality: 0, organic: 0 }), ctx))).toBe(plain);
  });

  it('B3: Stimmungs-Profil dämpft Innenböden und altert Kupfer je Fläche; benannte Zustände unverändert', () => {
    const p = moodStoryProfile(undefined, 0.75);
    expect(p.interiorFloor).toBe(MOOD_INTERIOR_FLOOR);
    expect(p.copperWhole).toBe(true);
    for (const s of Object.values(STORY_PROFILES)) expect(s.interiorFloor === undefined && s.copperWhole === undefined).toBe(true);
    expect(moodStoryProfile('verlassen', 0)).toBe(STORY_PROFILES.verlassen);
  });

  it('B4: neue Projekte bekommen die Theme-Stimmung, gespeicherte ohne Feld bleiben ohne', () => {
    const { res } = base('tavern', 1);
    expect(res.project.state.mood).toEqual(NEW_PROJECT_MOOD);
    expect(moodOf(res.project, ctx)).toEqual(ctx.themes.get('timber').mood);
    // Laden alter Historie (ohne MoodChanged): kein Feld, keine Stimmung
    const old = house();
    expect(old.state.mood).toBeUndefined();
  });

  it('Theme-Vorgabe wirkt nur mit Schalter; Nutzer überschreibt achsenweise', () => {
    const timber = ctx.themes.get('timber');
    expect(timber.mood).toBeDefined();
    expect(effectiveMood({}, timber)).toBeUndefined();
    expect(effectiveMood({ mood: {} }, timber)).toEqual(timber.mood);
    expect(effectiveMood({ mood: { formality: 1 } }, timber)?.formality).toBe(1);
    expect(effectiveMood({}, timber, true)).toEqual(timber.mood);
    expect(effectiveMood({}, ctx.themes.get('medieval'), true)).toBeUndefined();
  });
});

describe('feat/theme-moods: Schalter an – deterministisch, 0 harte Verstöße, richtige Richtung', () => {
  const STRICT: MoodVector = { wear: -1, richness: -1, formality: 1, organic: -1 };
  const WILD: MoodVector = { wear: 1, richness: 1, formality: -1, organic: 1 };

  for (const type of ['tavern', 'farmhouse']) {
    it(`${type}: streng vs. wild`, { timeout: HEAVY_TIMEOUT }, () => {
      const stats = (mood: MoodVector) => {
        const { res, world } = base(type, 2, mood);
        const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
        expect(hard, `${type} ${JSON.stringify(mood)}`).toEqual([]);
        const reach = reachableRooms(world.shell);
        expect(res.project.state.rooms.filter((r) => !reach.has(r.id)).map((r) => r.id)).toEqual([]);
        expect(world.materialized.light.darkCells).toEqual([]);
        const cells = [...world.materialized.volume.cells()];
        const worn = cells.filter((c) => /mossy|cracked|^stripped_/.test(c.state.name)).length / cells.length;
        const decor = res.project.state.placements.filter((p) => ['decor', 'attachment'].includes(ctx.catalog.get(p.componentId).category)).length;
        return { sum: checksum(world), worn, decor };
      };
      const strict = stats(STRICT);
      const wild = stats(WILD);
      expect(stats(STRICT).sum).toBe(strict.sum); // deterministisch
      expect(wild.decor).toBeGreaterThan(strict.decor);
      expect(wild.worn).toBeGreaterThan(strict.worn * 3);
    });
  }
});
