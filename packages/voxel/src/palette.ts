import { AIR, blockState, stateKey, type BlockState } from './blockstate.js';

/**
 * Palette (State-Interning): jeder verschiedene Blockzustand bekommt genau eine Nummer.
 * Index 0 ist immer Luft. Nummern bleiben stabil, solange die Palette lebt (nur Anhängen).
 * `minecraft:stone` und `stone` sind derselbe Zustand.
 */
export class Palette {
  /** Schlüssel → Nummer; enthält neben dem kanonischen Schlüssel auch gesehene Schreibvarianten. */
  private readonly ids = new Map<string, number>();
  private readonly list: BlockState[] = [];

  constructor() {
    this.intern(AIR);
  }

  /** Nummer des Zustands; neue Zustände werden kanonisiert und angehängt. */
  intern(s: BlockState): number {
    const raw = stateKey(s);
    const hit = this.ids.get(raw);
    if (hit !== undefined) return hit;
    const canonical = blockState(s.name, s.properties);
    const key = stateKey(canonical);
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.list.length;
      this.ids.set(key, id);
      this.list.push(canonical);
    }
    if (raw !== key) this.ids.set(raw, id);
    return id;
  }

  /** Nummer eines bereits bekannten Zustands, sonst `undefined`. */
  idOf(s: BlockState): number | undefined {
    return this.ids.get(stateKey(s)) ?? this.ids.get(stateKey(blockState(s.name, s.properties)));
  }

  get(id: number): BlockState {
    const s = this.list[id];
    if (s === undefined) throw new RangeError(`Palettenindex ${id} unbekannt (Größe ${this.list.length})`);
    return s;
  }

  get size(): number {
    return this.list.length;
  }

  /** Alle Zustände in Palettenreihenfolge (Index 0 = Luft). */
  states(): readonly BlockState[] {
    return this.list;
  }
}
