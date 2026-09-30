import { CellSet, key3, type Vec3 } from '@mcda/core';
import { Site, type BuildingInfo, type SiteResult, type TerrainStyleDef } from '../src/index.js';

/** Synthetisches Gebäude: Grundfläche 11 × 9 bei y0 = 64, Dachüberstand 1, Tür nach Norden bei (5, 0). */
export function syntheticBuilding(y0 = 64): BuildingInfo {
  const footprint = CellSet.rect(0, 0, 10, 8);
  const covered = CellSet.rect(-1, -1, 11, 9).difference(footprint);
  const occupied = new Set<string>();
  for (const [x, z] of covered) occupied.add(key3([x, y0 + 4, z]));
  for (const [x, z] of footprint) occupied.add(key3([x, y0, z]));
  return { y0, footprint, covered, doors: [{ cell: [5, 0], outward: 'north' }], occupied };
}

export const plot = { minX: -24, minZ: -26, maxX: 30, maxZ: 26 };

/** Grundstück mit allen Zonenarten. */
export function fullSite(seed = 11): Site {
  const s = Site.create({ id: 's', projectId: 'p', seed, styleId: 'meadow', plot });
  s.paintZone('field', CellSet.rect(-20, -22, -6, -12)); // 15 × 11 → Rinnen nötig
  s.paintZone('garden', CellSet.rect(16, -20, 26, -12));
  s.paintZone('yard', CellSet.rect(2, -9, 9, -4));
  s.paintZone('pond', CellSet.rect(18, 12, 25, 18));
  s.paintZone('meadow', CellSet.rect(-20, 12, -10, 20));
  return s;
}

export const TEST_STYLE: TerrainStyleDef = {
  id: 'test',
  name: 'Test',
  relief: { amplitude: 3, scale: 20, octaves: 3 },
  foundation: { pad: 1, blend: 5 },
  vegetation: {
    trees: { spacing: 7, density: 0.7, species: { oak: 1, birch: 1, spruce: 1 } },
    bushes: { spacing: 4, density: 0.5, foundation: 0.8 },
    ground: { spacing: 1.5, density: 0.6, flowers: 0.4, carpet: 0.15 },
  },
};

export function cellMap(res: SiteResult): Map<string, SiteResult['cells'][number]> {
  return new Map(res.cells.map((c) => [key3(c.pos), c]));
}

export const posAbove = (p: Vec3, dy = 1): Vec3 => [p[0], p[1] + dy, p[2]];

/** Draufsicht-Zeichen neuer Ausstattung (T2): Pfosten, Hecke, Brunnen, Hof-Ausstattung. */
const PLANT_SYMBOL: Readonly<Record<string, string>> = {
  fence_post: '|', hedge: 'h', leaves_fruit: 'A', light_hidden: '*', well_roof: '^', woodpile: 'W', barrel_outdoor: 'B',
  beehive: 'H', hay: 'Y', scarecrow_head: 'S', planter: 'k', trough: 'U',
};
const PRIORITY = ['T', '*', 'G', '|', '^', 'S', 'U', 'Y', 'W', 'B', 'H', 'k'];

/** Kurzbild der Oberfläche (für Fehlermeldungen und das Bericht-Beispiel). */
export function ascii(res: SiteResult): string {
  const g = res.grid;
  const top = new Map<string, string>();
  for (const c of res.cells) {
    if (c.kind !== 'plant') continue;
    const k = `${c.pos[0]},${c.pos[2]}`;
    const m = PLANT_SYMBOL[c.role] ?? (c.role === 'leaves_bush' ? 'b' : c.role.startsWith('leaves') ? 'L' : c.role.startsWith('log') ? 'T'
      : c.shape === 'fence_gate' ? 'G' : c.role === 'fence_outdoor' ? '+' : c.role.startsWith('crop') ? 'w'
        : c.role === 'light_outdoor' ? '*' : c.role.startsWith('flower') ? 'o' : c.role === 'pond_plant' ? 'r' : '"');
    const prev = top.get(k);
    if (prev === undefined || PRIORITY.includes(m)) top.set(k, m);
  }
  const sym: Record<string, string> = {
    building: '#', ground_grass: '.', ground_path: '=', farmland: 'f', water: '~', garden_soil: 'g', ground_yard: 'y', ground_dirt: ':',
    path_main: '%', path_edge: ',', path_stone: 's', path_gutter: '_', plaza_accent: 'p', paddock_ground: 'c', bed_edge: 'e', well_stone: 'O',
  };
  const rows: string[] = [];
  for (let z = g.minZ; z < g.minZ + g.d; z++) {
    let row = '';
    for (let x = g.minX; x < g.minX + g.w; x++) {
      const i = g.idx(x, z);
      row += top.get(`${x},${z}`) ?? sym[res.surface[i]!] ?? '?';
    }
    rows.push(row);
  }
  return rows.join('\n');
}
