/**
 * Katalog-Objekte im Gelände (Q3, research/56 §4): Zonen fordern Tags an, der Platzierungsschritt setzt
 * Komponenten aus dem Katalog. Geprüft werden die harten Randbedingungen des Auftrags:
 *  - **Auflage:** jede Spalte eines Objekts steht auf derselben Geländehöhe, das Objekt beginnt eine Zelle darüber.
 *  - **Freihaltung:** keine Spalte eines Objekts liegt auf einem Weg, in der Türachse (< 3) oder auf einer
 *    Sperrfläche; das Gebäude wird nicht überbaut.
 *  - **Determinismus:** gleicher Seed ⇒ gleiche Platzierungen.
 *  - **Wirkung:** jede Zonenart bekommt Objekte (Kennzahl L2 > 0).
 */
import { describe, expect, it } from 'vitest';
import { key3 } from '@mcda/core';
import { expandComponent, placeComponent } from '@mcda/furnishing';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { ZONE_KINDS } from '../src/model.js';
import { ZONE_PROP_FACTOR, ZONE_PROP_TAGS, type OutdoorPlacement } from '../src/props.js';
import { catalogObjectRates, catalogObjectRatesByKind, type ZoneObjectRate } from '../src/quality-l.js';
import { generateSite } from '../src/generate.js';
import { DATA_VERSION_1_21_11, loadCatalog } from './helpers.js';
import { TEST_STYLE, fullSite, syntheticBuilding } from './fixtures.js';

const catalog = loadCatalog();
const options = { catalog, dataVersion: DATA_VERSION_1_21_11 };
const building = syntheticBuilding();

function run(seed = 11) {
  return generateSite(fullSite(seed).state, TEST_STYLE, building, undefined, options);
}
const res = run();
const outer = (c: OutdoorPlacement) => placeComponent(expandComponent(catalog.get(c.componentId), c.variantId), c.pose);

describe('Gelände nutzt den Katalog: Platzierungen', () => {
  it('jede Zonenart fordert Tags an und hat einen Dichtefaktor', () => {
    for (const kind of ZONE_KINDS) {
      expect(ZONE_PROP_TAGS[kind].length, kind).toBeGreaterThan(0);
      expect(ZONE_PROP_FACTOR[kind], kind).toBeGreaterThan(0);
      expect(ZONE_PROP_FACTOR[kind], kind).toBeLessThanOrEqual(1);
    }
  });

  it('setzt Objekte in Hof, Garten, Feld und Teich', { timeout: HEAVY_TIMEOUT }, () => {
    const kinds = new Set(res.outdoor.map((p) => p.zoneKind));
    expect(kinds.has('yard')).toBe(true);
    expect(kinds.has('garden')).toBe(true);
    expect(kinds.has('field')).toBe(true);
    expect(kinds.has('pond')).toBe(true);
    expect(res.outdoor.length).toBeGreaterThan(4);
  });

  it('nichts schwebt: alle Zellen eines Objekts stehen auf derselben Geländehöhe', { timeout: HEAVY_TIMEOUT }, () => {
    for (const p of res.outdoor) {
      const cells = outer(p).cells;
      const levels = new Set(cells.map((c) => res.top[res.grid.idx(c.pos[0], c.pos[2])]!));
      expect(levels.size, `${p.componentId} @${p.cell}`).toBe(1);
      expect(p.pose.pos[1], `${p.componentId} steht auf dem Boden`).toBe([...levels][0]! + 1);
    }
  });

  it('Wege, Zugänge und Sperrflächen bleiben frei', { timeout: HEAVY_TIMEOUT }, () => {
    const { grid } = res;
    const zoneIds = new Set(fullSite(11).state.zones.map((z) => z.id));
    for (const p of res.outdoor) {
      for (const c of outer(p).cells) {
        const i = grid.idx(c.pos[0], c.pos[2]);
        expect(res.plan.path[i], `${p.componentId} auf einem Weg`).toBe(0);
        expect(res.surface[i] === 'building', `${p.componentId} im Gebäude`).toBe(false);
        expect(building.occupied.has(key3(c.pos)), `${p.componentId} auf dem Gebäude`).toBe(false);
      }
      // Türachse: die Ankerzelle liegt ≥ 3 Zellen von jedem Ausgang entfernt.
      const exitDist = Math.min(...res.doorExits.map(([x, z]) => Math.max(Math.abs(x - p.cell[0]), Math.abs(z - p.cell[1]))));
      expect(exitDist, `${p.componentId} zu nah an der Tür`).toBeGreaterThanOrEqual(3);
      expect(zoneIds.has(p.zoneId), `${p.componentId} gehört zu keiner Zone`).toBe(true);
    }
  });

  it('deterministisch: gleicher Seed ⇒ gleiche Platzierungen', { timeout: HEAVY_TIMEOUT }, () => {
    expect(run().outdoor).toEqual(res.outdoor);
  });

  it('L2: jede Zone mit Objekten liegt über 0 (Kennzahl je 100 Geländezellen)', { timeout: HEAVY_TIMEOUT }, () => {
    const counts = new Map<string, number>();
    for (const id of res.plan.zone) if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
    const areas = fullSite(11).state.zones.map((z) => ({ zoneId: z.id, kind: z.kind, cells: counts.get(z.id) ?? 0 })).filter((z) => z.cells > 0);
    const rates: ZoneObjectRate[] = catalogObjectRates(areas, res.outdoor);
    const byKind = catalogObjectRatesByKind(rates);
    for (const kind of ['yard', 'garden', 'field', 'pond'] as const) {
      const r = byKind.get(kind);
      if (r === undefined) continue; // Zone im Testkörper nicht vorhanden
      expect(r.objects, kind).toBeGreaterThan(0);
      expect(r.per100, kind).toBeGreaterThan(0);
    }
  });

  it('ohne Katalog bleibt das Gelände ohne Objekte (additiv)', { timeout: HEAVY_TIMEOUT }, () => {
    const plain = generateSite(fullSite(11).state, TEST_STYLE, building);
    expect(plain.outdoor).toEqual([]);
  });
});
