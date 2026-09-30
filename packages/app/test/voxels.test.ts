import { isAtticLight } from '@mcda/blueprint';
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import * as uc from '../src/usecases.js';
import { buildPreviewVoxels, countByLayer, layerVisible, materialBox } from '../src/viewer/voxels.js';

const catalog = loadBundledCatalog().catalog!;

describe('3D-Vorschau: Szenendaten', () => {
  const { session } = uc.paintRect(uc.createSession(11), catalog, { x1: 0, z1: 0, x2: 9, z2: 7 }, 'bedroom');
  const state = session.project.state;
  const shell = uc.shellOf(session.project, 'flat');
  const views = uc.placedViews(state, catalog);
  const voxels = buildPreviewVoxels(shell, views);
  const n = countByLayer(voxels);

  it('Hülle (Flachdach): Boden und Decke je Raumzelle, Wände rundum', () => {
    expect(n.floor).toBe(80);
    // W2 (26.09.2026): Regel D8 – dazu das Flachdach-Gesims rundum (2 × 10 + 2 × 8 + 4 Ecken = 40 Dachzellen)
    expect(shell.cells.filter((c) => c.kind === 'roof')).toHaveLength(40);
    // W5 (27.09.2026, N1): die 4 Ecken des Deckenrings sind Eckpfeiler bis zur Traufe (Wand-Schicht)
    expect(n.ceiling).toBe(80 + 40 - 4);
    expect(n.wall).toBe(shell.cells.filter((c) => c.kind !== 'floor' && c.kind !== 'ceiling' && c.kind !== 'roof').length);
  });

  it('Walmdach: Dachflächen kommen in die Decken-Schicht dazu, Boden und Wände bleiben', () => {
    expect(uc.shellOf(session.project)).toBe(uc.shellOf(session.project, uc.DEFAULT_ROOF)); // Standard = Stil neuer Projekte
    const hip = uc.shellOf(session.project, 'hip');
    const h = countByLayer(buildPreviewVoxels(hip, views));
    const roofCells = hip.cells.filter((c) => c.kind === 'roof').length;
    expect(roofCells).toBeGreaterThan(0);
    expect(h.floor).toBe(80);
    // W4 (27.09.2026): Dachraum-Licht – die Laternen auf dem Dachboden liegen mit der Decke in der Decken-Schicht
    // W5 (27.09.2026, N1): die 4 Ecken des Deckenrings sind Eckpfeiler bis zur Traufe (Wand-Schicht)
    expect(h.ceiling).toBe(80 + roofCells + hip.cells.filter(isAtticLight).length - 4);
    // Q2: die Fassaden-Pflichtregeln hängen am Dach (Wandvorlagenkopf an der Traufe) – die Wände bleiben deshalb
    // nur gegenüber der Hülle desselben Stils gleich, nicht gegenüber dem Flachdach.
    const wallCells = (s: typeof hip): number => s.cells.filter((c) => c.kind !== 'floor' && c.kind !== 'ceiling' && c.kind !== 'roof').length;
    expect(h.wall).toBe(wallCells(hip));
  });

  it('Möbel und leuchtende Deckenlampen', () => {
    expect(n.furniture).toBeGreaterThan(0);
    expect(n.light).toBeGreaterThanOrEqual(1); // Schlafzimmer: light_ceiling [1, 2]
    const blockCells = views.reduce((t, v) => t + v.placed.cells.length, 0);
    expect(n.furniture + n.light).toBe(blockCells);
  });

  it('Quader liegen in ihrem Block und haben positive Größe', () => {
    for (const v of voxels) {
      for (let i = 0; i < 3; i++) {
        expect(v.size[i]).toBeGreaterThan(0);
        expect(v.size[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('Formen: Stufe oben, Zaun schmal, Laterne klein', () => {
    expect(materialBox({ role: 'furniture_wood', shape: 'slab', orient: { upsideDown: true } })).toEqual({ min: [0, 0.5, 0], max: [1, 1, 1] });
    const fence = materialBox({ role: 'furniture_wood', shape: 'fence' });
    expect(fence.max[0] - fence.min[0]).toBeLessThan(0.5);
    const lantern = materialBox({ role: 'light_hanging', shape: 'lantern', orient: { hanging: true } });
    expect(lantern.max[1]).toBeLessThan(1);
    expect(materialBox({ block: 'minecraft:chest' })).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
  });

  it('Ansichten: Dach ab blendet die Decke aus, „Wände ab“ zusätzlich die Wände', () => {
    expect(layerVisible('ceiling', 'full')).toBe(true);
    expect(layerVisible('ceiling', 'noRoof')).toBe(false);
    expect(layerVisible('wall', 'noRoof')).toBe(true);
    expect(layerVisible('wall', 'floorOnly')).toBe(false);
    expect(layerVisible('furniture', 'floorOnly')).toBe(true);
    expect(layerVisible('light', 'floorOnly')).toBe(true);
  });
});
