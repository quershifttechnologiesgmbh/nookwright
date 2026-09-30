/**
 * W5-B (Review W4-R N2, plan/spikes/W5B_burg.md): Rahmenrolle der Hülle (`FacadeStyle.frameRole`). Ohne das Feld setzt die
 * Hülle nur die Ecken von Bank und Sturz in `window_frame` (zellgleich zu vorher); mit dem Feld Bank und Sturz über die
 * ganze Breite in der gewählten Rolle – der Rahmen ist aus einem Material, kein Holz mehr am Stein-Turmschaft.
 */
import { describe, expect, it } from 'vitest';
import { CellSet, key3, type HorizontalDir, type Vec3 } from '@mcda/core';
import { FRAME_ROLES, Project, TARGET_VERSIONS, deriveShell, type FacadeStyle, type Shell, type ShellCell } from '../src/index.js';
import { FACADE_QUALITY_RULES } from '../src/shell/facade.js';
import { STEP, axisOf } from '../src/shell/grid.js';

function house(): Project {
  const p = Project.create({ id: 'p', name: 'Haus', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  p.addFloor({ height: 3 });
  p.paintRoom(1, CellSet.rect(0, 0, 14, 6), 'bedroom');
  return p;
}

const shell = (p: Project, facade: FacadeStyle): Shell => deriveShell(p.state, { roof: 'gable', overhang: 1, facade });
const BASE: FacadeStyle = { plinthProfile: true, cornice: true, quoins: true, rules: FACADE_QUALITY_RULES };

/** Bank- und Sturzreihe vor jeder Scheibe (Spalten −1 … span): die Zellen der Hülle dort. */
function frameRows(s: Shell): { cells: (ShellCell | undefined)[]; windows: number } {
  const byPos = new Map(s.cells.map((c) => [key3(c.pos), c] as const));
  const cells: (ShellCell | undefined)[] = [];
  let windows = 0;
  for (const a of (s.anchors ?? []).filter((x) => x.kind === 'window')) {
    const back: Vec3 = [a.pos[0] - STEP[a.facing][0], a.pos[1], a.pos[2] - STEP[a.facing][1]];
    let h = 0;
    while (byPos.get(key3([back[0], back[1] + h, back[2]]))?.kind === 'window') h++;
    const along: HorizontalDir = axisOf(a.facing) === 'z' ? 'east' : 'south';
    windows++;
    for (let j = -1; j <= (a.span ?? 1); j++) for (const dy of [-1, Math.max(1, h)]) {
      cells.push(byPos.get(key3([a.pos[0] + STEP[along][0] * j, a.pos[1] + dy, a.pos[2] + STEP[along][1] * j])));
    }
  }
  return { cells, windows };
}

describe('W5-B Rahmenrolle der Hülle (FacadeStyle.frameRole)', () => {
  it('ohne frameRole: ohne Raster nur Ecken in window_frame, die Mitte bleibt frei für das Fenstermodul', () => {
    // W7 (27.09.2026, plan/spikes/W7A_ruhe.md): ohne Fassadenraster wie bisher (Ecken der Hülle)
    const s = shell(house(), { ...BASE, rules: { ...FACADE_QUALITY_RULES, grid: false } });
    const frames = s.cells.filter((c) => c.kind === 'facade' && c.role === 'window_frame');
    expect(frames.length).toBeGreaterThan(0);
    const { cells, windows } = frameRows(s);
    expect(windows).toBeGreaterThan(4);
    // Die Mitte (über/unter der Scheibe) ist leer – sonst hätte das Modul keinen Platz
    const mid = cells.filter((c) => c?.kind === 'facade' && c.role === 'window_frame').length;
    expect(mid).toBeLessThan(cells.length);
  });

  it('W7: mit Fassadenraster und ohne frameRole setzt die Hülle keine Rahmen-Ecken – Bank und Sturz ganz aus dem Fenstermodul', () => {
    // Eine Quelle je Rahmen: das Modul setzt Ecken und Mitte (App-Schalter „Bank“/„Sturz“ schalten den ganzen Rahmen,
    // F6 fällt ohne Ecken-Stummel zurück, im engen Feld darf das Modul schmal bleiben)
    const s = shell(house(), BASE);
    const { cells, windows } = frameRows(s);
    expect(windows).toBeGreaterThan(4);
    expect(cells.filter((c) => c?.kind === 'facade' && c.role === 'window_frame')).toHaveLength(0);
  });

  it('mit frameRole wall_cornice: Bank und Sturz über die ganze Breite in der Rolle, kein window_frame mehr', () => {
    const p = house();
    const s = shell(p, { ...BASE, frameRole: 'wall_cornice' });
    expect(s.cells.filter((c) => c.kind === 'facade' && c.role === 'window_frame')).toHaveLength(0);
    const { cells } = frameRows(s);
    const framed = cells.filter((c) => c?.kind === 'facade' && c.role === 'wall_cornice');
    // Jede freie Zelle der Bank- und Sturzreihe ist Rahmen (belegte: Gesims, Sockel, Wand – bleiben unangetastet)
    expect(framed.length).toBeGreaterThan(cells.filter((c) => c === undefined).length);
    expect(cells.filter((c) => c === undefined)).toHaveLength(0);
    // Formen wie das Fenstermodul: Bank = obere Stufe, Sturz = umgedrehte Treppe
    for (const c of framed) expect(['slab', 'stairs']).toContain(c!.shape);
  });

  it('nie auf oder vor der Scheibe; sonst zellgleich bis auf die Rahmenrolle und die Mitte', () => {
    const p = house();
    const plain = shell(p, BASE);
    const s = shell(p, { ...BASE, frameRole: 'wall_cornice' });
    const windows = new Set(s.cells.filter((c) => c.kind === 'window').map((c) => key3(c.pos)));
    const anchors = new Set((s.anchors ?? []).filter((a) => a.kind === 'window').map((a) => key3(a.pos)));
    for (const c of s.cells.filter((x) => x.kind === 'facade' && x.role === 'wall_cornice')) {
      expect(windows.has(key3(c.pos))).toBe(false);
      expect(anchors.has(key3(c.pos))).toBe(false);
    }
    // Alle Zellen außer Rahmen und Gesims (beide `wall_cornice`) sind gleich
    const strip = (x: Shell): string[] => x.cells.filter((c) => !(c.kind === 'facade' && (c.role === 'window_frame' || c.role === 'wall_cornice')))
      .map((c) => `${key3(c.pos)}=${c.kind}/${c.role}/${c.shape}`).sort();
    expect(strip(s)).toEqual(strip(plain));
    // Die Ecken liegen an denselben Stellen wie ohne Rahmenrolle
    const corners = plain.cells.filter((c) => c.kind === 'facade' && c.role === 'window_frame').map((c) => key3(c.pos));
    const roles = new Map(s.cells.map((c) => [key3(c.pos), c.role] as const));
    for (const k of corners) expect(roles.get(k)).toBe('wall_cornice');
  });

  it('window_frame ausdrücklich: ganze Breite im Rahmenholz des Themes', () => {
    const s = shell(house(), { ...BASE, frameRole: 'window_frame' });
    const { cells } = frameRows(s);
    expect(cells.filter((c) => c === undefined)).toHaveLength(0);
    expect(FRAME_ROLES).toEqual(['window_frame', 'wall_cornice']);
  });

  it('ohne Pflichtregel Fensterrahmen wirkt frameRole nicht (Hülle zellgleich)', () => {
    const p = house();
    const off = { plinthProfile: true, cornice: true } satisfies FacadeStyle;
    expect(JSON.stringify(shell(p, { ...off, frameRole: 'wall_cornice' }).cells)).toBe(JSON.stringify(shell(p, off).cells));
  });
});
