/**
 * Gewichtete Nachbarschaft (research/22 §0.1, Synthese 25 Regel 12): `adjacencyWeights` im Bautyp-Programm zieht
 * Raumtypen an (positiv) oder stößt sie ab (negativ). Geprüft wird der Schema-Durchlauf und die Wirkung auf den
 * Plan: Küche und Speisesaal nebeneinander bei positivem Gewicht, getrennt bei negativem.
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

/** Kleiner Bautyp mit Küche und Speisesaal und einstellbarem Gewicht zwischen ihnen. */
function typ(weight: number | undefined): BuildingTypeDef {
  const parsed = parseBuildingTypeDef(
    JSON.stringify({
      id: 'probe', name: 'Probe', family: 'house', themes: ['medieval'],
      sizes: { M: { footprint: [[21, 15], [25, 19]], floors: 1 } },
      massing: { generator: 'rect' },
      program: [
        { room: 'kitchen', required: true },
        { room: 'dining_hall', required: true, ...(weight !== undefined ? { adjacencyWeights: { kitchen: weight } } : {}) },
        { room: 'storage', required: true },
      ],
    }),
    'probe.json5',
  );
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return parsed.value;
}

describe('Gewichtete Nachbarschaft (adjacencyWeights)', () => {
  it('Schema nimmt Gewichte −1 … +1 an und lehnt Ausreißer ab', () => {
    const mit = (weights: unknown) => parseBuildingTypeDef(
      JSON.stringify({
        id: 'p', name: 'P', family: 'house', themes: ['medieval'],
        sizes: { M: { footprint: [[15, 11], [17, 13]], floors: 1 } },
        massing: { generator: 'rect' },
        program: [{ room: 'kitchen', adjacencyWeights: weights }],
      }),
      'p.json5',
    );
    expect(mit({ storage: -1 }).ok, 'Gewicht −1').toBe(true);
    expect(mit({ storage: 0.5 }).ok, 'Gewicht 0,5').toBe(true);
    expect(mit({ storage: 2 }).ok, 'Gewicht 2').toBe(false);
    expect(mit({ storage: -3 }).ok, 'Gewicht −3').toBe(false);
  });

  it('positives Gewicht zieht an, negatives stößt ab (über mehrere Seeds)', () => {
    const kontakt = (def: BuildingTypeDef): number => {
      let mitKontakt = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const p = planBuilding(def, { size: 'M' }, seed, arch);
        const kitchen = p.rooms.find((r) => r.roomTypeId === 'kitchen');
        const dining = p.rooms.find((r) => r.roomTypeId === 'dining_hall');
        if (kitchen === undefined || dining === undefined) continue;
        // gemeinsame Kante: benachbarte Zellen beider Räume
        const k = new Set(kitchen.cells.toArray().map(([x, z]) => `${x},${z}`));
        const beruehrt = dining.cells.toArray().some(([x, z]) =>
          ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dy]) => k.has(`${x + dx},${z + dy}`)));
        if (beruehrt) mitKontakt++;
      }
      return mitKontakt;
    };
    const anziehend = kontakt(typ(1));
    const neutral = kontakt(typ(undefined));
    const abstossend = kontakt(typ(-1));
    // Positiv berührt mindestens so oft wie neutral, negativ höchstens so oft – und die Extreme unterscheiden sich
    expect(anziehend).toBeGreaterThanOrEqual(neutral);
    expect(abstossend).toBeLessThanOrEqual(neutral);
    expect(anziehend).toBeGreaterThan(abstossend);
  });

  it('ohne Gewichte bleibt die Grundrisswahl unverändert', () => {
    const a = typ(undefined);
    const ohne = typ(0);
    for (const seed of [1, 2, 3]) {
      expect(planBuilding(ohne, { size: 'M' }, seed, arch).rooms.map((r) => r.roomTypeId)).toEqual(
        planBuilding(a, { size: 'M' }, seed, arch).rooms.map((r) => r.roomTypeId),
      );
    }
    // und die Katalogtypen mit `adjacent` (Burg) laufen weiter
    const castle = parseBuildingTypeDef(readFileSync(`${ROOT}/buildingtypes/castle_compact.json5`, 'utf8'), 'castle_compact.json5');
    expect(castle.ok && planBuilding(castle.value, { size: 'S' }, 4, arch).warnings).toEqual([]);
  });
});
