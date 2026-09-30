/** Test-Szenarien Baukörper (V0): Häuserzeile, Turm neben Halle, Hang. Außenmaß, Seed fest. */
import { CellSet } from '@mcda/core';
import { DEFAULT_VOLUME, Project, TARGET_VERSIONS, type ProjectEvent, type Shell, type VolumeProps } from '../../src/index.js';

export const volumeProject = (seed = 2026): Project =>
  Project.create({ id: 'p', name: 'Baukörper', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });

const volumeIdOf = (events: readonly ProjectEvent[]): string => {
  const e = events.find((x) => x.type === 'VolumeAdded');
  if (e?.type !== 'VolumeAdded') throw new Error('kein VolumeAdded');
  return e.volume.id;
};

export function addVolume(p: Project, props: VolumeProps): string {
  return volumeIdOf(p.addVolume(props));
}

/**
 * Häuserzeile (BT08): drei Stadthäuser 7 breit × 11 tief entlang x mit geteilten Wänden, Giebel zur Straße (Süden),
 * je eigenes Satteldach. Haus 1 (Standard-Baukörper) 2 Etagen à 3, Haus 2 höher (Erdgeschoss 5, 3 Etagen),
 * Haus 3 eine Etage. Je Haus eine gerade Treppe.
 */
export function rowHouses(): Project {
  const p = volumeProject();
  p.addFloor();
  p.addFloor();
  p.changeVolume(DEFAULT_VOLUME, { name: 'Haus 1', roof: 'gable' });
  const h2 = addVolume(p, { name: 'Haus 2', roof: 'gable', floorHeights: { 0: 5 } });
  const h3 = addVolume(p, { name: 'Haus 3', roof: 'gable', roofDetail: { pitch: 'steep' } });
  p.paintRoom(0, CellSet.rect(0, 0, 6, 10), 'kitchen');
  p.paintRoom(1, CellSet.rect(0, 0, 6, 10), 'bedroom');
  p.paintRoom(0, CellSet.rect(7, 0, 13, 10), 'smithy', { volumeId: h2 });
  p.paintRoom(1, CellSet.rect(7, 0, 13, 10), 'library', { volumeId: h2 });
  p.paintRoom(2, CellSet.rect(7, 0, 13, 10), 'bedroom', { volumeId: h2 });
  p.paintRoom(0, CellSet.rect(14, 0, 20, 10), 'storage', { volumeId: h3 });
  p.placeStairs(0, [3, 3], 'south');
  p.placeStairs(0, [9, 2], 'south');
  p.placeStairs(1, [11, 8], 'north');
  return p;
}

/** Turm neben Halle (BT01/BT02): Halle 15×11 mit Satteldach, Turm 7×7 mit 4 Etagen und Flachdach, Leitern im Wechsel. */
export function towerAndHall(): Project {
  const p = volumeProject();
  p.addFloor();
  p.addFloor();
  p.addFloor();
  const tower = addVolume(p, { name: 'Turm', roof: 'flat' });
  p.paintRoom(0, CellSet.rect(0, 0, 14, 10), 'dining_hall');
  for (let f = 0; f < 4; f++) p.paintRoom(f, CellSet.rect(15, 2, 21, 8), f === 0 ? 'storage' : f === 3 ? 'bedroom' : 'library', { volumeId: tower });
  for (let f = 0; f < 3; f++) p.placeStairs(f, [f % 2 === 0 ? 17 : 19, 3], 'north', 'ladder');
  return p;
}

/** Hang: Haupthaus (Standard) 11×9 und ein Nebenbau 9×9 daneben, 3 Blöcke tiefer (`baseOffset: -3`), je Satteldach. */
export function hillside(): Project {
  const p = volumeProject();
  const low = addVolume(p, { name: 'Unterhaus', baseOffset: -3 });
  p.paintRoom(0, CellSet.rect(0, 0, 10, 8), 'kitchen');
  p.paintRoom(0, CellSet.rect(11, 0, 19, 8), 'storage', { volumeId: low });
  return p;
}

/**
 * Dichtheit (Vollblock-Modell, sechs Nachbarn): Luft, die vom Rand der Box erreichbar ist, darf weder den Innenraum
 * eines Raums (baseY … baseY + Höhe − 1) noch eine Position direkt über einer Decke (Dachraum) erreichen. Türen und
 * Fenster zählen als geschlossen. Ergebnis: undichte Positionen.
 */
export function openings(shell: Shell): string[] {
  const k3 = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  const solid = new Set(shell.cells.map((c) => k3(c.pos[0], c.pos[1], c.pos[2])));
  const lo = [0, 1, 2].map((k) => Math.min(...shell.cells.map((c) => c.pos[k]!)) - 1);
  const hi = [0, 1, 2].map((k) => Math.max(...shell.cells.map((c) => c.pos[k]!)) + 1);
  const inBox = (x: number, y: number, z: number): boolean => x >= lo[0]! && y >= lo[1]! && z >= lo[2]! && x <= hi[0]! && y <= hi[1]! && z <= hi[2]!;
  const seen = new Set<string>([k3(lo[0]!, lo[1]!, lo[2]!)]);
  const queue: Array<readonly [number, number, number]> = [[lo[0]!, lo[1]!, lo[2]!]];
  for (let q = 0; q < queue.length; q++) {
    const [x, y, z] = queue[q]!;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const k = k3(nx, ny, nz);
      if (!inBox(nx, ny, nz) || seen.has(k) || solid.has(k)) continue;
      seen.add(k);
      queue.push([nx, ny, nz]);
    }
  }
  const out: string[] = [];
  for (const r of shell.rooms.values()) {
    for (const [x, z] of r.interior) for (let y = r.baseY; y < r.baseY + r.height; y++) if (seen.has(k3(x, y, z))) out.push(`${r.roomId}@${k3(x, y, z)}`);
  }
  const roofed = new Set(shell.cells.filter((c) => c.kind === 'roof').map((c) => `${c.pos[0]},${c.pos[2]}`));
  for (const c of shell.cells) {
    if (c.kind !== 'ceiling' || !roofed.has(`${c.pos[0]},${c.pos[2]}`)) continue;
    if (seen.has(k3(c.pos[0], c.pos[1] + 1, c.pos[2]))) out.push(`Dachraum@${k3(c.pos[0], c.pos[1] + 1, c.pos[2])}`);
  }
  return out;
}

/** Positionen mit mehr als einer Hüllzelle. */
export function doubles(shell: Shell): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of shell.cells) {
    const k = c.pos.join(',');
    if (seen.has(k)) out.push(k);
    seen.add(k);
  }
  return out;
}
