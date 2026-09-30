/**
 * Schalter `silhouette` (WS Schritt 2) auf Plan-Ebene: `off` ist bitgleich; `varied` gibt einteiligen Bautypen einen
 * niedrigeren Anbau mit eigener Dachform und ungeraden Maßen, ohne Warnungen (Erreichbarkeit, Licht, Pflichträume).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBuildingTypeDef, type BuildingTypeDef } from '@mcda/catalog';
import { nodeContext } from '@mcda/pipeline/node';
import { SILHOUETTE_PART, planBuilding, supportsSilhouette, withSilhouette, type ArchetypeContext } from '../src/index.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const arch: ArchetypeContext = { minArea: (id) => (ctx.catalog.roomTypeIds().includes(id) ? ctx.catalog.roomType(id).minArea : 4) };
const load = (id: string): BuildingTypeDef => {
  const r = parseBuildingTypeDef(readFileSync(`${ROOT}/buildingtypes/${id}.json5`, 'utf8'), `${id}.json5`);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
};
const SEEDS = [5, 11, 12, 13];

describe('Silhouette varied: off ist bitgleich', () => {
  it('ohne Option, mit off und für Bautypen ohne Regel bleibt die Definition dieselbe Referenz', () => {
    for (const id of ['tavern', 'longhouse', 'watchtower', 'farmhouse', 'castle_compact']) {
      const def = load(id);
      expect(withSilhouette(def, undefined, 'M', 5, 0)).toBe(def);
      expect(withSilhouette(def, 'off', 'M', 5, 0)).toBe(def);
    }
    for (const id of ['farmhouse', 'castle_compact']) {
      const def = load(id);
      expect(supportsSilhouette(def)).toBe(false);
      expect(withSilhouette(def, 'varied', 'M', 5, 0)).toBe(def);
    }
  });

  it('der Plan ohne Option und mit off ist derselbe (alle Regeltypen, mehrere Seeds)', () => {
    for (const id of ['tavern', 'longhouse', 'watchtower']) {
      for (const seed of SEEDS) {
        const plain = JSON.stringify(planBuilding(load(id), { size: 'M' }, seed, arch));
        expect(JSON.stringify(planBuilding(load(id), { size: 'M', silhouette: 'off' }, seed, arch))).toBe(plain);
      }
    }
  });
});

describe('Silhouette varied: Anbau mit eigener Dachhöhe', () => {
  for (const id of ['tavern', 'longhouse', 'watchtower']) {
    it(`${id}: ein Baukörper mehr, ungerade Maße, niedriger als der Hauptbau, keine Warnungen, deterministisch`, () => {
      const def = load(id);
      for (const seed of SEEDS) {
        const base = planBuilding(def, { size: 'M' }, seed, arch);
        const v = planBuilding(def, { size: 'M', silhouette: 'varied' }, seed, arch);
        expect(v.warnings, `${id} seed ${seed}`).toEqual([]);
        expect(v.params.silhouette).toBe('varied');
        expect(v.volumes.length).toBe(base.volumes.length + 1);
        const annex = v.volumes.find((x) => x.name === def.name || x.id !== 'v0' && !base.volumes.some((b) => b.id === x.id));
        expect(annex).toBeDefined();
        // eigene, niedrigere lichte Höhe und eigene Dachform
        expect(annex!.floorHeights?.[0] ?? 3).toBeLessThanOrEqual(3);
        expect(annex!.roof).toBeDefined();
        // ungerade Innenmaße des Anbaus
        const cells = v.rooms.filter((r) => r.volumeId === annex!.id).flatMap((r) => r.cells.toArray());
        const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
        expect((Math.max(...xs) - Math.min(...xs) + 1) % 2).toBe(1);
        expect((Math.max(...zs) - Math.min(...zs) + 1) % 2).toBe(1);
        expect(JSON.stringify(planBuilding(def, { size: 'M', silhouette: 'varied' }, seed, arch))).toBe(JSON.stringify(v));
      }
    });
  }

  it('Größe S bleibt unverändert (zu klein für einen zweiten Baukörper)', () => {
    for (const id of ['tavern', 'longhouse', 'watchtower']) {
      const def = load(id);
      expect(withSilhouette(def, 'varied', 'S', 5, 0)).toBe(def);
    }
  });

  it('der Zusatzteil steht am Ende des Programms und hat die dokumentierte Id', () => {
    const def = load('tavern');
    const shaped = withSilhouette(def, 'varied', 'M', 5, 0);
    expect(shaped).not.toBe(def);
    expect(shaped.program!.at(-1)!.part).toBe(SILHOUETTE_PART);
    expect(shaped.program!.slice(0, -1)).toEqual(def.program);
  });
});
