/**
 * W8-D (aus W7-K: „Außen-Deko 85 vs. 84 Teile“ in zwei Browser-Läufen derselben Vorlage): Die Vorlage bekommt je Öffnen
 * des Assistenten einen neuen Zufalls-Seed (`randomSeed` → `proposalCandidates`), und die Außen-Deko hängt am
 * Projekt-Seed. Gleicher Seed ⇒ gleiche Teile (auch in frischen Sitzungen); verschiedene Seeds dürfen abweichen.
 */
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import * as bt from '../src/buildingTypes.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes;
const ctx = { catalog, themes: load.themeCatalog!, types };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });

const parts = (seed: number, themeId = 'medieval'): string => {
  const def = types.get('house');
  const s = bt.typeSession(def, { ...bt.defaultParams(def, ctx.themes.ids(), 'medieval', NEW), themeId }, seed, ctx, NEW).session;
  const plan = uc.exteriorOf(s.project, catalog, uc.shellStyle(s));
  return JSON.stringify(plan?.placements ?? []);
};

describe('W8-D: Außen-Deko der Vorlage „Beispielhaus“ ist je Seed deterministisch', () => {
  it('gleicher Seed → gleiche Teile (zweimal, frische Sitzungen); Seeds der drei Browser-Läufe', () => {
    for (const seed of [649083469, 416110537, 2991890227, 7]) expect(parts(seed), String(seed)).toBe(parts(seed));
  });

  it('verschiedene Seeds dürfen abweichen (Fachwerk vor W9 76/77 – so entstand 85 vs. 84; seit W9-G1 Grundriss je Seed)', () => {
    // W12-A (2026-09-28): das Beispielhaus ist je Seed ein- oder zweigeschossig; die Spanne gilt je Geschosszahl (sonst
    // zählt das Obergeschoss mit seinen Fenstern und Konsolen als „Abweichung“)
    const def = types.get('house');
    const floorsOf = (seed: number): number => {
      const s = bt.typeSession(def, { ...bt.defaultParams(def, ctx.themes.ids(), 'medieval', NEW), themeId: 'timber' }, seed, ctx, NEW).session;
      return new Set(s.project.state.rooms.map((r) => r.floorIndex)).size;
    };
    const byFloors = new Map<number, number[]>();
    for (let i = 0; i < 8; i++) {
      const f = floorsOf(1000 + i);
      byFloors.set(f, [...(byFloors.get(f) ?? []), (JSON.parse(parts(1000 + i, 'timber')) as unknown[]).length]);
    }
    const counts = new Set([...byFloors.values()].flat());
    expect(counts.size).toBeGreaterThan(1);
    // (gemessen 2026-09-28: Spanne 11 bei gleicher Geschosszahl – Ecke und Breite des Quergiebels je Seed)
    // W13-E (2026-09-28): Fachwerk-Obergeschoss mit Bank und Sturz über die ganze Breite und ohne Bank über dem Sturz darunter
    // – je Seed mehr bzw. weniger Stücke: gemessen Spanne 17 (vorher ≤ 12)
    for (const ns of byFloors.values()) expect(Math.max(...ns) - Math.min(...ns)).toBeLessThanOrEqual(18);
    // W9 (2026-09-27): W9-G2 (Fenstermodul Fachwerk ruhiger: Blumenkästen 20 → 8, Stürze 28 → 12) senkte die Zahl auf
    // 44/45 (nur der Eingangsschmuck schwankt, wie vorher). W9-G1 würfelt beim Beispielhaus die Lage des Quergiebels je
    // Seed, samt Fassadenraster – damit ändern sich Fenster, Traufe und Deko mit dem Seed: gemessen 50–58 (Seeds
    // 1000–1007, ebenso 1000–1023). Gleicher Seed bleibt gleich (Test oben).
  });
});
