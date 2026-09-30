/**
 * K8 (research/30): stabile Zell-`id` – Identität unabhängig vom Ort. Ohne `ShellOptions.stableCellIds` trägt
 * keine Zelle eine `id` (alles bleibt bitgleich); mit dem Schalter stammen die Nummern aus der **Reihenfolge**
 * innerhalb der Zellgruppe, nicht aus Koordinaten – ein verschobenes Haus behält sie also.
 *
 * Ehrlich gemessen: Die **Zell-id** ist verschiebungsinvariant, die **Hüllenform** ist es nicht immer – ein
 * Verschieben in z kann die Haustür auf eine andere Wand legen (siehe letzter Test). Für „Textur bleibt beim
 * Umbau stehen" müsste auch die Tür-/Fensterwahl ortsunabhängig werden (offen, research/30 §K8).
 */
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, assignCellIds, deriveShell } from '../src/index.js';

const ROOF = { roof: 'gable' } as const;

/** Haus mit zwei Räumen, um `dx`/`dz` verschoben. */
function house(dx = 0, dz = 0): Project {
  const p = Project.create({ id: 's', name: 'S', seed: 4, themeId: 'timber', targetVersion: TARGET_VERSIONS['26.3'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0 + dx, 0 + dz, 8 + dx, 6 + dz), 'kitchen');
  p.paintRoom(0, CellSet.rect(9 + dx, 0 + dz, 14 + dx, 6 + dz), 'bedroom');
  return p;
}

/** Zellen der Hülle mit **relativem** Schlüssel → `id`. */
const idMap = (dx = 0, dz = 0): Map<string, number> => {
  const shell = deriveShell(house(dx, dz).state, { ...ROOF, stableCellIds: true });
  return new Map(shell.cells.map((c) => [`${c.pos[0] - dx},${c.pos[1]},${c.pos[2] - dz}|${c.kind}|${c.role}|${c.shape}`, c.id!]));
};

describe('K8: stabile Zell-IDs', () => {
  it('ohne Option keine `id` – Hülle bleibt wie vorher', () => {
    const shell = deriveShell(house().state, ROOF);
    expect(shell.cells.length).toBeGreaterThan(50);
    expect(shell.cells.every((c) => c.id === undefined)).toBe(true);
    expect(deriveShell(house().state, ROOF).cells).toEqual(shell.cells);
  });

  it('mit Option trägt jede Zelle eine `id`, einmalig je Gruppe', () => {
    const shell = deriveShell(house().state, { ...ROOF, stableCellIds: true });
    expect(shell.cells.every((c) => c.id !== undefined)).toBe(true);
    const gruppen = new Map<string, number[]>();
    for (const c of shell.cells) {
      const k = `${c.kind}|${c.role}|${c.roomId ?? '-'}|${c.shape}`;
      gruppen.set(k, [...(gruppen.get(k) ?? []), c.id!]);
    }
    for (const [k, ids] of gruppen) {
      expect(new Set(ids).size, `${k} hat doppelte IDs`).toBe(ids.length);
      expect([...ids].sort((a, b) => a - b)).toEqual([...Array(ids.length).keys()]);
    }
  });

  it('`assignCellIds` ist verschiebungsinvariant (reine Zuordnung)', () => {
    const shell = deriveShell(house().state, ROOF);
    const ids = new Map(shell.cells.map((c) => [c.pos.join(','), c.id ?? -1]));
    const verschoben = { ...shell, cells: shell.cells.map((c) => ({ ...c, pos: [c.pos[0] + 3, c.pos[1], c.pos[2] + 5] as const })) };
    const a = assignCellIds(shell);
    const b = assignCellIds(verschoben);
    const map = (s: typeof a): Map<string, number> => new Map(s.cells.map((c) => [c.pos.join(','), c.id!]));
    for (const [pos, id] of map(a)) {
      const [x, y, z] = pos.split(',').map(Number) as [number, number, number];
      expect(map(b).get([x + 3, y, z + 5].join(',')), `Zelle ${pos}`).toBe(id);
    }
    // und die Vergabe hängt nicht an der Reihenfolge der Zellen
    const verdreht = assignCellIds({ ...shell, cells: [...shell.cells].reverse() });
    expect(map(verdreht)).toEqual(map(a));
    void ids;
  });

  it('Verschieben ändert keine `id`, solange die Hüllenform gleich bleibt', () => {
    const basis = idMap();
    for (const [dx, dz] of [[3, 0], [-7, 4]] as const) {
      const verschoben = idMap(dx, dz);
      expect([...verschoben.keys()].sort()).toEqual([...basis.keys()].sort());
      for (const [k, id] of basis) expect(verschoben.get(k), `${k} nach (${dx},${dz})`).toBe(id);
    }
  });

  it('Grenze: die Hüllenform ist nicht immer verschiebungsinvariant (Türwahl hängt am Ort)', () => {
    // Gemessen: +5 in z legt die Haustür auf eine andere Wand → 6 Zellen unterscheiden sich. Für jeden
    // gemeinsamen Zellschlüssel stimmt die `id` trotzdem; das ist die Aussage von K8, mehr nicht.
    const basis = idMap();
    const verschoben = idMap(0, 5);
    const gemeinsam = [...basis.keys()].filter((k) => verschoben.has(k));
    expect(gemeinsam.length).toBe(basis.size - 6);
    for (const k of gemeinsam) expect(verschoben.get(k)).toBe(basis.get(k));
  });
});
