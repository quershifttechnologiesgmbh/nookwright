/**
 * Binäres NBT (Java Edition, Big Endian) – Writer und Reader.
 * Browser-tauglich (nur Uint8Array/DataView), keine Node-Abhängigkeit.
 * Strings: Java „Modified UTF-8“ (U+0000 als C0 80, Surrogates einzeln mit je 3 Bytes).
 */
import {
  NBT_TYPE_BY_ID, NBT_TYPE_IDS, setOwn,
  type NbtCompound, type NbtListItemType, type NbtTag,
} from './tag.js';

class ByteWriter {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  private pos = 0;

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number): void { this.ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  i8(v: number): void { this.ensure(1); this.view.setInt8(this.pos, v); this.pos += 1; }
  i16(v: number): void { this.ensure(2); this.view.setInt16(this.pos, v); this.pos += 2; }
  u16(v: number): void { this.ensure(2); this.view.setUint16(this.pos, v); this.pos += 2; }
  i32(v: number): void { this.ensure(4); this.view.setInt32(this.pos, v); this.pos += 4; }
  i64(v: bigint): void { this.ensure(8); this.view.setBigInt64(this.pos, v); this.pos += 8; }
  f32(v: number): void { this.ensure(4); this.view.setFloat32(this.pos, v); this.pos += 4; }
  f64(v: number): void { this.ensure(8); this.view.setFloat64(this.pos, v); this.pos += 8; }
  bytes(b: Uint8Array): void { this.ensure(b.length); this.buf.set(b, this.pos); this.pos += b.length; }
  result(): Uint8Array { return this.buf.slice(0, this.pos); }
}

export function encodeMutf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i); // UTF-16 code unit → Surrogates werden einzeln kodiert (MUTF-8/CESU-8)
    if (c !== 0 && c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

export function decodeMutf8(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length;) {
    const a = b[i]!;
    let code: number;
    if (a < 0x80) { code = a; i += 1; }
    else if ((a & 0xe0) === 0xc0) { code = ((a & 0x1f) << 6) | (b[i + 1]! & 0x3f); i += 2; }
    else if ((a & 0xf0) === 0xe0) {
      code = ((a & 0x0f) << 12) | ((b[i + 1]! & 0x3f) << 6) | (b[i + 2]! & 0x3f); i += 3;
    } else {
      // Echtes 4-Byte-UTF-8 kommt in Java-NBT nicht vor; tolerant dekodieren.
      const cp = ((a & 0x07) << 18) | ((b[i + 1]! & 0x3f) << 12) | ((b[i + 2]! & 0x3f) << 6) | (b[i + 3]! & 0x3f);
      s += String.fromCodePoint(cp); i += 4; continue;
    }
    s += String.fromCharCode(code);
  }
  return s;
}

function writeString(w: ByteWriter, s: string): void {
  const b = encodeMutf8(s);
  if (b.length > 0xffff) throw new RangeError(`NBT-String zu lang (${b.length} Bytes > 65535)`);
  w.u16(b.length);
  w.bytes(b);
}

function writePayload(w: ByteWriter, t: NbtTag): void {
  switch (t.type) {
    case 'byte': w.i8(t.value); break;
    case 'short': w.i16(t.value); break;
    case 'int': w.i32(t.value); break;
    case 'long': w.i64(t.value); break;
    case 'float': w.f32(t.value); break;
    case 'double': w.f64(t.value); break;
    case 'string': writeString(w, t.value); break;
    case 'byte_array':
      w.i32(t.value.length);
      w.bytes(new Uint8Array(t.value.buffer, t.value.byteOffset, t.value.length));
      break;
    case 'int_array':
      w.i32(t.value.length);
      for (const v of t.value) w.i32(v);
      break;
    case 'long_array':
      w.i32(t.value.length);
      for (const v of t.value) w.i64(v);
      break;
    case 'list': {
      const itemType: NbtListItemType = t.value.length === 0 ? 'end' : t.itemType;
      w.u8(NBT_TYPE_IDS[itemType]);
      w.i32(t.value.length);
      for (const it of t.value) {
        if (it.type !== itemType) throw new TypeError(`NBT-Liste list<${itemType}> enthält ${it.type}`);
        writePayload(w, it);
      }
      break;
    }
    case 'compound':
      for (const [k, v] of Object.entries(t.value)) {
        w.u8(NBT_TYPE_IDS[v.type]);
        writeString(w, k);
        writePayload(w, v);
      }
      w.u8(0);
      break;
  }
}

/** Serialisiert einen Root-Compound (unkomprimiert). Minecraft-Dateien nutzen den Root-Namen "". */
export function encodeNbt(root: NbtCompound, rootName = ''): Uint8Array {
  const w = new ByteWriter();
  w.u8(NBT_TYPE_IDS.compound);
  writeString(w, rootName);
  writePayload(w, root);
  return w.result();
}

class ByteReader {
  private readonly view: DataView;
  pos = 0;
  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new RangeError(`NBT: unerwartetes Dateiende bei Byte ${this.pos}`);
  }
  u8(): number { this.need(1); return this.view.getUint8(this.pos++); }
  i8(): number { this.need(1); return this.view.getInt8(this.pos++); }
  i16(): number { this.need(2); const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
  u16(): number { this.need(2); const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  i32(): number { this.need(4); const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  i64(): bigint { this.need(8); const v = this.view.getBigInt64(this.pos); this.pos += 8; return v; }
  f32(): number { this.need(4); const v = this.view.getFloat32(this.pos); this.pos += 4; return v; }
  f64(): number { this.need(8); const v = this.view.getFloat64(this.pos); this.pos += 8; return v; }
  bytes(n: number): Uint8Array { this.need(n); const b = this.buf.slice(this.pos, this.pos + n); this.pos += n; return b; }
  get remaining(): number { return this.buf.length - this.pos; }
}

const MAX_DEPTH = 512;

function readPayload(r: ByteReader, typeId: number, depth: number): NbtTag {
  if (depth > MAX_DEPTH) throw new RangeError('NBT: Verschachtelung zu tief');
  const type = NBT_TYPE_BY_ID[typeId];
  switch (type) {
    case 'byte': return { type, value: r.i8() };
    case 'short': return { type, value: r.i16() };
    case 'int': return { type, value: r.i32() };
    case 'long': return { type, value: r.i64() };
    case 'float': return { type, value: r.f32() };
    case 'double': return { type, value: r.f64() };
    case 'string': return { type, value: decodeMutf8(r.bytes(r.u16())) };
    case 'byte_array': {
      const n = checkLen(r.i32(), r, 1);
      const b = r.bytes(n);
      return { type, value: new Int8Array(b.buffer, b.byteOffset, b.length) };
    }
    case 'int_array': {
      const n = checkLen(r.i32(), r, 4);
      const a = new Int32Array(n);
      for (let i = 0; i < n; i++) a[i] = r.i32();
      return { type, value: a };
    }
    case 'long_array': {
      const n = checkLen(r.i32(), r, 8);
      const a = new BigInt64Array(n);
      for (let i = 0; i < n; i++) a[i] = r.i64();
      return { type, value: a };
    }
    case 'list': {
      const itemId = r.u8();
      const itemType = NBT_TYPE_BY_ID[itemId];
      if (itemType === undefined) throw new TypeError(`NBT: unbekannter Listen-Elementtyp ${itemId}`);
      const n = r.i32();
      if (n < 0) throw new RangeError('NBT: negative Listenlänge');
      if (itemType === 'end' && n > 0) throw new TypeError('NBT: Liste vom Typ End mit Elementen');
      const items: NbtTag[] = [];
      for (let i = 0; i < n; i++) items.push(readPayload(r, itemId, depth + 1));
      return { type, itemType, value: items };
    }
    case 'compound': {
      const value: Record<string, NbtTag> = {};
      for (;;) {
        const id = r.u8();
        if (id === 0) break;
        const key = decodeMutf8(r.bytes(r.u16()));
        setOwn(value, key, readPayload(r, id, depth + 1));
      }
      return { type, value };
    }
    default:
      throw new TypeError(`NBT: unbekannter Tag-Typ ${typeId}`);
  }
}

function checkLen(n: number, r: ByteReader, elemSize: number): number {
  if (n < 0 || n * elemSize > r.remaining) throw new RangeError(`NBT: ungültige Array-Länge ${n}`);
  return n;
}

export interface DecodedNbt { name: string; root: NbtCompound }

/** Liest unkomprimiertes NBT mit Root-Compound. */
export function decodeNbt(bytes: Uint8Array): DecodedNbt {
  const r = new ByteReader(bytes);
  const id = r.u8();
  if (id !== NBT_TYPE_IDS.compound) throw new TypeError(`NBT: Root ist kein Compound (Typ ${id})`);
  const name = decodeMutf8(r.bytes(r.u16()));
  const root = readPayload(r, id, 0);
  if (r.remaining !== 0) throw new RangeError(`NBT: ${r.remaining} überzählige Bytes nach Root`);
  return { name, root: root as NbtCompound };
}
