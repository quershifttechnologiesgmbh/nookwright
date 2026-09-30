/**
 * W4-B „Bergfried und Zugang“ (plan/spikes/W4B_bergfried.md): Turmschaft ohne Band je Geschoss (`RoofDetail.plainShaft`)
 * und Dachluke mit Leiter (`RoofDetail.hatch`) am Turm neben der Halle (Flachdach, 4 Etagen, Leitern im Wechsel).
 * Ohne die Felder bleibt die Hülle bitgleich (shell-digest.test.ts); die Halle ändert sich nie.
 */
import { describe, expect, it } from 'vitest';
import { cellKey } from '@mcda/core';
import { deriveShell, type RoofDetail, type Shell, type ShellCell, type ShellOptions } from '../src/index.js';
import { towerAndHall } from './support/volumes.js';

const OPTS: ShellOptions = { roof: 'gable', roofDetail: { trim: true }, facade: { plinthProfile: true, cornice: true, quoins: true } };
const TOWER = { x0: 15, x1: 21, z0: 2, z1: 8 };
const inTower = (c: ShellCell): boolean => c.pos[0] >= TOWER.x0 - 1 && c.pos[0] <= TOWER.x1 + 1 && c.pos[2] >= TOWER.z0 - 1 && c.pos[2] <= TOWER.z1 + 1;

function shellWith(detail?: RoofDetail): { shell: Shell; tower: string } {
  const p = towerAndHall();
  const tower = p.state.volumes!.find((v) => v.name === 'Turm')!.id;
  if (detail !== undefined) p.changeVolume(tower, { name: 'Turm', roof: 'flat', roofDetail: detail });
  return { shell: deriveShell(p.state, OPTS), tower };
}

const k3 = (c: ShellCell): string => c.pos.join(',');
const byPos = (s: Shell): Map<string, ShellCell> => new Map(s.cells.map((c) => [k3(c), c]));

describe('Turmschaft (`plainShaft`): kein Band je Geschoss', () => {
  const plain = shellWith({ trim: true });
  const shaft = shellWith({ trim: true, plainShaft: true });
  const outerWall = (c: ShellCell): boolean =>
    (c.pos[0] === TOWER.x0 || c.pos[0] === TOWER.x1 || c.pos[2] === TOWER.z0 || c.pos[2] === TOWER.z1)
    && c.pos[0] >= TOWER.x0 && c.pos[0] <= TOWER.x1 && c.pos[2] >= TOWER.z0 && c.pos[2] <= TOWER.z1;

  it('Bodenplatten der Obergeschosse in der Außenwand in der Wandrolle, das Erdgeschoss (Sockel) wie bisher', () => {
    const plates = shaft.shell.cells.filter((c) => c.kind === 'floor' && outerWall(c) && c.pos[0] > TOWER.x0); // x0 = Brandwand zur Halle
    const ys = [...new Set(plates.map((c) => c.pos[1]))].sort((a, b) => a - b);
    expect(ys).toEqual([0, 4, 8, 12]);
    for (const c of plates) expect(c.role, k3(c)).toBe(c.pos[1] === 0 ? 'floor_primary' : 'wall_primary');
    // Innen (Raumfläche) bleibt Boden
    expect(shaft.shell.cells.filter((c) => c.kind === 'floor' && !outerWall(c) && c.pos[0] > TOWER.x0 && c.pos[0] < TOWER.x1 && c.role !== 'floor_primary')).toEqual([]);
  });

  it('kein Gesims und kein Anker `storey_line` am Turm; die Halle bleibt zellgleich', () => {
    const lines = (s: Shell): number => (s.anchors ?? []).filter((a) => a.kind === 'storey_line' && a.pos[0] >= TOWER.x0 - 1).length;
    expect(lines(plain.shell)).toBeGreaterThan(0);
    expect(lines(shaft.shell)).toBe(0);
    expect(shaft.shell.cells.filter((c) => c.role === 'wall_cornice' && c.kind === 'facade')).toEqual([]);
    const hall = (s: Shell): ShellCell[] => s.cells.filter((c) => !inTower(c));
    expect(hall(shaft.shell)).toEqual(hall(plain.shell));
  });

  it('Rand des Flachdachs als Steingesims (`wall_cornice`) statt Holzrand, gleiche Form', () => {
    const rim = (s: Shell, role: string): string[] => s.cells.filter((c) => c.kind === 'roof' && c.role === role && inTower(c) && c.pos[0] > TOWER.x0).map((c) => `${k3(c)}|${c.shape}|${JSON.stringify(c.orient)}`).sort();
    expect(rim(plain.shell, 'roof_trim').length).toBeGreaterThan(0);
    expect(rim(shaft.shell, 'roof_trim')).toEqual([]);
    expect(rim(shaft.shell, 'wall_cornice')).toEqual(rim(plain.shell, 'roof_trim'));
  });
});

describe('Dachluke (`hatch`): Leiter aus dem obersten Raum bis in die Dachplatte', () => {
  const plain = shellWith({ trim: true });
  const { shell } = shellWith({ trim: true, hatch: true });
  const top = [...shell.rooms.values()].find((r) => r.floorIndex === 3)!;
  const ceilingY = top.baseY + top.height;
  const ladder = shell.cells.filter((c) => c.shape === 'ladder' && c.pos[1] >= top.baseY);

  it('eine Leiterspalte von der untersten Luftreihe bis in die Dachplatte, dort keine Decke', () => {
    expect(shell.warnings).toEqual([]);
    const cols = new Set(ladder.map((c) => cellKey(c.pos[0], c.pos[2])));
    expect(cols.size).toBe(1);
    expect(ladder.map((c) => c.pos[1]).sort((a, b) => a - b)).toEqual(Array.from({ length: top.height + 1 }, (_, k) => top.baseY + k));
    const [x, , z] = ladder[0]!.pos;
    expect(shell.cells.some((c) => c.kind === 'ceiling' && c.pos[0] === x && c.pos[2] === z && c.pos[1] === ceilingY)).toBe(false);
    expect(top.interior.has(x, z)).toBe(true);
  });

  it('Mechanik: hinter jeder Leiterzelle eine Wand ohne Tür und Fenster (bzw. die Dachplatte), davor eine freie Zelle', () => {
    const m = byPos(shell);
    for (const c of ladder) {
      const f = c.orient!.facing!;
      const back: [number, number] = f === 'north' ? [0, 1] : f === 'south' ? [0, -1] : f === 'east' ? [-1, 0] : [1, 0];
      const behind = m.get(`${c.pos[0] + back[0]},${c.pos[1]},${c.pos[2] + back[1]}`);
      expect(behind?.kind, k3(c)).toBe(c.pos[1] === ceilingY ? 'ceiling' : 'wall');
    }
    const f = ladder[0]!.orient!.facing!;
    const step: [number, number] = f === 'north' ? [0, -1] : f === 'south' ? [0, 1] : f === 'east' ? [1, 0] : [-1, 0];
    const [x, , z] = ladder[0]!.pos;
    const access = top.stairs!.find((s) => s.linkId.startsWith('hatch:'));
    expect(access).toMatchObject({ inside: [x + step[0], z + step[1]], end: 'bottom' });
    expect(top.blocked!.has(x, z)).toBe(true);
    expect(top.blocked!.has(x + step[0], z + step[1])).toBe(false);
    // nicht auf Treppen-Austritt oder Deckenöffnung der Leiter von unten
    expect(top.stairs!.filter((s) => !s.linkId.startsWith('hatch:')).some((s) => s.inside[0] === x && s.inside[1] === z)).toBe(false);
  });

  it('sonst zellgleich; ohne Flachdach keine Luke', () => {
    const [x, , z] = ladder[0]!.pos;
    const other = (s: Shell): ShellCell[] => s.cells.filter((c) => !(c.pos[0] === x && c.pos[2] === z && c.pos[1] >= top.baseY && c.pos[1] <= ceilingY));
    expect(other(shell)).toEqual(other(plain.shell));
    const p = towerAndHall();
    const tower = p.state.volumes!.find((v) => v.name === 'Turm')!.id;
    p.changeVolume(tower, { name: 'Turm', roof: 'hip', roofDetail: { hatch: true } });
    expect(deriveShell(p.state, OPTS).cells.filter((c) => c.shape === 'ladder' && c.pos[1] >= top.baseY)).toEqual([]);
  });
});
