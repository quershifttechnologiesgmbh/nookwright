/**
 * Test-Hilfen: Katalog aus `catalog/` und synthetische Räume wie aus `deriveShell` (Bauplan), ohne vom
 * Bauplan-Kontext abzuhängen. Fenster wie in der Hülle bis S2: symmetrisch auf Außenwandläufen ohne Tür,
 * Randabstand 1, je 2 Zellen Abstand (etwa alle 3 Zellen, K1-Befund) – der ungünstigste Fall für breite Möbel
 * (die Hülle hat inzwischen den Standard-Abstand 4). Innenwände ohne Fenster.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { Catalog, parseComponentDef, parseRoomTypeDef } from '@mcda/catalog';
import { CellSet, cellKey, key3, type Cell, type HorizontalDir } from '@mcda/core';
import type { DoorInfo, FurnishResult, RoomGeometry, WindowInfo } from '../src/index.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json5') ? [p] : [];
  });
const unwrap = <T,>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T => {
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
};

export const catalog = Catalog.of(
  walk(join(ROOT, 'components')).map((f) => unwrap(parseComponentDef(readFileSync(f, 'utf8'), f))),
  walk(join(ROOT, 'roomtypes')).map((f) => unwrap(parseRoomTypeDef(readFileSync(f, 'utf8'), f))),
);
export const DV = 4671;

/** Fensterpositionen in einem Wandlauf (wie `windowSlots` im Bauplan). */
export function windowSlots(length: number, margin = 1, spacing = 2): number[] {
  const avail = length - 2 * margin;
  if (avail <= 0) return [];
  if (avail === 2) return [margin, margin + 1];
  for (let n = Math.floor((avail + spacing) / (1 + spacing)); n >= 1; n--) {
    const span = n + (n - 1) * spacing;
    if (span > avail || (avail - span) % 2 !== 0) continue;
    const start = margin + (avail - span) / 2;
    return Array.from({ length: n }, (_, i) => start + i * (1 + spacing));
  }
  return [];
}

export interface ShellRoomOptions {
  readonly height?: number;
  /** Seite der Tür (Standard Süd) und Position entlang der Wand (Standard: Mitte). */
  readonly doorSide?: HorizontalDir;
  readonly doorAt?: number;
  /** Innenwände: keine Fenster auf diesen Seiten. */
  readonly inner?: readonly HorizontalDir[];
  /** Zellen zwischen zwei Fenstern (Standard 2 wie bis S2; die Hülle nimmt inzwischen 4). */
  readonly windowSpacing?: number;
  readonly blocked?: CellSet;
}

/** Rechteckiger Raum mit Außenmaß w × d (Wände inklusive) → Innenraum (w − 2) × (d − 2) ab (0, 0). */
export function shellRoom(w: number, d: number, o: ShellRoomOptions = {}): RoomGeometry {
  const iw = w - 2;
  const id = d - 2;
  const doorSide = o.doorSide ?? 'south';
  const along = (side: HorizontalDir): number => (side === 'north' || side === 'south' ? iw : id);
  const cellOn = (side: HorizontalDir, i: number): Cell =>
    side === 'north' ? [i, 0] : side === 'south' ? [i, id - 1] : side === 'west' ? [0, i] : [iw - 1, i];
  const doorPos = Math.min(along(doorSide) - 1, Math.max(0, o.doorAt ?? Math.floor(along(doorSide) / 2)));
  const doors: DoorInfo[] = [{ inside: cellOn(doorSide, doorPos), toward: doorSide, isMain: true }];
  const windows: WindowInfo[] = [];
  for (const side of ['north', 'east', 'south', 'west'] as const) {
    if (side === doorSide || o.inner?.includes(side)) continue;
    for (const i of windowSlots(along(side), 1, o.windowSpacing ?? 2)) windows.push({ inside: cellOn(side, i), toward: side });
  }
  return {
    roomId: `r${w}x${d}`,
    baseY: 1,
    height: o.height ?? 3,
    interior: CellSet.rect(0, 0, iw - 1, id - 1),
    doors,
    windows,
    ...(o.blocked !== undefined ? { blocked: o.blocked } : {}),
  };
}

/** L-Raum (zwei Rechtecke), Tür Süd am Fuß, Fenster auf den langen Außenläufen. */
export function lShellRoom(height = 3): RoomGeometry {
  return {
    roomId: 'rL',
    baseY: 1,
    height,
    interior: CellSet.rect(0, 0, 9, 3).union(CellSet.rect(0, 4, 3, 8)),
    doors: [{ inside: [1, 8], toward: 'south', isMain: true }, { inside: [9, 2], toward: 'east', isMain: false }],
    windows: [
      ...windowSlots(10).map((i): WindowInfo => ({ inside: [i, 0], toward: 'north' })),
      ...windowSlots(9).map((i): WindowInfo => ({ inside: [0, i], toward: 'west' })),
    ],
  };
}

/** Harte Garantien, die für JEDES Ergebnis gelten müssen (research/02 §7.21). */
export function assertHardGuarantees(geom: RoomGeometry, res: FurnishResult, where = ''): void {
  const blocks = new Set<string>();
  const floor = new Set<string>();
  /** Möbel-Boden (ohne Deckenobjekte): nur darüber darf etwas von der Decke tiefer als Kopfhöhe hängen. */
  const furniture = new Set<string>();
  const low: string[] = [];
  for (const p of res.placed) {
    for (const c of p.cells) {
      const k = key3(c.pos);
      if (p.expanded.mount !== 'ceiling' && c.pos[1] <= geom.baseY + 1 && !p.expanded.walkable) furniture.add(cellKey(c.pos[0], c.pos[2]));
      expect(blocks.has(k), `${where} Kollision bei ${k}`).toBe(false);
      blocks.add(k);
      expect(geom.interior.has(c.pos[0], c.pos[2]), `${where} außerhalb bei ${k}`).toBe(true);
      expect(geom.blocked?.has(c.pos[0], c.pos[2]) ?? false, `${where} auf gesperrter Zelle ${k}`).toBe(false);
      expect(c.pos[1]).toBeGreaterThanOrEqual(geom.baseY);
      expect(c.pos[1]).toBeLessThan(geom.baseY + geom.height);
      // Kopffreiheit über Laufwegen: Deckenobjekte ≥ Boden + 2, tiefer nur über Möbeln (Socket `hang`, S2/V3)
      if (p.expanded.mount === 'ceiling' && c.pos[1] < geom.baseY + 2) low.push(cellKey(c.pos[0], c.pos[2]));
      if (c.pos[1] <= geom.baseY + 1 && !p.expanded.walkable) floor.add(cellKey(c.pos[0], c.pos[2]));
    }
  }
  for (const k of low) expect(furniture.has(k), `${where} Kopffreiheit: Deckenobjekt tiefer als Boden + 2 über dem Laufweg bei ${k}`).toBe(true);
  const free = CellSet.of([...geom.interior].filter(([x, z]) => !floor.has(cellKey(x, z))));
  expect(free.isConnected(), `${where} freie Bodenfläche zerfällt in Taschen`).toBe(true);
  for (const d of geom.doors) {
    expect(free.has(d.inside[0], d.inside[1]), `${where} Tür blockiert`).toBe(true);
    for (const n of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Cell[]) {
      const x = d.inside[0] + n[0];
      const z = d.inside[1] + n[1];
      if (geom.interior.has(x, z)) expect(floor.has(cellKey(x, z)), `${where} Türzone belegt`).toBe(false);
    }
  }
}

/** Signatur-Tags je Raumtyp (wie im K1-Fuzz der Pipeline). */
export const SIGNATURE: Readonly<Record<string, string>> = {
  bedroom: 'canopy_bed',
  kitchen: 'hearth',
  storage: 'storage_wall',
  smithy: 'forge',
  library: 'bookshelf_wall',
  alchemy: 'brewing_counter',
  tavern: 'bar_counter',
};
