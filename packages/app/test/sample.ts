/** Test-Hilfen: Beispielhaus über die Use Cases der App (wie packages/pipeline/test, aber im App-Raster). */
import type { Catalog } from '@mcda/catalog';
import * as uc from '../src/usecases.js';

/** Küche, Schlafzimmer, Lager, Schmiede – eine Etage. */
export function sampleSession(catalog: Catalog, opts: { seed?: number; themeId?: string; version?: string; name?: string } = {}): uc.Session {
  let s = uc.createSession(opts.seed ?? 2026, opts.name ?? 'Beispielhaus', opts.themeId ?? 'medieval');
  const rooms: Array<[number, number, number, number, string]> = [
    [0, 0, 8, 6, 'kitchen'],
    [9, 0, 14, 6, 'bedroom'],
    [0, 7, 14, 11, 'storage'],
    [15, 0, 22, 11, 'smithy'],
  ];
  for (const [x1, z1, x2, z2, type] of rooms) s = uc.paintRect(s, catalog, { x1, z1, x2, z2 }, type).session;
  if (opts.version !== undefined) s = uc.setTargetVersion(s, catalog, opts.version);
  return s;
}
