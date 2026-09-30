/** Vokabular: statische Listen = Domäne, dynamische Listen = Katalog (neue Katalogdatei ist ohne Code in der API). */
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { VERSIONS } from '../src/index.js';
import { ctx, engine } from './fixture.js';

type Enum = { enum?: string[] };
const prop = (op: Parameters<typeof engine.inputSchema>[0], k: string): Enum =>
  ((engine.inputSchema(op) as { properties: Record<string, Enum> }).properties[k] ?? {});

describe('Vokabular', () => {
  it('Zielversionen = TARGET_VERSIONS der Domäne', () => {
    expect([...VERSIONS].sort()).toEqual(Object.keys(TARGET_VERSIONS).sort());
  });

  it('alle Bautypen und Themes des Katalogs sind wählbar', () => {
    expect(prop('building_generate', 'buildingTypeId').enum).toEqual(ctx.buildingTypes.ids());
    expect(prop('building_generate', 'themeId').enum).toEqual([...ctx.themes.ids()].sort());
  });

  it('catalog_describe liefert dieselben Labels', () => {
    const r = engine.execute({ op: 'catalog_describe' });
    expect(r.ok).toBe(true);
    const d = (r.ok ? r.data : {}) as { buildingTypes: { id: string }[]; roomTypes: { id: string }[] };
    expect(d.buildingTypes.map((b) => b.id)).toEqual(ctx.buildingTypes.ids());
    expect(d.roomTypes.length).toBe(ctx.catalog.roomTypeIds().length);
  });
});

describe('Katalog-Items einzeln (catalog_list / catalog_get)', () => {
  it('jede Datenquelle des Kontexts ist eingeordnet, jede Katalog-Art genau einmal', async () => {
    const { CATALOG_KIND_IDS, CONTEXT_SOURCES } = await import('../src/index.js');
    const assigned = Object.values(CONTEXT_SOURCES).flatMap((v) => ('excluded' in v ? [] : [...v]));
    expect([...assigned].sort()).toEqual([...CATALOG_KIND_IDS].sort());
    // W8-G/WS-Verwitterung: `pinwheelGuard`, `weathering`, `weatheringSolver`, `surfaceTexture` (TX-B) sind Schalter bzw. Messknöpfe (nur gesetzt, wenn abgeschaltet wird), keine Datenquelle des Kontexts
    expect(Object.keys(CONTEXT_SOURCES).filter((k) => !['pinwheelGuard', 'weathering', 'weatheringSolver', 'surfaceTexture'].includes(k)).sort()).toEqual(Object.keys(ctx).sort());
  });

  it('jeder Eintrag jeder Art ist per catalog_get abrufbar', () => {
    for (const kind of ['buildingtype', 'roomtype', 'component', 'theme', 'terrain']) {
      const list = engine.execute({ op: 'catalog_list', input: { kind } });
      expect(list.ok).toBe(true);
      const items = (list.ok ? list.data : []) as { id: string }[];
      expect(items.length, kind).toBeGreaterThan(0);
      for (const { id } of items) expect(engine.execute({ op: 'catalog_get', input: { kind, id } }).ok, `${kind}/${id}`).toBe(true);
    }
    expect(engine.execute({ op: 'catalog_get', input: { kind: 'theme', id: 'nope' } }).ok).toBe(false);
  });

  it('Filter nach Tag', () => {
    const r = engine.execute({ op: 'catalog_list', input: { kind: 'component', tag: 'bed' } });
    const items = (r.ok ? r.data : []) as { tags: string[] }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.tags.includes('bed'))).toBe(true);
  });
});
