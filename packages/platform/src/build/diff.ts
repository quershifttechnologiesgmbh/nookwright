/** Build: Versions-Diff zwischen zwei Registries (Bericht bei Versions-Updates). Rein funktional. */
import { BLOCK_RENAMES } from '../renames.js';
import type { RegistryData } from '../types.js';

export interface PropertyChange {
  readonly block: string;
  /** neue Properties (mit Werten) */
  readonly addedProps: Readonly<Record<string, readonly string[]>>;
  /** entfernte Properties */
  readonly removedProps: readonly string[];
  /** Properties mit geänderter Werteliste */
  readonly changedValues: Readonly<Record<string, { readonly added: readonly string[]; readonly removed: readonly string[] }>>;
  /** Geänderte Defaults (nur Properties, die es in beiden Versionen gibt) */
  readonly changedDefaults: Readonly<Record<string, { readonly from: string; readonly to: string }>>;
}

export interface RegistryDiff {
  readonly from: string;
  readonly to: string;
  readonly blocks: { readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly items: { readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly lootTables: { readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly propertyChanges: readonly PropertyChange[];
  /** Heuristisch erkannte Umbenennungen (entfernt → hinzugefügt, gleiche Properties, Namens-Ähnlichkeit) */
  readonly probableRenames: readonly { readonly from: string; readonly to: string }[];
}

/** Bekannte Umbenennungen alt → neu (Quelle: ../renames.ts), die sich nicht eindeutig heuristisch erkennen lassen. */
export const KNOWN_RENAMES: Readonly<Record<string, string>> = Object.fromEntries(BLOCK_RENAMES.map((r) => [r.from, r.to]));

function setDiff(a: readonly string[], b: readonly string[]): { added: string[]; removed: string[] } {
  const A = new Set(a);
  const B = new Set(b);
  return { added: b.filter((x) => !A.has(x)).sort(), removed: a.filter((x) => !B.has(x)).sort() };
}

export function diffRegistries(a: RegistryData, b: RegistryData): RegistryDiff {
  const blocks = setDiff(Object.keys(a.blocks), Object.keys(b.blocks));
  const propertyChanges: PropertyChange[] = [];
  for (const name of Object.keys(a.blocks).sort()) {
    const da = a.blocks[name];
    const db = b.blocks[name];
    if (!da || !db) continue;
    const addedProps: Record<string, readonly string[]> = {};
    const removedProps: string[] = [];
    const changedValues: Record<string, { added: string[]; removed: string[] }> = {};
    const changedDefaults: Record<string, { from: string; to: string }> = {};
    for (const [k, vals] of Object.entries(db.properties)) {
      const old = da.properties[k];
      if (!old) {
        addedProps[k] = vals;
        continue;
      }
      const d = setDiff(old, vals);
      if (d.added.length || d.removed.length) changedValues[k] = d;
      const fa = da.default[k];
      const fb = db.default[k];
      if (fa !== undefined && fb !== undefined && fa !== fb) changedDefaults[k] = { from: fa, to: fb };
    }
    for (const k of Object.keys(da.properties)) if (!db.properties[k]) removedProps.push(k);
    if (
      Object.keys(addedProps).length || removedProps.length || Object.keys(changedValues).length ||
      Object.keys(changedDefaults).length
    ) {
      propertyChanges.push({ block: name, addedProps, removedProps, changedValues, changedDefaults });
    }
  }
  // Umbenennungen: entfernter Block, dessen Name als Suffix/Teil eines neuen Namens auftaucht, mit gleichen Properties
  const probableRenames: { from: string; to: string }[] = [];
  for (const r of blocks.removed) {
    const known = KNOWN_RENAMES[r];
    if (known && blocks.added.includes(known)) {
      probableRenames.push({ from: r, to: known });
      continue;
    }
    const pr = JSON.stringify(a.blocks[r]?.properties);
    const cand = blocks.added.filter(
      (n) => (n.endsWith(`_${r}`) || n.startsWith(`${r}_`) || n.includes(r)) && JSON.stringify(b.blocks[n]?.properties) === pr,
    );
    if (cand.length === 1 && cand[0]) probableRenames.push({ from: r, to: cand[0] });
  }
  return {
    from: a.version,
    to: b.version,
    blocks,
    items: setDiff(a.items, b.items),
    lootTables: setDiff(a.lootTables, b.lootTables),
    propertyChanges,
    probableRenames,
  };
}
