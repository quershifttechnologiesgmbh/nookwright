/**
 * Test-Fixtures: echte Plattform-Daten, echter Katalog, echte Themes und eine SYNTHETISCHE Hülle
 * (handgebaut nach dem Vertrag blueprint/src/shell/types.ts, solange deriveShell parallel entsteht).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RoomShellInfo, Shell, ShellCell } from '@mcda/blueprint';
import { Catalog, ThemeCatalog, parseComponentDef, parseThemeDef, type ComponentDef } from '@mcda/catalog';
import { CellSet, pose, type HorizontalDir, type Mirror, type Quarter, type Vec3 } from '@mcda/core';
import { expandComponent, placeComponent } from '@mcda/furnishing';
import { TARGET_VERSIONS } from '@mcda/platform';
import { loadFamilies, loadPhysics, loadRegistry } from '@mcda/platform/node';
import type { MaterializePlacement, PlatformView } from '../src/index.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json5') ? [p] : [];
  });
}

export const VERSIONS = TARGET_VERSIONS;

const platformCache = new Map<string, PlatformView>();
export function platformView(version: string): PlatformView {
  let v = platformCache.get(version);
  if (v === undefined) {
    v = { registry: loadRegistry(version), families: loadFamilies(version), physics: loadPhysics(version) };
    platformCache.set(version, v);
  }
  return v;
}

export const catalog: Catalog = Catalog.of(
  walk(join(ROOT, 'catalog/components')).map((f) => {
    const r = parseComponentDef(readFileSync(f, 'utf8'), f);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.value;
  }),
);

export const themes: ThemeCatalog = ThemeCatalog.of(
  readdirSync(join(ROOT, 'catalog/themes')).filter((f) => f.endsWith('.json5')).map((f) => {
    const r = parseThemeDef(readFileSync(join(ROOT, 'catalog/themes', f), 'utf8'), f);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.value;
  }),
);

export const THEME_IDS = themes.ids();

export function place(id: string, componentId: string, pos: Vec3, rot: Quarter = 0, variant?: string, mirror: Mirror = 'none'): MaterializePlacement {
  const def: ComponentDef = catalog.get(componentId);
  return { id, placed: placeComponent(expandComponent(def, variant), pose(pos, rot, mirror)), roomId: 'r1' };
}

/**
 * 6×5-Raum (Außenmaß, x 0..5, z 0..4), Boden y=0, lichte Höhe 3 (y 1..3), Flachdach: Decke y=4 und
 * Traufkranz aus Treppen y=5 (hohe Seite nach innen). Tür Süd bei x=2, Fenster Nord bei x=3 (y=2).
 */
export const ROOM = { id: 'r1', baseY: 1, height: 3, interior: CellSet.rect(1, 1, 4, 3) } as const;

export function roomShell(): Shell {
  const cells: ShellCell[] = [];
  const W = 5, D = 4; // max x, max z
  const edge = (x: number, z: number): boolean => x === 0 || z === 0 || x === W || z === D;
  const corner = (x: number, z: number): boolean => (x === 0 || x === W) && (z === 0 || z === D);
  for (let x = 0; x <= W; x++) for (let z = 0; z <= D; z++) {
    cells.push({ pos: [x, 0, z], kind: 'floor', role: 'floor_primary', shape: 'block', roomId: 'r1' });
    cells.push({ pos: [x, 4, z], kind: 'ceiling', role: 'ceiling', shape: 'block', roomId: 'r1', exterior: true });
    if (!edge(x, z)) continue;
    for (let y = 1; y <= 3; y++) {
      const p: Vec3 = [x, y, z];
      if (corner(x, z)) {
        cells.push({ pos: p, kind: 'pillar', role: 'beam', shape: 'log', orient: { axis: 'y' }, roomId: 'r1', exterior: true });
      } else if (x === 2 && z === D && y <= 2) {
        cells.push({ pos: p, kind: 'door', role: 'door', shape: 'door', orient: { facing: 'south', half: y === 1 ? 'lower' : 'upper', hinge: 'left' }, roomId: 'r1', exterior: true });
      } else if (x === 2 && z === D && y === 3) {
        cells.push({ pos: p, kind: 'lintel', role: 'wall_primary', shape: 'block', roomId: 'r1', exterior: true });
      } else if (x === 3 && z === 0 && y === 2) {
        cells.push({ pos: p, kind: 'window', role: 'window', shape: 'pane', roomId: 'r1', exterior: true });
      } else {
        cells.push({ pos: p, kind: 'wall', role: 'wall_primary', shape: 'block', roomId: 'r1', exterior: true });
      }
    }
    // Traufkranz: hohe Seite zur Raummitte; Soll-Form wie bei deriveShell (Ecken nach Vanilla-Regel)
    const facing: HorizontalDir = z === 0 ? 'south' : z === D ? 'north' : x === 0 ? 'east' : 'west';
    const stairShape = !corner(x, z) ? 'straight' : (x === 0) === (z === 0) ? 'outer_left' : 'outer_right';
    cells.push({ pos: [x, 5, z], kind: 'roof', role: 'roof_main', shape: 'stairs', orient: { facing, half: 'bottom', stairShape }, roomId: 'r1', exterior: true });
  }
  const info: RoomShellInfo = {
    roomId: ROOM.id, floorIndex: 0, baseY: ROOM.baseY, height: ROOM.height, interior: ROOM.interior,
    doors: [{ inside: [2, 3], toward: 'south', isMain: true }],
    windows: [{ inside: [3, 1], toward: 'north' }],
  };
  return { cells, rooms: new Map([[ROOM.id, info]]), warnings: [] };
}

/** Eingerichteter Raum: Bett, Theke über Eck, Doppeltruhe, Stuhl, Kerzen, Hängelaterne, Wandfackel. */
export function furnished(): MaterializePlacement[] {
  return [
    place('bed', 'bed/single', [1, 1, 1], 0), //                 Kopf (1,1,1), Fuß (1,1,2), Kopfende Nord
    place('counter1', 'table/counter', [3, 1, 1], 0), //          Rücken Nord
    place('counter2', 'table/counter', [4, 1, 1], 0), //          Ecke
    place('counter3', 'table/counter', [4, 1, 2], 1), //          Rücken Ost
    place('chest1', 'storage/chest', [3, 1, 3], 2), //            Rücken Süd → Front Nord
    place('chest2', 'storage/chest', [4, 1, 3], 2),
    place('chair', 'seat/chair', [3, 1, 2], 2), //                Lehne Süd
    place('candles', 'decor/candles', [3, 2, 1], 0, 'three'), //  auf der Theke
    place('lamp', 'light/hanging_lantern', [2, 2, 2], 0), //      Laterne y=2, Kette y=3, Decke y=4
    place('torch', 'light/wall_torch', [1, 2, 3], 3), //          Rücken West → an der Westwand
  ];
}
