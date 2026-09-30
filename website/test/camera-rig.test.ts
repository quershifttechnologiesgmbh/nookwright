/**
 * W10 Präsentation: Kameras der Galerie (camera-rig.js) und die Himmelslicht-Verdeckung des öffentlichen Renderers
 * (voxels.js `skyShade`). Ohne neue Option bleibt die Geometrie bitgleich (Social-Kit, Erklärvideo).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, LOW_PITCH, MAX_SWING, firstView, heroCamera, lowCamera, sceneAnchors, sunFor } from '../js/camera-rig.js';
import { buildVoxelGeometry } from '../js/voxels.js';

const scene = (id: string): any => JSON.parse(readFileSync(new URL(`../gallery/${id}.json`, import.meta.url), 'utf8'));
const DOOR = (dir: string): number[] => ({ north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] } as Record<string, number[]>)[dir]!;

// kleine Szene: 5 × 5-Kiste mit Tür nach Süden, Dach darüber
function tinyScene(extra: number[][] = []): any {
  const palette = [['stone_bricks', 0x888888, 0, 'cube', '', ''], ['oak_door', 0x8a6a3a, 0, 'door', 'south', 'lower'], ['oak_door', 0x8a6a3a, 0, 'door', 'south', 'upper'], ['grass_block', 0x5c9a34, 0, 'cube', '', ''], ['oak_leaves', 0x3a7a2a, 0, 'cube', '', '']];
  const blocks: number[] = [];
  for (let x = -10; x <= 14; x++) for (let z = -10; z <= 30; z++) blocks.push(x, 0, z, 3, 0);
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) for (let y = 1; y <= 4; y++) {
    const wall = x === 0 || x === 4 || z === 0 || z === 4 || y === 4;
    if (!wall) continue;
    if (x === 2 && z === 4 && (y === 1 || y === 2)) blocks.push(x, y, z, y === 1 ? 1 : 2, 7);
    else blocks.push(x, y, z, 0, y === 4 ? 6 : 4);
  }
  for (const [x, y, z] of extra) blocks.push(x!, y!, z!, 4, 1);
  return { id: 'tiny', palette, blocks, rooms: [] };
}

describe('camera-rig: Haupteingang und Augenhöhe', () => {
  it('findet die Außentür und ihre Richtung', () => {
    const a = sceneAnchors(tinyScene());
    expect(a.door).toEqual({ pos: [2, 1, 4], outward: 'south' });
    expect(a.rimTop).toBe(1);
  });

  it('Auge 1,7 über dem Boden vor dem Eingang, vor der Tür, waagerechter Blick; deterministisch', () => {
    const s = tinyScene();
    const a = sceneAnchors(s);
    const cam = heroCamera(a, [0, 0, 0], 1.5);
    expect(cam.position[1]).toBeCloseTo(1 + EYE_HEIGHT, 9);
    expect(cam.target[1]).toBe(cam.position[1]);
    expect(cam.position[2]).toBeGreaterThan(4 + 3);
    expect(cam.shiftY).toBeGreaterThan(0);
    expect(cam.occluded).toBe(0);
    expect(heroCamera(sceneAnchors(tinyScene()), [0, 0, 0], 1.5)).toEqual(cam);
  });

  it('ein Baum vor dem Auge: die Kamera weicht aus (Sichtlinien-Suche)', () => {
    const free = heroCamera(sceneAnchors(tinyScene()), [0, 0, 0], 1.5);
    const p = free.position.map(Math.floor);
    const tree: number[][] = [];
    // Laubwand zwischen Auge und Haus, um die Blickachse
    const mid = [(p[0]! + 2) / 2, (p[2]! + 2) / 2].map(Math.floor);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = 1; y <= 5; y++) tree.push([mid[0]! + dx, y, mid[1]! + dz]);
    const cam = heroCamera(sceneAnchors(tinyScene(tree)), [0, 0, 0], 1.5);
    expect(cam.position).not.toEqual(free.position);
    expect(cam.occluded).toBeLessThan(0.5);
  });

  it('Erdhaus frontal (Schwenk 0) blickt entlang der Türachse; Sonne von der Gegenseite', () => {
    const a = sceneAnchors(tinyScene());
    const cam = heroCamera(a, [0, 0, 0], 1.5, { swing: 0 });
    expect(cam.swing).toBe(0);
    expect(cam.azimuth).toBeCloseTo(cam.frontAz, 9);
    const c38 = heroCamera(a, [0, 0, 0], 1.5);
    const sun = sunFor(c38);
    expect(Math.sign(Math.sin(sun.az - c38.frontAz))).toBe(-Math.sign(Math.sin(c38.azimuth - c38.frontAz)));
    expect(sunFor(c38, 1).el).toBeLessThan(sun.el);
  });

  it('Galerie-Szenen: jede hat einen Eingang und eine Hero-Kamera vor ihm', () => {
    const items = JSON.parse(readFileSync(new URL('../gallery/index.json', import.meta.url), 'utf8')) as { id: string; type?: string }[];
    for (const it of items) {
      const s = scene(it.id);
      const a = sceneAnchors(s);
      expect(a.door, it.id).toBeDefined();
      const cam = heroCamera(a, [0, 0, 0], 4 / 3, it.type === 'hobbit' ? { swing: 0 } : {});
      const o = DOOR(a.door!.outward);
      const ahead = (cam.position[0]! - a.door!.pos[0]!) * o[0]! + (cam.position[2]! - a.door!.pos[2]!) * o[1]!;
      expect(ahead, it.id).toBeGreaterThan(2);
    }
  });
});

// Mitte wie das Mesh der Galerie (voxels.js buildVoxelGeometry: ohne Gelände/Pflanzen, y = unterster Block)
function meshCenter(s: any): number[] {
  const B = s.blocks as number[];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity;
  for (let i = 0; i < B.length / 5; i++) {
    const c = B[i * 5 + 4]!;
    if (c === 0 || c === 1) continue;
    x0 = Math.min(x0, B[i * 5]!); x1 = Math.max(x1, B[i * 5]!); z0 = Math.min(z0, B[i * 5 + 2]!); z1 = Math.max(z1, B[i * 5 + 2]!); y0 = Math.min(y0, B[i * 5 + 1]!);
  }
  return [(x0 + x1 + 1) / 2, y0, (z0 + z1 + 1) / 2];
}
const ITEMS = JSON.parse(readFileSync(new URL('../gallery/index.json', import.meta.url), 'utf8')) as { id: string; type?: string }[];
const opts = (it: { type?: string }): { swing?: number } => (it.type === 'hobbit' ? { swing: 0 } : {});
/** erster Treffer auf der Sichtlinie Auge → Tür (Weltraster), falls Gelände, Pflanze/Zaun oder Gartenanlage; sonst undefined */
function doorBlocker(a: any, cam: any, c: number[]): number | undefined {
  const eye = [cam.position[0] + c[0], cam.position[1] + c[1], cam.position[2] + c[2]];
  const t = [a.door.pos[0] + 0.5, a.door.pos[1] + 1.2, a.door.pos[2] + 0.5];
  const n = Math.ceil(Math.hypot(t[0]! - eye[0]!, t[1]! - eye[1]!, t[2]! - eye[2]!) / 0.25);
  for (let k = 2; k < n; k++) {
    const p = eye.map((v, i) => Math.floor(v! + ((t[i]! - v!) * k) / n));
    const cat = a.catAt(p[0], p[1], p[2]);
    if (cat !== undefined) return cat === 0 || cat === 1 || cat === 8 ? cat : undefined;
  }
  return undefined;
}

describe('camera-rig W10-B: Bildausschnitt der Galerie', () => {
  it('erste Ansicht: Wehranlagen (Burgen, Basis mit Mauerring) tief schräg, alle anderen in Augenhöhe', () => {
    const low = ITEMS.filter((it) => firstView(sceneAnchors(scene(it.id))) === 'tief').map((it) => it.id).sort();
    expect(low).toEqual(['base-mauerring', 'burg-nordwall', 'burg-steinwacht', 'burg-tiefenfels']);
    expect(firstView(sceneAnchors(tinyScene()))).toBe('auge');
  });

  it('Erdhaus: Kamera im Hof zwischen Zaun und Fassade, Rundtür frei und mittig', () => {
    const s = scene('erdhaus-am-huegel');
    const a = sceneAnchors(s);
    const c = meshCenter(s);
    const cam = heroCamera(a, c, 4 / 3, { swing: 0 });
    expect(cam.yard).toBe(true);
    expect(cam.occluded).toBeLessThan(0.02);
    expect(doorBlocker(a, cam, c)).toBeUndefined();
    // Tür in der Bildmitte: Blickrichtung trifft die Tür (waagerecht höchstens 8 % der halben Bildbreite daneben).
    // W12-B (2026-09-28): Grund – die Rundtür liegt jetzt in der Frontmitte; 11 Blöcke vor ihr steigt das Gelände, die
    // Hof-Kamera schwenkt deshalb 10° (weniger Anschnitt) und die Tür liegt 7,2 % neben der Mitte (vorher Grenze 6 %)
    const d = [a.door!.pos[0]! + 0.5 - c[0]! - cam.position[0]!, a.door!.pos[2]! + 0.5 - c[2]! - cam.position[2]!];
    const fwd = [Math.sin(cam.yaw), -Math.cos(cam.yaw)];
    const u = (d[0]! * -fwd[1]! + d[1]! * fwd[0]!) / (d[0]! * fwd[0]! + d[1]! * fwd[1]!);
    const tanH = Math.tan((cam.fov * Math.PI) / 360) * (4 / 3);
    expect(Math.abs(u)).toBeLessThan(tanH * 0.08);
    // näher an der Tür als der erste Zaun auf der Türachse
    expect(cam.distance).toBeLessThan(20);
  });

  it('Hof-Standpunkt allgemein: Hecke rund um den Hof vor der besten Außenkamera → Kamera tritt in den Hof', () => {
    const fence: number[][] = [];
    for (let x = -6; x <= 10; x++) for (let y = 1; y <= 3; y++) fence.push([x, y, 10]); // Hecke 6 Blöcke vor der Tür
    for (let z = -10; z <= 10; z++) for (let y = 1; y <= 3; y++) fence.push([-6, y, z], [10, y, z]);
    const a = sceneAnchors(tinyScene(fence));
    const cam = heroCamera(a, [0, 0, 0], 1.5);
    expect(cam.yard).toBe(true);
    expect(cam.position[2]).toBeLessThan(10);
    expect(cam.position[2]).toBeGreaterThan(4);
    expect(cam.occluded).toBe(0);
    expect(cam.fov).toBeGreaterThan(32);
    expect(heroCamera(sceneAnchors(tinyScene(fence)), [0, 0, 0], 1.5)).toEqual(cam);
  });

  it('Gehöft: Eingangsflügel (Wohnhaus) ist das Motiv – Kamera auf seiner Seite, die Scheune dahinter', () => {
    const s = scene('bauernhof-lindenhof');
    const a = sceneAnchors(s);
    const c = meshCenter(s);
    expect(a.wing).toBeDefined();
    const wx = (a.wing!.min[0]! + a.wing!.max[0]! + 1) / 2, bx = (a.box.min[0]! + a.box.max[0]! + 1) / 2;
    const cam = heroCamera(a, c, 4 / 3);
    expect(Math.sign(cam.position[0]! + c[0]! - bx)).toBe(Math.sign(wx - bx));
  });

  it('alle Galerie-Szenen: Schwenk höchstens 50°, Eingang ohne Hindernis in der Nähe, tiefe Ansicht fasst den Bau', () => {
    for (const it of ITEMS) {
      const s = scene(it.id);
      const a = sceneAnchors(s);
      const c = meshCenter(s);
      const cam = heroCamera(a, c, 4 / 3, opts(it));
      expect(cam.swing, it.id).toBeLessThanOrEqual(MAX_SWING);
      expect(cam.occluded, it.id).toBeLessThan(0.1);
      const low = lowCamera(a, c, 4 / 3, cam);
      expect(low.pitch).toBe(LOW_PITCH);
      // alle Quaderecken im Bild (Sichtkegel), Blick von oben
      const f = [low.target[0]! - low.position[0]!, low.target[1]! - low.position[1]!, low.target[2]! - low.position[2]!];
      const n = Math.hypot(f[0]!, f[1]!, f[2]!);
      const fw = f.map((v) => v / n);
      expect(fw[1]!).toBeLessThan(0);
      const r = [-fw[2]!, 0, fw[0]!].map((v) => v / Math.hypot(fw[0]!, fw[2]!));
      const up = [r[1]! * fw[2]! - r[2]! * fw[1]!, r[2]! * fw[0]! - r[0]! * fw[2]!, r[0]! * fw[1]! - r[1]! * fw[0]!];
      const tv = Math.tan((low.fov * Math.PI) / 360);
      for (const x of [a.box.min[0]!, a.box.max[0]! + 1]) for (const y of [a.box.min[1]!, a.box.max[1]! + 1]) for (const z of [a.box.min[2]!, a.box.max[2]! + 1]) {
        const q = [x - c[0]! - low.position[0]!, y - c[1]! - low.position[1]!, z - c[2]! - low.position[2]!];
        const depth = q[0]! * fw[0]! + q[1]! * fw[1]! + q[2]! * fw[2]!;
        expect(depth, it.id).toBeGreaterThan(0);
        expect(Math.abs(q[0]! * r[0]! + q[1]! * r[1]! + q[2]! * r[2]!) / depth, it.id).toBeLessThanOrEqual(tv * (4 / 3) + 1e-9);
        expect(Math.abs(q[0]! * up[0]! + q[1]! * up[1]! + q[2]! * up[2]!) / depth, it.id).toBeLessThanOrEqual(tv + 1e-9);
      }
    }
  });
});

describe('voxels.js: Himmelslicht-Verdeckung (skyShade)', () => {
  const arr = (g: any, k: string): Float32Array => g.geometry.getAttribute(k).array;
  it('ohne Option bitgleich; mit Option AO und Himmelslicht getrennt in aShade (W10-D), Farbe nur Variation', () => {
    const s = scene('haus-medieval');
    const plain = buildVoxelGeometry(s);
    const off = buildVoxelGeometry(s, { skyShade: false });
    const on = buildVoxelGeometry(s, { skyShade: true });
    expect(arr(off, 'color')).toEqual(arr(plain, 'color'));
    expect(arr(off, 'position')).toEqual(arr(plain, 'position'));
    expect(plain.geometry.getAttribute('aShade')).toBeUndefined();
    expect(plain.shade).toBe(false);
    expect(on.shade).toBe(true);
    const sh = arr(on, 'aShade'), col = arr(on, 'color');
    expect(sh.length / 2).toBe(col.length / 3);
    let under = 0;
    for (let i = 0; i < sh.length; i += 2) {
      expect([0.5, 0.68, 0.84, 1]).toContain(Math.round(sh[i]! * 100) / 100);
      expect(sh[i + 1]!).toBeGreaterThanOrEqual(0);
      expect(sh[i + 1]!).toBeLessThanOrEqual(1);
      if (sh[i + 1]! < 1 - 1e-6) under++;
    }
    // Farbe × AO = Farbe ohne Option (gleiche Geometrie ohne Gelände: dort entfallen nur Randseiten)
    const noGround = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const p2 = buildVoxelGeometry(s, { cats: noGround }), o2 = buildVoxelGeometry(s, { cats: noGround, skyShade: true });
    expect(arr(o2, 'position')).toEqual(arr(p2, 'position'));
    const pc = arr(p2, 'color'), oc = arr(o2, 'color'), os = arr(o2, 'aShade');
    for (let i = 0; i < pc.length; i++) expect(Math.abs(oc[i]! * os[Math.floor(i / 3) * 2]! - pc[i]!)).toBeLessThan(1e-5);
    expect(under).toBeGreaterThan(0);
    expect(under).toBeLessThan(sh.length / 2);
  });

  it('Himmelslicht wie im Spiel: frei 15/15, unter einem Dach je Schritt 1/15 weniger (nur Vollwürfel sperren)', () => {
    // Dach 3 × 1 × 3 aus Stein auf Höhe 3, darunter Luft; Wand x = 0 unter dem Dach und eine freie Wand daneben
    const palette = [['stone', 0x888888, 0, 'cube', '', '']];
    const blocks: number[] = [];
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) blocks.push(x, 3, z, 0, 6);
    blocks.push(1, 0, 1, 0, 4, 6, 0, 6, 0, 4);
    const g = buildVoxelGeometry({ palette, blocks }, { skyShade: true });
    const pos = arr(g, 'position'), nor = arr(g, 'normal'), sh = arr(g, 'aShade');
    const c = g.center;
    const skyOfTop = (bx: number, bz: number): number => {
      for (let i = 0; i < nor.length / 3; i++) {
        if (nor[i * 3 + 1] !== 1) continue;
        const x = pos[i * 3]! + c[0], z = pos[i * 3 + 2]! + c[2], y = pos[i * 3 + 1]! + c[1];
        if (Math.abs(y - 1) < 1e-6 && x >= bx && x <= bx + 1 && z >= bz && z <= bz + 1) return sh[i * 2 + 1]!;
      }
      return NaN;
    };
    expect(skyOfTop(1, 1)).toBeCloseTo(13 / 15, 6); // Mitte unter dem Dach: zwei Schritte bis zur freien Luft
    expect(skyOfTop(6, 6)).toBeCloseTo(1, 6);
  });

  it('Farbvarianz je Block (vary, W13-D): gleiche Geometrie, Helligkeit ± 6 % mit leichtem Warm/Kalt-Stich, deterministisch', () => {
    const s = scene('haus-medieval');
    const on = buildVoxelGeometry(s, { skyShade: true }), vary = buildVoxelGeometry(s, { skyShade: true, vary: true });
    expect(arr(vary, 'position')).toEqual(arr(on, 'position'));
    expect(arr(vary, 'aShade')).toEqual(arr(on, 'aShade'));
    const a = arr(on, 'color'), b = arr(vary, 'color');
    let warm = 0, cool = 0;
    const n = a.length / 3;
    for (let i = 0; i < n; i++) {
      // ohne Option: Grau-Variation 0,95–1,05; mit Option: 0,94–1,06 × (1 ± 0,03) je Kanal
      for (let k = 0; k < 3; k++) {
        const f = b[i * 3 + k]! / a[i * 3 + k]!;
        expect(f).toBeGreaterThan((0.94 * 0.97) / 1.05 - 1e-6);
        expect(f).toBeLessThan((1.06 * 1.03) / 0.95 + 1e-6);
      }
      const t = (b[i * 3]! / a[i * 3]!) / (b[i * 3 + 2]! / a[i * 3 + 2]!);
      if (t > 1.01) warm++; else if (t < 0.99) cool++;
    }
    expect(warm).toBeGreaterThan(n * 0.2);
    expect(cool).toBeGreaterThan(n * 0.2);
    expect(arr(buildVoxelGeometry(s, { skyShade: true, vary: true }), 'color')).toEqual(b);
  });

  it('Rand des Geländestücks: Erdseiten unter der Randoberkante entfallen, Hügel darüber bleiben', () => {
    const palette = [['grass_block', 0x6d9b43, 0, 'cube', '', '']];
    const blocks: number[] = [];
    for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) blocks.push(x, 0, z, 0, 0);
    blocks.push(0, 1, 0, 0, 0); // Hügelblock am Rand
    const sides = (g: any): number => { const n = arr(g, 'normal'); let k = 0; for (let i = 1; i < n.length; i += 3) if (n[i] === 0) k++; return k / 4; };
    expect(sides(buildVoxelGeometry({ palette, blocks }))).toBe(24 + 4);
    expect(sides(buildVoxelGeometry({ palette, blocks }, { skyShade: true }))).toBe(4);
  });
});
