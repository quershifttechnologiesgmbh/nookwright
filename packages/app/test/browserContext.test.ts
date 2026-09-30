import type { PlatformView } from '@mcda/materialize';
import { describe, expect, it } from 'vitest';
import { browserContext, bundledPlatformData, lazyPipelineContext, loadBundledCatalog, loadPlatformView } from '../src/adapters/browserContext.js';

const load = loadBundledCatalog();

describe('Browser-Kontext: Katalog, Raumtypen, Themes (import.meta.glob, eager)', () => {
  it('ThemeCatalog mit aufgelöster Vererbung; Auswahlliste aus dem ThemeCatalog', () => {
    expect(load.themeCatalog?.ids()).toEqual(['asian', 'desert', 'dwarven', 'elven', 'farmstead', 'gothic', 'harbor', 'medieval', 'nordic', 'nordic_falu', 'ruin', 'rustic', 'steampunk', 'terracotta_birch', 'timber', 'tropical', 'winter']);
    // Auswahl-Reihenfolge (Review 3): die vier klassischen Themes zuerst, danach alphabetisch nach Anzeigename
    expect(load.themes.map((t) => t.id)).toEqual(['medieval', 'nordic', 'rustic', 'timber', 'asian', 'farmstead', 'elven', 'gothic', 'harbor', 'nordic_falu', 'ruin', 'steampunk', 'terracotta_birch', 'tropical', 'winter', 'desert', 'dwarven']);
    expect(load.themes.map((t) => t.id).slice().sort()).toEqual(load.themeCatalog!.ids().slice().sort());
    for (const t of load.themes) expect(t.name).toBe(load.themeCatalog!.get(t.id).name);
    // nordic erbt von medieval (plan/01 §4.2)
    expect(load.themeCatalog!.get('nordic').chain[0]).toBe('medieval');
  });

  it('browserContext liefert Katalog und Themes; ohne Themes keinen Kontext', () => {
    const ctx = browserContext(load)!;
    expect(ctx.catalog).toBe(load.catalog);
    expect(ctx.themes).toBe(load.themeCatalog);
    expect(browserContext({ ...load, themeCatalog: undefined })).toBeUndefined();
  });
});

describe('Browser-Kontext: Plattform-Daten lazy je Version', () => {
  it('lädt eine Version erst bei Bedarf und nur einmal; platform() vorher ist ein Fehler', async () => {
    const calls: string[] = [];
    const view = {} as PlatformView;
    const ctx = lazyPipelineContext(load.catalog!, load.themeCatalog!, async (v) => {
      calls.push(v);
      return view;
    });
    expect(ctx.loaded('1.21.11')).toBeUndefined();
    const [a, b] = await Promise.all([ctx.ready('1.21.11'), ctx.ready('1.21.11')]);
    expect(a).toBe(b);
    expect(calls).toEqual(['1.21.11']);
    expect(a.platform('1.21.11')).toBe(view);
    expect(() => a.platform('26.3')).toThrow('noch nicht geladen');
    expect(ctx.loaded('1.21.11')).toBe(a);
  });

  it('merkt sich fehlgeschlagene Ladevorgänge nicht', async () => {
    let fail = true;
    const ctx = lazyPipelineContext(load.catalog!, load.themeCatalog!, async () => {
      if (fail) throw new Error('offline');
      return {} as PlatformView;
    });
    await expect(ctx.ready('26.3')).rejects.toThrow('offline');
    fail = false;
    await expect(ctx.ready('26.3')).resolves.toBeDefined();
  });

  it('gebündelte JSON-Dateien: Registry, Familien und Physik der Zielversionen', async () => {
    for (const v of ['1.21.11', '26.3']) {
      const p = await loadPlatformView(v);
      expect(p.registry.version).toBe(v);
      expect(p.families.version).toBe(v);
      expect(p.physics.version).toBe(v);
    }
    expect((await bundledPlatformData.versions()).map((v) => v.id)).toContain('26.3');
    await expect(loadPlatformView('1.12.2')).rejects.toThrow('Keine Plattform-Daten');
  });
});
