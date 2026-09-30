/**
 * W8-D: Vorschaubilder im Bautyp-Assistenten zeigen das Theme – dieselben Blöcke wie das übernommene Haus (vorher
 * Rollenfarben: rotes Dach, helle Wände auch bei „Nordisch“).
 */
import { key3 } from '@mcda/core';
import { isAir } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import * as bt from '../src/buildingTypes.js';
import { roleColor } from '../src/colors.js';
import { worldOf } from '../src/exporting.js';
import { houseBox } from '../src/selection.js';
import * as uc from '../src/usecases.js';
import { moundVoxels, thumbnailVoxels } from '../src/viewer/thumbnail.js';
import { lookDirection } from '../src/viewer/viewport.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes;
const pipeline = browserContext(load)!;
const ctx = { catalog, themes: load.themeCatalog!, types };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });

describe('W8-D: Vorschaubild = Blöcke des übernommenen Hauses', () => {
  it('Langhaus Nordisch: Hüllenblöcke des Bilds = Hüllenblöcke nach dem Übernehmen, keine Rollenfarben', async () => {
    const def = types.get('longhouse');
    const params = { ...bt.defaultParams(def, ctx.themes.ids(), 'medieval', NEW), themeId: 'nordic' };
    const seed = bt.proposalSeeds(7)[0]!;
    const p = bt.proposal(def, params, seed, ctx, NEW);
    const pctx = await pipeline.ready(p.project.state.targetVersion.name);
    const thumbWorld = worldOf(p.project, pctx, p.style);
    const accepted = bt.typeSession(def, params, seed, ctx, NEW).session;
    const world = worldOf(accepted.project, pctx, uc.shellStyle(accepted));
    const blocksAt = (w: typeof world) => {
      const m = new Map<string, string>();
      for (const c of w.materialized.volume.cells()) if (!isAir(c.state)) m.set(key3(c.pos), c.state.name);
      return m;
    };
    const a = blocksAt(thumbWorld);
    const b = blocksAt(world);
    const roof = p.shell.cells.filter((c) => c.kind === 'roof' || c.kind === 'wall').map((c) => key3(c.pos));
    expect(roof.length).toBeGreaterThan(50);
    const same = roof.filter((k) => a.get(k) === b.get(k)).length;
    expect(same / roof.length).toBeGreaterThan(0.95);

    const voxels = thumbnailVoxels(p.shell, thumbWorld);
    const colors = new Set(voxels.map((v) => v.color));
    expect(colors.has(roleColor('roof'))).toBe(false);
    expect(voxels.some((v) => v.block !== undefined)).toBe(true);
    // ohne Welt (Plattform-Daten noch nicht geladen): Rollenfarben wie bisher
    expect(thumbnailVoxels(p.shell).some((v) => v.color === roleColor('roof') || v.color === roleColor('wall'))).toBe(true);
  });
});

describe('W9-G4: Erdhaus im Assistenten und im Editor', () => {
  it('Vorschaubild zeigt den Hügel (Quader über der Decke), andere Bautypen bleiben ohne', () => {
    const def = types.get('hobbit');
    const params = bt.defaultParams(def, ctx.themes.ids(), 'rustic', NEW);
    const p = bt.proposal(def, params, bt.proposalSeeds(7)[0]!, ctx, NEW);
    const top = Math.max(...p.shell.cells.map((c) => c.pos[1]));
    const mound = moundVoxels(p.shell);
    const footprint = p.shell.settings!.find((s) => s.kind === 'buried')!.footprint;
    expect(mound.length).toBeGreaterThan(footprint.size);
    // über jeder Spalte des Grundrisses liegt Erde, die Kuppe überragt die Hülle
    expect(Math.max(...mound.map((v) => v.center[1] + v.size[1] / 2))).toBeGreaterThan(top + 2);
    // das Bild enthält Haus und Hügel (Hügel-Quader haben die Hügelfarben)
    const all = thumbnailVoxels(p.shell);
    expect(all.length).toBeGreaterThan(mound.length);
    const hill = new Set(mound.map((v) => v.color));
    expect(all.filter((v) => hill.has(v.color)).length).toBeGreaterThanOrEqual(mound.length);
    const house = types.get('house');
    const q = bt.proposal(house, bt.defaultParams(house, ctx.themes.ids(), 'medieval', NEW), bt.proposalSeeds(7)[0]!, ctx, NEW);
    expect(moundVoxels(q.shell)).toEqual([]);
  });

  it('erste Ansicht: Einpassen schaut von vorn auf Front und Hügel, bei anderen Bauten bleibt die Blickrichtung', () => {
    const def = types.get('hobbit');
    for (const front of ['south', 'north', 'east', 'west'] as const) {
      const params = { ...bt.defaultParams(def, ctx.themes.ids(), 'rustic', NEW), front };
      const p = bt.proposal(def, params, bt.proposalSeeds(7)[0]!, ctx, NEW);
      const box = houseBox(p.shell)!;
      expect(box.look, front).toBeDefined();
      const [x, y, z] = lookDirection(box.look!);
      const out = { south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] }[front];
      // Kamera vor der Front (Skalarprodukt mit der Außenrichtung deutlich positiv), flach über dem Horizont
      expect(x * out[0]! + z * out[1]!, front).toBeGreaterThan(0.75);
      expect(y, front).toBeGreaterThan(0.2);
      expect(y, front).toBeLessThan(0.6);
      // der Quader reicht über die Hülle hinaus (Hügel im Bild)
      expect(box.max[1]).toBeGreaterThan(Math.max(...p.shell.cells.map((c) => c.pos[1])));
    }
    const house = types.get('house');
    const q = bt.proposal(house, bt.defaultParams(house, ctx.themes.ids(), 'medieval', NEW), bt.proposalSeeds(7)[0]!, ctx, NEW);
    expect(houseBox(q.shell)!.look).toBeUndefined();
  });
});
