import { HORIZONTAL, type Cell, type CellSet, type HorizontalDir, type Quarter } from '@mcda/core';

/**
 * Leseport: was die Einrichtung über einen Raum wissen muss.
 * Wird vom Bauplan-Kontext (abgeleitete Hülle) bereitgestellt – die Einrichtung kennt das Projekt-Aggregat nicht.
 */
export interface DoorInfo {
  /** Begehbare Innenzelle direkt vor der Tür. */
  readonly inside: Cell;
  /** Richtung von der Innenzelle zur Tür. */
  readonly toward: HorizontalDir;
  readonly isMain: boolean;
  /** Additiv (W4-C): Flügel einer Doppeltür – Innenzelle vor dem anderen Flügel (der auch als eigene Tür dasteht). */
  readonly partner?: Cell;
}

export interface WindowInfo {
  /** Innenzelle vor dem Fenster. */
  readonly inside: Cell;
  readonly toward: HorizontalDir;
}

export interface RoomGeometry {
  readonly roomId: string;
  /** Y der ersten Luftschicht über dem Boden (hier stehen Möbel mit y = 0). */
  readonly baseY: number;
  /** Lichte Höhe in Blöcken. */
  readonly height: number;
  /** Begehbare Bodenzellen innerhalb der Wände. */
  readonly interior: CellSet;
  readonly doors: readonly DoorInfo[];
  readonly windows: readonly WindowInfo[];
  /**
   * Gesperrte Innenzellen (Treppe, Treppenloch; vom Etagen-Kontext additiv geliefert, darf fehlen).
   * Hier wird in keiner Höhe etwas platziert; die Zellen zählen als begehbar und müssen mit der freien
   * Fläche zusammenhängen (Treppe bleibt erreichbar).
   */
  readonly blocked?: CellSet;
}

export const STEP: Readonly<Record<HorizontalDir, Cell>> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

/** Drehung, bei der die Rückseite einer Komponente (kanonisch Norden) zur Wand in Richtung `wall` zeigt. */
export function rotationForBack(wall: HorizontalDir): Quarter {
  return HORIZONTAL.indexOf(wall) as Quarter;
}

export const neighbor = (c: Cell, d: HorizontalDir): Cell => [c[0] + STEP[d][0], c[1] + STEP[d][1]];

