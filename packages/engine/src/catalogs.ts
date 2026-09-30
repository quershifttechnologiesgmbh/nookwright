/**
 * Katalog-Arten der Engine: Jede Datenquelle im Kontext (`EngineContext`) ist eingeordnet – als Katalog-Arten, die
 * per API (`catalog_list`, `catalog_get`) und als MCP-Ressource (`catalog://<art>/<id>`) abrufbar sind, oder
 * begründet ausgenommen. `CONTEXT_SOURCES` ist ein Mapped Type über die Schlüssel des Kontexts: Bekommt der Kontext
 * eine neue Datenquelle, schlägt `tsc` fehl, bis sie hier steht. Neue Katalog-DATEIEN brauchen keinen Code.
 */
import { excluded, type Excluded } from './commands.js';
import type { EngineContext } from './operation.js';

export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly tags?: readonly string[];
}

export interface CatalogKind {
  /** Ein Satz: was diese Art ist. */
  readonly summary: string;
  readonly list: (ctx: EngineContext) => CatalogEntry[];
  /** Vollständige Definition (wie in der JSON5-Datei, validiert); unbekannte ID → Fehler. */
  readonly get: (ctx: EngineContext, id: string) => unknown;
}

const byName = (a: CatalogEntry, b: CatalogEntry): number => a.id.localeCompare(b.id);

export const CATALOG_KINDS = {
  buildingtype: {
    summary: 'Bautypen: Grundriss-Generator mit Größen, Programm (Räume), Stil, Gelände und Bauwerken',
    list: (ctx) => ctx.buildingTypes.ids().map((id) => {
      const d = ctx.buildingTypes.get(id);
      return { id, name: d.label ?? d.name, tags: [d.family, ...(d.status === 'draft' ? ['draft'] : [])] };
    }),
    get: (ctx, id) => ctx.buildingTypes.get(id),
  },
  roomtype: {
    summary: 'Raumtypen: Pflicht- und Wunschmöbel (Tags), Mindestfläche, Licht-Stimmung',
    list: (ctx) => ctx.catalog.roomTypeIds().map((id) => ({ id, name: ctx.catalog.roomType(id).name })),
    get: (ctx, id) => ctx.catalog.roomType(id),
  },
  component: {
    summary: 'Komponenten: Möbel und Bauteile (Blöcke, Größe, Andockstellen, Tags) für die Einrichtung',
    list: (ctx) => ctx.catalog.all().map((d) => ({ id: d.id, name: d.name ?? d.id, tags: d.tags })).sort(byName),
    get: (ctx, id) => ctx.catalog.get(id),
  },
  palette: {
    summary: 'Farbpaletten: elf Oberflächenrollen (Wand, Dach, Rahmen, Holz, Boden, Akzent …) → Blöcke; färbt ein Theme um, ohne seine Bauweise zu ändern',
    list: (ctx) => [...(ctx.palettes ?? [])].map((p) => ({ id: p.id, name: p.name, tags: [p.mood, ...p.styles] })).sort(byName),
    get: (ctx, id) => {
      const p = ctx.palettes?.find(id);
      if (p === undefined) throw new Error(`Unbekannte Palette '${id}'`);
      return p;
    },
  },
  theme: {
    summary: 'Themes: Materialrollen (Wand, Boden, Dach …) → Blöcke, mit Vererbung',
    list: (ctx) => ctx.themes.ids().map((id) => ({ id, name: ctx.themes.def(id)?.name ?? id })).sort(byName),
    get: (ctx, id) => {
      const d = ctx.themes.def(id);
      if (d === undefined) throw new Error(`Unbekanntes Theme '${id}'`);
      return d;
    },
  },
  terrain: {
    summary: 'Geländestile: Relief, Vegetation, Beleuchtung',
    list: (ctx) => [...(ctx.terrainStyles?.values() ?? [])].map((t) => ({ id: t.id, name: t.name })).sort(byName),
    get: (ctx, id) => {
      const t = ctx.terrainStyles?.get(id);
      if (t === undefined) throw new Error(`Unbekannter Geländestil '${id}'`);
      return t;
    },
  },
} as const satisfies Record<string, CatalogKind>;

export type CatalogKindId = keyof typeof CATALOG_KINDS;
export const CATALOG_KIND_IDS = Object.keys(CATALOG_KINDS) as [CatalogKindId, ...CatalogKindId[]];

/** Jede Datenquelle des Kontexts → ihre Katalog-Arten oder ein begründeter Ausschluss (Compile-Zeit-Zwang). */
export const CONTEXT_SOURCES: { readonly [K in keyof EngineContext]-?: readonly CatalogKindId[] | Excluded } = {
  buildingTypes: ['buildingtype'],
  catalog: ['component', 'roomtype'],
  themes: ['theme'],
  palettes: ['palette'],
  terrainStyles: ['terrain'],
  platform: excluded('Minecraft-Registry je Version (ACL, ADR 8): Blocknamen sind Sache der Materialisierung, nicht der Steuerung'),
  pinwheelGuard: excluded('W8-G: Messschalter des Windrad-Wächters (nur Tests/Messungen), keine Datenquelle'),
  weatheringSolver: excluded('WS-Verwitterung: nur Messknopf (regelbasierter Vergleich), nie im Produkt, keine Datenquelle'),
  surfaceTexture: excluded('TX-B: Schalter der Materialisierung (kommt aus BuildOptions.surfaceTexture), keine Datenquelle'),
  weathering: excluded('WS-Verwitterung: Schalter der Materialisierung (kommt aus BuildOptions.weathering), keine Datenquelle'),
};
