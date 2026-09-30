/**
 * Kleiner, typsicherer NBT-Baum (Plain-Data, discriminated union).
 *
 * Designziele:
 * - Jeder Tag trägt seinen NBT-Typ explizit (`type`), damit z. B. `Slot` (byte),
 *   `count` (int), `Rotation` (float-Liste) und `Pos` (double-Liste) nie „erraten“ werden.
 * - Reine Daten (keine Klassen): structured-clone-fähig (Web Worker), JSON-serialisierbar
 *   über `toTypedJson`, direkt mit `deepEqual` vergleichbar.
 * - Longs als `bigint`, Long-Arrays als `BigInt64Array` (signed, wie in Java).
 */

export type NbtScalarType = 'byte' | 'short' | 'int' | 'long' | 'float' | 'double' | 'string';
export type NbtArrayType = 'byte_array' | 'int_array' | 'long_array';
export type NbtType = NbtScalarType | NbtArrayType | 'list' | 'compound';
/** Elementtyp einer Liste; `end` nur für leere Listen (so schreibt es auch Minecraft). */
export type NbtListItemType = NbtType | 'end';

export interface NbtByte { readonly type: 'byte'; readonly value: number }
export interface NbtShort { readonly type: 'short'; readonly value: number }
export interface NbtInt { readonly type: 'int'; readonly value: number }
export interface NbtLong { readonly type: 'long'; readonly value: bigint }
export interface NbtFloat { readonly type: 'float'; readonly value: number }
export interface NbtDouble { readonly type: 'double'; readonly value: number }
export interface NbtString { readonly type: 'string'; readonly value: string }
export interface NbtByteArray { readonly type: 'byte_array'; readonly value: Int8Array }
export interface NbtIntArray { readonly type: 'int_array'; readonly value: Int32Array }
export interface NbtLongArray { readonly type: 'long_array'; readonly value: BigInt64Array }
export interface NbtList<T extends NbtTag = NbtTag> {
  readonly type: 'list';
  readonly itemType: NbtListItemType;
  readonly value: readonly T[];
}
export interface NbtCompound {
  readonly type: 'compound';
  readonly value: { readonly [key: string]: NbtTag };
}

export type NbtTag =
  | NbtByte | NbtShort | NbtInt | NbtLong | NbtFloat | NbtDouble | NbtString
  | NbtByteArray | NbtIntArray | NbtLongArray | NbtList | NbtCompound;

/** Tag-Typ zu Tag-Interface. */
export type NbtTagOf<T extends NbtType> = Extract<NbtTag, { type: T }>;

export const NBT_TYPE_IDS: Readonly<Record<NbtListItemType, number>> = {
  end: 0, byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, byte_array: 7,
  string: 8, list: 9, compound: 10, int_array: 11, long_array: 12,
};
export const NBT_TYPE_BY_ID: readonly NbtListItemType[] = [
  'end', 'byte', 'short', 'int', 'long', 'float', 'double', 'byte_array',
  'string', 'list', 'compound', 'int_array', 'long_array',
];

const ALL_TYPES = new Set<string>(NBT_TYPE_BY_ID);

function checkInt(v: number, min: number, max: number, what: string): number {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new RangeError(`NBT ${what}: Wert ${v} liegt nicht im Bereich [${min}, ${max}]`);
  }
  return v;
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/** Builder – die einzige empfohlene Art, Tags zu bauen (prüft Wertebereiche). */
export const nbt = {
  byte: (v: number | boolean): NbtByte =>
    ({ type: 'byte', value: typeof v === 'boolean' ? (v ? 1 : 0) : checkInt(v, -128, 127, 'byte') }),
  short: (v: number): NbtShort => ({ type: 'short', value: checkInt(v, -32768, 32767, 'short') }),
  /** Unsigned short (0..65535) im signed-Short-Tag, z. B. Sponge Width/Height/Length. */
  ushort: (v: number): NbtShort => ({ type: 'short', value: (checkInt(v, 0, 65535, 'ushort') << 16) >> 16 }),
  int: (v: number): NbtInt => ({ type: 'int', value: checkInt(v, -2147483648, 2147483647, 'int') }),
  long: (v: bigint | number): NbtLong => {
    const b = typeof v === 'bigint' ? v : BigInt(checkInt(v, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'long'));
    if (b < INT64_MIN || b > INT64_MAX) throw new RangeError(`NBT long: ${b} außerhalb int64`);
    return { type: 'long', value: b };
  },
  /** Float wird sofort auf 32 bit gerundet, damit Round-Trips exakt vergleichbar sind. */
  float: (v: number): NbtFloat => ({ type: 'float', value: Math.fround(v) }),
  double: (v: number): NbtDouble => ({ type: 'double', value: v }),
  string: (v: string): NbtString => ({ type: 'string', value: v }),
  byteArray: (v: ArrayLike<number>): NbtByteArray => ({ type: 'byte_array', value: Int8Array.from(v) }),
  intArray: (v: ArrayLike<number>): NbtIntArray => ({ type: 'int_array', value: Int32Array.from(v) }),
  longArray: (v: ArrayLike<bigint> | BigInt64Array): NbtLongArray =>
    ({ type: 'long_array', value: v instanceof BigInt64Array ? v : BigInt64Array.from(v as ArrayLike<bigint>) }),
  /** Homogene Liste mit explizitem Elementtyp (Compile-Zeit + Laufzeit geprüft). */
  list: <T extends NbtType>(itemType: T, items: readonly NbtTagOf<NoInfer<T>>[]): NbtList<NbtTagOf<T>> => {
    for (const it of items) {
      if (it.type !== itemType) throw new TypeError(`NBT list<${itemType}> enthält ${it.type}`);
    }
    return { type: 'list', itemType: items.length === 0 ? 'end' : itemType, value: items };
  },
  /** Leere Liste (Elementtyp TAG_End, wie Minecraft sie schreibt). */
  emptyList: (): NbtList => ({ type: 'list', itemType: 'end', value: [] }),
  compound: (entries: { readonly [key: string]: NbtTag | undefined }): NbtCompound => {
    const value: Record<string, NbtTag> = {};
    for (const [k, v] of Object.entries(entries)) {
      if (v !== undefined) setOwn(value, k, v);
    }
    return { type: 'compound', value };
  },
  // Komfort für häufige Listen
  doubles: (v: readonly number[]) => nbt.list('double', v.map((x) => nbt.double(x))),
  floats: (v: readonly number[]) => nbt.list('float', v.map((x) => nbt.float(x))),
  ints: (v: readonly number[]) => nbt.list('int', v.map((x) => nbt.int(x))),
  strings: (v: readonly string[]) => nbt.list('string', v.map((x) => nbt.string(x))),
  compounds: (v: readonly NbtCompound[]) => nbt.list('compound', v),
} as const;

/** Setzt einen Key auch dann als eigene Property, wenn er `__proto__` heißt. */
export function setOwn(obj: Record<string, NbtTag>, key: string, v: NbtTag): void {
  if (key === '__proto__') {
    Object.defineProperty(obj, key, { value: v, enumerable: true, writable: true, configurable: true });
  } else {
    obj[key] = v;
  }
}

export function isNbtTag(x: unknown): x is NbtTag {
  if (typeof x !== 'object' || x === null) return false;
  const t = (x as { type?: unknown }).type;
  if (typeof t !== 'string' || !ALL_TYPES.has(t) || t === 'end') return false;
  const keys = Object.keys(x);
  const expected = t === 'list' ? 3 : 2;
  if (keys.length !== expected || !('value' in x)) return false;
  const v = (x as { value: unknown }).value;
  switch (t) {
    case 'byte': case 'short': case 'int': case 'float': case 'double': return typeof v === 'number';
    case 'long': return typeof v === 'bigint';
    case 'string': return typeof v === 'string';
    case 'byte_array': return v instanceof Int8Array;
    case 'int_array': return v instanceof Int32Array;
    case 'long_array': return v instanceof BigInt64Array;
    case 'list': return Array.isArray(v) && 'itemType' in x;
    case 'compound': return typeof v === 'object' && v !== null && !Array.isArray(v);
    default: return false;
  }
}

/**
 * Wandelt einen „NBT-ähnlichen“ JS-Wert in einen typisierten Tag (Komfort für Tests, Import und
 * Katalogdaten; das Modell selbst verlangt typisierte `NbtCompound`s).
 *
 * - Bereits typisierte Tags (aus `nbt.*`) werden unverändert übernommen – so MUSS man alle
 *   typkritischen Felder angeben (Slot=byte, Facing=byte, Rotation=float[], Pos=double[] ...).
 * - Inferenz für untypisierte Werte: string→string, boolean→byte, bigint→long,
 *   ganze Zahl→int, sonstige Zahl→double, Int8Array/Int32Array/BigInt64Array→Arrays,
 *   Array→Liste (homogen!), Objekt→Compound, undefined/null→Key entfällt.
 */
export function toNbt(value: unknown, path = '$'): NbtTag {
  if (isNbtTag(value)) return value;
  switch (typeof value) {
    case 'string': return nbt.string(value);
    case 'boolean': return nbt.byte(value);
    case 'bigint': return nbt.long(value);
    case 'number': return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
      ? nbt.int(value) : nbt.double(value);
    case 'object': {
      if (value === null) break;
      if (value instanceof Int8Array) return nbt.byteArray(value);
      if (value instanceof Int32Array) return nbt.intArray(value);
      if (value instanceof BigInt64Array) return nbt.longArray(value);
      if (Array.isArray(value)) {
        const items = value.map((v, i) => toNbt(v, `${path}[${i}]`));
        if (items.length === 0) return nbt.emptyList();
        const t = items[0]!.type;
        for (const [i, it] of items.entries()) {
          if (it.type !== t) {
            throw new TypeError(`NBT: heterogene Liste bei ${path}[${i}] (${t} vs ${it.type}). Explizit typisieren!`);
          }
        }
        return { type: 'list', itemType: t, value: items };
      }
      return toNbtCompound(value as Record<string, unknown>, path);
    }
    default: break;
  }
  throw new TypeError(`NBT: Wert bei ${path} nicht konvertierbar: ${String(value)}`);
}

export function toNbtCompound(obj: Readonly<Record<string, unknown>>, path = '$'): NbtCompound {
  if (isNbtTag(obj)) {
    if (obj.type !== 'compound') throw new TypeError(`NBT: bei ${path} Compound erwartet, ${obj.type} erhalten`);
    return obj;
  }
  const out: Record<string, NbtTag> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    setOwn(out, k, toNbt(v, `${path}.${k}`));
  }
  return { type: 'compound', value: out };
}

// ---------------------------------------------------------------------------
// Zugriffshelfer (für Reader)
// ---------------------------------------------------------------------------

export function getTag<T extends NbtType>(c: NbtCompound, key: string, type: T): NbtTagOf<T> | undefined {
  const t = Object.prototype.hasOwnProperty.call(c.value, key) ? c.value[key] : undefined;
  if (t === undefined) return undefined;
  if (t.type !== type) throw new TypeError(`NBT: ${key} hat Typ ${t.type}, erwartet ${type}`);
  return t as NbtTagOf<T>;
}

export function reqTag<T extends NbtType>(c: NbtCompound, key: string, type: T): NbtTagOf<T> {
  const t = getTag(c, key, type);
  if (t === undefined) throw new TypeError(`NBT: Pflichtfeld ${key} (${type}) fehlt`);
  return t;
}

/** Liste mit erwartetem Elementtyp; leere Listen (TAG_End) sind erlaubt. */
export function reqList<T extends NbtType>(c: NbtCompound, key: string, itemType: T): readonly NbtTagOf<T>[] {
  const l = reqTag(c, key, 'list');
  if (l.value.length > 0 && l.itemType !== itemType) {
    throw new TypeError(`NBT: ${key} ist list<${l.itemType}>, erwartet list<${itemType}>`);
  }
  return l.value as readonly NbtTagOf<T>[];
}

export function omitKeys(c: NbtCompound, keys: readonly string[]): NbtCompound {
  const out: Record<string, NbtTag> = {};
  for (const [k, v] of Object.entries(c.value)) if (!keys.includes(k)) setOwn(out, k, v);
  return { type: 'compound', value: out };
}

// ---------------------------------------------------------------------------
// Typed JSON (für Manifeste / Python-Gegenprüfung) und SNBT (Debug-Ausgabe)
// ---------------------------------------------------------------------------

export type TypedJson =
  | { type: 'byte' | 'short' | 'int' | 'float' | 'double'; value: number }
  | { type: 'long'; value: string }
  | { type: 'string'; value: string }
  | { type: 'byte_array' | 'int_array'; value: number[] }
  | { type: 'long_array'; value: string[] }
  | { type: 'list'; itemType: NbtListItemType; value: TypedJson[] }
  | { type: 'compound'; value: Record<string, TypedJson> };

export function toTypedJson(t: NbtTag): TypedJson {
  switch (t.type) {
    case 'long': return { type: 'long', value: t.value.toString() };
    case 'byte_array': case 'int_array': return { type: t.type, value: Array.from(t.value) };
    case 'long_array': return { type: 'long_array', value: Array.from(t.value, (x) => x.toString()) };
    case 'list': return { type: 'list', itemType: t.itemType, value: t.value.map(toTypedJson) };
    case 'compound': {
      const value: Record<string, TypedJson> = {};
      for (const [k, v] of Object.entries(t.value)) value[k] = toTypedJson(v);
      return { type: 'compound', value };
    }
    default: return { type: t.type, value: t.value } as TypedJson;
  }
}

const SNBT_PLAIN_KEY = /^[A-Za-z0-9._+-]+$/;
function snbtString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** SNBT-Darstellung (nur für Logs/Bericht; kein Parser). */
export function toSnbt(t: NbtTag): string {
  switch (t.type) {
    case 'byte': return `${t.value}b`;
    case 'short': return `${t.value}s`;
    case 'int': return `${t.value}`;
    case 'long': return `${t.value}L`;
    case 'float': return `${t.value}f`;
    case 'double': return `${t.value}d`;
    case 'string': return snbtString(t.value);
    case 'byte_array': return `[B;${Array.from(t.value, (x) => `${x}b`).join(',')}]`;
    case 'int_array': return `[I;${Array.from(t.value).join(',')}]`;
    case 'long_array': return `[L;${Array.from(t.value, (x) => `${x}L`).join(',')}]`;
    case 'list': return `[${t.value.map(toSnbt).join(',')}]`;
    case 'compound':
      return `{${Object.entries(t.value)
        .map(([k, v]) => `${SNBT_PLAIN_KEY.test(k) ? k : snbtString(k)}:${toSnbt(v)}`)
        .join(',')}}`;
  }
}
