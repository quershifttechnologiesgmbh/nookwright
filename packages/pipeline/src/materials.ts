/**
 * Materialliste (W3-BL, Konzept W2UX §4.3 B1): Gegenstände, die der fertige Bau verbraucht – je Block mit Menge für das
 * **Haus** und getrennt für die **Umgebung** (Gelände, Pflanzen, Bauwerke, Gelände-Objekte). Gemessen am fertigen
 * Volumen (nach Merge, Autotiling und Block-Sperren), also genau das, was der Export enthält. App (Tab „Material“) und
 * Engine-Antwort (`materials`) nutzen dieselbe Funktion.
 */
import type { ShellCell } from '@mcda/blueprint';
import { key3 } from '@mcda/core';
import { blockItem, stackSize } from '@mcda/platform';
import type { World } from './world.js';

export interface MaterialRow {
  /** Gegenstand (Block-ID ohne Namensraum; Wandvarianten als ihr Gegenstand, z. B. `torch`). */
  readonly item: string;
  /** Menge im Haus (Hülle, Möbel, Licht, Außen-Deko). */
  readonly house: number;
  /** Menge in der Umgebung (Gelände, Pflanzen, Bauwerke, Gelände-Objekte). */
  readonly surroundings: number;
  /** Stapelgröße des Gegenstands (64, 16 oder 1). */
  readonly stack: number;
}

export interface MaterialList {
  /** Zeilen absteigend nach Menge im Haus, dann Umgebung, dann Name. */
  readonly rows: readonly MaterialRow[];
  /** Summen (Gegenstände). */
  readonly house: number;
  readonly surroundings: number;
}

/** Teile der Umgebung, die eine Welt kennt (`generateBase`: `world.surroundings`). */
export interface MaterialSurroundings {
  readonly cells: readonly Pick<ShellCell, 'pos'>[];
  readonly outdoor: readonly { readonly id: string }[];
}

/**
 * Materialliste einer Welt. Umgebung = Zellen aus `around.cells` (Gelände, Pflanzen, Bauwerke), soweit sie im Volumen
 * nicht zu einer Raum-Komponente gehören, und alle Blöcke der Gelände-Objekte (`around.outdoor`). Ohne `around` zählt
 * alles zum Haus.
 */
export function materialList(world: Pick<World, 'materialized'>, around?: MaterialSurroundings): MaterialList {
  const extra = new Set((around?.cells ?? []).map((c) => key3(c.pos)));
  const outdoor = new Set((around?.outdoor ?? []).map((o) => o.id));
  const rows = new Map<string, { house: number; surroundings: number }>();
  let house = 0;
  let surroundings = 0;
  for (const c of world.materialized.volume.cells()) {
    const it = blockItem(c.state.name, c.state.properties);
    if (it === undefined) continue;
    const outside = outdoor.has(c.owner) || (c.owner.startsWith('shell:') && extra.has(key3(c.pos)));
    const row = rows.get(it.item) ?? { house: 0, surroundings: 0 };
    if (outside) {
      row.surroundings += it.count;
      surroundings += it.count;
    } else {
      row.house += it.count;
      house += it.count;
    }
    rows.set(it.item, row);
  }
  return {
    rows: [...rows.entries()]
      .map(([item, r]) => ({ item, house: r.house, surroundings: r.surroundings, stack: stackSize(item) }))
      .sort((a, b) => b.house - a.house || b.surroundings - a.surroundings || a.item.localeCompare(b.item)),
    house,
    surroundings,
  };
}

/** Menge in Stapeln als Text: „65 St. + 52“, „1 St.“, „14“ (unter einem Stapel nur die Zahl). */
export function stacksText(count: number, stack = 64): string {
  if (count < stack) return String(count);
  const full = Math.floor(count / stack);
  const rest = count - full * stack;
  return rest === 0 ? `${full} St.` : `${full} St. + ${rest}`;
}
