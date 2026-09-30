/**
 * Adapter „Dev-Assets“ (nur `vite dev`): lädt die mit `packages/viewer/scripts/extract-assets.ts` erzeugten
 * Dateien aus `local/mc-assets/<version>/` über die Dev-Middleware (`/mc-assets/…`, siehe vite.config.ts).
 * Im Produktions-Build gibt es weder die Middleware noch diesen Aufruf (`import.meta.env.DEV`).
 * Der Atlas wird mit dem PNG-Codec aus @mcda/viewer dekodiert (exakt, ohne Farbraum-/Alpha-Umrechnung des Browsers).
 */
import { decodePngAsync, type AsyncBytesFn, type AtlasIndex, type BlockFlags } from '@mcda/viewer/assets';
import type { TextureAssets } from '../textures/assets.js';

export const DEV_ASSET_BASE = '/mc-assets/';

type FetchFn = (url: string) => Promise<Response>;

/** Versionen, für die der Dev-Server Assets hat; `undefined`, wenn es keine Middleware gibt (Build, Fehler). */
export async function devTextureVersions(fetchFn: FetchFn = fetch, base = DEV_ASSET_BASE): Promise<string[] | undefined> {
  try {
    const res = await fetchFn(`${base}index.json`);
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return undefined;
    const data = (await res.json()) as { versions?: unknown };
    return Array.isArray(data.versions) ? data.versions.filter((v): v is string => typeof v === 'string') : undefined;
  } catch {
    return undefined;
  }
}

async function ok(fetchFn: FetchFn, url: string): Promise<Response> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}${res.status === 404 ? ' – fehlt local/mc-assets? (npx tsx packages/viewer/scripts/extract-assets.ts)' : ''}`);
  return res;
}

export async function loadDevTextures(version: string, inflate: AsyncBytesFn, fetchFn: FetchFn = fetch, base = DEV_ASSET_BASE): Promise<TextureAssets> {
  const dir = `${base}${encodeURIComponent(version)}/`;
  const json = async <T>(file: string): Promise<T> => (await (await ok(fetchFn, `${dir}${file}`)).json()) as T;
  const [atlasIndex, blockstates, models, blockFlags, png] = await Promise.all([
    json<AtlasIndex>('atlas.json'),
    json<Record<string, unknown>>('blockstates.json'),
    json<Record<string, unknown>>('models.json'),
    json<Record<string, BlockFlags>>('block-flags.json'),
    ok(fetchFn, `${dir}atlas.png`).then(async (r) => new Uint8Array(await r.arrayBuffer())),
  ]);
  const atlas = await decodePngAsync(png, inflate);
  return { origin: 'dev', version: atlasIndex.version, label: `local/mc-assets/${version} (Entwicklung)`, atlas, atlasIndex, blockstates, models, blockFlags };
}
