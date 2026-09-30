/**
 * Feature Unterbau (feat/underground, DungeonGenerator_lernen.md §4.1 A2): Zusatztüren für Rundgänge
 * (`ShellOptions.loopDoors`). Ohne die Option bleibt der Türgraph ein Baum und die Hülle zellgleich; mit ihr bekommen
 * benachbarte, noch nicht verbundene Raumpaare eine Tür (Seed-Hash der Raum-Schlüssel), private Räume nie.
 */
import { describe, expect, it } from 'vitest';
import { CellSet, type HorizontalDir } from '@mcda/core';
import { Project, TARGET_VERSIONS, deriveShell, type Shell } from '../src/index.js';

const STEP: Record<HorizontalDir, readonly [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** 2 × 2 Räume à 7 × 7 (gemeinsame Wände), Typen im Uhrzeigersinn ab Nordwest. */
function grid(types: readonly [string, string, string, string], seed = 11): Project {
  const p = Project.create({ id: 'l', name: 'Rundgang', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 6, 6), types[0]);
  p.paintRoom(0, CellSet.rect(6, 0, 12, 6), types[1]);
  p.paintRoom(0, CellSet.rect(6, 6, 12, 12), types[2]);
  p.paintRoom(0, CellSet.rect(0, 6, 6, 12), types[3]);
  return p;
}

/** Raumpaare mit Innentür. */
function pairs(s: Shell): string[] {
  const byCell = new Map<string, string[]>();
  for (const r of s.rooms.values()) {
    for (const d of r.doors) {
      const k = `${d.inside[0] + STEP[d.toward][0]},${d.inside[1] + STEP[d.toward][1]}`;
      byCell.set(k, [...(byCell.get(k) ?? []), r.roomId]);
    }
  }
  return [...byCell.values()].filter((g) => g.length === 2).map((g) => [...g].sort().join('|')).sort();
}

describe('Zusatztüren für Rundgänge (loopDoors)', () => {
  const types = ['kitchen', 'dining_hall', 'library', 'study'] as const;

  it('ohne Option bzw. mit 0: Türbaum, Hülle zellgleich', () => {
    const p = grid(types);
    const plain = deriveShell(p.state, { roof: 'gable' });
    expect(pairs(plain)).toHaveLength(3);
    expect(JSON.stringify(deriveShell(p.state, { roof: 'gable', loopDoors: 0 }))).toBe(JSON.stringify(plain));
  });

  it('mit 1: alle vier Nachbarpaare verbunden – ein Rundgang, alle Räume erreichbar, keine Warnung', () => {
    const p = grid(types);
    const s = deriveShell(p.state, { roof: 'gable', loopDoors: 1 });
    expect(pairs(s)).toHaveLength(4);
    expect(s.warnings).toEqual([]);
    // jede Tür hat links und rechts Wand (keine Nachbartüren)
    const doorCells = s.cells.filter((c) => c.kind === 'door' && c.orient?.half === 'lower').map((c) => c.pos);
    for (const a of doorCells) {
      for (const b of doorCells) if (a !== b && a[1] === b[1]) expect(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[2] - b[2]))).toBeGreaterThan(1);
    }
  });

  it('private Räume (Schlafzimmer, Bad …) bekommen keine Zusatztür', () => {
    const p = grid(['kitchen', 'bedroom', 'library', 'washroom']);
    const plain = deriveShell(p.state, { roof: 'gable' });
    const s = deriveShell(p.state, { roof: 'gable', loopDoors: 1 });
    expect(pairs(s)).toEqual(pairs(plain));
  });

  it('deterministisch; die Wahrscheinlichkeit wirkt monoton (mehr Chance ⊇ weniger Chance)', () => {
    const counts = [0.1, 0.3, 0.6, 1].map((chance) => {
      let n = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const s = deriveShell(grid(types, seed).state, { roof: 'gable', loopDoors: chance });
        expect(JSON.stringify(deriveShell(grid(types, seed).state, { roof: 'gable', loopDoors: chance }))).toBe(JSON.stringify(s));
        n += pairs(s).length;
      }
      return n;
    });
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]!);
    expect(counts[3]).toBe(12 * 4);
  });
});
