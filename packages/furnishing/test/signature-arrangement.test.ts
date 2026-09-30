/**
 * W3-IN „Räume“ (plan/spikes/W3IN_raeume.md): Signatur-Anordnungen (`near`: Arbeitszeile am Herd, Blick zum Kamin),
 * niedrige Möbel unter dem Fenster, Licht-Budget und bevorzugte Lichtpunkte (`lighting.budget`/`anchors`, I7).
 * Synthetische Komponenten prüfen die Mechanik isoliert, der Katalog die neun Hauptraumtypen.
 */
import { describe, expect, it } from 'vitest';
import { Catalog, ComponentDefSchema, isLightFixture, lightBudget, type ComponentDef, type RoomTypeDef } from '@mcda/catalog';
import { resolveRelDir } from '@mcda/core';
import { RoomPlanner, footprintGap, furnishRoom, type FurnishResult, type PlacedComponent, type RoomGeometry } from '../src/index.js';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { DV, assertHardGuarantees, catalog, shellRoom } from './fixtures.js';

const MAT = { block: 'minecraft:oak_planks' };

function box(id: string, tags: string[], w: number, d: number, h = 1, extra: Record<string, unknown> = {}): ComponentDef {
  const layer = Array.from({ length: d }, () => 'X'.repeat(w));
  return ComponentDefSchema.parse({
    id, kind: 'static', category: 'furniture', tags, obtainability: 'survival', mount: 'floor', rotations: 'backToWall',
    layers: Array.from({ length: h }, () => layer), legend: { X: MAT }, ...extra,
  });
}

function roomType(id: string, required: RoomTypeDef['required'], optional: RoomTypeDef['optional'] = [], extra: Partial<RoomTypeDef> = {}): RoomTypeDef {
  return { id, name: id, minArea: 1, coverage: { target: 0 }, required, optional, ...extra };
}

/** Kette ab dem Bezugsmöbel: wie viele Stücke hängen (anliegend) am Herd bzw. an einem Stück der Kette? */
function chainFrom(head: PlacedComponent, parts: readonly PlacedComponent[]): number {
  const chain = new Set<PlacedComponent>();
  let frontier = [head];
  while (frontier.length > 0) {
    const next = parts.filter((p) => !chain.has(p) && frontier.some((f) => footprintGap(f, p) <= 0));
    next.forEach((p) => chain.add(p));
    frontier = next;
  }
  return chain.size;
}

describe('Signatur-Anordnung `near` (synthetisch)', () => {
  const hearth = box('t/hearth', ['hearth'], 3, 1, 3);
  const counter = box('t/counter', ['counter'], 1, 1);
  const cat = Catalog.of([hearth, counter]);
  const sig = { tags: ['hearth'], count: [1, 1] as [number, number], signature: true };
  const rooms: RoomGeometry[] = [shellRoom(9, 7, { windowSpacing: 4 }), shellRoom(10, 8, { inner: ['north'] }), shellRoom(8, 8, { windowSpacing: 4 })];
  const run = (rt: RoomTypeDef): number[] =>
    rooms.flatMap((g) => Array.from({ length: 8 }, (_, seed) => {
      const r = furnishRoom(g, rt, cat, { seed, dataVersion: DV });
      assertHardGuarantees(g, r, `${g.roomId} seed ${seed}`);
      const head = r.placed.find((p) => p.expanded.defId === 't/hearth')!;
      return chainFrom(head, r.placed.filter((p) => p.expanded.defId === 't/counter'));
    }));

  it('Arbeitszeile: die Arbeitsplatten schließen am Herd an (fast immer alle drei), ohne `near` selten', () => {
    const withNear = run(roomType('k', [sig, { tags: ['counter'], count: [3, 3], near: { tags: ['hearth', 'counter'], sameWall: true } }]));
    const without = run(roomType('k0', [sig, { tags: ['counter'], count: [3, 3] }]));
    const full = (xs: number[]): number => xs.filter((n) => n === 3).length / xs.length;
    expect(full(withNear)).toBeGreaterThanOrEqual(0.9);
    expect(full(without)).toBeLessThan(full(withNear) - 0.3);
  });

  it('Qualität: Teilwert „Signatur-Anordnung“ (Anteil der Möbel am Bezugsmöbel)', () => {
    const rt = roomType('k', [sig, { tags: ['counter'], count: [2, 2], near: { tags: ['hearth', 'counter'], sameWall: true } }]);
    const r = furnishRoom(shellRoom(9, 7, { windowSpacing: 4 }), rt, cat, { seed: 1, dataVersion: DV });
    const part = r.quality.parts.find((p) => p.id === 'arrangement');
    expect(part?.value).toBe(1);
    expect(part?.detail).toMatch(/2 von 2/);
    // ohne `near` gibt es den Teilwert nicht (bitgleiche Qualität für Raumtypen ohne Anordnung)
    const plain = furnishRoom(shellRoom(9, 7, { windowSpacing: 4 }), roomType('k0', [sig, { tags: ['counter'], count: [2, 2] }]), cat, { seed: 1, dataVersion: DV });
    expect(plain.quality.parts.some((p) => p.id === 'arrangement')).toBe(false);
  });

  it('Blick zum Bezugsmöbel (`facing`): der Sessel schaut zum Kamin', () => {
    const fire = box('t/fire', ['fireplace'], 3, 1, 2);
    const chair = box('t/chair', ['chair'], 1, 1, 1, { rotations: 'all' });
    const c2 = Catalog.of([fire, chair]);
    const rt = roomType('s', [{ tags: ['fireplace'], count: [1, 1], signature: true }, { tags: ['chair'], count: [1, 1], near: { tags: ['fireplace'], maxGap: 2, facing: true } }]);
    let facing = 0;
    let n = 0;
    for (const g of rooms) {
      for (let seed = 0; seed < 8; seed++) {
        const r = furnishRoom(g, rt, c2, { seed, dataVersion: DV });
        const f = r.placed.find((p) => p.expanded.defId === 't/fire')!;
        const c = r.placed.find((p) => p.expanded.defId === 't/chair')!;
        n++;
        // Front des Sessels zeigt zur Rückwand des Kamins (= der Kamin liegt vor ihm) und höchstens 2 Zellen Abstand
        if (resolveRelDir('front', c.pose) === resolveRelDir('back', f.pose) && footprintGap(c, f) <= 2) facing++;
      }
    }
    expect(facing / n).toBeGreaterThanOrEqual(0.9);
  });

  it('Schema: Bezugsmöbel muss im Programm vorkommen', async () => {
    const { validateRoomTypeDef } = await import('@mcda/catalog');
    const bad = validateRoomTypeDef({ ...roomType('x', [sig]), optional: [{ tags: ['counter'], count: [1, 1], near: { tags: ['stove'] } }] });
    expect(bad.ok).toBe(false);
    expect(bad.ok ? '' : bad.errors.join()).toMatch(/near\.tags stove/);
  });
});

describe('Niedrige Möbel unter dem Fenster (W3-IN)', () => {
  it('eine Reihe hohe Rückseite lehnt am Fenster an, zwei Reihen nicht', () => {
    // 7 × 6: Nordwand mit Fenstern an x = 1 und x = 3 (Abstand 2, Rand 1)
    const g = shellRoom(7, 6);
    const windowsNorth = g.windows.filter((w) => w.toward === 'north').map((w) => w.inside[0]);
    expect(windowsNorth.length).toBeGreaterThan(0);
    const planner = new RoomPlanner(g);
    const low = box('t/low', ['low'], 1, 1, 1);
    const tall = box('t/tall', ['tall'], 1, 1, 2);
    const atNorth = (def: ComponentDef): number[] => planner.poses(def).filter((p) => resolveRelDir('back', p.pose) === 'north' && p.pose.pos[2] === 0).map((p) => p.pose.pos[0]);
    for (const x of windowsNorth) {
      expect(atNorth(low), `niedrig vor dem Fenster bei x=${x}`).toContain(x);
      expect(atNorth(tall), `hoch vor dem Fenster bei x=${x}`).not.toContain(x);
    }
    // Komponenten mit Rahmen (Entities) an der Wand bleiben bei festen Wänden
    const framed = box('t/framed', ['framed'], 1, 1, 1, { entities: [{ type: 'item_frame', at: [0, 1, 0], face: 'back' }] });
    for (const x of windowsNorth) expect(atNorth(framed)).not.toContain(x);
  });
});

describe('Licht-Budget und bevorzugte Lichtpunkte (I7)', () => {
  it('lightBudget: Fläche / cellsPer, mindestens min (Standard 1), höchstens max; ohne Budget unendlich', () => {
    expect(lightBudget(undefined, 40)).toBe(Infinity);
    expect(lightBudget({ budget: { cellsPer: 12 } }, 40)).toBe(3);
    expect(lightBudget({ budget: { cellsPer: 12 } }, 4)).toBe(1);
    expect(lightBudget({ budget: { cellsPer: 12, min: 2 } }, 4)).toBe(2);
    expect(lightBudget({ budget: { cellsPer: 10, max: 4 } }, 200)).toBe(4);
    expect(isLightFixture(catalog.get('light/hanging_lantern'))).toBe(true);
    expect(isLightFixture(catalog.get('decor/candles'))).toBe(true);
    expect(isLightFixture(catalog.get('work/kitchen_hearth'))).toBe(false);
  });

  const MAIN = ['kitchen', 'tavern', 'bedroom', 'smithy', 'library', 'storage', 'solar', 'alchemy', 'dining_hall'];
  const cases = (type: string): RoomGeometry[] => {
    const min = catalog.roomType(type).minArea;
    return [shellRoom(8, 7, { windowSpacing: 4 }), shellRoom(10, 8), shellRoom(12, 9, { inner: ['north'], height: 4 }), shellRoom(14, 10, { height: 5 })].filter((g) => g.interior.size >= min);
  };
  const lights = (r: FurnishResult): FurnishResult['placements'] => r.placements.filter((p) => isLightFixture(catalog.get(p.componentId)));

  it('die neun Hauptraumtypen haben Signatur-Anordnung, Budget und Lichtpunkte im Katalog', () => {
    for (const id of MAIN) {
      const rt = catalog.roomType(id);
      expect(rt.lighting?.budget, id).toBeDefined();
      expect(rt.lighting?.anchors?.length, id).toBeGreaterThan(0);
      if (id !== 'library' && id !== 'dining_hall' && id !== 'storage') expect([...rt.required, ...rt.optional].some((e) => e.near !== undefined), id).toBe(true);
    }
  });

  it('Einrichtung: Leuchten im Budget, Abstell-Lichter nur auf Ankern, je Möbel höchstens ein stehendes und ein hängendes', { timeout: HEAVY_TIMEOUT }, () => {
    for (const id of MAIN) {
      const rt = catalog.roomType(id);
      for (const g of cases(id)) {
        for (let seed = 0; seed < 3; seed++) {
          const r = furnishRoom(g, rt, catalog, { seed, dataVersion: DV });
          assertHardGuarantees(g, r, `${id} ${g.roomId} seed ${seed}`);
          const ls = lights(r);
          expect(ls.length, `${id} ${g.roomId} seed ${seed}`).toBeLessThanOrEqual(lightBudget(rt.lighting, g.interior.size));
          const anchors = rt.lighting!.anchors!;
          const byKey = new Map(r.placements.map((p) => [p.key, p]));
          const perHost = new Map<string, number>();
          for (const l of ls) {
            if (l.parentKey === undefined) continue;
            const host = byKey.get(l.parentKey)!;
            expect(catalog.get(host.componentId).tags.some((t) => anchors.includes(t)), `${id}: Licht auf ${host.componentId}`).toBe(true);
            const k = `${l.parentKey}|${catalog.get(l.componentId).mount === 'ceiling' ? 'hang' : 'stand'}`;
            perHost.set(k, (perHost.get(k) ?? 0) + 1);
          }
          // Paar-Andockpunkte (zwei Kerzengruppen auf der langen Tafel) zählen als ein Licht-Ort
          for (const [k, n] of perHost) expect(n, `${id} ${k}`).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('Küche: Herd mit Arbeitszeile (mindestens zwei Stück anliegend) in den meisten Räumen', { timeout: HEAVY_TIMEOUT }, () => {
    let ok = 0;
    let n = 0;
    for (const g of cases('kitchen')) {
      for (let seed = 0; seed < 4; seed++) {
        const r = furnishRoom(g, catalog.roomType('kitchen'), catalog, { seed, dataVersion: DV });
        const head = r.placed.find((p) => catalog.get(p.expanded.defId).tags.includes('hearth'));
        const work = r.placed.filter((p) => ['counter', 'sink', 'smoker'].some((t) => catalog.get(p.expanded.defId).tags.includes(t)) && p.expanded.mount === 'floor');
        n++;
        if (head !== undefined && chainFrom(head, work) >= 2) ok++;
      }
    }
    expect(ok / n).toBeGreaterThanOrEqual(0.75);
  });
});
