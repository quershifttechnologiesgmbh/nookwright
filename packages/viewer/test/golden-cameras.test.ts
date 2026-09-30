/**
 * Goldene Galerie (P0-A): Kamera-Ableitung – feste Ansichten je Bau, Einpassen (parallel und perspektivisch),
 * Blickrichtungen, Filter `--views`.
 */
import { describe, expect, it } from 'vitest';
import { FOV_Y, orbitAxes, orbitEye, orbitView, transformPoint } from '../src/camera.js';
import { DEFAULT_PROJECTION, projectionMatrix } from '../src/lit-renderer.js';
import { analyze } from '../golden/lib/analyze.js';
import {
  EYE_FOV, EYE_HEIGHT, EYE_SWING, MAX_SWING, bestEyeFrame, deriveCameras, eyeFrame, firstViewFor, fitOrthographic, sunDirFor, fitPerspectivePoints, hullPoints, PLAN_PITCH, selectViews, yawFromBack, type ViewSpec,
} from '../golden/lib/cameras.js';
import { gridFromVolume, type Vec3 } from '../golden/lib/grid.js';
import { buriedHouse, tableClassifier, testHouse } from './golden-helpers.js';

const close = (a: readonly number[], b: readonly number[], digits = 6): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('Goldene Galerie: Kamera-Mathematik', () => {
  it('yawFromBack: Kamera steht in der angegebenen Himmelsrichtung vom Ziel', () => {
    for (const [bx, bz] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1]] as const) {
      const back = orbitAxes({ target: [0, 0, 0], yaw: yawFromBack(bx, bz), pitch: 0, distance: 1 }).back;
      const n = Math.hypot(bx, bz);
      close(back, [bx / n, 0, bz / n]);
    }
  });

  it('Parallelprojektion: alle Ecken im Bild, Ziel in der Mitte', () => {
    const solid = { min: [2, 0, 3] as Vec3, max: [20, 12, 9] as Vec3 };
    const aspect = 1.6;
    const { orbit, halfHeight } = fitOrthographic(solid, yawFromBack(0, 1), 0, aspect);
    close(orbit.target, [11, 6, 6]);
    const { right, up } = orbitAxes(orbit);
    for (const x of [2, 20]) for (const y of [0, 12]) for (const z of [3, 9]) {
      const q: Vec3 = [x - 11, y - 6, z - 6];
      expect(Math.abs(dot(q, right))).toBeLessThanOrEqual(halfHeight * aspect + 1e-9);
      expect(Math.abs(dot(q, up))).toBeLessThanOrEqual(halfHeight + 1e-9);
    }
    // Höhe bestimmt (12 hoch → 6 > 18 breit / 2 / 1,6 = 5,625), dazu 6 % Rand
    expect(halfHeight).toBeCloseTo(Math.max(6, 9 / aspect) * 1.06, 9);
    // breiter Quader: Breite bestimmt
    expect(fitOrthographic({ min: [0, 0, 0], max: [40, 4, 4] }, 0, 0, aspect).halfHeight).toBeCloseTo((20 / aspect) * 1.06, 9);
  });

  it('Perspektive auf Punkte: alle Punkte im Bildfeld und mittig', () => {
    const pts: Vec3[] = [[0, 0, 0], [30, 0, 0], [0, 0, 20], [30, 0, 20], [10, 25, 8], [12, 3, 18]];
    const fov = (40 * Math.PI) / 180, aspect = 1.6;
    const o = fitPerspectivePoints(pts, yawFromBack(1, 1), 0.5, fov, aspect);
    const eye = orbitEye(o);
    const { right, up, back } = orbitAxes(o);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) {
      const q: Vec3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
      const w = -dot(q, back);
      expect(w).toBeGreaterThan(0);
      const u = dot(q, right) / w / (Math.tan(fov / 2) * aspect), v = dot(q, up) / w / Math.tan(fov / 2);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    expect(Math.max(-u0, u1, -v0, v1)).toBeLessThanOrEqual(1);
    expect(Math.max(-u0, u1, -v0, v1)).toBeGreaterThan(0.9); // eng eingepasst
    expect(u0 + u1).toBeCloseTo(0, 2); // mittig
    expect(v0 + v1).toBeCloseTo(0, 2);
  });
});

describe('Goldene Galerie: Ansichten eines Baus', () => {
  const a = analyze(gridFromVolume(testHouse(), tableClassifier));
  const { variants, views } = deriveCameras(a, { aspect: 1.6 });
  const byName = new Map<string, ViewSpec>(views.map((v) => [v.name, v]));

  it('feste Liste: Präsentation zuerst (W10), 4 Fassaden, 2 Schrägansichten, 3 Nahaufnahmen, je Etage Schnitt und Innenblick', () => {
    expect(views.map((v) => v.name)).toEqual([
      'auge', 'auge-abend', 'tief', 'fassade-n', 'fassade-o', 'fassade-s', 'fassade-w', 'hero-so', 'hero-nw', 'nah-ecke', 'nah-traufe', 'nah-eingang', 'schnitt-1', 'innen-1',
    ]);
    expect(variants.map((v) => v.key)).toEqual(['voll', 'bau', 'haupt', 'umfeld', 'schnitt-1']);
    // Schnitt-Ausschnitt endet über der Etage (Fuß 1 → bis y 3)
    expect(variants.find((v) => v.key === 'schnitt-1')!.box.max[1]).toBe(3);
  });

  it('deterministisch: zweimal abgeleitet = gleich', () => {
    expect(deriveCameras(analyze(gridFromVolume(testHouse(), tableClassifier)), { aspect: 1.6 })).toEqual({ variants, views });
  });

  it('Fassaden parallel und flach, Kamera außerhalb auf der richtigen Seite', () => {
    for (const [name, axis, sign] of [['fassade-s', 2, 1], ['fassade-n', 2, -1], ['fassade-o', 0, 1], ['fassade-w', 0, -1]] as const) {
      const v = byName.get(name)!;
      expect(v.projection.kind).toBe('orthographic');
      expect(v.orbit.pitch).toBe(0);
      const back = orbitAxes(v.orbit).back;
      expect(Math.sign(back[axis])).toBe(sign);
    }
  });

  it('Eingang: Kamera vor der Tür (Süden), Blick auf die Tür', () => {
    const v = byName.get('nah-eingang')!;
    const eye = orbitEye(v.orbit);
    expect(eye[2]).toBeGreaterThan(9); // vor der Südwand
    expect(Math.abs(v.orbit.target[0] - 7.5)).toBeLessThan(0.01);
    expect(eye[1]).toBeGreaterThan(2);
  });

  it('Innenblick: Auge auf 1,62 über dem Boden der Etage, im Haus', () => {
    const v = byName.get('innen-1')!;
    const eye = orbitEye(v.orbit);
    expect(eye[1]).toBeCloseTo(1 + 1.62, 6);
    expect(eye[0]).toBeGreaterThan(5);
    expect(eye[0]).toBeLessThan(10);
    expect(eye[2]).toBeGreaterThan(5);
    expect(eye[2]).toBeLessThan(8);
  });

  it('Schnitt: parallel, fast senkrecht von Süden', () => {
    const v = byName.get('schnitt-1')!;
    expect(v.projection.kind).toBe('orthographic');
    expect(v.orbit.pitch).toBeCloseTo(PLAN_PITCH, 9);
    expect(v.orbit.yaw).toBe(0);
  });

  it('Umriss-Punkte nur für belegte Spalten', () => {
    const pts = hullPoints(a);
    expect(pts.length).toBe(17 * 15 * 8); // Wiese überall
    expect(Math.max(...pts.map((p) => p[1]))).toBe(6); // Dach/Blätter y 5 → Oberkante 6
  });

  it('Filter --views: Name, Präfix oder Gruppe', () => {
    expect(selectViews(views, []).length).toBe(views.length);
    expect(selectViews(views, ['fassade']).map((v) => v.name)).toEqual(['fassade-n', 'fassade-o', 'fassade-s', 'fassade-w']);
    expect(selectViews(views, ['nah-ecke', 'innen']).map((v) => v.name)).toEqual(['nah-ecke', 'innen-1']);
    expect(selectViews(views, ['hero-so']).map((v) => v.name)).toEqual(['hero-so']);
  });

  it('Sockel = Gelände, wenn die Tür darüber steht (Ausschnitte wie bisher)', () => {
    expect(a.baseY).toBe(a.groundY);
    expect(variants.find((v) => v.key === 'bau')!.box.min[1]).toBe(0);
  });
});

describe('Goldene Galerie: Erdhaus im Hügel (W7-J)', () => {
  const a = analyze(gridFromVolume(buriedHouse(), tableClassifier));
  const { variants, views } = deriveCameras(a, { aspect: 1.6 });
  const box = (key: string) => variants.find((v) => v.key === key)!.box;

  it('Gelände = Hügel, Sockel = unter der Haupttür', () => {
    expect(a.groundY).toBe(9);
    expect(a.mainDoor).toMatchObject({ pos: [8, 2, 10], outward: 'south' });
    expect(a.baseY).toBe(1);
    expect(a.floors.map((f) => f.feetY)).toEqual([2]);
  });

  it('Schnitt zeigt den Raum: Ausschnitt vom Sockel bis über die Etage', () => {
    const s = box('schnitt-1');
    expect(s.min[1]).toBeLessThanOrEqual(1); // Bretterboden
    expect(s.max[1]).toBeGreaterThanOrEqual(3);
    expect(s.min[1]).toBeLessThanOrEqual(s.max[1]);
  });

  it('Fassade und Eingang zeigen die Tür ganz', () => {
    for (const key of ['bau', 'umfeld']) expect(box(key).min[1]).toBeLessThanOrEqual(1);
    const v = views.find((w) => w.name === 'fassade-s')!;
    expect(v.projection.kind).toBe('orthographic');
    // Bildmitte ± halbe Höhe umfasst Türschwelle (y 2) und Türsturz (y 4)
    const half = (v.projection as { halfHeight: number }).halfHeight;
    expect(v.orbit.target[1] - half).toBeLessThanOrEqual(2);
    expect(v.orbit.target[1] + half).toBeGreaterThanOrEqual(4);
  });
});

describe('W10 Präsentation: Augenhöhe', () => {
  const a = analyze(gridFromVolume(testHouse(), tableClassifier));
  const { views } = deriveCameras(a, { aspect: 1.6 });
  const auge = views.find((v) => v.name === 'auge')!;

  it('Auge 1,7 über dem Türboden, waagerecht (Neigung 0), Shift statt Kippen, Präsentations-Look', () => {
    const eye = orbitEye(auge.orbit);
    expect(eye[1]).toBeCloseTo(a.mainDoor!.pos[1] + EYE_HEIGHT, 9);
    expect(auge.orbit.pitch).toBe(0);
    expect(auge.projection).toMatchObject({ kind: 'perspective', fovY: EYE_FOV });
    expect(auge.projection.kind === 'perspective' ? auge.projection.shiftY : undefined).toBeGreaterThan(0);
    expect(auge.look?.mood).toBe('tag');
    expect(views.find((v) => v.name === 'auge-abend')!.look?.mood).toBe('abend');
    // alle anderen Ansichten ohne Look: bitgleich wie vor W10
    expect(views.filter((v) => v.group !== 'praesentation').every((v) => v.look === undefined)).toBe(true);
  });

  it('Kamera vor der Tür (außen) und der Bau ganz im Bild (mit Shift)', () => {
    const eye = orbitEye(auge.orbit);
    const [ox, oz] = [0, 1]; // Testhaus: Tür nach Süden
    expect(a.mainDoor!.outward).toBe('south');
    expect((eye[0] - a.mainDoor!.pos[0]) * ox + (eye[2] - a.mainDoor!.pos[2]) * oz).toBeGreaterThan(3);
    const view = orbitView(auge.orbit);
    const proj = projectionMatrix(auge.projection, 1.6);
    const b = a.building;
    for (const x of [b.min[0], b.max[0] + 1]) for (const y of [a.mainDoor!.pos[1], b.max[1] + 1]) for (const z of [b.min[2], b.max[2] + 1]) {
      const v = transformPoint(view, [x, y, z]);
      const c = transformPoint(proj, v);
      const w = -v[2];
      expect(Math.abs(c[0] / w)).toBeLessThanOrEqual(1 + 1e-6);
      expect(Math.abs((proj[5]! * v[1] + proj[9]! * v[2]) / w)).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('Erdhaus frontal: Schwenk 0 → Blick genau gegen die Türachse', () => {
    const f = eyeFrame(a, 1.6, 0);
    expect(f.azimuth).toBeCloseTo(f.frontAz, 9);
  });

  it('Sichtlinien-Suche: ohne Hindernis gewinnt der Wunsch-Schwenk; ein Block vor dem Auge wird gemieden', () => {
    const free = bestEyeFrame(a, 1.6, EYE_SWING, () => false);
    expect(free.occluded).toBe(0);
    expect(free.azimuth).toBeCloseTo(eyeFrame(a, 1.6).azimuth, 9);
    const first = eyeFrame(a, 1.6);
    const cell = first.eye.map(Math.floor);
    const blocked = bestEyeFrame(a, 1.6, EYE_SWING, (x, y, z) => x === cell[0] && y === cell[1] && z === cell[2]);
    expect(blocked.occluded).toBe(0);
    expect(blocked.eye).not.toEqual(first.eye);
  });

  it('Sonne kommt von der Gegenseite des Schwenks und steht 32° (abends 9°) hoch', () => {
    const f = eyeFrame(a, 1.6);
    const s = sunDirFor(f);
    expect(Math.asin(s[1])).toBeCloseTo((32 * Math.PI) / 180, 9);
    expect(Math.asin(sunDirFor(f, 'abend')[1])).toBeCloseTo((9 * Math.PI) / 180, 9);
    // Kamera- und Sonnenrichtung liegen auf verschiedenen Seiten der Türachse
    const side = (az: number): number => Math.sign(Math.sin(az - f.frontAz));
    expect(side(Math.atan2(s[0], s[2]))).toBe(-side(f.azimuth));
  });
});

describe('W10-B Bildausschnitt: erste Ansicht und Hof-Standpunkt (wie website/js/camera-rig.js)', () => {
  const a = analyze(gridFromVolume(testHouse(), tableClassifier));

  it('Burg: tiefe Schrägansicht zuerst, sonst Augenhöhe; übrige Reihenfolge unverändert', () => {
    expect(firstViewFor('castle_compact')).toBe('tief');
    // W16-B: das Gehöft zeigt zuerst die Schrägansicht
    expect(firstViewFor('farmhouse')).toBe('tief');
    expect(firstViewFor('house')).toBe('auge');
    expect(firstViewFor(undefined)).toBe('auge');
    const names = (first?: 'auge' | 'tief'): string[] => deriveCameras(a, { aspect: 1.6, ...(first ? { first } : {}) }).views.map((v) => v.name);
    expect(names('tief').slice(0, 4)).toEqual(['tief', 'auge', 'auge-abend', 'fassade-n']);
    expect(names('auge')).toEqual(names());
    expect(names().slice(0, 3)).toEqual(['auge', 'auge-abend', 'tief']);
  });

  it('Hecke rund um den Hof vor jeder Außenkamera: Augenhöhe tritt in den Hof, kürzere Brennweite, freie Sicht', () => {
    const hedge = (x: number, y: number, z: number): boolean => y >= 1 && y <= 3 && ((z === 16 && x >= -4 && x <= 18) || ((x === -4 || x === 18) && z >= 0 && z <= 16));
    const f = bestEyeFrame(a, 1.6, EYE_SWING, hedge);
    expect(f.yard).toBe(true);
    expect(f.eye[2]).toBeGreaterThan(9);
    expect(f.eye[2]).toBeLessThan(16);
    expect(f.fovY).toBeGreaterThan(EYE_FOV);
    expect(f.occluded).toBe(0);
    expect(bestEyeFrame(a, 1.6, EYE_SWING, hedge)).toEqual(f);
    // die Ansicht übernimmt die Brennweite
    const auge = deriveCameras(a, { aspect: 1.6, solid: hedge }).views.find((v) => v.name === 'auge')!;
    expect(auge.projection).toMatchObject({ kind: 'perspective', fovY: f.fovY });
  });

  it('Schwenk höchstens 50° (Eingang lesbar), auch wenn der Wunsch-Schwenk verdeckt ist', () => {
    const first = eyeFrame(a, 1.6);
    const cell = first.eye.map(Math.floor);
    const f = bestEyeFrame(a, 1.6, EYE_SWING, (x, y, z) => x === cell[0] && y === cell[1] && z === cell[2]);
    expect(Math.abs(Math.sin(f.azimuth - f.frontAz))).toBeLessThanOrEqual(Math.sin(MAX_SWING) + 1e-9);
  });
});

describe('Renderer: Projektion (additiv)', () => {
  it('W10 Shift: Punkt auf der Höhe tan = 2·shiftY·tan(fov/2) landet in der Bildmitte; ohne Shift unverändert', () => {
    const fov = EYE_FOV, shiftY = 0.2;
    const m = projectionMatrix({ kind: 'perspective', fovY: fov, shiftY }, 1.5);
    const t = 2 * shiftY * Math.tan(fov / 2);
    const v: Vec3 = [0, t * 10, -10];
    expect((m[5]! * v[1] + m[9]! * v[2]) / 10).toBeCloseTo(0, 6);
    expect(projectionMatrix({ kind: 'perspective', fovY: fov, shiftY: 0 }, 1.5)).toEqual(projectionMatrix({ kind: 'perspective', fovY: fov }, 1.5));
  });

  it('Standard bleibt die bisherige Perspektive (70°, 0,1 … 500)', () => {
    const m = projectionMatrix(DEFAULT_PROJECTION, 1.6);
    const f = 1 / Math.tan(FOV_Y / 2);
    expect(m[0]).toBeCloseTo(f / 1.6, 6);
    expect(m[5]).toBeCloseTo(f, 6);
    expect(m[11]).toBe(-1);
    expect(m[10]).toBeCloseTo((500 + 0.1) / (0.1 - 500), 6);
    expect(projectionMatrix({ kind: 'perspective', fovY: FOV_Y }, 1.6)).toEqual(m);
  });

  it('Parallelprojektion: halbe Höhe → Bildrand, unabhängig von der Entfernung', () => {
    const m = projectionMatrix({ kind: 'orthographic', halfHeight: 5 }, 2);
    close(transformPoint(m, [10, 5, -3]).slice(0, 2), [1, 1]);
    close(transformPoint(m, [-10, -5, -200]).slice(0, 2), [-1, -1]);
    expect(m[11]).toBe(0);
    expect(m[15]).toBe(1);
  });
});
