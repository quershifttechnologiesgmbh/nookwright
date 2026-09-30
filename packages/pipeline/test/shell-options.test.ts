import { deriveShell, type ShellAnnex } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { shellFor } from '../src/index.js';
import { sampleHouse } from './helpers.js';

describe('shellFor reicht die Außendesign-Optionen an die Hülle durch', () => {
  it('facade: gleiche Zellen wie deriveShell mit derselben Option', () => {
    const project = sampleHouse('1.21.11', 'medieval');
    const facade = { plinthProfile: true, cornice: true, quoins: true, brackets: 3 } as const;
    const viaPipeline = shellFor(project, { roof: 'gable', facade });
    // K8 ist Standard: `shellFor` vergibt ohne Option die stabilen IDs; der Vergleich mit `deriveShell` läuft
    // deshalb ohne `id`, und `stableCellIds: false` belegt die Bitgleichheit der Zellen (Notausgang).
    const ohneId = (cells: typeof viaPipeline.cells): unknown => cells.map(({ id: _id, ...rest }) => rest);
    const direct = deriveShell(project.state, { roof: 'gable', facade });
    expect(viaPipeline.cells.every((c) => c.id !== undefined)).toBe(true);
    expect(ohneId(viaPipeline.cells)).toEqual(ohneId(direct.cells));
    expect(shellFor(project, { roof: 'gable', facade, stableCellIds: false }).cells).toEqual(direct.cells);
    expect(ohneId(shellFor(project, { roof: 'gable', facade, stableCellIds: true }).cells)).toEqual(ohneId(direct.cells));
    expect(viaPipeline.cells.some((c) => c.kind === 'facade')).toBe(true);
  });

  it('ohne Optionen kein Außenprofil', () => {
    expect(shellFor(sampleHouse('1.21.11', 'medieval'), { roof: 'gable' }).cells.some((c) => c.kind === 'facade')).toBe(false);
  });
});

describe('shellFor reicht Anbauten (annexes) durch', () => {
  it('Treppenturm an der Nordwand: gleiche Hülle wie deriveShell, Öffnung wird Tür', () => {
    const project = sampleHouse('1.21.11', 'medieval'); // Räume x 0–22, z 0–11
    const tower: ShellAnnex = { id: 'turm', footprint: CellSet.rect(2, -5, 6, -1), top: 8, openings: [{ floorIndex: 0, at: [4, 0] }] };
    const via = shellFor(project, { roof: 'gable', annexes: [tower] });
    const ohneId = (cells: typeof via.cells): unknown => cells.map(({ id: _id, ...rest }) => rest);
    expect(ohneId(via.cells)).toEqual(ohneId(deriveShell(project.state, { roof: 'gable', annexes: [tower] }).cells));
    expect(via.annexes?.map((a) => a.id)).toEqual(['turm']);
    expect(via.cells).not.toEqual(shellFor(project, { roof: 'gable' }).cells);
  });
});
