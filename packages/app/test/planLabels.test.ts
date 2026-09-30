/**
 * Lesbare Grundriss-Beschriftung (Review R1-14) und enge 3D-Einpassung: Mindestgröße in angezeigten Pixeln, jede
 * Beschriftung im eigenen Raum, keine Überdeckung, sonst Kurzform oder keine; Kamera-Abstand passt alle Ecken ein.
 */
import { describe, expect, it } from 'vitest';
import { MIN_LABEL_PX, labelFontPx, layoutLabels, type LabelCandidate } from '../src/editor/labels.js';
import { fitDistance, fitView } from '../src/viewer/viewport.js';

/** Breite wie eine Proportionalschrift: 0,6 × Schriftgröße je Zeichen. */
const measureAt = (fontPx: number) => (t: string) => t.length * fontPx * 0.6;
const CELL = 16;
const room = (key: string, minX: number, minZ: number, maxX: number, maxZ: number, name: string, no: number): LabelCandidate => ({
  key, minX, minZ, maxX, maxZ, texts: [`${name} · ${no}`, String(no)],
});

describe('Schriftgröße', () => {
  it('angezeigt mindestens 11 px: bei 0,57-facher Anzeige (1440 px) wächst die Zeichenschrift', () => {
    expect(labelFontPx(1)).toBe(MIN_LABEL_PX);
    expect(labelFontPx(2)).toBe(MIN_LABEL_PX); // groß dargestellt: nicht kleiner als bisher
    const at1440 = labelFontPx(0.57);
    expect(at1440 * 0.57).toBeGreaterThanOrEqual(MIN_LABEL_PX - 0.01);
    expect(labelFontPx(0.3) * 0.3).toBeGreaterThanOrEqual(MIN_LABEL_PX - 0.01); // 360 px
    expect(labelFontPx(Number.NaN)).toBe(MIN_LABEL_PX);
  });
});

describe('Beschriftungen setzen', () => {
  it('passt: voller Text; zu schmal: nur die Nummer; zu klein: keine', () => {
    const font = labelFontPx(0.57); // ≈ 19,3 Zeichenpixel
    const placed = layoutLabels(
      [room('big', 0, 0, 19, 9, 'Taverne', 1), room('narrow', 20, 0, 23, 9, 'Lager', 2), room('tiny', 24, 0, 24, 0, 'Flur', 3)],
      CELL, font, measureAt(font),
    );
    expect(placed.map((l) => [l.key, l.text])).toEqual([['big', 'Taverne · 1'], ['narrow', '2']]);
    for (const l of placed) {
      const c = { big: [0, 19], narrow: [20, 23] }[l.key as 'big' | 'narrow'];
      expect(l.cx - l.w / 2).toBeGreaterThanOrEqual(c[0]! * CELL);
      expect(l.cx + l.w / 2).toBeLessThanOrEqual((c[1]! + 1) * CELL);
    }
  });

  it('keine Überdeckung: überlappende Raum-Rechtecke (L-Form) bekommen nur eine Beschriftung an derselben Stelle', () => {
    const font = 11;
    const a = room('a', 0, 0, 9, 9, 'Küche', 1);
    const b = room('b', 2, 2, 7, 7, 'Lager', 2); // Mitte fällt auf dieselbe Stelle
    const placed = layoutLabels([a, b], CELL, font, measureAt(font));
    expect(placed).toHaveLength(1);
    expect(placed[0]!.key).toBe('a'); // größerer Raum zuerst
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const p = placed[i]!, q = placed[j]!;
        expect(Math.abs(p.cx - q.cx) * 2 >= p.w + q.w || Math.abs(p.cy - q.cy) * 2 >= p.h + q.h).toBe(true);
      }
    }
  });
});

describe('3D einpassen', () => {
  const dir = (() => { const d = [-10, 29, 14]; const l = Math.hypot(...d); return d.map((x) => x / l) as [number, number, number]; })();
  const tan = Math.tan((40 * Math.PI) / 180 / 2);

  it('alle Ecken im Bild; flacher breiter Bau: näher als die Hüllkugel', () => {
    const min: [number, number, number] = [0, 0, 0];
    const max: [number, number, number] = [48, 4, 44];
    const center: [number, number, number] = [24, 2, 22];
    for (const aspect of [900 / 260, 340 / 220, 0.8]) {
      const d = fitDistance(min, max, center, dir, tan, tan * aspect, 1);
      const sphere = Math.hypot(48, 4, 44) / 2 / Math.sin(Math.atan(Math.min(tan, tan * aspect)));
      expect(d).toBeLessThan(sphere);
      // jede Ecke liegt im Kegel (mit numerischer Toleranz)
      const cam = center.map((c, i) => c + dir[i]! * d) as [number, number, number];
      const f = dir.map((x) => -x);
      const r = [-f[2]!, 0, f[0]!]; // f × (0, 1, 0)
      const rl = Math.hypot(...r);
      const right = r.map((x) => x / rl);
      const up = [right[1]! * f[2]! - right[2]! * f[1]!, right[2]! * f[0]! - right[0]! * f[2]!, right[0]! * f[1]! - right[1]! * f[0]!];
      for (const x of [0, 48]) for (const y of [0, 4]) for (const z of [0, 44]) {
        const v = [x - cam[0], y - cam[1], z - cam[2]];
        const depth = v[0]! * f[0]! + v[1]! * f[1]! + v[2]! * f[2]!;
        expect(Math.abs(v[0]! * right[0]! + v[1]! * right[1]! + v[2]! * right[2]!)).toBeLessThanOrEqual(tan * aspect * depth + 1e-6);
        expect(Math.abs(v[0]! * up[0]! + v[1]! * up[1]! + v[2]! * up[2]!)).toBeLessThanOrEqual(tan * depth + 1e-6);
      }
    }
  });

  it('zentriert: der projizierte Quader liegt mittig und der Abstand wird nicht größer', () => {
    const min: [number, number, number] = [0, -4, 0];
    const max: [number, number, number] = [48, 6, 44];
    const aspect = 830 / 196; // 1024 px: breite, flache 3D-Fläche
    const plain = fitDistance(min, max, [24, 1, 22], dir, tan, tan * aspect, 1.08);
    const view = fitView(min, max, dir, tan, tan * aspect, 1.08);
    expect(view.distance).toBeLessThanOrEqual(plain + 1e-6);
    // Projektion der Ecken: oben und unten gleich viel Rand
    const f = dir.map((x) => -x);
    const rl = Math.hypot(f[2]!, f[0]!);
    const right = [-f[2]! / rl, 0, f[0]! / rl];
    const up = [right[1]! * f[2]! - right[2]! * f[1]!, right[2]! * f[0]! - right[0]! * f[2]!, right[0]! * f[1]! - right[1]! * f[0]!];
    const cam = view.target.map((c, i) => c + dir[i]! * view.distance);
    const ys: number[] = [];
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      const v = [x - cam[0]!, y - cam[1]!, z - cam[2]!];
      const depth = v[0]! * f[0]! + v[1]! * f[1]! + v[2]! * f[2]!;
      ys.push((v[0]! * up[0]! + v[1]! * up[1]! + v[2]! * up[2]!) / (depth * tan));
    }
    expect(Math.abs(Math.max(...ys) + Math.min(...ys))).toBeLessThan(0.02); // mittig
    expect(Math.max(...ys.map(Math.abs))).toBeLessThanOrEqual(1); // im Bild
    expect(Math.max(...ys.map(Math.abs))).toBeGreaterThan(0.85); // und füllt es (Rand 8 %)
  });

  it('Etagen-Leiste links: die Base liegt ganz rechts davon (nutzbares Bild ab `left`)', () => {
    const min: [number, number, number] = [0, -4, 0];
    const max: [number, number, number] = [48, 6, 44];
    const aspect = 340 / 215; // 390 px
    const left = -1 + (2 * 72) / 340;
    const view = fitView(min, max, dir, tan, tan * aspect, 1.08, left);
    const f = dir.map((x) => -x);
    const rl = Math.hypot(f[2]!, f[0]!);
    const right = [-f[2]! / rl, 0, f[0]! / rl];
    const cam = view.target.map((c, i) => c + dir[i]! * view.distance);
    const xs: number[] = [];
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      const v = [x - cam[0]!, y - cam[1]!, z - cam[2]!];
      const depth = v[0]! * f[0]! + v[1]! * f[1]! + v[2]! * f[2]!;
      xs.push((v[0]! * right[0]! + v[1]! * right[1]! + v[2]! * right[2]!) / (depth * tan * aspect));
    }
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(left - 1e-6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('senkrecht von oben bleibt endlich', () => {
    const d = fitDistance([0, 0, 0], [10, 2, 10], [5, 1, 5], [0, 1, 0], tan, tan, 1.08);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
  });
});
