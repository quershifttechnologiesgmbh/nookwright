/** `catalog_list` / `catalog_get`: jedes Katalog-Item einzeln abrufbar (Übersicht und vollständige Definition). */
import { z } from 'zod';
import { CATALOG_KINDS, CATALOG_KIND_IDS, type CatalogKind, type CatalogKindId } from '../catalogs.js';
import { defineOperation, type Json } from '../operation.js';

const kindOf = (k: CatalogKindId): CatalogKind => CATALOG_KINDS[k];
const kind = z.enum(CATALOG_KIND_IDS).describe('Katalog-Art: buildingtype, roomtype, component, theme, terrain');

export const catalogList = defineOperation({
  id: 'catalog_list',
  summary: 'Einträge einer Katalog-Art auflisten (IDs, Namen, Tags), optional nach Tag gefiltert.',
  cacheable: true,
  input: () => z.object({ kind, tag: z.string().min(1).optional().describe('nur Einträge mit diesem Tag') }).strict(),
  run: (i, ctx) => ({
    data: kindOf(i.kind).list(ctx).filter((e) => i.tag === undefined || (e.tags ?? []).includes(i.tag)) as unknown as Json,
  }),
});

export const catalogGet = defineOperation({
  id: 'catalog_get',
  summary: 'Vollständige Definition eines Katalog-Eintrags (z. B. welche Möbel ein Raumtyp braucht, Blöcke eines Themes).',
  cacheable: true,
  input: () => z.object({ kind, id: z.string().min(1).describe('ID des Eintrags (siehe catalog_list)') }).strict(),
  run: (i, ctx) => ({ data: JSON.parse(JSON.stringify(kindOf(i.kind).get(ctx, i.id))) as Json }),
});
