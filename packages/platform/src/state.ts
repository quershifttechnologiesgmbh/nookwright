/** Block-IDs und State-Strings: Normalisierung, Parsen, kanonisches Formatieren. Rein, ohne Registry. */
import type { BlockState } from './types.js';

const NS = 'minecraft:';

/** Entfernt den Namespace `minecraft:`. Fremde Namespaces bleiben erhalten (→ unbekannt). */
export function normalizeId(id: string): string {
  const t = id.trim();
  return t.startsWith(NS) ? t.slice(NS.length) : t;
}

/**
 * Parst `minecraft:oak_stairs[facing=east,half=top]` bzw. `oak_stairs`.
 * Wirft bei Syntaxfehlern; prüft NICHT gegen die Registry (dafür `Registry.parseState`).
 */
export function parseStateString(input: string): BlockState {
  const s = input.trim();
  const open = s.indexOf('[');
  if (open === -1) return { name: normalizeId(s), properties: {} };
  if (!s.endsWith(']')) throw new Error(`Ungültiger Block-State: ${input}`);
  const name = normalizeId(s.slice(0, open));
  const body = s.slice(open + 1, -1).trim();
  const properties: Record<string, string> = {};
  if (body.length > 0) {
    for (const part of body.split(',')) {
      const eq = part.indexOf('=');
      if (eq <= 0) throw new Error(`Ungültige Property "${part}" in ${input}`);
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (Object.hasOwn(properties, k)) throw new Error(`Property "${k}" doppelt in ${input}`);
      properties[k] = v;
    }
  }
  return { name, properties };
}

/** Formatiert einen State kanonisch (Properties alphabetisch, standardmäßig mit Namespace). */
export function formatState(state: BlockState, withNamespace = true): string {
  const keys = Object.keys(state.properties).sort();
  const base = (withNamespace ? NS : '') + state.name;
  if (keys.length === 0) return base;
  return `${base}[${keys.map((k) => `${k}=${state.properties[k]}`).join(',')}]`;
}
