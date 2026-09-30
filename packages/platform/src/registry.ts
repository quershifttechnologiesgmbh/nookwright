/**
 * Typisierte Zugriffs-API auf eine generierte Registry (data/registry-<version>.json).
 * Rein, ohne Dateisystem – im Browser und in Node nutzbar. Laden übernimmt der Port `PlatformData`.
 */
import { BLOCK_RENAMES } from './renames.js';
import { formatState, normalizeId, parseStateString } from './state.js';
import { resolveTag } from './tags.js';
import type { BlockDef, BlockState, PropertyMap, RegistryData } from './types.js';

export type StateIssue =
  | { readonly kind: 'unknown_block'; readonly block: string }
  | { readonly kind: 'unknown_property'; readonly property: string }
  | { readonly kind: 'invalid_value'; readonly property: string; readonly value: string; readonly allowed: readonly string[] }
  | { readonly kind: 'missing_property'; readonly property: string };

export interface ValidateOptions {
  /** true: alle Properties müssen angegeben sein (Default: false – fehlende = Default-Wert) */
  readonly complete?: boolean;
}

export class Registry {
  readonly version: string;
  readonly dataVersion: number;
  private readonly data: RegistryData;
  private readonly itemSet: ReadonlySet<string>;
  private readonly lootSet: ReadonlySet<string>;
  private readonly tagSets = new Map<string, ReadonlySet<string>>();

  constructor(data: RegistryData) {
    this.data = data;
    this.version = data.version;
    this.dataVersion = data.dataVersion;
    this.itemSet = new Set(data.items);
    this.lootSet = new Set(data.lootTables);
  }

  // ------------------------------------------------------------ Blöcke

  hasBlock(id: string): boolean {
    return Object.hasOwn(this.data.blocks, normalizeId(id));
  }

  blockNames(): string[] {
    return Object.keys(this.data.blocks);
  }

  get blockCount(): number {
    return Object.keys(this.data.blocks).length;
  }

  /**
   * Name des Blocks in DIESER Version unter Berücksichtigung bekannter Umbenennungen
   * (z. B. `chain` ↔ `iron_chain` seit 1.21.9). `undefined`, wenn es keinen passenden Block gibt.
   */
  migrateBlockName(id: string): string | undefined {
    const start = normalizeId(id);
    const seen = new Set<string>([start]);
    const queue = [start];
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      if (this.hasBlock(name)) return name;
      for (const r of BLOCK_RENAMES) {
        const next = r.from === name ? r.to : r.to === name ? r.from : undefined;
        if (next !== undefined && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return undefined;
  }

  private def(id: string): BlockDef | undefined {
    const n = normalizeId(id);
    return Object.hasOwn(this.data.blocks, n) ? this.data.blocks[n] : undefined;
  }

  /** Property → erlaubte Werte; `undefined` wenn der Block unbekannt ist. */
  listProperties(id: string): Readonly<Record<string, readonly string[]>> | undefined {
    return this.def(id)?.properties;
  }

  /** Default-State; `undefined` wenn der Block unbekannt ist. */
  defaultState(id: string): BlockState | undefined {
    const d = this.def(id);
    if (!d) return undefined;
    return { name: normalizeId(id), properties: { ...d.default } };
  }

  /** Liefert alle Probleme eines (Teil-)States. Leeres Array = gültig. */
  validateState(id: string, props: PropertyMap = {}, opts: ValidateOptions = {}): StateIssue[] {
    const d = this.def(id);
    if (!d) return [{ kind: 'unknown_block', block: normalizeId(id) }];
    const issues: StateIssue[] = [];
    for (const [k, v] of Object.entries(props)) {
      const allowed = Object.hasOwn(d.properties, k) ? d.properties[k] : undefined;
      if (!allowed) issues.push({ kind: 'unknown_property', property: k });
      else if (!allowed.includes(v)) issues.push({ kind: 'invalid_value', property: k, value: v, allowed });
    }
    if (opts.complete) {
      for (const k of Object.keys(d.properties)) {
        if (!Object.hasOwn(props, k)) issues.push({ kind: 'missing_property', property: k });
      }
    }
    return issues;
  }

  isValidState(id: string, props: PropertyMap = {}, opts: ValidateOptions = {}): boolean {
    return this.validateState(id, props, opts).length === 0;
  }

  /** Ergänzt fehlende Properties mit Defaults. Wirft bei ungültigem State. */
  resolveState(id: string, props: PropertyMap = {}): BlockState {
    const issues = this.validateState(id, props);
    const d = this.def(id);
    if (issues.length > 0 || d === undefined) {
      throw new Error(`Ungültiger State ${formatState({ name: normalizeId(id), properties: props })}: ${JSON.stringify(issues)}`);
    }
    return { name: normalizeId(id), properties: { ...d.default, ...props } };
  }

  /** Parst und validiert einen State-String; wirft bei Fehlern. */
  parseState(input: string): BlockState {
    const s = parseStateString(input);
    return this.resolveState(s.name, s.properties);
  }

  /** Anzahl möglicher States eines Blocks (Produkt der Property-Wertanzahlen). */
  stateCount(id: string): number {
    const d = this.def(id);
    if (!d) return 0;
    return Object.values(d.properties).reduce((n, vals) => n * vals.length, 1);
  }

  // ------------------------------------------------------------ Items / Loot / Tags

  hasItem(id: string): boolean {
    return this.itemSet.has(normalizeId(id));
  }

  items(): readonly string[] {
    return this.data.items;
  }

  hasLootTable(id: string): boolean {
    return this.lootSet.has(normalizeId(id));
  }

  lootTables(): readonly string[] {
    return this.data.lootTables;
  }

  /** Aufgelöster Block-Tag (Eingabe mit/ohne `#`/Namespace); leeres Array wenn unbekannt. */
  blockTag(tag: string): readonly string[] {
    return [...this.tagSet(tag)];
  }

  hasBlockTag(block: string, tag: string): boolean {
    return this.tagSet(tag).has(normalizeId(block));
  }

  blockTagNames(): string[] {
    return Object.keys(this.data.blockTags);
  }

  private tagSet(tag: string): ReadonlySet<string> {
    const t = normalizeId(tag.replace(/^#/, ''));
    let set = this.tagSets.get(t);
    if (!set) {
      set = new Set(Object.hasOwn(this.data.blockTags, t) ? resolveTag(this.data.blockTags, t) : []);
      this.tagSets.set(t, set);
    }
    return set;
  }
}
