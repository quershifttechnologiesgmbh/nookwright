/**
 * W12-D/W13-B: gekreuzte Windbretter (`exterior/ridge_cross`, `planRidgeDecor`) für gerade und ungerade Hausbreite
 * (zwei Firstreihen bzw. einreihiger First mit halber Firstplatte), ein- und zweigeschossig: je Firstende zwei Treppen,
 * Rücken seitlich nach außen, spiegelgleich (beide Enden, gleiche Höhe, gleich viele Treppen je Richtung), keine
 * schwebenden Blöcke (unter jeder Treppe eine Dachzelle). Andere Themes: keine gekreuzten Bretter.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, deriveShell } from '@mcda/blueprint';
import { Catalog, parseComponentDef } from '@mcda/catalog';
import { CellSet, key3 } from '@mcda/core';
import { planExterior } from '../src/index.js';
import { RIDGE_CROSS_COMPONENT } from '../src/roof.js';

const DIR = fileURLToPath(new URL('../../../catalog/components', import.meta.url));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.json5') ? [join(d, n)] : []));
const catalog = Catalog.of(walk(DIR).map((f) => {
  const r = parseComponentDef(readFileSync(f, 'utf8'), f);
  if (!r.ok) throw new Error(`${f}: ${r.errors.join('; ')}`);
  return r.value;
}));

/** Rechteckhaus 15 lang, `depth` tief (gerade → zwei Firstreihen, ungerade → einreihiger First), 1 oder 2 Geschosse. */
function box(depth: number, storeys: 1 | 2) {
  const p = Project.create({ id: 'b', name: 'Kiste', seed: 2026, themeId: 'nordic', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 14, depth - 1), 'living');
  if (storeys === 2) {
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 14, depth - 1), 'bedroom');
    p.placeStairs(0, [2, 2], 'east');
  }
  const shell = deriveShell(p.state, { roof: 'gable', overhang: 1, roofDetail: { trim: true } });
  const roomTypes = Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId]));
  return { shell, roomTypes };
}

describe('gekreuzte Windbretter: gerade/ungerade Breite, ein-/zweigeschossig', () => {
  for (const depth of [8, 9]) for (const storeys of [1, 2] as const) {
    it(`Tiefe ${depth} (${depth % 2 === 0 ? 'zwei Firstreihen' : 'einreihiger First'}), ${storeys} Geschoss(e)`, () => {
      const { shell, roomTypes } = box(depth, storeys);
      const roof = new Map(shell.cells.filter((c) => c.kind === 'roof').map((c) => [key3(c.pos), c]));
      const plan = planExterior(shell, catalog, { seed: 2026, style: { density: 1 }, roomTypes, themeId: 'nordic' });
      const cross = plan.placements.filter((p) => p.componentId === RIDGE_CROSS_COMPONENT);
      expect(cross).toHaveLength(4);
      const cells = cross.map((p) => p.cells[0]!);
      // gleiche Höhe, beide Firstenden (je zwei), spiegelgleich zur Firstmitte
      expect(new Set(cells.map((c) => c[1])).size).toBe(1);
      const xs = [...new Set(cells.map((c) => c[0]))].sort((a, b) => a - b);
      expect(xs).toHaveLength(2);
      const zs = [...new Set(cells.map((c) => c[2]))].sort((a, b) => a - b);
      expect(zs).toHaveLength(2);
      // Abstand der beiden Bretter je Ende: 1 (nebeneinander über zwei Firstreihen) bzw. 2 (links/rechts der Platte)
      expect(zs[1]! - zs[0]!).toBe(depth % 2 === 0 ? 1 : 2);
      // spiegelgleich zur Firstlinie: Mitte der beiden Bretter = Mitte des Hauses (Überstand 1 an beiden Seiten)
      expect(zs[0]! + zs[1]!).toBe(depth - 1);
      // Rücken seitlich nach außen: je Seite dieselbe Drehung, beide Seiten gegensätzlich
      const bySide = (z: number) => cross.filter((p) => p.cells[0]![2] === z).map((p) => p.pose.rot);
      expect(new Set(bySide(zs[0]!)).size).toBe(1);
      expect(new Set(bySide(zs[1]!)).size).toBe(1);
      expect(bySide(zs[0]!)[0]).not.toBe(bySide(zs[1]!)[0]);
      // keine schwebenden Blöcke: direkt darunter eine Dachzelle
      for (const c of cells) expect(roof.has(key3([c[0], c[1] - 1, c[2]])), key3(c)).toBe(true);
      // einreihiger First: zwischen den Brettern die halbe Firstplatte (V wie auf zwei Firstreihen)
      if (depth % 2 === 1) {
        for (const x of xs) {
          const tip = roof.get(key3([x, cells[0]![1], (zs[0]! + zs[1]!) / 2]));
          expect(tip?.shape, `Firstplatte bei x=${x}`).toBe('slab');
        }
      }
      // andere Themes: keine gekreuzten Bretter
      const medieval = planExterior(shell, catalog, { seed: 2026, style: { density: 1 }, roomTypes, themeId: 'medieval' });
      expect(medieval.placements.some((p) => p.componentId === RIDGE_CROSS_COMPONENT)).toBe(false);
    });
  }
});
