/**
 * Angedockte Bauwerke (B2, research/18 T1 Eckturm / T3 Treppenturm): nur der Hüllen-Teil – Aussparung im Dach, Türen
 * an den Öffnungen, Wände am Anbau ohne Tür/Fenster, Außenmodell hält den Grundriss frei, Treppenturm verbindet Etagen.
 */
import { describe, expect, it } from 'vitest';
import { CellSet, key3 } from '@mcda/core';
import { deriveShell, type RoofStyle, type Shell, type ShellAnnex, type ShellOptions } from '../src/index.js';
import { halfLeaks } from './support/leaks.js';
import { rooms } from './support/houses.js';

const PITCHED: readonly RoofStyle[] = ['hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox'];
const FACADE = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4 };

/** Zweistöckig ohne Treppe im Haus; 5 × 5-Treppenturm an der Ostwand, Türen auf beiden Etagen. */
const house = () => rooms([[0, 0, 7, 8, 'kitchen'], [8, 0, 14, 8, 'storage']], [[0, 0, 14, 8, 'bedroom']]);
const TOWER: ShellAnnex = { id: 'turm', footprint: CellSet.rect(15, 2, 19, 6), top: 12, openings: [{ floorIndex: 0, at: [14, 4] }, { floorIndex: 1, at: [14, 4] }] };
const inTower = (x: number, z: number): boolean => TOWER.footprint.has(x, z);
const touching = (x: number, z: number): boolean => !inTower(x, z) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => inTower(x + dx!, z + dz!));

describe('Anbau (Treppenturm/Eckturm): Hüllen-Teil', () => {
  it('Treppenturm: Türen hinein auf beiden Etagen, Obergeschoss darüber erreichbar, Tür in der Raumsicht', () => {
    const plain = deriveShell(house().state, { roof: 'gable' });
    expect(plain.warnings).toContain('Etage 1: keine Treppe führt hierher – Räume r3 sind nicht erreichbar');
    const s = deriveShell(house().state, { roof: 'gable', annexes: [TOWER] });
    expect(s.warnings).toEqual([]);
    expect(s.cells.filter((c) => c.kind === 'door' && c.pos[0] === 14).map((c) => `${key3(c.pos)}:${c.orient!.facing}/${c.orient!.half}`)).toEqual([
      '14,1,4:east/lower', '14,2,4:east/upper', '14,5,4:east/lower', '14,6,4:east/upper',
    ]);
    expect(s.rooms.get('r2')!.doors).toContainEqual({ inside: [13, 4], toward: 'east', isMain: false });
    expect(s.rooms.get('r3')!.doors).toContainEqual({ inside: [13, 4], toward: 'east', isMain: false });
    expect(s.annexes).toEqual([{
      id: 'turm', footprint: TOWER.footprint, top: 12, contactTop: 13,
      doors: [{ floorIndex: 0, at: [14, 4], y: 1, facing: 'east' }, { floorIndex: 1, at: [14, 4], y: 5, facing: 'east' }],
    }]);
  });

  it('alle Dachformen mit Außenprofil: nichts im Grundriss (Zellen, Anker, Profil), keine Fenster/Türen zum Turm außer den Öffnungen, dicht', () => {
    for (const roof of [...PITCHED, 'flat'] as const) {
      for (const opts of [{}, { facade: FACADE, roofDetail: { trim: true, verge: 'closed' as const, gableWindows: true } }] as const) {
        const s: Shell = deriveShell(house().state, { roof, ...opts, annexes: [TOWER] } as ShellOptions);
        const where = `${roof} ${JSON.stringify(opts)}`;
        expect(s.cells.filter((c) => inTower(c.pos[0], c.pos[2])), where).toEqual([]);
        expect((s.anchors ?? []).filter((a) => inTower(a.pos[0], a.pos[2])), where).toEqual([]);
        // Wände am Turm: keine Fenster; Türen nur an den Öffnungen
        const wallsAtTower = s.cells.filter((c) => touching(c.pos[0], c.pos[2]) && c.pos[1] <= TOWER.top);
        expect(wallsAtTower.filter((c) => c.kind === 'window'), where).toEqual([]);
        expect(wallsAtTower.filter((c) => c.kind === 'door').every((c) => c.pos[0] === 14 && c.pos[2] === 4), where).toBe(true);
        if (roof !== 'flat') expect(halfLeaks(s), where).toEqual([]);
        const keys = s.cells.map((c) => key3(c.pos));
        expect(new Set(keys).size, where).toBe(keys.length);
        expect(JSON.stringify(deriveShell(house().state, { roof, ...opts, annexes: [TOWER] } as ShellOptions).cells), where).toBe(JSON.stringify(s.cells));
      }
    }
  });

  it('Aussparung: nur der Dachüberstand über dem Turm entfällt, das übrige Dach bleibt gleich', () => {
    for (const roof of PITCHED) {
      const plain = deriveShell(house().state, { roof });
      const s = deriveShell(house().state, { roof, annexes: [TOWER] });
      const roofOf = (x: Shell) => x.cells.filter((c) => c.kind === 'roof' || (c.kind === 'wall' && c.pos[1] > 8));
      const missing = roofOf(plain).filter((c) => !roofOf(s).some((d) => key3(d.pos) === key3(c.pos)));
      expect(missing.length, roof).toBeGreaterThan(0);
      expect(missing.every((c) => inTower(c.pos[0], c.pos[2])), roof).toBe(true);
    }
  });

  it('niedriger Anbau (Oberkante unter dem Obergeschoss): Fenster oben erlaubt, Dach oben nicht ausgespart', () => {
    const low: ShellAnnex = { id: 'schuppen', footprint: CellSet.rect(15, 2, 17, 6), top: 3, openings: [{ floorIndex: 0, at: [14, 4] }] };
    const p = rooms([[0, 0, 14, 8, 'kitchen']], [[0, 0, 14, 8, 'bedroom']], [3, 4]);
    const s = deriveShell(p.state, { roof: 'hip', annexes: [low] });
    expect(s.warnings).toEqual([]);
    expect(s.cells.some((c) => c.kind === 'door' && c.pos[0] === 14 && c.pos[1] === 1)).toBe(true);
    // Etage 1 (Wand ab y = 5 > 3): Ostwand wie ohne Anbau
    const east = (x: Shell) => x.cells.filter((c) => c.pos[0] === 14 && c.pos[1] >= 5).map((c) => `${key3(c.pos)}:${c.kind}`);
    expect(east(s)).toEqual(east(deriveShell(p.state, { roof: 'hip' })));
    expect(s.cells.some((c) => c.kind === 'roof' && low.footprint.has(c.pos[0], c.pos[2]))).toBe(true); // Überstand oben bleibt
  });

  it('ungültig: über Räumen oder ohne Kontakt → ignoriert mit Warnung, Hülle wie ohne Anbau; falsche Öffnung → nur sie entfällt', () => {
    const plain = deriveShell(house().state, { roof: 'gable' });
    for (const [bad, text] of [
      [{ id: 'a', footprint: CellSet.rect(12, 2, 16, 6), top: 12 }, 'Anbau a: Grundriss leer oder über Räumen – ignoriert'],
      [{ id: 'b', footprint: CellSet.rect(17, 2, 19, 6), top: 12 }, 'Anbau b berührt das Haus nicht – ignoriert'],
    ] as const) {
      const s = deriveShell(house().state, { roof: 'gable', annexes: [bad] });
      expect(s.warnings).toEqual([text, ...plain.warnings]);
      expect(s.annexes).toEqual([]);
      expect(JSON.stringify(s.cells)).toBe(JSON.stringify(plain.cells));
    }
    const wrong: ShellAnnex = { ...TOWER, openings: [{ floorIndex: 0, at: [14, 8] }, { floorIndex: 0, at: [14, 4] }] };
    const s = deriveShell(house().state, { roof: 'gable', annexes: [wrong] });
    expect(s.warnings).toEqual([
      'Anbau turm: Öffnung bei 14,8 (Etage 0) ist keine gerade Außenwand zwischen Raum und Anbau – ignoriert',
      'Etage 1: keine Treppe führt hierher – Räume r3 sind nicht erreichbar', // nur noch eine Etage am Turm
    ]);
    expect(s.annexes![0]!.doors).toEqual([{ floorIndex: 0, at: [14, 4], y: 1, facing: 'east' }]);
  });
});
