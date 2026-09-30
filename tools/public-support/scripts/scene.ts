/**
 * Serialisiert eine generierte Welt als kompakte Szene für die Marketing-Renderer (Social-Kit, Website-Startseite und -Galerie).
 *
 * Format: { id, title, theme, stats, palette: [[name, rgb, glow, shape, facing, half]], blocks: [x,y,z,pi,cat,…],
 *           rooms: [{ floor, type, name, cells: [x,z,…] }] }
 * cat: 0 Gelände, 1 Pflanze, 2 Bauwerk, 3 Boden, 4 Wand, 5 Decke, 6 Dach, 7 Tür/Fenster, 8 Möbel, 9 Außen-Deko
 * Farbe: eigene Flächenfarbe der App (`blockColors.ts`) – die Renderer legen daraus ihre eigenen Pixeltexturen an.
 */
import type { Project } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import type { World } from '../../../packages/pipeline/src/index.js';
import { blockLook } from '../../../packages/app/src/blockColors.js';

export interface Scene {
  readonly id: string;
  readonly title: string;
  readonly theme: string;
  readonly stats: { readonly blocks: number; readonly placements: number; readonly rooms: number; readonly ms: number };
  readonly palette: unknown[];
  readonly blocks: number[];
  readonly rooms: { floor: number; type: string; name: string; cells: number[] }[];
}

export const KIND_CAT: Record<string, number> = {
  terrain: 0, plant: 1, fort: 2, floor: 3, wall: 4, pillar: 4, door: 7, lintel: 4, window: 7, ceiling: 5, roof: 6,
  stairs: 4, railing: 4, facade: 9,
};

export function shapeOf(name: string, props: Readonly<Record<string, string>>): string {
  const n = name.replace(/^minecraft:/, '');
  if (n.endsWith('_slab')) return props['type'] === 'top' ? 'slab_t' : props['type'] === 'double' ? 'cube' : 'slab_b';
  if (n.endsWith('_stairs')) return 'stairs';
  if (n.endsWith('_carpet') || n.endsWith('pressure_plate') || n === 'rail' || n.endsWith('_rail') || n === 'lily_pad' || n === 'snow') return 'carpet';
  if (n.endsWith('_pane') || n === 'iron_bars') return 'pane';
  if (n.endsWith('_door')) return 'door';
  // offene Falltür = senkrechte Platte (W10-C: Rundtür-Füllung des Erdhauses, Schornsteinkappen um das Lagerfeuer)
  if (n.endsWith('_trapdoor')) return props['open'] === 'true' ? 'trap_open' : props['half'] === 'top' ? 'slab_t' : 'carpet';
  // Laterne: eigenes Modell (Körper, Deckel; hängend mit Kette)
  if (n.endsWith('lantern') && !n.includes('jack_o')) return props['hanging'] === 'true' ? 'lantern_hang' : 'lantern';
  if (/(fence|_wall$|chain$|end_rod|lightning_rod)/.test(n) && !n.endsWith('_gate')) return 'post';
  if (/(torch|lantern|candle|flower_pot|potted_|sapling|_flower|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lily|rose|peony|lilac|short_grass|tall_grass|fern|bush|wheat|carrots|potatoes|beetroots|sweet_berry|sugar_cane|button|lever|sign|banner|ladder|head|skull|amethyst_cluster|bud$)/.test(n)) return 'small';
  if (/(bed$|chest|barrel|anvil|grindstone|stonecutter|lectern|brewing_stand|cauldron|composter|table|loom|bell|campfire|enchanting|smoker|furnace|decorated_pot|bookshelf)/.test(n)) return 'cube';
  if (n.endsWith('_gate')) return 'post';
  return 'cube';
}

export function sceneOf(id: string, title: string, project: Project, world: World, catalog: Catalog, ms = 0): Scene {
  const kindAt = new Map<string, string>();
  for (const c of world.shell.cells) kindAt.set(c.pos.join(','), c.kind);
  const vol = world.materialized.volume;
  const palIndex = new Map<string, number>();
  const palette: unknown[] = [];
  const blocks: number[] = [];
  for (const owner of vol.owners()) {
    for (const cell of vol.cellsOf(owner)) {
      const look = blockLook(cell.state.name);
      if (look.rule === 'invisible') continue;
      const props = cell.state.properties;
      const shape = shapeOf(cell.state.name, props);
      const key = `${cell.state.name}|${shape}|${props['facing'] ?? ''}|${props['half'] ?? ''}`;
      let pi = palIndex.get(key);
      if (pi === undefined) {
        pi = palette.length;
        palIndex.set(key, pi);
        palette.push([cell.state.name.replace(/^minecraft:/, ''), look.color, look.glow ? 1 : 0, shape, props['facing'] ?? '', props['half'] ?? '']);
      }
      const kind = kindAt.get(cell.pos.join(','));
      let cat: number;
      if (kind !== undefined) cat = KIND_CAT[kind] ?? 4;
      else if (cell.layer === 1) cat = 0;
      else if (cell.layer === 3) cat = 7;
      else if (owner.startsWith('x') || owner.includes('ext')) cat = 9;
      else cat = 8;
      blocks.push(cell.pos[0], cell.pos[1], cell.pos[2], pi, cat);
    }
  }
  const rooms = project.state.rooms.map((r) => ({
    floor: r.floorIndex,
    type: r.roomTypeId,
    name: catalog.roomType(r.roomTypeId).name,
    cells: [...r.cells].flatMap((c) => [c[0], c[1]]),
  }));
  const scene = {
    id, title, theme: project.state.themeId, stats: {
      blocks: blocks.length / 5, placements: project.state.placements.length, rooms: rooms.length, ms: Math.round(ms),
    }, palette, blocks, rooms,
  };
  return scene;
}
