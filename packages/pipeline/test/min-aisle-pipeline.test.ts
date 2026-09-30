/**
 * P07 über die Pipeline: `FurnishOptions.minAisle` muss bei `furnishRoomsDetailed` ankommen. Ohne die Option
 * bleibt das Ergebnis bitgleich; mit der Option wird der Mittelgang nicht mehr aufgegeben, und ein Konflikt
 * zwischen Gang und Pflichtmöbeln wird als Befund gemeldet statt still den Gang zu opfern.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { furnishRoomsDetailed, shellFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const MIT_GANG = ctx.catalog.roomTypeIds().filter((id) => ctx.catalog.roomType(id).aisle !== undefined);

function raum(type: string, w: number, d: number, seed: number) {
  const p = Project.create({ id: 'p07', name: 'P07', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), type);
  return { project: p, shell: shellFor(p, { roof: 'gable' }) };
}

describe('P07 über die Pipeline', () => {
  it('ohne die Option bitgleich, mit der Option kein aufgegebener Mittelgang', () => {
    let geprueft = 0;
    const bericht: string[] = [];
    for (const type of MIT_GANG) {
      for (const [w, d] of [[5, 5], [6, 5], [6, 6], [7, 6], [8, 7], [10, 8]] as const) {
        const a = raum(type, w, d, 5);
        const ohne = furnishRoomsDetailed(a.project, a.shell, ctx.catalog, {});
        const b = raum(type, w, d, 5);
        const aus = furnishRoomsDetailed(b.project, b.shell, ctx.catalog, { minAisle: false });
        expect(aus.warnings, `${type} ${w}×${d}`).toEqual(ohne.warnings);

        const c = raum(type, w, d, 5);
        const mit = furnishRoomsDetailed(c.project, c.shell, ctx.catalog, { minAisle: true });
        const mitOhneGang = mit.warnings.some((x) => x.includes('ohne Mittelgang'));
        const gleich = JSON.stringify(mit.warnings) === JSON.stringify(ohne.warnings);
        bericht.push(`${type} ${w}×${d}: ohne=${ohne.warnings.length} Warnungen, mit=${mit.warnings.length}${mitOhneGang ? ' (Gang aufgegeben!)' : ''}`);
        // Der verbindliche Gang darf nie „ohne Mittelgang" melden.
        expect(mitOhneGang, `${type} ${w}×${d}: Mittelgang trotz minAisle aufgegeben\n${bericht.join('\n')}`).toBe(false);
        // Konflikt nie verschweigen: jeder Pflichtkonflikt bekommt den ausdrücklichen Befund.
        const pflicht = mit.warnings.some((x) => x.includes('Pflichtobjekt') && x.includes('passt nicht'));
        const befund = mit.warnings.some((x) => x.includes('Mittelgang verbindlich'));
        expect(befund, `${type} ${w}×${d}: Pflichtkonflikt ohne Befund\n${mit.warnings.join('\n')}`).toBe(pflicht);
        if (!gleich) geprueft++;
      }
    }
    expect(geprueft, `die Option wirkt in keinem geprüften Raum (kein Unterschied zu ohne):\n${bericht.join('\n')}`).toBeGreaterThan(0);
  });

  it('bleibt bei erneuter Einrichtung mit demselben Seed gleich', () => {
    const type = MIT_GANG[0]!;
    const a = raum(type, 8, 7, 9);
    const x = furnishRoomsDetailed(a.project, a.shell, ctx.catalog, { minAisle: true });
    const b = raum(type, 8, 7, 9);
    const y = furnishRoomsDetailed(b.project, b.shell, ctx.catalog, { minAisle: true });
    expect(y.warnings).toEqual(x.warnings);
    expect(JSON.stringify(b.project.state.placements)).toBe(JSON.stringify(a.project.state.placements));
  });
});
