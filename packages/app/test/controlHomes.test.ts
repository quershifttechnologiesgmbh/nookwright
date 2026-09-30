/**
 * W2-ED U2 „Heimat-Tabelle“: Beim Umbau auf die Minimal-Oberfläche geht keine Fähigkeit verloren – jede frühere
 * Einstellung hat GENAU EINEN neuen Ort (oder ist als Doppel zusammengelegt), die Beschriftung steht dort wörtlich im
 * Quelltext, und jedes Feld des Hüllen-Stils sowie jede Nutzer-Funktion aus `APP_SURFACE` hat eine Heimat.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_SURFACE } from '@mcda/engine';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { CONTROL_HOMES, HOME_SOURCES, STYLE_CONTROLS, SURFACE_CONTROLS, type ControlHome } from '../src/ui/controlHomes.js';
import * as uc from '../src/usecases.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const source = (f: string): string => readFileSync(join(SRC, f), 'utf8');
const placed = (c: ControlHome): c is Extract<ControlHome, { home: string }> => 'home' in c;

describe('Heimat-Tabelle', () => {
  it('Zusammenlegungen zeigen auf einen Eintrag mit eigenem Ort', () => {
    for (const [id, c] of Object.entries(CONTROL_HOMES)) {
      if (placed(c)) continue;
      const target = CONTROL_HOMES[c.merged];
      expect(target, `${id} → ${c.merged}`).toBeDefined();
      expect(placed(target!), `${id} → ${c.merged} ist selbst zusammengelegt`).toBe(true);
    }
  });

  it('kein Ort ist doppelt belegt (Ort + Beschriftung eindeutig)', () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const [id, c] of Object.entries(CONTROL_HOMES)) {
      if (!placed(c)) continue;
      const key = `${c.home}|${c.label}`;
      if (seen.has(key)) dup.push(`${seen.get(key)} und ${id}: ${key}`);
      seen.set(key, id);
    }
    expect(dup).toEqual([]);
  });

  it('jede Beschriftung steht wörtlich in einer Quelldatei ihres Orts', () => {
    const missing = Object.entries(CONTROL_HOMES)
      .filter((e): e is [string, Extract<ControlHome, { home: string }>] => placed(e[1]))
      .filter(([, c]) => !HOME_SOURCES[c.home].some((f) => source(f).includes(c.label)))
      .map(([id, c]) => `${id}: „${c.label}“ fehlt in ${HOME_SOURCES[c.home].join(', ')}`);
    expect(missing).toEqual([]);
  });

  it('die früheren Panels „Projekt“, „Gebäude“, „Speichern“ und die Ansichtsleiste gibt es nicht mehr doppelt', () => {
    const app = source('App.tsx');
    expect(app).not.toMatch(/<ProjectPanel|<SaveSection|<BuildingPanel\b|className="view-bar"/);
    // Theme nur noch an einer Stelle (vorher Projekt + Bautyp mit verschiedener Wirkung)
    expect(source('ui/BuildingTypePanel.tsx')).not.toMatch(/type-theme|themeId: e\.target/);
    expect(CONTROL_HOMES['type.theme']).toEqual({ before: expect.any(String), merged: 'project.theme' });
  });

  it('jedes Feld des Hüllen-Stils (ShellStyle) hat ein Bedienelement mit Heimat', () => {
    const load = loadBundledCatalog();
    const ctx = { catalog: load.catalog!, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles };
    const types = load.buildingTypes;
    const def = types.get('farmhouse');
    const typed = bt.typeSession(def, bt.defaultParams(def, ctx.themes.ids(), 'medieval'), 7, ctx, uc.shellStyle({ roof: uc.DEFAULT_ROOF })).session;
    const paths = new Set<string>();
    const walk = (o: Record<string, unknown>, prefix: string): void => {
      for (const [k, v] of Object.entries(o)) {
        const p = prefix === '' ? k : `${prefix}.${k}`;
        if (v !== null && typeof v === 'object' && !Array.isArray(v) && p !== 'exterior.groups') walk(v as Record<string, unknown>, p);
        else paths.add(p);
      }
    };
    walk(uc.shellStyle(typed) as unknown as Record<string, unknown>, '');
    walk(uc.shellStyle(uc.createSession(1, 'x')) as unknown as Record<string, unknown>, '');
    expect([...paths].filter((p) => !(p in STYLE_CONTROLS)), 'neues Stil-Feld ohne Heimat').toEqual([]);
    for (const [path, id] of Object.entries(STYLE_CONTROLS)) if (id !== null) expect(CONTROL_HOMES[id], path).toBeDefined();
    // abgeleitete Felder: angedockte Türme (Umgebung), Flur-Rollen (Bautyp), Pfeiler-Pflicht (Theme), W5: Rahmenrolle (Bautyp)
    // – keine Einstellung; W12-C: Eingangsmodul des Bautyps (Bauernhaus: Cottage-Vordach); W13-E: Wandkleid der
    // Obergeschosse (Bautyp)
    expect(Object.entries(STYLE_CONTROLS).filter(([, v]) => v === null).map(([k]) => k).sort())
      .toEqual(['corridorTypes', 'exterior.entranceModule', 'facade.frameRole', 'facade.lightRooms', 'facade.piers', 'facade.upperFrame', 'towers']);
  });

  it('jede Nutzer-Funktion der App (APP_SURFACE mit Operation) hat ein Bedienelement mit Heimat', () => {
    const user = ['usecases', 'buildingTypes', 'placementEdit', 'blockRefurnish'].flatMap((m) =>
      Object.entries(APP_SURFACE[m] ?? {})
        .filter(([, e]) => 'op' in e)
        .map(([f]) => f),
    );
    expect(user.filter((f) => SURFACE_CONTROLS[f] === undefined), 'Nutzer-Funktion ohne Bedienelement').toEqual([]);
    for (const [f, id] of Object.entries(SURFACE_CONTROLS)) expect(CONTROL_HOMES[id], `${f} → ${id}`).toBeDefined();
  });
});
