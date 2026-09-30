/**
 * K8 **ist Standard** (Freigabe 25.09.2026, aktiviert mit diesem Commit): `shellFor` vergibt die stabilen Zell-IDs,
 * solange `stableCellIds` nicht ausdrücklich `false` ist (Auftrag R_review_bt01_wehrplatten §K8). Der Test hält
 * fest, dass der Standard **wirkt** und der Notausgang **aus**.
 *
 * Dieser Test hält die beiden Zusagen fest:
 *  1. Der Notausgang `stableCellIds: false` liefert wieder genau das **ortsgebundene** Ergebnis (bitgleich zur
 *     Welt vor der Freigabe) – A/B-Vergleich und Prüfsummen bleiben möglich.
 *  2. Mit IDs verschiebt sich das Muster nicht mehr mit dem Haus: an denselben (relativen) Zellen steht derselbe
 *     Block. Gemessen an einem um 3 Blöcke in x verschobenen Haus.
 */
import { fileURLToPath } from 'node:url';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { generate, shellFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

/** Haus mit zwei Räumen, um `dx` verschoben (gleiche Raumtypen, gleiche Reihenfolge). */
function house(dx = 0): Project {
  const p = Project.create({ id: 's', name: 'S', seed: 7, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(2 + dx, 2, 10 + dx, 7), 'bedroom');
  p.paintRoom(0, CellSet.rect(13 + dx, 2, 19 + dx, 7), 'kitchen');
  return p;
}

interface Zelle { readonly pos: readonly number[]; readonly state: { readonly name: string; readonly properties: unknown } }
const states = (r: { materialized: { volume: { cells: () => Iterable<Zelle> } } }): Map<string, string> =>
  new Map([...r.materialized.volume.cells()].map((c) => [c.pos.join(','), `${c.state.name}${JSON.stringify(c.state.properties)}`]));

describe('K8 aktiv: stabile Zell-IDs in der Pipeline', () => {
  it('Standard: ohne Option IDs, `stableCellIds: false` keine (Notausgang)', () => {
    const p = house();
    const standard = shellFor(p, { roof: 'gable', lighting: false });
    const aus = shellFor(p, { roof: 'gable', lighting: false, stableCellIds: false });
    expect(standard.cells.every((c) => c.id !== undefined)).toBe(true);
    expect(aus.cells.every((c) => c.id === undefined)).toBe(true);
  });

  it('Notausgang deterministisch: `stableCellIds: false` liefert zweimal die ortsgebundene Welt', () => {
    const a = states(generate(house(), ctx, { roof: 'gable', lighting: false, stableCellIds: false }));
    const b = states(generate(house(), ctx, { roof: 'gable', lighting: false, stableCellIds: false }));
    expect([...b.entries()].sort()).toEqual([...a.entries()].sort());
    // Der Standard (IDs) ist bewusst eine andere Welt: Muster hängen an der Zelle, nicht am Ort
    const c = states(generate(house(), ctx, { roof: 'gable', lighting: false }));
    expect(c.size).toBe(a.size);
    expect([...c.entries()].filter(([k, v]) => a.get(k) === v).length).toBeLessThan(a.size);
  });

  it('verschobenes Haus: mit IDs bleiben die Blöcke an denselben relativen Zellen', () => {
    const vergleich = (ids: boolean): [number, number] => {
      const a = states(generate(house(0), ctx, { roof: 'gable', lighting: false, stableCellIds: ids }));
      const b = states(generate(house(3), ctx, { roof: 'gable', lighting: false, stableCellIds: ids }));
      let gleich = 0;
      let geprueft = 0;
      for (const [pos, state] of a) {
        const [x, y, z] = pos.split(',').map(Number) as [number, number, number];
        const dort = b.get([x + 3, y, z].join(','));
        if (dort === undefined) continue;
        geprueft++;
        if (dort === state) gleich++;
      }
      return [gleich, geprueft];
    };
    const mit = vergleich(true);
    const ohne = vergleich(false);
    expect(mit[1]).toBeGreaterThan(400);
    // Mit IDs: praktisch alles bleibt stehen (gemessen 99 %+), ohne IDs wandert die Textur mit.
    // W2 (26.09.2026): Regel I6 – der Hauptweg (2 breit) folgt der Tür, und die Türwahl hängt am Ort (K8-Grenze: hier
    // wandert die Tür des Schlafzimmers von der Süd- an die Nordwand). Die Einrichtung ordnet sich dann um: 93,9 %.
    expect(mit[0] / mit[1]).toBeGreaterThan(0.92);
    expect(ohne[0] / ohne[1]).toBeLessThan(mit[0] / mit[1]);
  });
});
