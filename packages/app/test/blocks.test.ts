import { isAtticLight } from '@mcda/blueprint';
import { key3 } from '@mcda/core';
import { blockState } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { DYE_COLORS, blockLook, mix } from '../src/blockColors.js';
import { worldOf } from '../src/exporting.js';
import * as uc from '../src/usecases.js';
import { blockBoxes, buildBlockVoxels } from '../src/viewer/blocks.js';
import { countByLayer } from '../src/viewer/voxels.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;
const isRgb = (c: number) => Number.isInteger(c) && c >= 0 && c <= 0xffffff;

describe('Farbheuristik je Blockname', () => {
  it('Holzarten: eigene Bretterfarbe, Rinde dunkler/anders; dark_oak und pale_oak nicht als oak', () => {
    const planks = ['oak', 'spruce', 'birch', 'dark_oak', 'pale_oak', 'cherry'].map((w) => blockLook(`minecraft:${w}_planks`).color);
    expect(new Set(planks).size).toBe(planks.length);
    expect(blockLook('spruce_stairs').color).toBe(blockLook('spruce_planks').color);
    expect(blockLook('spruce_door').rule).toBe('wood');
    expect(blockLook('oak_log').color).not.toBe(blockLook('oak_planks').color);
    expect(blockLook('stripped_spruce_log').rule).toBe('wood');
    expect(blockLook('dark_oak_log').color).not.toBe(blockLook('oak_log').color);
  });

  it('Gestein: Steinziegel, bemoost, Bruchstein, Tiefenschiefer unterscheidbar; „stone“ fängt nicht grindstone/glowstone', () => {
    const names = ['stone_bricks', 'mossy_stone_bricks', 'cobblestone', 'deepslate_tiles', 'bricks', 'sandstone', 'red_sandstone'];
    const colors = names.map((n) => blockLook(n).color);
    expect(new Set(colors).size).toBe(names.length);
    for (const n of names) expect(blockLook(n).rule, n).toBe('mineral');
    expect(blockLook('grindstone').rule).toBe('special');
    expect(blockLook('glowstone').rule).toBe('light');
  });

  it('Farbstoffe: Wolle, Teppich, Bett, Kerze in Farbstoff-Farbe; Glas heller; red_sandstone ist kein Farbstoff', () => {
    expect(blockLook('red_wool').color).toBe(DYE_COLORS['red']);
    expect(blockLook('red_bed').color).toBe(DYE_COLORS['red']);
    expect(blockLook('light_blue_carpet').color).toBe(DYE_COLORS['light_blue']);
    expect(blockLook('light_gray_candle').color).toBe(DYE_COLORS['light_gray']);
    expect(blockLook('blue_stained_glass_pane').color).toBe(mix(DYE_COLORS['blue']!, 0xffffff, 0.35));
    expect(blockLook('red_sandstone').rule).toBe('mineral');
  });

  it('Lichtquellen leuchten: Laterne warm, Seelenlaterne blau, Kupferlaterne, Fackel', () => {
    for (const n of ['lantern', 'soul_lantern', 'waxed_copper_lantern', 'torch', 'wall_torch', 'glowstone', 'sea_lantern']) {
      expect(blockLook(n).glow, n).toBe(true);
    }
    expect(blockLook('soul_lantern').color).not.toBe(blockLook('lantern').color);
    expect(blockLook('chain').glow).toBe(false);
    expect(blockLook('chest').glow).toBe(false);
  });

  it('Luft, Licht-Block und Strukturleere sind unsichtbar; Unbekanntes bekommt eine stabile Ersatzfarbe', () => {
    for (const n of ['air', 'minecraft:cave_air', 'structure_void', 'light', 'barrier']) expect(blockLook(n).rule, n).toBe('invisible');
    const u = blockLook('mymod:strange_thing');
    expect(u.rule).toBe('fallback');
    expect(isRgb(u.color)).toBe(true);
    expect(blockLook('mymod:strange_thing').color).toBe(u.color);
  });
});

describe('Blockformen', () => {
  it('Stufe oben/unten, Treppe = Sockel + Stufe zur facing-Seite', () => {
    expect(blockBoxes(blockState('oak_slab', { type: 'top' }))).toEqual([{ min: [0, 0.5, 0], max: [1, 1, 1] }]);
    expect(blockBoxes(blockState('oak_slab', { type: 'double' }))).toEqual([{ min: [0, 0, 0], max: [1, 1, 1] }]);
    const stairs = blockBoxes(blockState('spruce_stairs', { facing: 'north', half: 'top', shape: 'straight' }));
    expect(stairs).toEqual([
      { min: [0, 0.5, 0], max: [1, 1, 1] },
      { min: [0, 0, 0], max: [1, 0.5, 0.5] },
    ]);
  });

  it('Tür dünn an einer Kante, Glasscheibe entlang ihrer Verbindungen, Laterne klein', () => {
    const [door] = blockBoxes(blockState('oak_door', { facing: 'east', half: 'lower' }));
    expect(door!.max[0] - door!.min[0]).toBeLessThan(0.25);
    const pane = blockBoxes(blockState('glass_pane', { east: 'true', west: 'true', north: 'false', south: 'false' }));
    expect(pane).toHaveLength(3); // Pfosten + 2 Arme
    for (const b of pane) expect(b.max[2] - b.min[2]).toBeLessThan(0.2);
    const [lantern] = blockBoxes(blockState('lantern', { hanging: 'true' }));
    expect(lantern!.max[0] - lantern!.min[0]).toBeLessThan(0.5);
    expect(blockBoxes(blockState('stone_bricks'))).toEqual([{ min: [0, 0, 0], max: [1, 1, 1] }]);
  });
});

describe('Vorschau: Blöcke aus dem materialisierten Volumen', () => {
  it('jeder Block des Beispielhauses (alle Themes, beide Versionen) hat eine Regel-Farbe, kein Ersatz', async () => {
    const seen = new Set<string>();
    for (const version of uc.TARGET_VERSION_NAMES) {
      const ctx = await pipeline.ready(version);
      for (const themeId of load.themeCatalog!.ids()) {
        const { project } = sampleSession(catalog, { themeId, version });
        for (const c of worldOf(project, ctx).materialized.volume.cells()) seen.add(c.state.name);
      }
    }
    expect(seen.size).toBeGreaterThan(15);
    const fallback = [...seen].filter((n) => blockLook(n).rule === 'fallback');
    expect(fallback, `ohne Farbregel: ${fallback.join(', ')}`).toEqual([]);
  });

  it('Schichten wie in der Rollen-Vorschau: Boden/Wand/Decke aus der Hülle, Laternen leuchten', async () => {
    const s = sampleSession(catalog);
    const world = worldOf(s.project, await pipeline.ready('1.21.11'));
    const voxels = buildBlockVoxels(world);
    const n = countByLayer(voxels);
    const shellFloor = world.shell.cells.filter((c) => c.kind === 'floor').length;
    expect(n.floor).toBe(shellFloor);
    // Decke + Walmdach: je Hüllenzelle ein Block (Treppen bestehen aus zwei Quadern → Blöcke zählen, nicht Quader)
    const blockOf = (v: (typeof voxels)[number]) => key3([Math.floor(v.center[0]), Math.floor(v.center[1]), Math.floor(v.center[2])]);
    expect(n.ceiling).toBeGreaterThanOrEqual(new Set(voxels.filter((v) => v.layer === 'ceiling').map(blockOf)).size);
    // … dazu die Dachteile der Außen-Deko (Schornstein, Traufenlaterne, Firstschmuck); ihre Fassadenteile zählen zur Wand
    const outside = new Map((world.exterior ?? []).flatMap((p) => p.cells.map((c) => [key3(c), uc.EXTERIOR_ROOF_GROUPS.has(p.group) ? 'ceiling' : 'wall'] as const)));
    const ceilingBlocks = new Set(voxels.filter((v) => v.layer === 'ceiling').map(blockOf));
    // W4 (27.09.2026): Laternen des Dachraum-Lichts leuchten – sie liegen in der Licht-Schicht, nicht in der Decke
    expect([...ceilingBlocks].filter((k) => !outside.has(k)).length).toBe(world.shell.cells.filter((c) => (c.kind === 'ceiling' || c.kind === 'roof') && !isAtticLight(c)).length);
    for (const v of voxels) if (outside.has(blockOf(v))) expect(v.layer, blockOf(v)).toBe(outside.get(blockOf(v)));
    expect(n.wall).toBeGreaterThan(0);
    expect(n.furniture).toBeGreaterThan(0);
    // jede Lichtquelle im Haus liegt in der Licht-Schicht (Laternen der Außen-Deko folgen Wand bzw. Dach, siehe oben)
    const inside = world.materialized.light.emitters.filter((e) => !outside.has(key3(e.pos)));
    expect(inside.length).toBeLessThan(world.materialized.light.emitters.length); // Wand- und Traufenlaternen
    expect(n.light).toBeGreaterThanOrEqual(inside.length);
    const lightCenters = new Set(voxels.filter((v) => v.layer === 'light').map((v) => key3([Math.floor(v.center[0]), Math.floor(v.center[1]), Math.floor(v.center[2])])));
    for (const e of inside) expect(lightCenters.has(key3(e.pos))).toBe(true);
    for (const v of voxels) expect(isRgb(v.color)).toBe(true);
  });

  it('Theme-Wechsel ist in der Blockvorschau sichtbar (andere Farben); die Einrichtung folgt nur der Stil-Kette', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const medieval = sampleSession(catalog);
    const nordic = uc.setTheme(medieval, catalog, 'nordic');
    const palette = (s: uc.Session) => new Set(buildBlockVoxels(worldOf(s.project, ctx)).map((v) => v.color));
    expect(palette(nordic)).not.toEqual(palette(medieval));
    // W2 (26.09.2026): Regel F1 „Raster zuerst, Feldbreite je Theme“ (W2-FA/W2-FC: medieval 3, nordic 5) – die Fenster
    // und damit die Einrichtung folgen dem Theme. Gleich bleiben: jeder Raum ist eingerichtet, keine Nordic-Formen in
    // Küche, Schlafzimmer, Lager, Schmiede
    const rooms = (s: uc.Session) => [...new Set(s.project.state.placements.map((p) => p.roomId))].sort();
    expect(rooms(nordic)).toEqual(rooms(medieval));
    expect(nordic.project.state.placements.some((p) => p.componentId.startsWith('nordic/'))).toBe(false);
  });
});
