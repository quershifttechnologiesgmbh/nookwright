import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PngFormatError, blitImage, createImage, cropImage, decodePng, encodePng, type RgbaImage } from '../src/assets/png.js';
import { ASSET_ROOT, inExtractScope } from '../src/assets/extract.js';
import { HAS_JAR, localJar, makeRawPng, toU8 } from './helpers.js';

const inflate = (d: Uint8Array): Uint8Array => toU8(inflateSync(d));
const deflate = (d: Uint8Array): Uint8Array => toU8(deflateSync(d));

/** Deterministisches Testbild mit Verläufen und Transparenz (damit alle Filter etwas zu tun haben). */
function testImage(w: number, h: number): RgbaImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      img.data[o] = (x * 37 + y * 11) & 255;
      img.data[o + 1] = (x * y * 7) & 255;
      img.data[o + 2] = (255 - x * 5) & 255;
      img.data[o + 3] = (x + y) % 5 === 0 ? 0 : (x * 50 + 30) & 255;
    }
  }
  return img;
}

const px = (img: RgbaImage, x: number, y: number): number[] => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe('PNG kodieren/dekodieren (RGBA8)', () => {
  it.each([0, 1, 2, 3, 4, undefined] as const)('Rundreise mit Filter %s', (filter) => {
    const img = testImage(23, 17);
    const png = encodePng(img, deflate, filter === undefined ? {} : { filter });
    const back = decodePng(png, inflate);
    expect(back.width).toBe(23);
    expect(back.height).toBe(17);
    expect(back.data).toEqual(img.data);
  });

  it('prüft Signatur und CRC', () => {
    const png = encodePng(testImage(4, 4), deflate);
    expect(() => decodePng(png.subarray(1), inflate)).toThrow(PngFormatError);
    const broken = png.slice();
    broken[20] = broken[20]! ^ 0x01; // im IHDR
    expect(() => decodePng(broken, inflate)).toThrow(/CRC/);
  });

  it('Ausschnitt und Einfügen', () => {
    const img = testImage(10, 8);
    const part = cropImage(img, 3, 2, 4, 5);
    expect(px(part, 0, 0)).toEqual(px(img, 3, 2));
    expect(px(part, 3, 4)).toEqual(px(img, 6, 6));
    const dst = createImage(12, 12);
    blitImage(dst, part, 8, 7);
    expect(px(dst, 8, 7)).toEqual(px(img, 3, 2));
    expect(() => blitImage(dst, part, 9, 7)).toThrow(RangeError);
  });
});

describe('PNG dekodieren: alle Farbtypen', () => {
  it('Palette 2 Bit mit tRNS', () => {
    const png = makeRawPng({
      width: 5, height: 3, colorType: 3, depth: 2,
      palette: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [9, 9, 9]], trns: [255, 0, 128],
      pixel: (x, y) => [(x + y) % 4],
    });
    const img = decodePng(png, inflate);
    expect(px(img, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(img, 1, 0)).toEqual([0, 255, 0, 0]);
    expect(px(img, 2, 0)).toEqual([0, 0, 255, 128]);
    expect(px(img, 3, 0)).toEqual([9, 9, 9, 255]); // Index hinter tRNS → deckend
    expect(px(img, 4, 2)).toEqual([0, 0, 255, 128]);
  });

  it('Grau 1 Bit, Grau 16 Bit mit tRNS, Grau+Alpha 8 Bit', () => {
    const g1 = decodePng(makeRawPng({ width: 9, height: 2, colorType: 0, depth: 1, pixel: (x) => [x % 2] }), inflate);
    expect(px(g1, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(g1, 8, 1)).toEqual([0, 0, 0, 255]);
    expect(px(g1, 7, 1)).toEqual([255, 255, 255, 255]);
    const g16 = decodePng(makeRawPng({ width: 3, height: 1, colorType: 0, depth: 16, trns: [0x12, 0x34], pixel: (x) => [[0x1234, 0xff00, 0x0080][x]!] }), inflate);
    expect(px(g16, 0, 0)).toEqual([0x12, 0x12, 0x12, 0]);
    expect(px(g16, 1, 0)).toEqual([0xff, 0xff, 0xff, 255]);
    expect(px(g16, 2, 0)).toEqual([0, 0, 0, 255]);
    const ga = decodePng(makeRawPng({ width: 2, height: 2, colorType: 4, depth: 8, pixel: (x, y) => [x * 100, y * 200] }), inflate);
    expect(px(ga, 1, 1)).toEqual([100, 100, 100, 200]);
  });

  it('RGB 8 Bit mit tRNS-Farbschlüssel, RGBA 16 Bit', () => {
    const rgb = decodePng(makeRawPng({ width: 2, height: 1, colorType: 2, depth: 8, trns: [0, 1, 0, 2, 0, 3], pixel: (x) => (x === 0 ? [1, 2, 3] : [4, 5, 6]) }), inflate);
    expect(px(rgb, 0, 0)).toEqual([1, 2, 3, 0]);
    expect(px(rgb, 1, 0)).toEqual([4, 5, 6, 255]);
    const rgba16 = decodePng(makeRawPng({ width: 1, height: 1, colorType: 6, depth: 16, pixel: () => [0xabcd, 0x1200, 0xff01, 0x8000] }), inflate);
    expect(px(rgba16, 0, 0)).toEqual([0xab, 0x12, 0xff, 0x80]);
  });

  it('Adam7-Interlacing', () => {
    const pixel = (x: number, y: number): number[] => [x * 20, y * 20, (x + y) * 10, 200 + (x % 3)];
    const inter = decodePng(makeRawPng({ width: 11, height: 9, colorType: 6, depth: 8, interlace: true, pixel }), inflate);
    const plain = decodePng(makeRawPng({ width: 11, height: 9, colorType: 6, depth: 8, pixel }), inflate);
    expect(inter.data).toEqual(plain.data);
    expect(px(inter, 10, 8)).toEqual(pixel(10, 8));
  });
});

describe.skipIf(!HAS_JAR)('PNG dekodieren: alle Texturen im Extraktionsumfang des lokalen JARs', () => {
  it('dekodiert jede Textur fehlerfrei', () => {
    const jar = localJar();
    const pngs = jar.names().filter((n) => n.startsWith(ASSET_ROOT) && n.endsWith('.png') && inExtractScope(n.slice(ASSET_ROOT.length)));
    expect(pngs.length).toBeGreaterThan(1200);
    for (const n of pngs) {
      const img = decodePng(jar.read(n)!, inflate);
      expect(img.width * img.height, n).toBeGreaterThan(0);
    }
    const bed = decodePng(jar.read(`${ASSET_ROOT}textures/entity/bed/red.png`)!, inflate);
    expect([bed.width, bed.height]).toEqual([64, 64]);
  });
});
