/**
 * Vorschau „Texturen“: Port und reine Logik rund um die Minecraft-Assets (Blockmodelle + Atlas).
 *
 * Recht (research/08 §5): Die App liefert KEINE Mojang-Datei aus. Assets kommen nur
 * - aus dem eigenen Client-JAR des Nutzers (lokal im Browser gelesen, optional lokal in IndexedDB gecacht) oder
 * - im Entwicklungsserver aus `local/mc-assets/<version>/` (Dev-Middleware, nie im Build).
 *
 * Hier liegen: das Wertobjekt `TextureAssets`, die Umwandlung in den Port `ViewerResources` von @mcda/viewer,
 * das Cache-Format (JSON-Texte + gzip-Atlas) und die Zustandslogik des Modus (verfügbar/deaktiviert + Erklärung).
 * Nur Typ-Importe aus @mcda/viewer: deepslate landet so nicht im Haupt-Chunk.
 */
import type { GzipCodec } from '@mcda/export';
import type { AssetBundle, AtlasImage, AtlasIndex, BlockFlags, BlockInfo, ViewerResources } from '@mcda/viewer';

/** Herkunft der Assets. */
export type TextureOrigin = 'dev' | 'jar' | 'cache';

export interface TextureSourceInfo {
  readonly origin: TextureOrigin;
  /** Minecraft-Version der Assets */
  readonly version: string;
  /** Anzeige, z. B. „1.21.11.jar“ oder „local/mc-assets/1.21.11“ */
  readonly label: string;
}

export interface TextureAssets extends TextureSourceInfo {
  readonly atlas: AtlasImage;
  readonly atlasIndex: AtlasIndex;
  readonly blockstates: Readonly<Record<string, unknown>>;
  readonly models: Readonly<Record<string, unknown>>;
  readonly blockFlags: Readonly<Record<string, BlockFlags>>;
}

export function assetsFromBundle(b: AssetBundle, origin: TextureOrigin, label: string): TextureAssets {
  return { origin, version: b.version, label, atlas: b.atlas, atlasIndex: b.atlasIndex, blockstates: b.blockstates, models: b.models, blockFlags: b.blockFlags };
}

/** Port `ViewerResources` für den Blockrenderer; `blockInfo` ergänzt fehlende Block-Properties aus der Registry. */
export function toViewerResources(a: TextureAssets, blockInfo?: (name: string) => BlockInfo | undefined): ViewerResources {
  return {
    version: a.version,
    atlas: a.atlas,
    atlasIndex: a.atlasIndex,
    blockstates: a.blockstates,
    models: a.models,
    blockFlags: a.blockFlags,
    ...(blockInfo !== undefined ? { blockInfo } : {}),
  };
}

/** Registry (Form von `Registry` aus @mcda/platform) → `blockInfo` für den Renderer. */
export function registryBlockInfo(reg: {
  listProperties(id: string): Readonly<Record<string, readonly string[]>> | undefined;
  defaultState(id: string): { readonly properties: Readonly<Record<string, string>> } | undefined;
}): (name: string) => BlockInfo | undefined {
  return (name) => {
    const properties = reg.listProperties(name);
    const def = reg.defaultState(name);
    return properties === undefined || def === undefined ? undefined : { properties, default: def.properties };
  };
}

/** Hinweis, wenn Assets und Zielversion nicht zusammenpassen (neue Blöcke fehlen dann evtl.). */
export function versionNote(assetsVersion: string, targetVersion: string): string | undefined {
  return assetsVersion === targetVersion ? undefined : `Texturen aus Minecraft ${assetsVersion}, Zielversion ${targetVersion}: neuere Blöcke fehlen evtl.`;
}

// ------------------------------------------------------------------------------------------ Cache-Format

export const TEXTURE_CACHE_FORMAT = 'basen-texturen';
export const TEXTURE_CACHE_VERSION = 1;

/** Kurzinfo zum Cache (eigener Eintrag: Anzeige ohne die großen Daten zu laden). */
export interface CachedTextureMeta extends TextureSourceInfo {
  readonly savedAt: string;
}

/** Ein Cache-Eintrag (IndexedDB): große Bündel als JSON-Text, Atlas als gzip-komprimiertes RGBA. */
export interface CachedTextures {
  readonly format: typeof TEXTURE_CACHE_FORMAT;
  readonly v: typeof TEXTURE_CACHE_VERSION;
  readonly meta: CachedTextureMeta;
  readonly atlas: { readonly width: number; readonly height: number; readonly gz: Uint8Array };
  readonly atlasIndex: string;
  readonly blockstates: string;
  readonly models: string;
  readonly blockFlags: string;
}

export async function packTextures(a: TextureAssets, codec: GzipCodec, savedAt: Date = new Date()): Promise<CachedTextures> {
  const raw = a.atlas.data instanceof Uint8Array ? a.atlas.data : new Uint8Array(a.atlas.data.buffer, a.atlas.data.byteOffset, a.atlas.data.byteLength);
  return {
    format: TEXTURE_CACHE_FORMAT,
    v: TEXTURE_CACHE_VERSION,
    meta: { origin: 'cache', version: a.version, label: a.label, savedAt: savedAt.toISOString() },
    atlas: { width: a.atlas.width, height: a.atlas.height, gz: await codec.gzip(raw) },
    atlasIndex: JSON.stringify(a.atlasIndex),
    blockstates: JSON.stringify(a.blockstates),
    models: JSON.stringify(a.models),
    blockFlags: JSON.stringify(a.blockFlags),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Prüft die Kurzinfo eines Cache-Eintrags; `undefined` bei fremdem oder altem Format. */
export function cachedMeta(rec: unknown): CachedTextureMeta | undefined {
  if (!isObject(rec) || rec['format'] !== TEXTURE_CACHE_FORMAT || rec['v'] !== TEXTURE_CACHE_VERSION) return undefined;
  const m = rec['meta'];
  if (!isObject(m) || typeof m['version'] !== 'string' || typeof m['label'] !== 'string') return undefined;
  return { origin: 'cache', version: m['version'], label: m['label'], savedAt: typeof m['savedAt'] === 'string' ? m['savedAt'] : '' };
}

/** Cache-Eintrag → Assets; `undefined`, wenn der Eintrag unvollständig oder beschädigt ist (dann neu laden). */
export async function unpackTextures(rec: unknown, codec: GzipCodec): Promise<TextureAssets | undefined> {
  const meta = cachedMeta(rec);
  if (meta === undefined || !isObject(rec)) return undefined;
  try {
    const c = rec as unknown as CachedTextures;
    const data = await codec.gunzip(c.atlas.gz);
    if (data.length !== c.atlas.width * c.atlas.height * 4) return undefined;
    const atlasIndex = JSON.parse(c.atlasIndex) as AtlasIndex;
    if (atlasIndex.size !== c.atlas.width) return undefined;
    return {
      origin: 'cache',
      version: meta.version,
      label: meta.label,
      atlas: { width: c.atlas.width, height: c.atlas.height, data },
      atlasIndex,
      blockstates: JSON.parse(c.blockstates) as Record<string, unknown>,
      models: JSON.parse(c.models) as Record<string, unknown>,
      blockFlags: JSON.parse(c.blockFlags) as Record<string, BlockFlags>,
    };
  } catch {
    return undefined;
  }
}

/** Port: lokaler Cache für die aus dem Nutzer-JAR gebauten Assets. Adapter dürfen scheitern – dann ohne Cache. */
export interface TextureCache {
  /** Kurzinfo (billig) oder `undefined`. */
  meta(): Promise<CachedTextureMeta | undefined>;
  load(): Promise<unknown>;
  /** `true`, wenn gespeichert. */
  save(rec: CachedTextures): Promise<boolean>;
  clear(): Promise<boolean>;
}

/** Cache im Speicher (Tests, oder wenn IndexedDB fehlt). */
export function memoryTextureCache(): TextureCache {
  let rec: CachedTextures | undefined;
  return {
    meta: async () => cachedMeta(rec),
    load: async () => rec,
    save: async (r) => {
      rec = r;
      return true;
    },
    clear: async () => {
      rec = undefined;
      return true;
    },
  };
}

// ------------------------------------------------------------------------------------------ Zustand des Modus

export type TextureState =
  /** Suche nach Dev-Assets und Cache läuft (Start) */
  | { readonly kind: 'probing' }
  /** keine Quelle – Modus deaktiviert */
  | { readonly kind: 'none' }
  /** Quelle gefunden, Assets werden beim ersten Öffnen geladen */
  | { readonly kind: 'available'; readonly source: TextureSourceInfo }
  | { readonly kind: 'loading'; readonly message: string; readonly progress?: number }
  | { readonly kind: 'ready'; readonly assets: TextureAssets };

/** Welche Quelle beim Start gilt: der Cache (das JAR hat der Nutzer bewusst gewählt) vor den Dev-Assets. */
export function pickSource(cache: CachedTextureMeta | undefined, devVersions: readonly string[] | undefined, preferredVersion: string): TextureSourceInfo | undefined {
  if (cache !== undefined) return { origin: 'cache', version: cache.version, label: cache.label };
  if (devVersions === undefined || devVersions.length === 0) return undefined;
  const version = devVersions.includes(preferredVersion) ? preferredVersion : [...devVersions].sort().reverse()[0]!;
  return { origin: 'dev', version, label: `local/mc-assets/${version} (Entwicklung)` };
}

export const NO_TEXTURES_HINT = 'Texturen brauchen dein eigenes Minecraft-JAR (Java Edition): im Projekt-Panel unter „Texturen“ laden. Die Datei bleibt auf deinem Gerät.';

/** Button „Texturen“: aktiv? Und welche Erklärung steht daneben/im Tooltip? */
export function textureMode(state: TextureState, inflateAvailable = true): { readonly enabled: boolean; readonly hint: string } {
  switch (state.kind) {
    case 'probing':
      return { enabled: false, hint: 'Suche nach Texturen …' };
    case 'none':
      return { enabled: false, hint: inflateAvailable ? NO_TEXTURES_HINT : 'Dieser Browser kann JAR-Dateien nicht entpacken (DecompressionStream fehlt).' };
    case 'available':
      return { enabled: true, hint: `Echte Blockmodelle aus ${state.source.label} (werden beim ersten Öffnen geladen)` };
    case 'loading':
      return { enabled: true, hint: state.message };
    case 'ready':
      return { enabled: true, hint: `Echte Blockmodelle aus ${state.assets.label} (Minecraft ${state.assets.version})` };
  }
}

/** Fortschritt des JAR-Lesens (Phasen aus `bundleFromJar`) → 0..1 und Text. */
export function jarProgress(phase: 'read' | 'decode' | 'atlas', done: number, total: number): { readonly progress: number; readonly message: string } {
  const f = total > 0 ? done / total : 0;
  if (phase === 'read') return { progress: 0.05 + 0.5 * f, message: `JAR wird entpackt … ${done}/${total} Dateien` };
  if (phase === 'decode') return { progress: 0.55 + 0.35 * f, message: `Texturen werden gelesen … ${done}/${total}` };
  return { progress: 0.9 + 0.1 * f, message: 'Texturatlas wird gebaut …' };
}
