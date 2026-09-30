/** Auswahl per Klick: Strahl der Orbit-Kamera, Voxel-DDA, Auswahlrahmen (rein, ohne DOM). */
import { describe, expect, it } from 'vitest';
import { fitOrbit, orbitEye, orbitView, transformPoint, type Orbit } from '../src/camera.js';
import { boxLines, orbitRay, raycastGrid, toNdc, type Ray } from '../src/pick.js';
import type { Vec3 } from '../src/port.js';

const solidSet = (cells: readonly Vec3[]) => {
  const keys = new Set(cells.map((c) => c.join(',')));
  return (x: number, y: number, z: number): boolean => keys.has(`${x},${y},${z}`);
};

describe('Strahl der Orbit-Kamera', () => {
  it('Bildmitte zielt auf das Blickziel, Ursprung ist die Kamera', () => {
    const o: Orbit = fitOrbit([10, 6, 8], 1.5);
    const r = orbitRay(o, 0, 0, 1.5);
    expect(r.origin).toEqual(orbitEye(o));
    const toTarget = o.target.map((t, k) => t - r.origin[k]!);
    const len = Math.hypot(...toTarget);
    toTarget.forEach((v, k) => expect(r.dir[k]).toBeCloseTo(v / len, 6));
    expect(Math.hypot(...r.dir)).toBeCloseTo(1, 9);
  });

  it('Bildrand oben rechts liegt im Kamerasystem rechts oben (wie die Projektion)', () => {
    const o: Orbit = { target: [5, 2, 5], yaw: 0.7, pitch: 0.5, distance: 20 };
    const r = orbitRay(o, 1, 1, 2);
    // Punkt entlang des Strahls ins Kamerasystem: x > 0 (rechts), y > 0 (oben), z < 0 (vor der Kamera)
    const p: Vec3 = [r.origin[0] + r.dir[0] * 10, r.origin[1] + r.dir[1] * 10, r.origin[2] + r.dir[2] * 10];
    const v = transformPoint(orbitView(o), p);
    expect(v[2]).toBeLessThan(0);
    const fovHalf = Math.tan((70 * Math.PI) / 360);
    expect(v[0] / -v[2]).toBeCloseTo(fovHalf * 2, 6); // Rand bei aspect 2
    expect(v[1] / -v[2]).toBeCloseTo(fovHalf, 6);
  });

  it('Pixel → NDC', () => {
    expect(toNdc(0, 0, 200, 100)).toEqual([-1, 1]);
    expect(toNdc(200, 100, 200, 100)).toEqual([1, -1]);
    expect(toNdc(100, 50, 200, 100)).toEqual([0, 0]);
  });
});

describe('Voxel-DDA', () => {
  const size: Vec3 = [8, 5, 8];
  it('trifft die erste belegte Zelle von außen', () => {
    const ray: Ray = { origin: [-3, 2.5, 3.5], dir: [1, 0, 0] };
    const hit = raycastGrid(ray, size, solidSet([[5, 2, 3], [2, 2, 3]]));
    expect(hit?.cell).toEqual([2, 2, 3]);
    expect(hit?.distance).toBeCloseTo(5, 5);
  });

  it('schräg von oben: Boden unter einem freien Raum', () => {
    const floor: Vec3[] = [];
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) floor.push([x, 0, z]);
    const dir: Vec3 = [1 / Math.sqrt(3), -1 / Math.sqrt(3), 1 / Math.sqrt(3)];
    const hit = raycastGrid({ origin: [0.5, 4.5, 0.5], dir }, size, solidSet(floor));
    expect(hit?.cell[1]).toBe(0);
    expect(hit!.cell[0]).toBeGreaterThanOrEqual(3);
  });

  it('verfehlt: am Quader vorbei, leerer Weg, Strahl weg vom Quader', () => {
    const all = () => true;
    expect(raycastGrid({ origin: [-1, 10, -1], dir: [0, 1, 0] }, size, all)).toBeUndefined();
    expect(raycastGrid({ origin: [-1, 2, 2], dir: [1, 0, 0] }, size, () => false)).toBeUndefined();
    expect(raycastGrid({ origin: [20, 2, 2], dir: [1, 0, 0] }, size, all)).toBeUndefined();
  });

  it('Start im Quader und Strahl parallel zu einer Achse', () => {
    const hit = raycastGrid({ origin: [1.5, 1.5, 1.5], dir: [0, 0, -1] }, size, solidSet([[1, 1, 0]]));
    expect(hit?.cell).toEqual([1, 1, 0]);
  });

  it('Kamera → Bildmitte trifft den Block im Blickziel', () => {
    const o = fitOrbit(size, 1);
    const center: Vec3 = [Math.floor(o.target[0]), Math.floor(o.target[1]), Math.floor(o.target[2])];
    const hit = raycastGrid(orbitRay(o, 0, 0, 1), size, solidSet([center]));
    expect(hit?.cell).toEqual(center);
  });
});

describe('Auswahlrahmen', () => {
  it('12 Kanten um die Zellen, außen versetzt, Farbe je Punkt', () => {
    const lines = boxLines({ min: [1, 0, 2], max: [2, 1, 2] }, [1, 0.5, 0], 0.1);
    expect(lines.length).toBe(12 * 2 * 6);
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < lines.length; i += 6) {
      xs.push(lines[i]!);
      ys.push(lines[i + 1]!);
      zs.push(lines[i + 2]!);
      expect([lines[i + 3], lines[i + 4], lines[i + 5]]).toEqual([1, 0.5, 0]);
    }
    expect(Math.min(...xs)).toBeCloseTo(0.9);
    expect(Math.max(...xs)).toBeCloseTo(3.1);
    expect(Math.min(...ys)).toBeCloseTo(-0.1);
    expect(Math.max(...ys)).toBeCloseTo(2.1);
    expect(Math.min(...zs)).toBeCloseTo(1.9);
    expect(Math.max(...zs)).toBeCloseTo(3.1);
  });
});
