/**
 * FN-Crafting (plan/spikes/FN_produktionslinien.md): die Produktionslinien-Komponenten (`functional/fn_line_*`,
 * `work/fn_*`) materialisieren in allen Themes, beiden Zielversionen und allen Posen ohne Verstoß; Crafter-Ausrichtung,
 * Verzauberungs-Regale (nur echte Positionen) und Brau-Straße (kein Trichter unter dem Braustand) werden nachgemessen.
 */
import type { RoomShellInfo, Shell, ShellCell } from '@mcda/blueprint';
import { CellSet, type Mirror, type Quarter, type Vec3 } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { materialize, type MaterializePlacement, type MaterializeResult } from '../src/index.js';
import { THEME_IDS, VERSIONS, catalog, place, platformView, themes } from './fixtures.js';

/** Die sechs Crafting-Komponenten; andere FN-Zweige nutzen `work/fn_*` ebenfalls (eigene Tests dort). */
const LINE_IDS: ReadonlySet<string> = new Set([
  'work/fn_enchant_study', 'work/fn_scribe_fletch_corner', 'work/fn_smith_corner',
]);
const FN = catalog.all().filter((d) => d.id.startsWith('functional/fn_line_') || LINE_IDS.has(d.id));
const POSES: readonly (readonly [Quarter, Mirror])[] = [[0, 'none'], [1, 'none'], [2, 'none'], [3, 'none'], [1, 'x'], [2, 'z']];

function floorShell(size = 12): Shell {
  const cells: ShellCell[] = [];
  for (let x = -1; x <= size; x++) for (let z = -1; z <= size; z++) cells.push({ pos: [x, 0, z], kind: 'floor', role: 'floor_primary', shape: 'block', roomId: 'r1' });
  const info: RoomShellInfo = { roomId: 'r1', floorIndex: 0, baseY: 1, height: 5, interior: CellSet.rect(-1, -1, size, size), doors: [], windows: [] };
  return { cells, rooms: new Map([['r1', info]]), warnings: [] };
}

function run(pl: MaterializePlacement, version: string, theme = 'medieval'): MaterializeResult {
  return materialize({ shell: floorShell(), placements: [pl], theme: themes.get(theme), platform: platformView(version), seed: 5 });
}

function blocksOf(r: MaterializeResult, owner: string) {
  return r.volume.cellsOf(owner).map((c) => ({ pos: c.pos as Vec3, name: c.state.name, props: c.state.properties }));
}

describe('FN-Produktionslinien: Katalog', () => {
  it('alle sechs Komponenten sind da', () => {
    expect(FN.map((d) => d.id).sort()).toEqual([
      'functional/fn_line_autocrafter', 'functional/fn_line_bakery', 'functional/fn_line_brew_street',
      'work/fn_enchant_study', 'work/fn_scribe_fletch_corner', 'work/fn_smith_corner',
    ]);
  });
  it('alle tragen ein Tag mit Präfix fn_ (keine Kollision mit bestehenden Raumtypen)', () => {
    for (const d of FN) expect(d.tags.some((t) => t.startsWith('fn_')), d.id).toBe(true);
  });
});

describe('FN-Produktionslinien: Materialisierung', () => {
  for (const version of VERSIONS) {
    it(`${version}: jede Variante × Theme × Pose ohne Verstöße mit gültigen Zuständen`, () => {
      const reg = platformView(version).registry;
      let n = 0;
      for (const def of FN) {
        for (const variant of def.variants?.map((v) => v.id) ?? [undefined]) {
          for (const theme of THEME_IDS) {
            for (const [rot, mirror] of POSES) {
              const where = `${def.id}#${variant ?? '-'} ${theme} rot${rot} ${mirror}`;
              const r = run(place('c', def.id, [1, 1, 1], rot, variant, mirror), version, theme);
              // Wandrahmen: rotations backToWall sichert die Rückwand; die Testfläche hat keine Wände
              expect(r.violations.filter((v) => v.kind !== 'spawn' && v.kind !== 'entity_support'), where).toEqual([]);
              for (const c of r.volume.cellsOf('c')) expect(reg.isValidState(c.state.name, c.state.properties, { complete: true }), where).toBe(true);
              n++;
            }
          }
        }
      }
      expect(n).toBeGreaterThan(300);
    });
  }
});

describe('FN-Produktionslinien: Mechanik-Nachmessung', () => {
  it('Autocrafter: Crafter zeigt waagerecht (Auswurf), vor der Auswurfseite der Ausgabe-Trichter, über dem Crafter ein Knopf', () => {
    const dirs: Record<string, Vec3> = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };
    for (const version of VERSIONS) {
      for (const variant of ['single', 'pair', 'quad']) {
        for (const [rot, mirror] of POSES) {
          const bs = blocksOf(run(place('c', 'functional/fn_line_autocrafter', [1, 1, 1], rot, variant, mirror), version), 'c');
          const crafters = bs.filter((b) => b.name === 'crafter');
          expect(crafters.length, variant).toBe(variant === 'single' ? 1 : variant === 'pair' ? 2 : 4);
          for (const c of crafters) {
            const o = c.props['orientation'] ?? '';
            expect(o, `${variant} ${rot}${mirror}`).toMatch(/^(north|south|east|west)_up$/);
            const out = dirs[o.split('_')[0]!]!;
            const front = bs.find((b) => b.pos[0] === c.pos[0] + out[0] && b.pos[1] === c.pos[1] && b.pos[2] === c.pos[2] + out[2]);
            expect(front?.name, `${variant} ${rot}${mirror}: vor dem Crafter steht der Ausgabe-Trichter`).toBe('hopper');
            expect(front?.props['facing'], `${variant} ${rot}${mirror}`).toBe('down');
            const above = bs.find((b) => b.pos[0] === c.pos[0] && b.pos[1] === c.pos[1] + 1 && b.pos[2] === c.pos[2]);
            expect(above?.name, `${variant}: über dem Crafter ein Knopf`).toMatch(/button$/);
          }
        }
      }
    }
  });

  it('Brau-Straße: unter keinem Braustand liegt ein Trichter', () => {
    for (const version of VERSIONS) {
      for (const variant of ['duo', 'trio', 'quad']) {
        for (const [rot, mirror] of POSES) {
          const bs = blocksOf(run(place('c', 'functional/fn_line_brew_street', [1, 1, 1], rot, variant, mirror), version), 'c');
          const stands = bs.filter((b) => b.name === 'brewing_stand');
          expect(stands.length, variant).toBe(variant === 'duo' ? 2 : variant === 'trio' ? 3 : 4);
          for (const s of stands) {
            const below = bs.find((b) => b.pos[0] === s.pos[0] && b.pos[1] === s.pos[1] - 1 && b.pos[2] === s.pos[2]);
            expect(below?.name, 'unter dem Braustand').not.toBe('hopper');
          }
        }
      }
    }
  });

  it('Verzauberungs-Studie: der Tisch sieht nur echte Regale (Abstand 2, Zwischenzelle frei), höchstens 15, der Ring genau 15', () => {
    for (const variant of ['ring', 'study', 'library']) {
      for (const [rot, mirror] of POSES) {
        const bs = blocksOf(run(place('c', 'work/fn_enchant_study', [1, 1, 1], rot, variant, mirror), '26.3'), 'c');
        const table = bs.find((b) => b.name === 'enchanting_table');
        expect(table, variant).toBeDefined();
        const at = (x: number, y: number, z: number) => bs.find((b) => b.pos[0] === x && b.pos[1] === y && b.pos[2] === z);
        const [tx, ty, tz] = table!.pos;
        let count = 0;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
          for (const dy of [0, 1]) {
            if (at(tx + dx, ty + dy, tz + dz)?.name !== 'bookshelf') continue;
            // Zwischenzelle (Vanilla: halbes Offset) muss frei sein; im Bauteil ist "frei" = kein Block gesetzt
            if (at(tx + Math.trunc(dx / 2), ty + dy, tz + Math.trunc(dz / 2)) === undefined) count++;
          }
        }
        expect(count, `${variant} ${rot}${mirror}`).toBeLessThanOrEqual(15);
        if (variant === 'ring') expect(count, `${variant} ${rot}${mirror}`).toBe(15);
        else expect(count, `${variant} ${rot}${mirror}`).toBeGreaterThanOrEqual(10);
      }
    }
  });
});
