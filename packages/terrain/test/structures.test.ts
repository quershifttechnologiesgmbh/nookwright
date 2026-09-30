/**
 * I2 – Gelände und andere Kontexte: Bauwerke als Sperrfläche mit Durchgängen (Kontext Bauwerke) und das Gebäude
 * mit mehreren Etagen (auskragende Obergeschosse sind überdeckt, kein Fundament darunter).
 */
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, deriveShell } from '@mcda/blueprint';
import { CellSet, key3 } from '@mcda/core';
import { Site, buildingFromShell, generateSite, plotAround } from '../src/index.js';
import { TEST_STYLE, fullSite, syntheticBuilding } from './fixtures.js';

const building = syntheticBuilding(0); // Grundfläche 0..10 × 0..8, Haustür Nord bei (5, 0)
/** Mauerring 2 breit um das Haus (x −3..13, z −3..11), Tor im Norden (x 4..6) mit innerem Vorplatz (außen: Hof). */
const ring = CellSet.rect(-3, -3, 13, 11).difference(CellSet.rect(-1, -1, 11, 9));
const passages = CellSet.rect(4, -3, 6, -1);
const withRing = generateSite(fullSite().state, TEST_STYLE, building, { footprint: ring, passages });
const col = (x: number, z: number): string => `${x},${z}`;

describe('Gelände mit Bauwerken (Sperrfläche, Durchgänge)', () => {
  it('keine Pflanzen, Zäune oder Laternen auf den Bauwerksspalten (auch nicht in Durchgängen)', () => {
    expect(withRing.warnings).toEqual([]);
    const blocked = new Set([...ring, ...passages].map(([x, z]) => col(x, z)));
    const offending = withRing.cells.filter((c) => c.kind === 'plant' && blocked.has(col(c.pos[0], c.pos[2])));
    expect(offending.map((c) => `${c.role}@${c.pos}`)).toEqual([]);
  });

  it('Wege queren die Mauer nur durch den Durchgang; Haustür und Hof (außerhalb) sind verbunden', () => {
    const pass = new Set([...passages].map(([x, z]) => col(x, z)));
    const wall = new Set([...ring].filter(([x, z]) => !pass.has(col(x, z))).map(([x, z]) => col(x, z)));
    const paths = [...withRing.paths];
    expect(paths.filter(([x, z]) => wall.has(col(x, z)))).toEqual([]);
    expect(paths.some(([x, z]) => pass.has(col(x, z)))).toBe(true);
    // Hof (2..9 × −9..−4) liegt außerhalb des Rings und hat Pflaster
    expect(withRing.surface[withRing.grid.idx(5, -8)]).toBe('ground_yard');
  });

  it('Bäume halten Abstand ≥ 3 zu Bauwerken, Kronen hängen nicht über der Mauer', () => {
    const cells = [...ring];
    for (const t of withRing.trees) {
      const d = Math.min(...cells.map(([x, z]) => Math.max(Math.abs(x - t.base[0]), Math.abs(z - t.base[2]))));
      expect(d, `Baum ${t.base}`).toBeGreaterThanOrEqual(3);
    }
    const blocked = new Set(cells.map(([x, z]) => col(x, z)));
    expect(withRing.cells.filter((c) => c.role.startsWith('leaves') && blocked.has(col(c.pos[0], c.pos[2])))).toEqual([]);
  });

  it('Zonen auf Bauwerksspalten werden ausgelassen (mit Hinweis); Höhen bleiben natürlich (ohne Ring gleich)', () => {
    const s = fullSite();
    s.paintZone('field', CellSet.rect(10, 10, 15, 15)); // Feld überlappt die Südostecke des Rings
    const r = generateSite(s.state, TEST_STYLE, building, { footprint: ring, passages });
    expect(r.warnings.some((w) => /Bauwerk/.test(w))).toBe(true);
    const plain = generateSite(fullSite().state, TEST_STYLE, building);
    for (const [x, z] of ring) expect(withRing.top[withRing.grid.idx(x, z)], col(x, z)).toBe(plain.top[plain.grid.idx(x, z)]);
  });

  it('ist deterministisch', () => {
    const again = generateSite(fullSite().state, TEST_STYLE, building, { footprint: ring, passages });
    expect(JSON.stringify(again.cells)).toBe(JSON.stringify(withRing.cells));
  });
});

describe('Gebäude mit mehreren Etagen (F1): Fundament nur unter der untersten Etage', () => {
  // Erdgeschoss 0..8 × 0..6, Obergeschoss kragt nach Osten aus (x 9..11 = Balkon/Auskragung)
  const p = Project.create({ id: 'm', name: 'M', seed: 3, themeId: 'medieval', targetVersion: TARGET_VERSIONS['26.3'] });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 11, 6), 'bedroom');
  const shell = deriveShell(p.state, { roof: 'hip' });
  const b = buildingFromShell(shell);

  it('Grundfläche = Bodenplatte der untersten Etage; auskragende Etage ist überdeckt', () => {
    expect(b.y0).toBe(0);
    expect(b.footprint.size).toBe(9 * 7);
    expect(b.footprint.has(10, 3)).toBe(false);
    expect(b.covered.has(10, 3)).toBe(true);
  });

  it('Gelände: kein Fundament unter der Auskragung, dort planiert auf y0, keine Bäume/Blumen, nichts in der Hülle', () => {
    const site = Site.create({ id: 's', projectId: 'm', seed: 4, styleId: 'test', plot: plotAround(b, 10) });
    const r = generateSite(site.state, TEST_STYLE, b);
    expect(r.cells.filter((c) => c.role === 'foundation' && c.pos[0] >= 9)).toEqual([]);
    expect(r.cells.filter((c) => c.role === 'foundation' && c.pos[0] <= 8).length).toBeGreaterThan(9 * 7);
    for (let x = 9; x <= 11; x++) for (let z = 0; z <= 6; z++) {
      expect(r.top[r.grid.idx(x, z)], `${x},${z}`).toBe(b.y0);
      // nur Büsche am Fundament (wie unter der Traufe), keine Bäume, Blumen oder Gräser ohne Himmel
      expect(r.cells.filter((c) => c.kind === 'plant' && c.role !== 'leaves_bush' && c.pos[0] === x && c.pos[2] === z), `${x},${z}`).toEqual([]);
    }
    const occupied = new Set(shell.cells.map((c) => key3(c.pos)));
    expect(r.cells.filter((c) => occupied.has(key3(c.pos)))).toEqual([]);
  });
});
