/** W2-ED U5: Möbel tauschen bzw. Variante wechseln (`swapPlacement`, Event `PlacementSwapped`). */
import { describe, expect, it } from 'vitest';
import { CellSet, pose } from '@mcda/core';
import { DomainError, Project, TARGET_VERSIONS } from '../src/index.js';

const setup = () => {
  const p = Project.create({ id: 'p', name: 'Haus', seed: 3, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
  p.paintRoom(0, CellSet.rect(0, 0, 6, 6), 'kitchen');
  p.applyFurnishing('r1', [
    { key: 't', componentId: 'table/small', pose: pose([2, 1, 2]), seed: 1 },
    { key: 'c', componentId: 'decor/candle', pose: pose([2, 2, 2]), seed: 2, parentKey: 't', socketId: 'top' },
  ]);
  const table = p.state.placements.find((x) => x.componentId === 'table/small')!;
  return { p, table };
};

describe('swapPlacement', () => {
  it('Variante wechseln: gleiche ID und Lage, Kinder bleiben, danach „manual“ (übersteht Neu-Einrichten)', () => {
    const { p, table } = setup();
    const ev = p.swapPlacement(table.id, 'table/small', { variantId: 'oak' });
    expect(ev).toEqual([{ type: 'PlacementSwapped', placementId: table.id, componentId: 'table/small', variantId: 'oak' }]);
    const t = p.placement(table.id);
    expect(t).toMatchObject({ componentId: 'table/small', variantId: 'oak', origin: 'manual', pose: table.pose });
    expect(p.state.placements).toHaveLength(2);
    p.applyFurnishing('r1', []);
    expect(p.state.placements.map((x) => x.id)).toEqual([table.id]); // Kind war automatisch → neu eingerichtet weg, Tisch bleibt
  });

  it('andere Komponente: Kinder entfallen; unverändert = keine Events; Replay gleich', () => {
    const { p, table } = setup();
    p.swapPlacement(table.id, 'table/round');
    expect(p.state.placements.map((x) => x.componentId)).toEqual(['table/round']);
    expect(p.swapPlacement(table.id, 'table/round')).toEqual([]);
    expect(() => p.swapPlacement(table.id, '')).toThrow(DomainError);
    expect(Project.fromHistory(p.history).state).toEqual(p.state);
    // ohne Variante: Feld weg
    p.swapPlacement(table.id, 'table/small', { variantId: 'oak' });
    p.swapPlacement(table.id, 'table/small');
    expect(Object.keys(p.placement(table.id))).not.toContain('variantId');
  });
});
