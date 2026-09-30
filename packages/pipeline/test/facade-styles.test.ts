/**
 * P12: Stilabhängige Fassaden-Zielbänder (`FACADE_STYLE_TARGETS`, `facadeTargetsFor`, `facadeTargetMisses(q, typeId)`).
 *
 * Geprüft wird dreierlei:
 *  1. **Ohne Bautyp bitgleich:** `facadeTargetMisses(q)` nutzt unverändert die generische Tabelle.
 *  2. **Stilprofil wirkt:** `hobbit` (F2 16,6 %) und `township`-artige Werte gelten mit Profil als im Band.
 *  3. **Kein Freibrief:** F1 (Tiefe) und F4 (Fensterwiederholung) bleiben in **jedem** Profil Pflicht – die
 *     gemessenen Werte von `watchtower` **ohne Pflichtregeln** (F1 18,9 %, F4 unverändert) müssen weiter auffallen,
 *     und eine echte F2-Abweichung (60 %) wird auch mit Profil gemeldet.
 */
import { describe, expect, it } from 'vitest';
import { FACADE_STYLE_TARGETS, FACADE_TARGETS, facadeTargetMisses, facadeTargetsFor, type FacadeQuality } from '../src/quality-f.js';

const q = (v: Partial<FacadeQuality>): FacadeQuality => ({
  f1: 0.5,
  f2: 0.25,
  f3: 8,
  f4: 1,
  facadeCells: 500,
  windowAxes: 10,
  distinctBlocks: 25,
  ...v,
});

describe('P12: Stilabhängige Zielbänder', () => {
  it('ohne Bautyp gilt unverändert die generische Tabelle', () => {
    expect(facadeTargetsFor()).toEqual(FACADE_TARGETS);
    expect(facadeTargetMisses(q({ f2: 0.166 }))).toContain('F2 16.6 % außerhalb 20.0 %–35.0 %');
    expect(facadeTargetMisses(q({ f3: 12.6 }))).toContain('F3 12.6 außerhalb 6–12');
  });

  it('die vier gemessenen Stilfälle sind mit Profil im Band', () => {
    expect(facadeTargetMisses(q({ f2: 0.166 }), 'hobbit')).toEqual([]);
    expect(facadeTargetMisses(q({ f2: 0.169 }), 'watchtower')).toEqual([]);
    expect(facadeTargetMisses(q({ f2: 0.376 }), 'townhouse')).toEqual([]);
    expect(facadeTargetMisses(q({ f2: 0.41, f3: 12.6 }), 'twostory')).toEqual([]);
  });

  it('kein Freibrief: F1 und F4 bleiben in jedem Profil Pflicht', () => {
    // Werte von `watchtower` OHNE Pflichtregeln (npm run quality -- --plain): F1 18,9 %, F4 1.
    const ohneRegeln = q({ f1: 0.189, f2: 0.083, f4: 1 });
    const miss = facadeTargetMisses(ohneRegeln, 'watchtower');
    expect(miss.some((m) => m.startsWith('F1 ')), miss.join('; ')).toBe(true);
    // F4-Verstoß (5 Achsen) wird trotz Profil gemeldet.
    expect(facadeTargetMisses(q({ f4: 5 }), 'hobbit').some((m) => m.startsWith('F4 '))).toBe(true);
    // Echte F2-Abweichung nach oben bleibt ein Verstoß.
    expect(facadeTargetMisses(q({ f2: 0.6 }), 'twostory').some((m) => m.startsWith('F2 '))).toBe(true);
  });

  it('die Profile ändern nur F2/F3, nie F1/F4-Grenzen', () => {
    for (const [id, profile] of Object.entries(FACADE_STYLE_TARGETS)) {
      const t = facadeTargetsFor(id);
      expect(t.f1, id).toEqual(FACADE_TARGETS.f1);
      expect(t.f4, id).toEqual(FACADE_TARGETS.f4);
      expect(Object.keys(profile).every((k) => k === 'f2' || k === 'f3'), id).toBe(true);
    }
  });
});
