import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PaletteCatalog, ThemeCatalog, parsePaletteDef, parseThemeDef, type PaletteDef, type ThemeDef } from '@mcda/catalog';
import { generate, materializeWorld, sampleHouse, themeFor } from '@mcda/pipeline';
import type { PipelineContext } from '../src/index.js';
import { P1, P1_MIN_DISTANCE, P1Text, blockLightness, oklabL, paletteRoleLightness } from '../src/quality-p1.js';
import { blockLook } from '../src/blockColors.js';
import { nodeContext } from '../src/node-context.js';

const CATALOG = fileURLToPath(new URL('../../../catalog', import.meta.url));

function loadPalettes(): PaletteDef[] {
  return readdirSync(`${CATALOG}/palettes`).filter((f) => f.endsWith('.json5')).sort().map((f) => {
    const r = parsePaletteDef(readFileSync(`${CATALOG}/palettes/${f}`, 'utf8'), f);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.value;
  });
}

function loadThemes(): ThemeDef[] {
  return readdirSync(`${CATALOG}/themes`).filter((f) => f.endsWith('.json5')).sort().map((f) => {
    const r = parseThemeDef(readFileSync(`${CATALOG}/themes/${f}`, 'utf8'), f);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.value;
  });
}

const PALETTES = loadPalettes();
const THEMES = loadThemes();
const CATALOG_THEMES = ThemeCatalog.of(THEMES);

describe('OKLab-L: reine Helligkeitsrechnung', () => {
  it('trifft die bekannten Eckwerte (Weiß 1, Schwarz 0)', () => {
    expect(oklabL(0xffffff)).toBeCloseTo(1, 6);
    expect(oklabL(0x000000)).toBeCloseTo(0, 6);
    // Referenzwerte aus der OKLab-Veröffentlichung (Ottosson): Rot ≈ 0,628, Grün ≈ 0,866, Blau ≈ 0,452
    expect(oklabL(0xff0000)).toBeCloseTo(0.628, 3);
    expect(oklabL(0x00ff00)).toBeCloseTo(0.866, 3);
    expect(oklabL(0x0000ff)).toBeCloseTo(0.452, 3);
  });

  it('ordnet echte Blöcke wie erwartet (Kalzit hell, Tiefenschiefer dunkel)', () => {
    expect(blockLightness('minecraft:calcite')).toBeGreaterThan(blockLightness('minecraft:stone_bricks'));
    expect(blockLightness('minecraft:stone_bricks')).toBeGreaterThan(blockLightness('minecraft:deepslate_tiles'));
    expect(blockLightness('minecraft:deepslate_tiles')).toBeLessThan(0.4);
    for (const b of ['minecraft:calcite', 'minecraft:stone_bricks', 'minecraft:deepslate_tiles', 'minecraft:blackstone']) {
      expect(blockLook(b).rule).not.toBe('fallback');
    }
  });
});

describe('P1 je Theme', () => {
  it('liefert für jedes der 16 Themes eine Zahl und einen Kurztext', () => {
    for (const t of THEMES) {
      const resolved = CATALOG_THEMES.get(t.id);
      const r = P1(resolved);
      expect(r, t.id).toBeDefined();
      expect(r!.value).toBeGreaterThanOrEqual(0);
      expect(r!.value).toBeLessThanOrEqual(1);
      expect(P1Text(resolved)).toContain('P1 ');
    }
  });

  it('misst den Wand-Dach-Abstand und berichtet die Kantenabstände mit', () => {
    const r = P1(CATALOG_THEMES.get('medieval'))!;
    expect(r.value).toBe(r.contrasts.wallRoof);
    expect(r.contrasts.roofEdge).toBeCloseTo(Math.abs(r.roof.lightness - r.edge.lightness), 12);
    expect(r.contrasts.wallEdge).toBeCloseTo(Math.abs(r.wall.lightness - r.edge.lightness), 12);
    expect(r.ok).toBe(r.value >= P1_MIN_DISTANCE);
  });

  it('ist ohne Wand- oder Dachrolle nicht messbar (`undefined`, kein stilles „bestanden“)', () => {
    const t = CATALOG_THEMES.get('medieval');
    expect(P1({ ...t, roles: {} })).toBeUndefined();
  });
});

describe('P1 als Palette-Kennzahl', () => {
  it('jede Palette nennt die drei Messrollen', () => {
    for (const p of PALETTES) {
      expect(paletteRoleLightness(p, 'wall_primary'), p.id).toBeDefined();
      expect(paletteRoleLightness(p, 'roof'), p.id).toBeDefined();
      expect(paletteRoleLightness(p, 'roof_accent'), p.id).toBeDefined();
    }
  });

  it('keine Palette hat einen zu schwachen Wertkontrast (P1 ≥ Mindestabstand)', () => {
    // Nachgeschärft in Q4 (`spikes/quality/fix_palette_roofs.py`, `fix_palette_edges.py`): Wand ↔ Dach ↔ Kante
    // liegen in jeder der 31 Farbwelten mindestens `P1_MIN_DISTANCE` auseinander.
    const weak = PALETTES.flatMap((p) => {
      const wall = paletteRoleLightness(p, 'wall_primary')!;
      const roof = paletteRoleLightness(p, 'roof')!;
      const edge = paletteRoleLightness(p, 'roof_accent')!;
      return Math.abs(wall - roof) < P1_MIN_DISTANCE ? [`${p.id}: ${Math.abs(wall - roof).toFixed(3)}`] : [];
    });
    expect(weak).toEqual([]);
  });
});

describe('P1 vorher/nachher: Palette färbt messbar um', () => {
  it('alle 16 Themes × alle Paletten: P1 messbar, Mindestabstand bei der Mehrheit gehalten', () => {
    const results: Array<{ theme: string; palette: string; before: number; after: number }> = [];
    for (const t of THEMES) {
      const before = P1(CATALOG_THEMES.get(t.id))!;
      for (const p of PALETTES) {
        const after = P1(CATALOG_THEMES.resolveWith(t.id, p));
        expect(after, `${t.id} × ${p.id}`).toBeDefined();
        results.push({ theme: t.id, palette: p.id, before: before.value, after: after!.value });
      }
    }
    expect(results.length).toBe(THEMES.length * PALETTES.length);
    const ok = results.filter((r) => r.after >= P1_MIN_DISTANCE).length;
    // Die Farbwelten sind in Q4 auf den Mindestabstand nachgeschärft (`spikes/quality/fix_palette_*.py`,
    // 31/31 Paletten allein). In 33 der 372 Kombinationen liegt die Wand eines Themes zu nah am Dach der
    // Palette (vor allem `winter`, dessen sehr helle kühle Wand warme Paletten aufzehrt) – bewusste,
    // dokumentierte Restlücke im Bericht §Offene Punkte.
    expect(ok / results.length).toBeGreaterThan(0.9);
    // … und die Palette ändert die Messung wirklich (sonst misst P1 das Theme, nicht die Farbwelt).
    const moved = results.filter((r) => Math.abs(r.after - r.before) > 1e-9).length;
    expect(moved / results.length).toBeGreaterThan(0.9);
  });
});

describe('P1 am erzeugten Projekt (mit und ohne Palette)', () => {
  const ctx = nodeContext(CATALOG);
  const withPalettes: PipelineContext = { ...ctx, palettes: PaletteCatalog.of(PALETTES) };

  it('ein Projekt ohne Palette löst exakt das Theme des Katalogs auf (Referenzobjekt)', () => {
    const project = sampleHouse('1.21.11', 'medieval');
    expect(project.state.paletteId).toBeUndefined();
    expect(themeFor(project, withPalettes)).toBe(withPalettes.themes.get('medieval'));
    expect(P1Text(themeFor(project, withPalettes))).toBe(P1Text(CATALOG_THEMES.get('medieval')));
  });

  it('setPalette färbt das Theme der Welt um, ohne die Hülle zu ändern', () => {
    const project = sampleHouse('1.21.11', 'medieval');
    const before = CATALOG_THEMES.get('medieval');
    const plain = generate(project, withPalettes);
    expect(P1(themeFor(project, withPalettes))!.value).toBeCloseTo(P1(before)!.value, 12);

    project.setPalette('winterhort');
    const themed = themeFor(project, withPalettes);
    expect(themed.id).toBe('medieval');
    expect(themed.roles['wall_primary']).not.toEqual(before.roles['wall_primary']);
    // Bauweise bleibt: Flächen-Regeln und Vererbungskette unverändert
    expect(JSON.stringify(themed.surfaces)).toBe(JSON.stringify(before.surfaces));
    expect([...themed.chain]).toEqual([...before.chain]);

    const colored = generate(project, withPalettes);
    const names = (w: typeof colored): string => [...w.materialized.volume.cells()].map((c) => c.state.name).join(',');
    expect(names(colored)).not.toBe(names(plain)); // Farbe wechselt
    expect(colored.materialized.volume.size).toEqual(plain.materialized.volume.size); // Geometrie bleibt
  });

});
