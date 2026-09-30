/**
 * Goldene Galerie (P0-A): die goldene Menge (set.json5) prüfen und zu einzelnen Bauten ausklappen (rein).
 */

export interface GoldenEntry {
  /** `<bautyp>-<theme>` */
  readonly id: string;
  readonly type: string;
  readonly theme: string;
  /** Standard-Theme des Eintrags oder Variante */
  readonly variant: boolean;
  readonly seed: number;
  /** Größe (bei festen Vorlagen ohne Größen ignoriert der Generator sie) */
  readonly size: string;
  readonly targetVersion: { readonly name: string; readonly dataVersion: number };
  /** Geländeform (feat/gelaende): 'natural' | 'dramatic'; fehlt = wie bisher */
  readonly landform?: string;
  /** WS-Verwitterung: 'some' | 'rich'; fehlt = wie bisher */
  readonly weathering?: string;
}

export interface GoldenSet {
  readonly version: number;
  readonly entries: readonly GoldenEntry[];
}

const fail = (msg: string): never => {
  throw new Error(`Goldene Menge: ${msg}`);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function expandSet(raw: unknown): GoldenSet {
  if (!isObj(raw)) return fail('Objekt erwartet');
  const version = raw['version'];
  if (version !== 1) fail(`version 1 erwartet, nicht ${String(version)}`);
  const seed = raw['seed'];
  if (typeof seed !== 'number' || !Number.isInteger(seed)) return fail('seed (ganze Zahl) fehlt');
  const size = raw['size'];
  if (typeof size !== 'string') return fail('size fehlt');
  const tv = raw['targetVersion'];
  if (!isObj(tv) || typeof tv['name'] !== 'string' || typeof tv['dataVersion'] !== 'number') return fail('targetVersion { name, dataVersion } fehlt');
  const list = raw['entries'];
  if (!Array.isArray(list) || list.length === 0) return fail('entries fehlt');
  const out: GoldenEntry[] = [];
  const ids = new Set<string>();
  const targetVersion = { name: tv['name'] as string, dataVersion: tv['dataVersion'] as number };
  for (const e of list) {
    if (!isObj(e) || typeof e['type'] !== 'string' || typeof e['theme'] !== 'string') return fail('Eintrag braucht type und theme');
    const variants = e['variants'] ?? [];
    if (!Array.isArray(variants) || variants.some((v) => typeof v !== 'string')) return fail(`${e['type']}: variants muss eine Liste von Themes sein`);
    const eSeed = e['seed'] ?? seed;
    const eSize = e['size'] ?? size;
    const landform = e['landform'] ?? raw['landform'];
    const weathering = e['weathering'] ?? raw['weathering'];
    if (typeof eSeed !== 'number' || typeof eSize !== 'string') return fail(`${e['type']}: seed/size ungültig`);
    for (const [theme, variant] of [[e['theme'], false], ...(variants as string[]).map((v) => [v, true] as const)] as Array<readonly [string, boolean]>) {
      const id = `${e['type']}-${theme}`;
      if (ids.has(id)) fail(`doppelte ID ${id}`);
      ids.add(id);
      out.push({ id, type: e['type'] as string, theme, variant, seed: eSeed, size: eSize, targetVersion, ...(typeof landform === 'string' ? { landform } : {}), ...(typeof weathering === 'string' ? { weathering } : {}) });
    }
  }
  return { version: 1, entries: out };
}

/** Filter `--only`: Bautyp oder ID (Komma-Liste). Leer = alle. */
export function selectEntries(entries: readonly GoldenEntry[], only: readonly string[]): GoldenEntry[] {
  if (only.length === 0) return [...entries];
  const out = entries.filter((e) => only.includes(e.type) || only.includes(e.id));
  const unknown = only.filter((o) => !entries.some((e) => e.type === o || e.id === o));
  if (unknown.length > 0) fail(`unbekannt in --only: ${unknown.join(', ')} (bekannt: ${[...new Set(entries.map((e) => e.type))].join(', ')})`);
  return out;
}
