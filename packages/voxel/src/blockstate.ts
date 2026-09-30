/**
 * Blockzustand als kleines Wertobjekt (Glossar: `BlockState`).
 *
 * Vorläufig: `@mcda/platform` definiert den verbindlichen Typ; dieser hier ist strukturell gleich
 * (`{ name, properties }`, Name ohne `minecraft:`, fremde Namespaces bleiben) und wird später angeglichen.
 */

export interface BlockState {
  /** Block-ID ohne `minecraft:` (z. B. `oak_stairs`); fremde Namespaces bleiben erhalten. */
  readonly name: string;
  /** Properties; kanonisch alphabetisch sortiert und eingefroren (siehe `blockState`). */
  readonly properties: Readonly<Record<string, string>>;
}

const NS = 'minecraft:';

/** Kanonischer, eingefrorener Blockzustand. Wirft bei leerem Namen oder leeren Property-Schlüsseln. */
export function blockState(name: string, properties: Readonly<Record<string, string>> = {}): BlockState {
  const t = name.trim();
  const n = t.startsWith(NS) ? t.slice(NS.length) : t;
  if (n.length === 0 || /[[\]\s]/.test(n)) throw new Error(`Ungültiger Blockname: "${name}"`);
  const props: Record<string, string> = {};
  for (const k of Object.keys(properties).sort()) {
    if (k.length === 0) throw new Error(`Leerer Property-Schlüssel in ${n}`);
    props[k] = properties[k]!;
  }
  return Object.freeze({ name: n, properties: Object.freeze(props) });
}

/** Eindeutiger Schlüssel `name[k=v,…]` (Properties sortiert) – Grundlage des Paletten-Internings. */
export function stateKey(s: BlockState): string {
  const keys = Object.keys(s.properties).sort();
  if (keys.length === 0) return s.name;
  return `${s.name}[${keys.map((k) => `${k}=${s.properties[k]}`).join(',')}]`;
}

export const AIR: BlockState = blockState('air');

/** Luft und ihre Varianten (Höhlen-/Void-Luft). */
export function isAir(s: BlockState): boolean {
  return s.name === 'air' || s.name === 'cave_air' || s.name === 'void_air';
}
