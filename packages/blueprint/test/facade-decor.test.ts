/**
 * F1-Deko des Außenprofil-Passes (research/16 W4): offene Falltür-Paneele in der Brüstungsreihe unter Fenstern und
 * Streben als Treppe vor der Giebelwand. Ohne `facade.decor` bleibt die Hülle zellgleich; die bewusste Ausnahme
 * „vor Fenstern liegt nie etwas“ gilt nur, wo `panels` an ist (dieselbe Zelle, die vorher frei bleiben musste).
 */
import { describe, expect, it } from 'vitest';
import { CellSet, type HorizontalDir, type Vec3 } from '@mcda/core';
import { OPP, STEP } from '../src/shell/grid.js';
import { exteriorModel } from '../src/shell/anchors.js';
import { Project, TARGET_VERSIONS, deriveShell, type FacadeDecor, type FacadeStyle, type RoofStyle, type Shell, type ShellCell } from '../src/index.js';

const ROOFS: readonly RoofStyle[] = ['hip', 'gable', 'flat'];
const GABLE_BRACES = 3;
const DECOR: FacadeDecor = { panels: true, gableBraces: GABLE_BRACES };
const ALL: FacadeStyle = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4, decor: DECOR };

/** Eingeschossiges Beispielhaus (wie die Pipeline). */
function oneStory(): Project {
  const p = Project.create({ id: 'p', name: 'Haus', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
  p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
  return p;
}

/** Zweistöckig: Fachwerk-OG über Stein-EG (Giebel und Paneele in beiden Etagen). */
function twoStory(): Project {
  const p = oneStory();
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 8, 6), 'bedroom');
  p.paintRoom(1, CellSet.rect(9, 0, 14, 6), 'alchemy');
  p.paintRoom(1, CellSet.rect(0, 7, 14, 11), 'library');
  p.placeStairs(0, [3, 10], 'east');
  return p;
}

const FIXTURES: ReadonlyArray<readonly [string, () => Project]> = [['eingeschossig', oneStory], ['zweistöckig', twoStory]];
const cells = (s: Shell): readonly ShellCell[] => s.cells.filter((c) => c.kind === 'facade');
/** Deko des Themes (Rolle des Anbaus), ohne Sockel/Gesims/Konsolen des Außenprofils. */
const decorOf = (s: Shell): readonly ShellCell[] => cells(s).filter((c) => c.role === 'beam' && (c.shape === 'trapdoor' || c.shape === 'stairs'));
const alongOf = (d: HorizontalDir): HorizontalDir => (d === 'north' || d === 'south' ? 'east' : 'south');
/**
 * Giebelstrebe: die Deko-Treppe mit `half: bottom` an einer Giebelwand. Wandvorlagen liegen eine Etage tiefer, ihre
 * Köpfe haben `half: top`; Sockel, Gesims und Konsolen tragen andere Rollen.
 */
const isGableBrace = (c: ShellCell): boolean => c.shape === 'stairs' && c.orient?.half === 'bottom';
describe('F1-Deko des Außenprofil-Passes (W4)', () => {
  it('ohne decor zellgleich, mit leerem decor unverändert; Determinismus', () => {
    for (const [name, make] of FIXTURES) {
      for (const roof of ROOFS) {
        const where = `${name}/${roof}`;
        const plain = deriveShell(make().state, { roof });
        expect(deriveShell(make().state, { roof, facade: { decor: {} } }).cells, where).toEqual(plain.cells);
        expect(deriveShell(make().state, { roof, facade: ALL }).cells.length, where).toBeGreaterThan(plain.cells.length);
        expect(deriveShell(make().state, { roof, facade: ALL }), `${where}: deterministisch`).toEqual(deriveShell(make().state, { roof, facade: ALL }));
      }
    }
  });

  it('Paneele: genau eine offene Falltür je Fensterspalte in der Brüstungsreihe darunter, flach an der Wand, in Außenluft (W2 F5: nie vor Glas)', () => {
    for (const [name, make] of FIXTURES) {
      for (const roof of ROOFS) {
        const where = `${name}/${roof}`;
        const plain = deriveShell(make().state, { roof });
        const full = deriveShell(make().state, { roof, facade: ALL });
        const m = exteriorModel(plain);
        // ein Paneel je Fensterspalte (Fensteranker decken mit `span` mehrere Spalten ab), eine Reihe unter der untersten
        // Scheibe vor der Brüstungswand – W2 (Baustandard F5): nie vor der Scheibe selbst
        const wanted = new Set<string>();
        for (const a of (plain.anchors ?? []).filter((x) => x.kind === 'window')) {
          for (let j = 0; j < (a.span ?? 1); j++) {
            const x = a.pos[0] + STEP[alongOf(a.facing)][0] * j;
            const z = a.pos[2] + STEP[alongOf(a.facing)][1] * j;
            const back = plain.cells.find((c) => c.pos[0] === x - STEP[a.facing][0] && c.pos[1] === a.pos[1] - 1 && c.pos[2] === z - STEP[a.facing][1]);
            if (back?.kind === 'wall' || back?.kind === 'pillar') wanted.add(`${x},${a.pos[1] - 1},${z}`);
          }
        }
        expect(wanted.size, `${where}: Brüstung unter den Fenstern`).toBeGreaterThan(0);
        const panels = decorOf(full).filter((c) => c.shape === 'trapdoor');
        expect(new Set(panels.map((c) => `${c.pos[0]},${c.pos[1]},${c.pos[2]}`)), `${where}: ein Paneel je Fensterspalte`).toEqual(wanted);
        for (const p of panels) {
          expect(p.role, where).toBe('beam');
          // offen, Rücken zur Wand: `facing` zeigt von der Wand weg, `half` oben, `open` gesetzt
          expect(p.orient, where).toMatchObject({ open: true, half: 'top' });
          expect(m.isAir(p.pos), `${where}: Paneel ${p.pos} nicht in Außenluft`).toBe(true);
          const behind = full.cells.find((c) => c.kind !== 'facade' && c.pos[1] === p.pos[1]
            && Math.abs(c.pos[0] - p.pos[0]) + Math.abs(c.pos[2] - p.pos[2]) === 1 && c.kind === 'window');
          expect(behind, `${where}: Paneel ${p.pos} vor einer Scheibe`).toBeUndefined();
          expect(p.exterior, where).toBe(true);
        }
      }
    }
  });

  it('Türen und Türwege bleiben frei (Paneele nur unter Fenstern)', () => {
    for (const [name, make] of FIXTURES) {
      const where = name;
      const plain = deriveShell(make().state, { roof: 'gable' });
      const full = deriveShell(make().state, { roof: 'gable', facade: ALL });
      const facAt = new Set(cells(full).map((c) => `${c.pos[0]},${c.pos[1]},${c.pos[2]}`));
      for (const a of (plain.anchors ?? []).filter((x) => x.kind === 'door')) {
        // Türzelle (auf Bodenplattenhöhe bis Kopf) und ein Block Weg davor bleiben frei
        for (let y = a.pos[1] - 1; y <= a.pos[1] + 1; y++) {
          for (const k of [0, 1]) {
            const p: Vec3 = [a.pos[0] + STEP[a.facing][0] * k, y, a.pos[2] + STEP[a.facing][1] * k];
            expect(facAt.has(`${p[0]},${p[1]},${p[2]}`), `${where}: Türweg ${p} belegt`).toBe(false);
          }
        }
      }
    }
  });

  it('Giebelstreben: Takt 3 ab dem Giebelanker, Rücken zur Wand, nie vor Fenstern', () => {
    for (const [name, make] of FIXTURES) {
      for (const roof of ['gable', 'hip'] as const) {
        const where = `${name}/${roof}`;
        const plain = deriveShell(make().state, { roof });
        const full = deriveShell(make().state, { roof, facade: ALL });
        const braces = decorOf(full).filter(isGableBrace);
        const gables = (plain.anchors ?? []).filter((a) => a.kind === 'gable');
        if (gables.length === 0) {
          expect(braces, `${where}: keine Giebel, keine Streben`).toEqual([]);
          continue;
        }
        expect(braces.length, where).toBeGreaterThan(0);
        for (const b of braces) {
          expect(b.role, where).toBe('beam');
          expect(b.orient, `${where}: Strebe ${b.pos}`).toMatchObject({ half: 'bottom' });
          expect(b.orient?.open, where).toBeUndefined();
          expect(exteriorModel(plain).isAir(b.pos), `${where}: Strebe ${b.pos} nicht in Außenluft`).toBe(true);
        }
        // jede Strebe steht in Außenluft vor einer Wandzelle: dahinter (in Blickrichtung, also zur Wand) liegt Wand
        for (const b of braces) {
          const f = b.orient!.facing!;
          const wall: Vec3 = [b.pos[0] + STEP[f][0], b.pos[1], b.pos[2] + STEP[f][1]];
          const behind = plain.cells.find((c) => c.pos[0] === wall[0] && c.pos[1] === wall[1] && c.pos[2] === wall[2]);
          expect(behind, `${where}: Strebe ${b.pos} ohne Wand dahinter (${wall})`).toBeDefined();
        }
      }
    }
  });

  it('Takt steuert die Zahl der Giebelstreben; 0 = keine', () => {
    const p = oneStory();
    const count = (gableBraces: number): number => decorOf(deriveShell(p.state, { roof: 'gable', facade: { decor: { panels: false, gableBraces } } })).length;
    expect(count(0)).toBe(0);
    expect(count(2)).toBeGreaterThan(count(4));
    expect(count(3)).toBeGreaterThan(count(6));
  });
});
