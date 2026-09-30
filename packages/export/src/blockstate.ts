/** Block-State-Helfer des Exporters: Namensnormalisierung, kanonische State-Strings, Palettenformat. */
import { nbt, reqTag, type NbtCompound } from './nbt/tag.js';

export const AIR = 'minecraft:air';
export const STRUCTURE_VOID = 'minecraft:structure_void';

/** Kanonischer State im Exporter: Name MIT Namespace, Properties alphabetisch sortiert. */
export interface ExportState {
  readonly name: string;
  readonly properties: Readonly<Record<string, string>>;
}

const ID_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const PROP_RE = /^[a-z0-9_]+$/;

/** `oak_stairs` → `minecraft:oak_stairs`; prüft das Resource-Location-Format. */
export function normalizeName(name: string): string {
  const n = name.includes(':') ? name : `minecraft:${name}`;
  if (!ID_RE.test(n)) throw new Error(`Ungültige Block-ID: ${name}`);
  return n;
}

export function isAir(name: string): boolean {
  const n = normalizeName(name);
  return n === AIR || n === 'minecraft:cave_air' || n === 'minecraft:void_air';
}

/** Properties alphabetisch sortiert; fehlende Properties → {}. */
export function canonicalProperties(p: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!p) return out;
  for (const k of Object.keys(p).sort()) {
    const v = p[k]!;
    if (!PROP_RE.test(k) || !PROP_RE.test(v)) throw new Error(`Ungültige Block-Property ${k}=${v}`);
    out[k] = v;
  }
  return out;
}

export function canonicalState(name: string, properties?: Readonly<Record<string, string>>): ExportState {
  return { name: normalizeName(name), properties: canonicalProperties(properties) };
}

/** `minecraft:oak_stairs[facing=north,half=bottom]` (Properties sortiert → eindeutiger Paletten-Key). */
export function stateToString(s: ExportState): string {
  const keys = Object.keys(s.properties).sort();
  if (keys.length === 0) return s.name;
  return `${s.name}[${keys.map((k) => `${k}=${s.properties[k]}`).join(',')}]`;
}

export function parseStateString(str: string): ExportState {
  const m = /^([^[\]]+)(?:\[(.*)\])?$/.exec(str.trim());
  if (!m) throw new Error(`Ungültiger Block-State-String: ${str}`);
  const properties: Record<string, string> = {};
  if (m[2] !== undefined && m[2].length > 0) {
    for (const part of m[2].split(',')) {
      const eq = part.indexOf('=');
      if (eq < 1) throw new Error(`Ungültige Property in ${str}: ${part}`);
      properties[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  return canonicalState(m[1]!, properties);
}

/** Vanilla-/Litematica-Palettenformat: {Name, Properties?{k: string}}. */
export function stateToNbt(s: ExportState): NbtCompound {
  const keys = Object.keys(s.properties);
  return nbt.compound({
    Name: nbt.string(s.name),
    Properties: keys.length === 0
      ? undefined
      : nbt.compound(Object.fromEntries(keys.map((k) => [k, nbt.string(s.properties[k]!)]))),
  });
}

export function stateFromNbt(c: NbtCompound): ExportState {
  const name = reqTag(c, 'Name', 'string').value;
  const propsTag = c.value['Properties'];
  const properties: Record<string, string> = {};
  if (propsTag !== undefined) {
    if (propsTag.type !== 'compound') throw new TypeError('Properties ist kein Compound');
    for (const [k, v] of Object.entries(propsTag.value)) {
      if (v.type !== 'string') throw new TypeError(`Property ${k} ist kein String (${v.type})`);
      properties[k] = v.value;
    }
  }
  return canonicalState(name, properties);
}

/** Palette mit stabiler Einfügereihenfolge (intern für die Writer). */
export class StatePalette {
  private readonly index = new Map<string, number>();
  readonly states: ExportState[] = [];

  idFor(s: ExportState): number {
    const key = stateToString(s);
    let id = this.index.get(key);
    if (id === undefined) {
      id = this.states.length;
      this.index.set(key, id);
      this.states.push(s);
    }
    return id;
  }

  get size(): number {
    return this.states.length;
  }
}
