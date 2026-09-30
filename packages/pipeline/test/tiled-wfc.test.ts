/**
 * feat/tiled-wfc (Bericht plan/spikes/F_tiled_wfc.md): Schalter `tiledWfc` im Anwendungsdienst.
 *
 *  1. **Schalter aus = bitgleich:** Prüfsummen ganzer Welten (alle Blöcke samt Zuständen) sind die des
 *     Integrationsstands ohne den Branch, ohne Angabe und mit `tiledWfc: false`.
 *  2. **Schalter an:** deterministisch je Seed, anders als aus.
 *  3. **Windrad-Wächter über alle Ausgaben:** jeder Bautyp mit Zinnen, Platz, Hof, Garten oder Feld × jedes Theme ×
 *     3 Seeds (Umgebung ohne Einrichtung, `surroundings`): Draufsicht der Zinnen und Muster-Zonen ohne chirales
 *     4-zähliges Motiv, alle Muster ohne Verstoß, keine schwebenden Bauwerkszellen.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ShellCell } from '@mcda/blueprint';
import { findPinwheels, hashSeed } from '@mcda/core';
import { floatingCells } from '@mcda/structures';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import {
  generateBase, projectFromBuildingType, shellWithTowers, surroundings, themeFor, type BaseWorld, type Surroundings,
} from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { worldPinwheels } from './pinwheelWorld.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

function digest(world: BaseWorld): string {
  const vol = world.materialized.volume;
  const rows: string[] = [];
  for (const owner of vol.owners()) {
    for (const c of vol.cellsOf(owner)) rows.push(`${c.pos.join(',')}|${c.state.name}|${JSON.stringify(c.state.properties)}`);
  }
  rows.sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16);
}

function world(type: string, themeId: string, seed: number, tiledWfc?: boolean): BaseWorld {
  const res = projectFromBuildingType(ctx.buildingTypes.get(type), { themeId, front: 'south' }, seed, ctx);
  // Nur der WFC-Schalter wird geprüft: Stimmung neuer Projekte (feat/theme-moods-on) aus, damit die Prüfsummen vor dem
  // Branch gültig bleiben (die Stimmung hat eigene Tests in pipeline/test/mood.test.ts)
  res.project.setMood(undefined);
  return generateBase(res.project, ctx, { ...res.build, ...res.surroundings, ...(tiledWfc !== undefined ? { tiledWfc } : {}) });
}

/**
 * Prüfsummen des Integrationsstands ohne feat/tiled-wfc (`origin/w1/eine-app` `c1585887`, gemessen an einer eigenen
 * Kopie per `git archive`, nicht am Branch selbst), je Fall ohne Schalter. Vorher (Basis `067a566`) gemessen und
 * ebenfalls bitgleich.
 */
// W9 (2026-09-27): die W9-Pakete ändern diese Welten gewollt – Burg W9-G5 (Materialspiel), Stadthaus W9-G1 (Auskragung)
// + W9-G2 (Fensterrahmen), Bauernhaus W9-G3 (Scheune, Palette) + W9-G1 (Querflügel), Erdhaus W9-G4 (Hügel, Rundfenster).
// Neu gemessen auf dem W9-Integrationsstand; die Absicht bleibt geprüft: ohne Angabe = `tiledWfc: false` (zweite
// Erwartung unten) und an ≠ aus (nächster Test). Vorher: ccac1c501bff83a0, 545f84f326658ba9, e2c91f2feb42f6db,
// 49e38a7d5125cdb2; longhouse unverändert.
// W12-B (2026-09-28): Grund – Erdhaus-Front neu gegliedert (Diele mittig, Tür in der Frontmitte, lückenloser Rundbogen
// mit Laibung aus Stämmen, Rundfenster mit Holzwangen, Pfeiler, Laub über der Traufe, Vorgarten mit Mittelweg;
// plan/spikes/W12B_erdhausfront.md). Vorher (hobbit): 77747a5cf0008483.
// W12-D (2026-09-28): Grund – nordic wird Blockbau (Steinsockel, Schwelle, liegende Stämme, Giebelbretter, Schiefer am
// First, gekreuzte Windbretter, Bruchstein-Schlot; Review R6-6). Nur longhouse/nordic neu, vorher 0e80a21912d2ac15.
const BEFORE: ReadonlyArray<readonly [string, string, number, string]> = [
  // W13-E Runde 2 (2026-09-28): Giebelfenster ohne Plus (Drillingsfenster/Band statt Okulus), Stadthaus ohne Bank über
  // dem Sturz darunter; vorher castle 249eca9c8eab7bca, townhouse 866639f0bc8e98e9, farmhouse e84661a2f3733286
  // W15 (2026-09-28): Fassaden-Details dezent als Standard (Steinkonsolen unter dem Gesims) – vorher 0c310c34712688b9
  // W15 + Determinismus-Fix (2026-09-28): zusammen neu gemessen
  // Determinismus-Fix (2026-09-28, plan/spikes/F_determinismus.md): Materialmischung und Truhen-Inhalte je Möbel über den
  // Seed der Platzierung statt ihrer ID (die ID hing an der Ereignisfolge; erneutes Generieren war nicht bitgleich);
  // Blockzahl gleich, nur gemischte Materialien neu. Vorher castle 0c310c34712688b9,
  // townhouse b12a6bfe9a539c09, farmhouse 30b106ab0f4d3f38, hobbit e17655cc5083fba3
  // FN-Dense + FN-dense-grand + FN-dense-living (29.09.2026, nach Merge neu gemessen): Werkstatt- und Prunkräume der Burg – vorher 31a005855473793f
  ['castle_compact', 'medieval', 11, 'c157e6ce578b39f8'],
  // W13-F (2026-09-28): Theme-Palette neu (plan/spikes/W13F_stil_paletten.md) – vorher 866639f0bc8e98e9
  // FN-Dense (29.09.2026): Innenräume der Werkstätten/Nutzräume (Inselmöbel, Keller-Gewölbe) – vorher 6b96f586febc9adb
  // FN-Integration (29.09.2026): Wohnstube (Paneel [1, 1]) und Bibliothek (Ecken [0, 2]) neu eingerichtet – vorher 137aa21390aea8cd
  ['townhouse', 'desert', 22, '4cb4d31c54011447'],
  // W12-C (2026-09-28): Bauernhaus-Details und Sichtkeil (homestead) – vorher 4a2c9b598f5d16e6
  // W13-A (2026-09-28): niedriger Anbau am Wohnhaus (Komposition der Baumasse) – vorher e84661a2f3733286
  // W13-F (2026-09-28): Theme-Palette neu (plan/spikes/W13F_stil_paletten.md), mit W13-A zusammen neu gemessen
  // W13-A Runde 2 (2026-09-28): Anbau hinten links statt mittig – vorher 61d79fa753434e24 (Integration)
  // W16-B (2026-09-28): Silo ab M vorn, Feld vor der Scheune, dunkles Scheunendach, Küchenfenster, reife Feldfrüchte
  // (plan/spikes/W16B_bauernhaus.md) – vorher 30b106ab0f4d3f38
  // W16-B-Integration (2026-09-28): mit W15 und Determinismus-Fix zusammen neu gemessen
  // FN-Dense (29.09.2026): Innenräume der Werkstätten/Nutzräume (Inselmöbel, Keller-Gewölbe) – vorher fd5ff2e128f41a1f
  ['farmhouse', 'dwarven', 33, 'b225ff2deea632c9'],
  // W13-C (2026-09-28): Grund – Erdhaus mit schmaler Front (Diele als Längsband), Stirnbogen, weichem Hügel um die Front
  // und Terrassenkanten (plan/spikes/W13C_erdhaus_huegel.md) – vorher db3bd4507f0a3ec5
  // W13-C Runde 2 (2026-09-28): Grund – Doppelfenster, zweilagiger Bogenrahmen, Terrassen-Rauschen, Vorgarten mit
  // Mittelweg, Zaun und Laternenpfosten – vorher c5fce26f215ed50f
  // W13-F (2026-09-28): Theme-Palette neu, mit W13-C Runde 2 zusammen neu gemessen
  // W13-C Nacharbeit (2026-09-28): Vorgarten auf Türhöhe, Zaun weiter vorn (Galerie-Kamera) – mit W13-F neu gemessen
  // W16-C (2026-09-28): Grund – Bogenfront (Band als Halbellipse mit Stirnholz-Scheiben, Stirn aus Stämmen bis unter das
  // Band, Moosnarbe darüber), Schornstein und Eiche auf dem Hügel (plan/spikes/W16C_erdhaus.md) – vorher e17655cc5083fba3
  // W16-C-Integration (2026-09-28): mit W15/W16-B/Determinismus-Fix zusammen neu gemessen
  // FN-Dense (29.09.2026): Innenräume der Werkstätten/Nutzräume (Inselmöbel, Keller-Gewölbe) – vorher c07faffd084f4a10
  ['hobbit', 'elven', 11, '40356e49e1920ed8'],
  // W13-B (2026-09-28): Torfdach nordic (Seed 22 wählt Torf) – vorher bf420a6fb2e52259
  // W15 (2026-09-28): Fassaden-Details dezent als Standard (Konsolen, Giebelzapfen) – vorher 52cf38ce869ba3f2
  ['longhouse', 'nordic', 22, '657033b6a0782405'],
];

describe('Tiled-WFC im Anwendungsdienst (feat/tiled-wfc)', () => {
  it.each(BEFORE)('Schalter aus: %s/%s/%i bitgleich zum Stand vor dem Branch', (type, theme, seed, sum) => {
    const plain = digest(world(type, theme, seed));
    expect(plain).toBe(sum);
    expect(digest(world(type, theme, seed, false))).toBe(sum);
  }, HEAVY_TIMEOUT);

  it('Schalter an: deterministisch je Seed und anders als aus (Burg, Hof)', () => {
    for (const [type, theme, seed] of [['castle_compact', 'dwarven', 22], ['farmhouse', 'medieval', 11]] as const) {
      const on = digest(world(type, theme, seed, true));
      expect(digest(world(type, theme, seed, true))).toBe(on);
      expect(on).not.toBe(digest(world(type, theme, seed, false)));
    }
  }, HEAVY_TIMEOUT);

  it('Windrad-Wächter und Verstöße über alle Bautypen mit Mustern × alle Themes × 3 Seeds', () => {
    const TYPES = ['castle_compact', 'townhouse', 'townhouse_row', 'longhouse', 'farmhouse', 'tavern', 'hobbit'];
    const problems: string[] = [];
    let patterns = 0;
    for (const type of TYPES) {
      for (const themeId of ctx.themes.ids()) {
        for (const seed of [11, 22, 33]) {
          const id = `${type}/${themeId}/${seed}`;
          const res = projectFromBuildingType(ctx.buildingTypes.get(type), { themeId, front: 'south' }, seed, ctx);
          const shell = shellWithTowers(res.project, res.build, res.surroundings.attachedTowers, themeFor(res.project, ctx));
          const around = surroundings(shell, { ...res.surroundings, tiledWfc: true }, {
            seed, ...(ctx.terrainStyles !== undefined ? { terrainStyles: ctx.terrainStyles } : {}), catalog: ctx.catalog,
            dataVersion: res.project.state.targetVersion.dataVersion, themeId,
          });
          const entries = [...(around.structures?.tiled ?? []), ...(around.site?.tiled ?? [])];
          patterns += entries.length;
          for (const e of entries) if (e.violations > 0) problems.push(`${id}: ${JSON.stringify(e)}`);
          const hits = pinwheelHits(around, new Map((res.surroundings.site?.zones ?? []).map((z) => [z.id, z.kind])));
          if (hits > 0) problems.push(`${id}: ${hits} Windrad-Treffer`);
          const solid = [...shell.cells, ...around.cells.filter((c) => c.kind !== 'plant')];
          const fort = new Set(around.cells.filter((c) => c.kind === 'fort').map((c) => c.pos.join(',')));
          const floating = floatingCells(solid, around.ground).filter((p) => fort.has(p.join(',')));
          if (floating.length > 0) problems.push(`${id}: ${floating.length} schwebende Bauwerkszellen`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(patterns).toBeGreaterThan(400);
  }, HEAVY_TIMEOUT);

  /**
   * Review F (A1): Blockebene der fertigen Welt. Regression: Taverne elven/harbor/nordic/winter Seed 9 – dort bildeten
   * Randband und Band des Hof-Pflasters mit der blockweisen Steinmischung ein 4 × 4-Windrad aus Andesit. Seit
   * `ShellCell.pickAt` wählen Spiegelpartner denselben Block. Dazu eine Stichprobe aller Bautypen mit Mustern:
   * mit Schalter an keine Treffer, die es mit Schalter aus nicht auch gibt (Bestand, z. B. Streu-Vegetation).
   */
  it('Blockebene: kein Windrad aus der Materialmischung (Tavernen-Regression + Stichprobe)', () => {
    const cases: [string, string, number][] = [
      ['tavern', 'elven', 9], ['tavern', 'harbor', 9], ['tavern', 'nordic', 9], ['tavern', 'winter', 9],
      ['castle_compact', 'dwarven', 3], ['townhouse', 'medieval', 2], ['townhouse_row', 'desert', 19],
      ['longhouse', 'ruin', 1], ['farmhouse', 'elven', 9], ['hobbit', 'rustic', 19],
    ];
    const problems: string[] = [];
    for (const [type, theme, seed] of cases) {
      const kinds = (w: boolean): string[] => {
        const res = projectFromBuildingType(ctx.buildingTypes.get(type), { themeId: theme, front: 'south' }, seed, ctx);
        const zoneKinds = new Map((res.surroundings.site?.zones ?? []).map((z) => [z.id, z.kind]));
        return worldPinwheels(generateBase(res.project, ctx, { ...res.build, ...res.surroundings, tiledWfc: w }), zoneKinds, true);
      };
      const off = new Set(kinds(false));
      for (const h of kinds(true)) if (!off.has(h)) problems.push(`${type}/${theme}/${seed}: ${h}`);
    }
    expect(problems).toEqual([]);
  }, HEAVY_TIMEOUT);
});

/** Chirale 4-zählige Fenster in der Draufsicht der Zinnen und der Muster-Zonen (Oberfläche + Pflanze). */
function pinwheelHits(around: Surroundings, zoneKind: ReadonlyMap<string, string>): number {
  let hits = 0;
  const fort = around.cells.filter((c) => c.kind === 'fort');
  const base = new Map<string, number>();
  for (const c of fort) if (c.role === 'parapet') base.set(`${c.pos[0]},${c.pos[2]}`, Math.min(base.get(`${c.pos[0]},${c.pos[2]}`) ?? Infinity, c.pos[1]));
  const view = new Map<string, number>();
  for (const c of fort) {
    const k = `${c.pos[0]},${c.pos[2]}`;
    const b = base.get(k);
    if (b === undefined) continue;
    const v = c.role === 'parapet' ? c.pos[1] - b + 1 : c.role === 'wall_cornice' && c.pos[1] === b + 2 ? 12 : 0;
    view.set(k, Math.max(view.get(k) ?? 0, v));
  }
  if (view.size > 0) {
    const xs = [...view.keys()].map((k) => Number(k.split(',')[0]));
    const zs = [...view.keys()].map((k) => Number(k.split(',')[1]));
    hits += findPinwheels((x, z) => view.get(`${x},${z}`), { minX: Math.min(...xs), minZ: Math.min(...zs), maxX: Math.max(...xs), maxZ: Math.max(...zs) }).length;
  }
  const site = around.site;
  if (site === undefined) return hits;
  const g = site.grid;
  const plants = new Map<number, string>();
  for (const c of site.cells as readonly ShellCell[]) if (c.kind === 'plant' && !plants.has(g.at(c.pos[0], c.pos[2]))) plants.set(g.at(c.pos[0], c.pos[2]), c.role);
  const labels = new Map<number, number>();
  site.plan.zone.forEach((z, i) => {
    if (z !== null && ['plaza', 'yard', 'garden', 'field'].includes(zoneKind.get(z) ?? '')) labels.set(i, hashSeed(`${site.surface[i]}/${plants.get(i) ?? ''}`));
  });
  if (labels.size > 0) {
    hits += findPinwheels((x, z) => (g.inside(x, z) ? labels.get(g.idx(x, z)) : undefined), { minX: g.minX, minZ: g.minZ, maxX: g.minX + g.w - 1, maxZ: g.minZ + g.d - 1 }).length;
  }
  return hits;
}
