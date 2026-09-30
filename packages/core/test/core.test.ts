import { describe, expect, it } from 'vitest';
import {
  CellSet,
  Rng,
  hashSeed,
  resolveRelDir,
  rotateDir,
  transformDir,
  transformLocal,
  transformedSize,
  type Quarter,
  type Vec3,
} from '../src/index.js';

describe('Richtungen', () => {
  it('dreht im Uhrzeigersinn: Nord → Ost → Süd → West', () => {
    expect(rotateDir('north', 1)).toBe('east');
    expect(rotateDir('north', 2)).toBe('south');
    expect(rotateDir('west', 1)).toBe('north');
    expect(rotateDir('up', 3)).toBe('up');
    expect(rotateDir('east', -1)).toBe('north');
  });

  it('kanonische Front ist Süden, links ist Osten (Sicht der Komponente)', () => {
    const p = { rot: 0 as Quarter, mirror: 'none' as const };
    expect(resolveRelDir('front', p)).toBe('south');
    expect(resolveRelDir('back', p)).toBe('north');
    expect(resolveRelDir('left', p)).toBe('east');
    expect(resolveRelDir('right', p)).toBe('west');
  });

  it('Drehung um 90° lässt die Front nach Westen zeigen', () => {
    expect(resolveRelDir('front', { rot: 1, mirror: 'none' })).toBe('west');
    expect(resolveRelDir('left', { rot: 1, mirror: 'none' })).toBe('south');
  });

  it('Spiegeln an x vertauscht links und rechts, nicht vorn und hinten', () => {
    const p = { rot: 0 as Quarter, mirror: 'x' as const };
    expect(resolveRelDir('left', p)).toBe('west');
    expect(resolveRelDir('front', p)).toBe('south');
  });
});

describe('transformLocal', () => {
  const size: Vec3 = [3, 1, 2]; // 3 breit (x), 2 tief (z)

  it('Drehung um 0 ist die Identität', () => {
    expect(transformLocal([2, 0, 1], size, 0, 'none')).toEqual([2, 0, 1]);
  });

  it('Nordwest-Ecke wandert bei 90° im Uhrzeigersinn nach Nordost', () => {
    // gedrehte Box ist 2 breit, 3 tief; Nordost = (1, 0)
    expect(transformedSize(size, 1)).toEqual([2, 1, 3]);
    expect(transformLocal([0, 0, 0], size, 1, 'none')).toEqual([1, 0, 0]);
  });

  it('vier Vierteldrehungen ergeben wieder die Ausgangslage', () => {
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 2; z++) {
        let p: Vec3 = [x, 0, z];
        let s: Vec3 = size;
        for (let i = 0; i < 4; i++) {
          p = transformLocal(p, s, 1, 'none');
          s = transformedSize(s, 1);
        }
        expect(p).toEqual([x, 0, z]);
      }
    }
  });

  it('Drehung um k entspricht k Einzeldrehungen', () => {
    for (const rot of [1, 2, 3] as Quarter[]) {
      let p: Vec3 = [2, 0, 0];
      let s: Vec3 = size;
      for (let i = 0; i < rot; i++) {
        p = transformLocal(p, s, 1, 'none');
        s = transformedSize(s, 1);
      }
      expect(transformLocal([2, 0, 0], size, rot, 'none')).toEqual(p);
    }
  });

  it('Positionen und Richtungen drehen konsistent (Nachbar in Richtung d bleibt Nachbar in Richtung d′)', () => {
    // Zelle (0,0,0) hat ihren Süd-Nachbarn bei (0,0,1). Nach Drehung muss der Nachbar in transformDir('south') liegen.
    for (const rot of [0, 1, 2, 3] as Quarter[]) {
      for (const mirror of ['none', 'x', 'z'] as const) {
        const a = transformLocal([0, 0, 0], size, rot, mirror);
        const b = transformLocal([0, 0, 1], size, rot, mirror);
        const d = transformDir('south', { rot, mirror });
        const delta = [b[0] - a[0], b[2] - a[2]];
        const expected = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[d as 'north'];
        expect(delta).toEqual(expected);
      }
    }
  });
});

describe('Rng / hashSeed', () => {
  it('ist deterministisch', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect([a.next(), a.next(), a.int(1, 6)]).toEqual([b.next(), b.next(), b.int(1, 6)]);
  });

  it('hashSeed unterscheidet Teile und Typen', () => {
    expect(hashSeed('a', 1)).not.toBe(hashSeed('a1'));
    expect(hashSeed(1)).not.toBe(hashSeed('1'));
    expect(hashSeed('room', 3)).toBe(hashSeed('room', 3));
  });

  it('fork ist stabil und unabhängig vom Verbrauch anderer Teilströme', () => {
    const r1 = new Rng(7);
    const r2 = new Rng(7);
    const f1 = r1.fork('deko');
    r2.fork('möbel').next();
    const f2 = r2.fork('deko');
    expect(f1.next()).toBe(f2.next());
  });

  it('weighted ignoriert Gewicht 0', () => {
    const r = new Rng(1);
    for (let i = 0; i < 200; i++) {
      expect(r.weighted(['a', 'b'], (x) => (x === 'a' ? 0 : 1))).toBe('b');
    }
  });
});

describe('CellSet', () => {
  it('Rechteck, Mengenoperationen, Grenzen', () => {
    const a = CellSet.rect(0, 0, 3, 2);
    expect(a.size).toBe(12);
    const b = CellSet.rect(2, 0, 5, 2);
    expect(a.intersection(b).size).toBe(6);
    expect(a.union(b).size).toBe(18);
    expect(a.bounds()).toEqual({ minX: 0, minZ: 0, maxX: 3, maxZ: 2 });
  });

  it('findet Zusammenhangskomponenten (4er-Nachbarschaft), größte zuerst', () => {
    const cells = CellSet.rect(0, 0, 4, 0).difference(CellSet.of([[2, 0]])).union(CellSet.of([[10, 10]]));
    const comps = cells.components();
    expect(comps.map((c) => c.size)).toEqual([2, 2, 1]);
    expect(CellSet.of([[0, 0], [1, 1]]).isConnected()).toBe(false); // nur diagonal
  });
});
