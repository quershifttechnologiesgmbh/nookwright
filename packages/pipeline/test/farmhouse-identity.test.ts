/**
 * W9-G3 (plan/spikes/W9G3_bauernhaus.md, Review R5 G3): Typ-Identität des Bauernhauses über den Anwendungsdienst
 * (`projectFromBuildingType` + `generateBase`, wie Assistent, Engine und goldene Menge).
 *
 * - M hat eine Scheune (Ensemble-Teil, eigener Baukörper mit hoher Tenne) mit Wänden und Dach.
 * - rustic: Scheune in Scheunenrot (Mangrove), Wohnhaus-Giebel in Putz, unterste Außenwandreihe Bruchstein.
 * - Wand/Dach-Helligkeitsabstand des Wohnhauses (OKLab-L der gebauten Blöcke, `blockLook`) ≥ dem des Mittelalterhauses.
 * - ≥ 3 Materialfamilien an der Fassade; 0 harte Verstöße; deterministisch.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { blockLook, generateBase, projectFromBuildingType, type BaseWorld, type BuildingTypeResult } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

function build(type: string, size: 'S' | 'M' | 'L' | undefined, theme: string, seed: number): { res: BuildingTypeResult; world: BaseWorld } {
  const def = ctx.buildingTypes.get(type)!;
  const res = projectFromBuildingType(def, { ...(size !== undefined ? { size } : {}), themeId: theme, targetVersion: TARGET_VERSIONS['1.21.11'] }, seed, ctx);
  return { res, world: generateBase(res.project, ctx, { ...res.build, ...res.surroundings }) };
}

/** OKLab-L (Björn Ottosson) einer sRGB-Farbe 0xRRGGBB. */
function lightness(rgb: number): number {
  const lin = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = lin((rgb >> 16) & 255), g = lin((rgb >> 8) & 255), b = lin(rgb & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

function family(name: string): string {
  const n = name.replace(/^minecraft:/, '');
  if (/(calcite|terracotta|mushroom_stem|quartz)/.test(n)) return 'plaster';
  if (/^(stripped_)?(oak|spruce|birch|dark_oak|mangrove|cherry|pale_oak|poplar)_/.test(n)) return 'wood';
  if (/(cobble|stone|andesite|deepslate|tuff)/.test(n)) return 'stone';
  return 'other';
}

interface Facts {
  readonly barnVolume: string | undefined;
  readonly volumes: Map<string, { wall: string[]; roof: string[] }>;
}

/** Außenwand- und Dachblöcke je Baukörper (Glas zählt nicht). */
function facts(res: BuildingTypeResult, world: BaseWorld): Facts {
  const vol = world.materialized.volume;
  const volOf = new Map(res.project.state.rooms.map((r) => [r.id, r.volumeId ?? 'main']));
  const volumes = new Map<string, { wall: string[]; roof: string[] }>();
  for (const c of world.shell.cells) {
    // W16-B (28.09.2026): die Scheune deckt in `roof_barn` (eigenes dunkles Dach, `Volume.exterior.roof`)
    const roof = c.kind === 'roof' && (c.role === 'roof_main' || c.role === 'roof_barn');
    const wall = c.exterior === true && (c.kind === 'wall' || c.kind === 'pillar' || c.kind === 'facade' || c.kind === 'floor');
    if ((!roof && !wall) || c.roomId === undefined || !vol.contains(c.pos) || vol.isEmpty(c.pos)) continue;
    const name = String(vol.stateAt(c.pos).name);
    if (/air$|glass|pane/.test(name)) continue;
    const v = volOf.get(c.roomId) ?? '?';
    if (!volumes.has(v)) volumes.set(v, { wall: [], roof: [] });
    volumes.get(v)![roof ? 'roof' : 'wall'].push(name);
  }
  return { barnVolume: res.plan.parts?.find((p) => p.id === 'barn')?.volumeId, volumes };
}

const meanL = (names: readonly string[]): number => names.reduce((s, n) => s + lightness(blockLook(n).color), 0) / names.length;
const contrast = (v: { wall: string[]; roof: string[] }): number => Math.abs(meanL(v.wall) - meanL(v.roof));

describe('W9-G3: Bauernhaus liest sich als Hof', () => {
  it('M rustic: Scheune sichtbar und rot, Putzgiebel, Steinsockel, Kontrast ≥ Mittelalterhaus, ≥ 3 Familien, 0 harte Verstöße', { timeout: HEAVY_TIMEOUT }, () => {
    const ref = build('house', undefined, 'medieval', 2026);
    const refContrast = contrast(facts(ref.res, ref.world).volumes.get('main')!);
    for (const seed of [1, 2, 3]) {
      const { res, world } = build('farmhouse', 'M', 'rustic', seed);
      const f = facts(res, world);
      expect(world.materialized.violations.filter((v) => v.kind !== 'spawn'), `Seed ${seed}`).toEqual([]);
      expect(f.barnVolume, `Seed ${seed}: Scheune`).toBeDefined();
      const barn = f.volumes.get(f.barnVolume!)!;
      const house = f.volumes.get('main')!;
      expect(barn.roof.length, `Seed ${seed}: Scheunendach`).toBeGreaterThan(50);
      expect(barn.wall.filter((n) => n.includes('mangrove')).length / barn.wall.length, `Seed ${seed}: Scheunenrot`).toBeGreaterThan(0.5);
      expect(house.wall.some((n) => n.includes('calcite')), `Seed ${seed}: Putzgiebel`).toBe(true);
      expect(house.wall.some((n) => n.includes('cobblestone')), `Seed ${seed}: Steinsockel`).toBe(true);
      expect(contrast(house), `Seed ${seed}: Wand/Dach`).toBeGreaterThanOrEqual(refContrast);
      const fams = new Set([...house.wall, ...barn.wall].map(family));
      fams.delete('other');
      expect(fams.size, `Seed ${seed}: Familien ${[...fams].join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('deterministisch: gleicher Seed → gleiche Blöcke (Scheune und Haus)', { timeout: HEAVY_TIMEOUT }, () => {
    const run = (): Facts => { const { res, world } = build('farmhouse', 'M', 'rustic', 7); return facts(res, world); };
    const a = run();
    const b = run();
    expect([...a.volumes.entries()]).toEqual([...b.volumes.entries()]);
  });
});
