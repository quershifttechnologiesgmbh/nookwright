/**
 * Teilen per URL (DR5 K4): Bautyp, Seed, Würfel-Zähler und Generierparameter als versioniertes, kompaktes URL-Fragment
 * (`#b=1.<base64url>`). Das Fragment geht nie an einen Server. Bewusst **ohne** Nutzerdaten: kein Projektname, keine
 * Beschreibung/Prompts, keine Schlüssel, keine Editor-Änderungen – nur die Parameter-Namen aus {@link SHARE_PARAM_KEYS};
 * alles andere verwirft der Kodierer und meldet der Dekodierer als Warnung. Rein (kein I/O, kein DOM; nur `URLSearchParams` zum Lesen des Fragments).
 *
 * „Kompakt“: kurze Schlüssel (Tabelle je Version) und base64url über UTF-8-JSON. Keine Deflate-Stufe – die Nutzlast
 * ist klein (typisch 100–400 Zeichen) und das Paket bleibt ohne Abhängigkeit; eine Version 2 kann das nachrüsten.
 */

/** Wert eines geteilten Parameters (JSON ohne `null`). */
export type ShareValue = string | number | boolean | readonly ShareValue[] | { readonly [k: string]: ShareValue };

export interface SharedBuild {
  readonly buildingTypeId: string;
  readonly seed: number;
  /** „Grundriss neu würfeln“-Zähler (0 = erster Grundriss). */
  readonly rerollCount: number;
  /** Minecraft-Zielversion (Name, z. B. `1.21.11`); fehlt = Standard der App. */
  readonly targetVersion?: string;
  /** Generierparameter (Namen wie die Parameter des Bautyp-Assistenten bzw. von `building_generate`). */
  readonly params: Readonly<Record<string, ShareValue>>;
}

export const SHARE_VERSION = 1;
/** Schlüssel im Fragment: `#b=<version>.<nutzlast>`. */
export const SHARE_FRAGMENT_KEY = 'b';
/** Obergrenze der Fragment-Länge (Zeichen) – schützt vor absichtlich großen Links. */
export const SHARE_MAX_LENGTH = 2048;

/** Erlaubte Parameter und ihr Kurzschlüssel in Version 1 (Reihenfolge = Reihenfolge im Fragment). */
export const SHARE_PARAM_KEYS = {
  size: 'z', front: 'f', floors: 'n', themeId: 'th', paletteId: 'pa', paletteOverrides: 'po', exterior: 'x', site: 'si',
  shell: 'sh', setting: 'se', blockRules: 'br', ensemble: 'en', storyState: 'st', underground: 'u', functionLevel: 'fl',
  silhouette: 'sil', landform: 'lf', facadeRhythm: 'fr',
} as const satisfies Readonly<Record<string, string>>;
export type ShareParamKey = keyof typeof SHARE_PARAM_KEYS;

const LONG = new Map<string, string>(Object.entries(SHARE_PARAM_KEYS).map(([long, short]) => [short, long]));
const ID = /^[a-z0-9_:.-]{1,64}$/i;
const MAX_DEPTH = 5;

// ------------------------------------------------------------------ base64url (ohne btoa/Buffer)
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function fromUtf8(b: readonly number[]): string {
  let s = '';
  for (let i = 0; i < b.length;) {
    const x = b[i]!;
    const n = x < 0x80 ? 1 : x >= 0xf0 ? 4 : x >= 0xe0 ? 3 : 2;
    let c = n === 1 ? x : x & (0xff >> (n + 1));
    for (let k = 1; k < n; k++) c = (c << 6) | ((b[i + k] ?? 0) & 63);
    s += String.fromCodePoint(c);
    i += n;
  }
  return s;
}

export function toBase64Url(bytes: readonly number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2;
    for (let k = 0; k < chars; k++) s += ALPHABET[(n >> (18 - 6 * k)) & 63];
  }
  return s;
}

export function fromBase64Url(s: string): number[] | undefined {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const chunk = s.slice(i, i + 4);
    if (chunk.length === 1) return undefined;
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const v = k < chunk.length ? INDEX.get(chunk[k]!) : 0;
      if (v === undefined) return undefined;
      n = (n << 6) | v;
    }
    out.push((n >> 16) & 255);
    if (chunk.length > 2) out.push((n >> 8) & 255);
    if (chunk.length > 3) out.push(n & 255);
  }
  return out;
}

// ------------------------------------------------------------------ Prüfung der Werte
function cleanValue(v: unknown, depth: number): ShareValue | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return v.length <= 64 ? v : undefined;
  if (depth >= MAX_DEPTH || v === null || typeof v !== 'object') return undefined;
  if (Array.isArray(v)) {
    if (v.length > 256) return undefined;
    const items = v.map((x) => cleanValue(x, depth + 1));
    return items.every((x) => x !== undefined) ? items as ShareValue[] : undefined;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 64) return undefined;
  const out: Record<string, ShareValue> = {};
  for (const [k, x] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!ID.test(k)) return undefined;
    const c = cleanValue(x, depth + 1);
    if (c === undefined) return undefined;
    out[k] = c;
  }
  return out;
}

/** Nur erlaubte Parameter, `undefined`-Felder weg, verschachtelte Objekte mit sortierten Schlüsseln (kanonisch). */
export function shareParamsOf(params: Readonly<Record<string, unknown>>): Record<string, ShareValue> {
  const out: Record<string, ShareValue> = {};
  for (const key of Object.keys(SHARE_PARAM_KEYS) as ShareParamKey[]) {
    const v = params[key];
    if (v === undefined) continue;
    const c = cleanValue(v, 0);
    if (c !== undefined) out[key] = c;
  }
  return out;
}

// ------------------------------------------------------------------ Fragment
/** Geteilten Bau als URL-Fragment (mit `#`). Gleicher Bau → gleiches Fragment (kanonische Reihenfolge). */
export function encodeShareFragment(b: SharedBuild): string {
  const p = shareParamsOf(b.params);
  const short: Record<string, ShareValue> = {};
  for (const key of Object.keys(SHARE_PARAM_KEYS) as ShareParamKey[]) if (p[key] !== undefined) short[SHARE_PARAM_KEYS[key]] = p[key]!;
  const payload = {
    t: b.buildingTypeId, s: b.seed, ...(b.rerollCount !== 0 ? { r: b.rerollCount } : {}), ...(b.targetVersion !== undefined ? { v: b.targetVersion } : {}),
    ...(Object.keys(short).length > 0 ? { p: short } : {}),
  };
  return `#${SHARE_FRAGMENT_KEY}=${SHARE_VERSION}.${toBase64Url(utf8(JSON.stringify(payload)))}`;
}

export type ShareDecode =
  | { readonly ok: true; readonly build: SharedBuild; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: string };

/** Enthält das Fragment (bzw. der ganze Link) einen geteilten Bau? */
export function hasShareFragment(hashOrUrl: string): boolean {
  const i = hashOrUrl.indexOf('#');
  return new URLSearchParams(i >= 0 ? hashOrUrl.slice(i + 1) : '').has(SHARE_FRAGMENT_KEY);
}

/** Fragment (`#b=…`, auch mit weiteren `&`-Teilen) bzw. ganzen Link lesen und prüfen. */
export function decodeShareFragment(hashOrUrl: string): ShareDecode {
  const i = hashOrUrl.indexOf('#');
  const raw = new URLSearchParams(i >= 0 ? hashOrUrl.slice(i + 1) : hashOrUrl).get(SHARE_FRAGMENT_KEY);
  if (raw === null) return { ok: false, error: 'Der Link enthält keinen geteilten Bau' };
  if (raw.length > SHARE_MAX_LENGTH) return { ok: false, error: 'Der geteilte Link ist zu lang' };
  const dot = raw.indexOf('.');
  const version = Number(raw.slice(0, dot));
  if (dot < 1 || !Number.isInteger(version)) return { ok: false, error: 'Der geteilte Link ist beschädigt' };
  if (version > SHARE_VERSION) return { ok: false, error: `Der Link stammt aus einer neueren Version (${version}); bitte die App aktualisieren` };
  if (version < 1) return { ok: false, error: 'Der geteilte Link ist beschädigt' };
  const bytes = fromBase64Url(raw.slice(dot + 1));
  let data: unknown;
  try {
    data = bytes === undefined ? undefined : JSON.parse(fromUtf8(bytes));
  } catch {
    data = undefined;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'Der geteilte Link ist beschädigt' };
  const d = data as Record<string, unknown>;
  const warnings: string[] = [];
  if (typeof d['t'] !== 'string' || !ID.test(d['t'])) return { ok: false, error: 'Der geteilte Link nennt keinen gültigen Bautyp' };
  const seed = d['s'];
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 2 ** 31 - 1) return { ok: false, error: 'Der geteilte Link hat keinen gültigen Seed' };
  const reroll = d['r'] ?? 0;
  if (typeof reroll !== 'number' || !Number.isInteger(reroll) || reroll < 0 || reroll > 999) return { ok: false, error: 'Der geteilte Link hat einen ungültigen Würfel-Zähler' };
  const tv = d['v'];
  if (tv !== undefined && (typeof tv !== 'string' || !ID.test(tv))) return { ok: false, error: 'Der geteilte Link hat eine ungültige Zielversion' };
  const params: Record<string, ShareValue> = {};
  const p = d['p'];
  if (p !== undefined) {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return { ok: false, error: 'Der geteilte Link ist beschädigt' };
    for (const [short, v] of Object.entries(p as Record<string, unknown>)) {
      const long = LONG.get(short);
      const c = long === undefined ? undefined : cleanValue(v, 0);
      if (long === undefined || c === undefined) warnings.push(`Unbekannter Parameter „${short}“ ignoriert`);
      else params[long] = c;
    }
  }
  for (const k of Object.keys(d)) if (!['t', 's', 'r', 'v', 'p'].includes(k)) warnings.push(`Unbekanntes Feld „${k}“ ignoriert`);
  return {
    ok: true,
    build: { buildingTypeId: d['t'], seed, rerollCount: reroll, ...(tv !== undefined ? { targetVersion: tv } : {}), params: shareParamsOf(params) },
    warnings,
  };
}
