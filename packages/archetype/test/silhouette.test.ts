/**
 * Silhouetten-Prüfung (research/20 §0.9, Synthese 25 Regel 11): Zahl der Baukörper und Überragen des
 * Hauptbaukörpers durch den höchsten Teil. Weiche Werte – Verstöße erscheinen als Hinweis, nie als Warnung.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBuildingTypeDef, type BuildingTypeDef } from '@mcda/catalog';
import { nodeContext } from '@mcda/pipeline/node';
import { planBuilding, type ArchetypeContext } from '../src/index.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const arch: ArchetypeContext = { minArea: (id) => (ctx.catalog.roomTypeIds().includes(id) ? ctx.catalog.roomType(id).minArea : 4) };
const parsed = parseBuildingTypeDef(readFileSync(`${ROOT}/buildingtypes/castle_compact.json5`, 'utf8'), 'castle_compact.json5');
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const castle: BuildingTypeDef = parsed.value;

describe('Silhouette: Baukörper und Fokus-Element (research/20 §0.9)', () => {
  it('Burg: zwei Baukörper, der Bergfried überragt den Palas messbar', () => {
    for (const size of ['S', 'M', 'L'] as const) {
      for (const seed of [1, 3, 42, 2026]) {
        const p = planBuilding(castle, { size }, seed, arch);
        const q = Object.fromEntries(p.quality.map((x) => [x.id, x]));
        const where = `Burg ${size} Seed ${seed}`;
        expect(q['massCount']?.value, where).toBeGreaterThanOrEqual(2);
        // W3 (27.09.2026): Der Bergfried überragt den Palas um die recherchierten ≥ 25 % (research/20 §0.9). Vorher
        // 1,1–1,25: Gesims und Fensterrahmen des Bergfrieds über dem Palasdach zählten als Palas-Oberkante (K6).
        expect(q['focusOverMain']?.value, where).toBeGreaterThanOrEqual(1.25);
        expect(q['focusOverMain']?.value, where).toBeLessThanOrEqual(2);
        // Ein Verstoß ist ein Hinweis, keine Warnung (research/20 §0.9: weicher Wert)
        for (const x of p.quality.filter((y) => !y.ok)) expect(p.hints.join('\n'), where).toContain(`Silhouette: ${x.id}`);
        expect(p.warnings, where).toEqual([]);
      }
    }
  });

  it('ohne `checks`-Angabe werden die neuen Werte nicht gemeldet (kein Bruch für andere Typen)', () => {
    const p = planBuilding(ctx.buildingTypes.get('longhouse'), { size: 'S' }, 1, arch);
    expect(p.quality.map((q) => q.id)).toEqual(['ratio', 'heightToWidth']);
  });
});
