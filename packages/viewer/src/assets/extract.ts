/**
 * Reiner Kern der Asset-Aufbereitung: welche Dateien aus dem Client-JAR gebraucht werden, Bündel für
 * deepslate (Blockstates, Modelle), erstes Animationsbild, Durchschnittsfarben, Block-Flags.
 *
 * Kein I/O: Das Node-Skript (scripts/extract-assets.ts) liest das JAR und schreibt nach `local/`;
 * im Browser könnte derselbe Kern später ein Nutzer-JAR verarbeiten (research/08 A.3.2, Modus 3).
 * Mojang-Dateien werden NIE eingecheckt oder ausgeliefert (research/08 §5).
 */
import { atlasUv, composeAtlas, missingTexture, packAtlas, type AtlasRect, type UV } from './atlas.js';
import { cropImage, type RgbaImage } from './png.js';

/** Präfix aller Vanilla-Assets im JAR. */
export const ASSET_ROOT = 'assets/minecraft/';

/** Textur-ID der Ersatztextur (liegt immer bei 0,0 im Atlas). */
export const MISSING_TEXTURE = 'mcda:missing';

/**
 * Umfang der Extraktion (Pfade relativ zu `assets/minecraft/`): Blockstates, Blockmodelle, Blocktexturen
 * und die Entity-Texturen, die deepslates Spezialrenderer für Block-Entities brauchen
 * (Truhe, Bett, Schilder, Banner, Glocke, Shulker-Kiste, verzierter Krug, Aquisitor, Kupfergolem, Köpfe).
 */
export const EXTRACT_SCOPE: readonly string[] = [
  'blockstates/',
  'models/block/',
  'textures/block/',
  'textures/entity/chest/',
  'textures/entity/bed/',
  'textures/entity/signs/',
  'textures/entity/banner/',
  'textures/entity/banner_base.png',
  'textures/entity/bell/',
  'textures/entity/shulker/',
  'textures/entity/decorated_pot/',
  'textures/entity/conduit/',
  'textures/entity/copper_golem/',
  'textures/entity/skeleton/skeleton.png',
  'textures/entity/skeleton/wither_skeleton.png',
  'textures/entity/zombie/zombie.png',
  'textures/entity/creeper/creeper.png',
  'textures/entity/piglin/piglin.png',
  'textures/entity/enderdragon/dragon.png',
  'textures/entity/player/wide/steve.png',
];

/**
 * Textur-IDs, unter denen deepslate 0.27.1 Texturen sucht, die in 1.21.11 anders heißen
 * (deepslate-ID → vorhandene Textur-ID). Der Atlas bekommt für beide IDs dasselbe Rechteck.
 */
export const TEXTURE_ALIASES: Readonly<Record<string, string>> = {
  'minecraft:entity/banner/banner_base': 'minecraft:entity/banner_base',
  'minecraft:entity/copper_golem/copper_golem_exposed': 'minecraft:entity/copper_golem/exposed_copper_golem',
  'minecraft:entity/copper_golem/copper_golem_weathered': 'minecraft:entity/copper_golem/weathered_copper_golem',
  'minecraft:entity/copper_golem/copper_golem_oxidized': 'minecraft:entity/copper_golem/oxidized_copper_golem',
};

/** Liegt der Pfad (relativ zu assets/minecraft/) im Extraktionsumfang? Nur .json, .png und .png.mcmeta. */
export function inExtractScope(rel: string): boolean {
  if (!/\.(json|png|png\.mcmeta)$/.test(rel)) return false;
  if (rel.startsWith('blockstates/') || rel.startsWith('models/block/')) return rel.endsWith('.json');
  if (!rel.startsWith('textures/')) return false;
  return EXTRACT_SCOPE.some((s) => (s.endsWith('/') ? rel.startsWith(s) : rel === s || rel === `${s}.mcmeta`));
}

/** `textures/block/stone.png` → `minecraft:block/stone`; sonst `undefined`. */
export function textureIdOf(rel: string): string | undefined {
  const m = /^textures\/(.+)\.png$/.exec(rel);
  return m ? `minecraft:${m[1]}` : undefined;
}

/** Namensraum ergänzen: `block/stone` → `minecraft:block/stone`. */
export function withNamespace(id: string): string {
  return id.includes(':') ? id : `minecraft:${id}`;
}

/** Namensraum `minecraft:` entfernen (Schlüssel der Bündel). */
export function withoutMinecraft(id: string): string {
  return id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id;
}

// ------------------------------------------------------------------------------------------ Bündel

export type JsonBundle = Record<string, unknown>;

/**
 * Baut die Bündel für deepslate aus Dateien (Pfad relativ zu assets/minecraft/ → Text):
 * `blockstates` (Blockname ohne Namensraum → Blockstate-JSON), `models` (`block/…` → Modell-JSON).
 */
export function buildJsonBundles(files: Iterable<readonly [string, string]>): { blockstates: JsonBundle; models: JsonBundle } {
  const blockstates: JsonBundle = {};
  const models: JsonBundle = {};
  for (const [rel, text] of files) {
    let m = /^blockstates\/(.+)\.json$/.exec(rel);
    if (m) {
      blockstates[m[1]!] = JSON.parse(text) as unknown;
      continue;
    }
    m = /^models\/(block\/.+)\.json$/.exec(rel);
    if (m) models[m[1]!] = JSON.parse(text) as unknown;
  }
  return { blockstates: sortKeys(blockstates), models: sortKeys(models) };
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k]!;
  return out;
}

// ------------------------------------------------------------------------------------------ Texturen

/**
 * Erstes Bild einer (evtl. animierten) Textur. Animierte Texturen sind Streifen; ohne Angabe in der
 * `.mcmeta` ist ein Bild quadratisch mit der kleineren Kante (Vanilla-Regel).
 */
export function firstFrame(img: RgbaImage, mcmeta?: unknown): RgbaImage {
  const anim = (mcmeta as { animation?: { width?: unknown; height?: unknown } } | undefined)?.animation;
  if (anim === undefined) return img;
  const side = Math.min(img.width, img.height);
  const w = typeof anim.width === 'number' ? anim.width : typeof anim.height === 'number' ? img.width : side;
  const h = typeof anim.height === 'number' ? anim.height : typeof anim.width === 'number' ? img.height : side;
  if (w === img.width && h === img.height) return img;
  return cropImage(img, 0, 0, Math.min(w, img.width), Math.min(h, img.height));
}

export interface TextureStats {
  /** Hex-Farbe `#rrggbb`: Mittel über alle Pixel mit Alpha > 0, alpha-gewichtet */
  readonly rgb: string;
  /** mittlere Deckkraft 0..1 über alle Pixel */
  readonly opacity: number;
  /** mindestens ein Pixel mit Alpha < 255 */
  readonly cutout: boolean;
  /** mindestens ein Pixel mit 0 < Alpha < 255 (halbtransparent) */
  readonly translucent: boolean;
}

const hex2 = (v: number): string => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');

export function toHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export function textureStats(img: RgbaImage): TextureStats {
  let r = 0, g = 0, b = 0, wsum = 0, asum = 0;
  let cutout = false, translucent = false;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]!;
    asum += a;
    if (a < 255) cutout = true;
    if (a > 0 && a < 255) translucent = true;
    if (a === 0) continue;
    r += d[i]! * a; g += d[i + 1]! * a; b += d[i + 2]! * a;
    wsum += a;
  }
  const n = d.length / 4;
  return {
    rgb: wsum > 0 ? toHex(r / wsum, g / wsum, b / wsum) : '#000000',
    opacity: n > 0 ? Math.round((asum / (n * 255)) * 1000) / 1000 : 0,
    cutout,
    translucent,
  };
}

/** Inhalt von atlas.json (Pixel-Rechtecke; UV rechnet `atlasIndexUv`). */
export interface AtlasIndex {
  readonly version: string;
  readonly size: number;
  /** Textur-ID → [x, y, w, h] in Pixeln; enthält `mcda:missing` und die Aliase. */
  readonly textures: Readonly<Record<string, readonly [number, number, number, number]>>;
}

export function atlasIndexUv(index: AtlasIndex): Record<string, UV> {
  const out: Record<string, UV> = {};
  for (const [id, [x, y, w, h]] of Object.entries(index.textures)) out[id] = atlasUv({ x, y, w, h }, index.size);
  return out;
}

/**
 * Atlas aus Texturen (ID → erstes Bild): packt, setzt zusammen und ergänzt Ersatztextur und Aliase.
 * Aliase, deren Ziel fehlt, werden ausgelassen.
 */
export function buildAtlas(version: string, textures: ReadonlyMap<string, RgbaImage>): { image: RgbaImage; index: AtlasIndex } {
  const images = new Map<string, RgbaImage>(textures);
  if (images.has(MISSING_TEXTURE)) throw new Error(`${MISSING_TEXTURE} ist reserviert`);
  images.set(MISSING_TEXTURE, missingTexture());
  const layout = packAtlas([...images].map(([id, img]) => ({ id, w: img.width, h: img.height })));
  const image = composeAtlas(layout, images);
  const rects: Record<string, AtlasRect> = { ...layout.rects };
  for (const [alias, target] of Object.entries(TEXTURE_ALIASES)) {
    const r = layout.rects[target];
    if (r !== undefined && rects[alias] === undefined) rects[alias] = r;
  }
  const out: Record<string, [number, number, number, number]> = {};
  for (const id of Object.keys(rects).sort()) {
    const r = rects[id]!;
    out[id] = [r.x, r.y, r.w, r.h];
  }
  return { image, index: { version, size: layout.size, textures: out } };
}

// ------------------------------------------------------------------------------------------ Modelle

interface RawFace { readonly texture?: string }
interface RawElement {
  readonly from?: readonly number[];
  readonly to?: readonly number[];
  readonly rotation?: { readonly angle?: number };
  readonly faces?: Readonly<Record<string, RawFace>>;
}
interface RawModel {
  readonly parent?: string;
  readonly textures?: Readonly<Record<string, string | { readonly sprite: string }>>;
  readonly elements?: readonly RawElement[];
}
interface RawVariant { readonly model?: string }
interface RawBlockstate {
  readonly variants?: Readonly<Record<string, RawVariant | readonly RawVariant[]>>;
  readonly multipart?: ReadonlyArray<{ readonly apply?: RawVariant | readonly RawVariant[] }>;
}

export interface ResolvedModel {
  readonly elements: readonly RawElement[];
  /** Textur-Variable → Textur-ID mit Namensraum (Verweise `#x` aufgelöst, sofern möglich) */
  readonly textures: Readonly<Record<string, string>>;
}

/** Modell mit Eltern auflösen (Elemente: erstes in der Kette; Texturen: Kind überschreibt Eltern). */
export function resolveModel(models: JsonBundle, id: string): ResolvedModel | undefined {
  const chain: RawModel[] = [];
  const seen = new Set<string>();
  for (let cur: string | undefined = withoutMinecraft(id); cur !== undefined;) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const m = models[cur] as RawModel | undefined;
    if (m === undefined) {
      if (chain.length === 0) return undefined;
      break;
    }
    chain.push(m);
    cur = m.parent === undefined ? undefined : withoutMinecraft(m.parent);
  }
  const vars: Record<string, string> = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    for (const [k, v] of Object.entries(chain[i]!.textures ?? {})) vars[k] = typeof v === 'string' ? v : v.sprite;
  }
  const textures: Record<string, string> = {};
  for (const k of Object.keys(vars)) {
    let v: string | undefined = vars[k];
    for (let hop = 0; v !== undefined && v.startsWith('#') && hop < 16; hop++) v = vars[v.slice(1)];
    if (v !== undefined && !v.startsWith('#')) textures[k] = withNamespace(v);
  }
  const elements = chain.find((m) => m.elements !== undefined)?.elements ?? [];
  return { elements, textures };
}

/** Textur-ID einer Fläche: erst als Variable (`#var` oder `var`, wie deepslate), sonst als direkte ID. */
export function faceTexture(model: ResolvedModel, ref: string): string | undefined {
  const v = model.textures[ref.startsWith('#') ? ref.slice(1) : ref];
  return v ?? (ref.startsWith('#') ? undefined : withNamespace(ref));
}

/** Alle Modell-IDs, die ein Blockstate benutzen kann. */
export function blockstateModels(bs: unknown): string[] {
  const b = bs as RawBlockstate;
  const out = new Set<string>();
  const add = (v: RawVariant | readonly RawVariant[] | undefined): void => {
    for (const x of v === undefined ? [] : Array.isArray(v) ? v : [v as RawVariant]) if (x.model) out.add(withNamespace(x.model));
  };
  for (const v of Object.values(b.variants ?? {})) add(v);
  for (const p of b.multipart ?? []) add(p.apply);
  return [...out];
}

// ------------------------------------------------------------------------------------------ Block-Flags

/** Flags für deepslate (Verdeckung und Render-Durchgang). */
export interface BlockFlags {
  /** verdeckt Nachbarflächen (voller, deckender Würfel) */
  readonly opaque?: boolean;
  /** halbtransparente Pixel → eigener, späterer Durchgang */
  readonly semi_transparent?: boolean;
  /** gleiche Nachbarn verdecken sich gegenseitig (Glas, Eis …) */
  readonly self_culling?: boolean;
}

const FULL = (e: RawElement): boolean =>
  (e.rotation?.angle ?? 0) === 0 &&
  e.from?.length === 3 && e.to?.length === 3 &&
  e.from.every((v) => v === 0) && e.to.every((v) => v === 16);

const SIDES = ['north', 'east', 'south', 'west', 'up', 'down'] as const;
const LIQUIDS = new Set(['water', 'bubble_column']);
const SELF_CULLING = /(^|_)glass$|_glass_pane$|^glass_pane$|^ice$|^frosted_ice$|^slime_block$|^honey_block$|^iron_bars$|^water$|^lava$|^powder_snow$/;

/**
 * Heuristik aus den Modellen (Vanilla-Code ist nicht Teil der Assets):
 * - opaque: nur `variants`, und jedes Modell hat ein Element als vollen, ungedrehten Würfel mit sechs
 *   Flächen, deren Texturen keinen Pixel mit Alpha < 255 haben.
 * - semi_transparent: irgendeine benutzte Textur hat halbtransparente Pixel, oder Wasser.
 * - self_culling: Glas, Scheiben, Eis, Schleim, Honig, Gitter, Flüssigkeiten.
 */
export function computeBlockFlags(
  blockstates: JsonBundle,
  models: JsonBundle,
  stats: (textureId: string) => TextureStats | undefined,
): Record<string, BlockFlags> {
  const cache = new Map<string, ResolvedModel | undefined>();
  const model = (id: string): ResolvedModel | undefined => {
    if (!cache.has(id)) cache.set(id, resolveModel(models, id));
    return cache.get(id);
  };
  const out: Record<string, BlockFlags> = {};
  for (const [name, bs] of Object.entries(blockstates)) {
    const ids = blockstateModels(bs);
    const resolved = ids.map(model);
    let translucent = LIQUIDS.has(name);
    for (const m of resolved) {
      if (m === undefined) continue;
      for (const e of m.elements) {
        for (const f of Object.values(e.faces ?? {})) {
          const t = f.texture === undefined ? undefined : faceTexture(m, f.texture);
          if (t !== undefined && stats(t)?.translucent) translucent = true;
        }
      }
    }
    const onlyVariants = (bs as RawBlockstate).variants !== undefined && (bs as RawBlockstate).multipart === undefined;
    const opaque = onlyVariants && resolved.length > 0 && resolved.every((m) =>
      m !== undefined && m.elements.some((e) => FULL(e) && SIDES.every((s) => {
        const f = e.faces?.[s];
        const t = f?.texture === undefined ? undefined : faceTexture(m, f.texture);
        const st = t === undefined ? undefined : stats(t);
        return st !== undefined && !st.cutout;
      })));
    const flags: BlockFlags = {
      ...(opaque ? { opaque: true } : {}),
      ...(translucent ? { semi_transparent: true } : {}),
      ...(SELF_CULLING.test(name) ? { self_culling: true } : {}),
    };
    if (Object.keys(flags).length > 0) out[name] = flags;
  }
  return out;
}

// ------------------------------------------------------------------------------------------ Farben je Block

/**
 * Stellvertretende Textur je Block (für Flächenfarben): Block-Entities nach ihrer Entity-Textur,
 * sonst die `particle`-Textur des ersten Modells.
 */
export function representativeTexture(name: string, blockstate: unknown, models: JsonBundle): string | undefined {
  const bed = /^(.+)_bed$/.exec(name);
  if (bed) return `minecraft:entity/bed/${bed[1]}`;
  if (name === 'chest') return 'minecraft:entity/chest/normal';
  if (name === 'trapped_chest') return 'minecraft:entity/chest/trapped';
  if (name === 'ender_chest') return 'minecraft:entity/chest/ender';
  const banner = /^(.+?)_(wall_)?banner$/.exec(name);
  if (banner) return `minecraft:block/${banner[1]}_wool`;
  const first = blockstateModels(blockstate)[0];
  const m = first === undefined ? undefined : resolveModel(models, first);
  return m?.textures['particle'] ?? (m ? Object.values(m.textures)[0] : undefined);
}

/** UV eines Rechtecks ([x, y, w, h]) im Atlas. */
export function rectUv(rect: readonly [number, number, number, number], size: number): UV {
  return atlasUv({ x: rect[0], y: rect[1], w: rect[2], h: rect[3] }, size);
}
