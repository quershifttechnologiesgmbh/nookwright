/**
 * W11-A „Treppen automatisch aus den Räumen“ im Editor: Malen auf einer neuen Etage verbindet sie (ein Undo-Schritt,
 * Statuszeile), von Hand gesetzte Treppen bleiben, bewusst entfernte kommen nicht zurück, Schalter aus = wie bisher.
 */
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import * as uc from '../src/usecases.js';

const catalog = loadBundledCatalog().catalog!;
const AUTO = { autoStairs: true } as const;

type Rect = uc.Rect;
const r = (x1: number, z1: number, x2: number, z2: number): Rect => ({ x1, z1, x2, z2 });

function paint(s: uc.Session, rect: Rect, type: string, floor: number, flag: uc.AutoStairsFlag = AUTO): uc.Session {
  return uc.paintRect(s, catalog, rect, type, floor, flag).session;
}

/** EG mit Eingangshalle und Küche, 1. OG angelegt (noch leer). */
function groundFloor(seed = 3): uc.Session {
  let s = uc.createSession(seed);
  s = paint(s, r(2, 2, 10, 12), 'entrance_hall', 0);
  s = paint(s, r(10, 2, 18, 12), 'kitchen', 0);
  return uc.addFloor(s, catalog).session;
}

const typeOf = (s: uc.Session, id: string): string => s.project.state.rooms.find((x) => x.id === id)!.roomTypeId;
const lowerType = (s: uc.Session, floor: number): string => {
  const link = s.project.state.links.find((l) => l.floorIndex === floor)!;
  return typeOf(s, uc.roomAt(s.project.state, link.origin[0], link.origin[1], floor)!.id);
};

describe('W11-A: Treppen automatisch im Editor', () => {
  it('Raum auf neuer Etage malen → Treppe in der Diele, ein Undo-Schritt, Statuszeile', () => {
    const s0 = groundFloor();
    const s1 = paint(s0, r(2, 2, 18, 12), 'bedroom', 1);
    expect(s1.project.state.links).toHaveLength(1);
    expect(lowerType(s1, 0)).toBe('entrance_hall');
    expect(uc.disconnectedFloors(s1.project.state)).toEqual([]);
    expect(s1.autoStairsNote).toBe('Treppe automatisch gesetzt: EG ↔ 1. OG in Eingangshalle → Schlafzimmer');
    expect(s1.past.length).toBe(s0.past.length + 1);
    // Rückgängig nimmt Raum und Treppe in EINEM Schritt zurück
    const back = uc.undo(s1);
    expect(back.project.state.links).toEqual([]);
    expect(back.project.state.rooms.filter((x) => x.floorIndex === 1)).toEqual([]);
    expect(back.project.history.length).toBe(s0.project.history.length);
  });

  it('Schalter aus: keine Treppe (wie bisher, bitgleich)', () => {
    const s0 = groundFloor();
    const off = paint(s0, r(2, 2, 18, 12), 'bedroom', 1, {});
    const offExplicit = paint(s0, r(2, 2, 18, 12), 'bedroom', 1, { autoStairs: false });
    expect(off.project.state.links).toEqual([]);
    expect(off.autoStairsNote).toBeUndefined();
    expect(offExplicit.project.history).toEqual(off.project.history);
  });

  it('drei Etagen und Keller: jede Etage erreichbar; nur neue Lücken, schon verbundene bleiben unberührt', () => {
    let s = groundFloor(5);
    s = paint(s, r(2, 2, 10, 12), 'gallery', 1);
    s = paint(s, r(10, 2, 18, 12), 'bedroom', 1);
    s = uc.addFloor(s, catalog).session;
    s = paint(s, r(2, 2, 18, 12), 'attic', 2);
    s = uc.addFloor(s, catalog, { below: true }).session;
    s = paint(s, r(2, 2, 18, 12), 'storage', -1);
    expect(s.project.state.links.map((l) => l.floorIndex).sort()).toEqual([-1, 0, 1]);
    expect(uc.disconnectedFloors(s.project.state)).toEqual([]);
    expect(lowerType(s, 0)).toBe('entrance_hall');
    expect(lowerType(s, 1)).toBe('gallery');
    // weiterer Raum auf verbundener Etage: keine neue Treppe
    const more = paint(s, r(18, 2, 26, 12), 'study', 0);
    expect(more.project.state.links).toEqual(s.project.state.links);
    expect(more.autoStairsNote).toBeUndefined();
  }, HEAVY_TIMEOUT);

  it('von Hand gesetzte Treppe bleibt; entfernte Treppe kommt bei der nächsten Aktion nicht zurück', () => {
    let s = groundFloor();
    s = paint(s, r(2, 2, 18, 12), 'bedroom', 1, {});
    const manual = uc.placeStairs(s, catalog, { floor: 0, origin: [12, 4], facing: 'east', type: 'straight' });
    expect(manual.linkId).toBeDefined();
    const withManual = paint(manual.session, r(18, 2, 24, 12), 'study', 1);
    expect(withManual.project.state.links).toEqual(manual.session.project.state.links);
    // Nutzer entfernt sie bewusst → nächste Raum-Aktion setzt keine neue
    const removed = uc.removeStairs(withManual, catalog, manual.linkId!);
    const again = paint(removed, r(18, 2, 24, 12), 'library', 0);
    expect(again.project.state.links).toEqual([]);
    // Schalter einschalten („Treppen jetzt verbinden“) schließt auch alte Lücken – ein Schritt
    const now = uc.autoStairs(again, catalog);
    expect(now.project.state.links).toHaveLength(1);
    expect(now.past.length).toBe(again.past.length + 1);
    expect(uc.autoStairs(now, catalog)).toBe(now);
  }, HEAVY_TIMEOUT);

  it('Radieren trennt die Etage (Treppe entfällt) → dieselbe Aktion setzt eine neue, wo sie passt', () => {
    const s0 = paint(groundFloor(), r(2, 2, 18, 12), 'bedroom', 1);
    const link = s0.project.state.links[0]!;
    const erased = uc.eraseRect(s0, catalog, r(link.origin[0] - 1, link.origin[1] - 1, link.origin[0] + 1, link.origin[1] + 1), 0, AUTO);
    expect(uc.disconnectedFloors(erased.project.state)).toEqual([]);
    expect(erased.project.state.links).toHaveLength(1);
    expect(erased.project.state.links[0]!.id).not.toBe(link.id);
  }, HEAVY_TIMEOUT);

  it('deterministisch: gleiche Aktionen → gleiche Treppe', () => {
    const a = paint(groundFloor(9), r(2, 2, 18, 12), 'solar', 1);
    const b = paint(groundFloor(9), r(2, 2, 18, 12), 'solar', 1);
    expect(a.project.state.links).toEqual(b.project.state.links);
  });

  it('Spielbarkeit: keine Pflichtobjekt-Warnung durch die Treppe', () => {
    const s0 = groundFloor();
    const auto = paint(s0, r(2, 2, 18, 12), 'bedroom', 1);
    const plain = paint(s0, r(2, 2, 18, 12), 'bedroom', 1, {});
    const missing = (s: uc.Session) => [...s.warnings.values()].flat().filter((w) => /Pflichtobjekt/.test(w)).length;
    expect(missing(auto)).toBeLessThanOrEqual(missing(plain));
    expect(missing(auto)).toBe(0);
  });

  it('Browser-Einstellung: Standard an, „off“ = aus, gesperrter Speicher = an', () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    expect(uc.autoStairsPref(store)).toBe(true);
    uc.saveAutoStairsPref(store, false);
    expect(uc.autoStairsPref(store)).toBe(false);
    uc.saveAutoStairsPref(store, true);
    expect(uc.autoStairsPref(store)).toBe(true);
    expect(uc.autoStairsPref(undefined)).toBe(true);
    expect(uc.autoStairsPref({ getItem: () => { throw new Error('gesperrt'); } })).toBe(true);
  });
});
