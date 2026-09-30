/**
 * Lava-Regel der Katalog-Tests (research/10 §11 #5, Lava zündet brennbare Nachbarn): Lava (Quellblock oder `lava_cauldron`) kommt in
 * Katalog-Bauten nicht offen vor. Einzige Ausnahme sind ausdrücklich versiegelte technische Anlagen (Hühner-Garer
 * `functional/fn_animal_chicken_farm#cooker`): alle sechs Nachbarn der Lava-Zelle sind feste, nicht brennbare Blöcke (weder Luft noch
 * Holz, Wolle, Heu, Laub ...), sodass weder Feuer entsteht noch jemand hineinfällt.
 */
import type { Vec3 } from '@mcda/core';

interface StateVolume {
  stateAt(pos: Vec3): { readonly name: string };
}

const FLAMMABLE = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped|stripped)_|planks|hay_block|wool|carpet|bookshelf|leaves|vine|barrel|chest|lectern|composter|scaffolding|_log$|_wood$|door|sign|bed$|banner|torch|lantern|campfire|fire$/;
const NEIGHBORS: readonly Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Meldungen zu offener Lava an `pos` (leer = in Ordnung oder kein Lava-Block). */
export function lavaProblems(volume: StateVolume, pos: Vec3, name: string): string[] {
  if (!/lava/.test(name)) return [];
  const out: string[] = [];
  for (const d of NEIGHBORS) {
    const n = volume.stateAt([pos[0] + d[0], pos[1] + d[1], pos[2] + d[2]]).name;
    if (n === 'air' || n === 'cave_air' || n === 'void_air' || FLAMMABLE.test(n)) out.push(`${n} neben Lava bei ${pos.join(',')}`);
  }
  return out;
}
