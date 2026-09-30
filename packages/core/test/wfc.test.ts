import { describe, expect, it } from 'vitest';
import {
  CHAIN_NEXT, chainGrid, findPinwheelFigures, findPinwheels, grid2d, grid3d, isChiralC4, mirrorMap, palindromeTies, runChainModel, socketModel, solveWfc, tileIndex, wfcViolations,
  type SocketTile,
} from '../src/index.js';

// Kette: Zinnen-artig. Zinne 1 breit (M), 2 breit (Ma Mb), Lücke (C); keine zwei Lücken nebeneinander.
const CHAIN: SocketTile[] = [
  { id: 'C', weight: 1, sockets: ['y', 'x'] },
  { id: 'M', weight: 1, sockets: ['x', 'y'] },
  { id: 'Ma', weight: 1, sockets: ['m', 'y'] },
  { id: 'Mb', weight: 1, sockets: ['x', 'm'] },
];
const chainModel = socketModel(CHAIN, [1, 0]);
const CHAIN_MIRROR = { Ma: 'Mb', Mb: 'Ma' };

// 2D: Streifen-Kacheln (Band waagerecht H, senkrecht V, Kreuzung X, Feld F)
const BAND: SocketTile[] = [
  { id: 'F', weight: 6, sockets: ['f', 'f', 'f', 'f'] },
  { id: 'H', weight: 1, sockets: ['b', 'b', 'f', 'f'] },
  { id: 'V', weight: 1, sockets: ['f', 'f', 'b', 'b'] },
  { id: 'X', weight: 1, sockets: ['b', 'b', 'b', 'b'] },
];
const bandModel = socketModel(BAND, [1, 0, 3, 2]);

const ids = (model: { tiles: readonly { id: string }[] }, tiles: Int32Array): string[] => [...tiles].map((t) => (t < 0 ? '.' : model.tiles[t]!.id));

describe('Tiled WFC: Solver', () => {
  it('Kette: vollständig, verträglich, deterministisch je Seed, verschieden über Seeds', () => {
    const g = chainGrid(20);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const r = solveWfc(chainModel, g, { seed });
      expect(r.ok).toBe(true);
      expect(wfcViolations(chainModel, g, r.tiles)).toEqual([]);
      expect(ids(chainModel, solveWfc(chainModel, g, { seed }).tiles)).toEqual(ids(chainModel, r.tiles));
      const s = ids(chainModel, r.tiles).join(' ');
      expect(s).not.toMatch(/C C/);
      seen.add(s);
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it('Ring: Anfang und Ende passen zusammen', () => {
    const g = chainGrid(9, true);
    for (let seed = 1; seed <= 10; seed++) {
      const r = solveWfc(chainModel, g, { seed });
      expect(r.ok).toBe(true);
      expect(wfcViolations(chainModel, g, r.tiles)).toEqual([]);
      expect(g.adj[8 * 2 + CHAIN_NEXT]).toBe(0);
    }
  });

  it('Vorgaben (vorab gesetzte Zellen) bleiben; Gewicht 0 wird nie frei gewählt', () => {
    const g = chainGrid(15);
    const M = tileIndex(chainModel, 'M');
    const C = tileIndex(chainModel, 'C');
    const fixed = new Map([[0, [M]], [7, [C]], [14, [M]]]);
    for (let seed = 1; seed <= 10; seed++) {
      const r = solveWfc(chainModel, g, { seed, fixed, weights: [1, 1, 0, 0] });
      expect(r.ok).toBe(true);
      expect(wfcViolations(chainModel, g, r.tiles, { fixed })).toEqual([]);
      expect(ids(chainModel, r.tiles).join('')).toMatch(/^[MC]+$/);
    }
  });

  it('Spiegel-Bindungen erzwingen Palindrome (mit Spiegelbild der Kacheln)', () => {
    const n = 13;
    const g = chainGrid(n);
    const map = mirrorMap(chainModel, CHAIN_MIRROR);
    const ties = Array.from({ length: Math.ceil(n / 2) }, (_, i) => ({ a: i, b: n - 1 - i, map }));
    for (let seed = 1; seed <= 20; seed++) {
      const r = solveWfc(chainModel, g, { seed, ties });
      expect(r.ok).toBe(true);
      expect(wfcViolations(chainModel, g, r.tiles, { ties })).toEqual([]);
      const s = ids(chainModel, r.tiles);
      const mirrored = [...s].reverse().map((t) => (CHAIN_MIRROR as Record<string, string>)[t] ?? t);
      expect(mirrored).toEqual(s);
    }
  });

  it('Widerspruch in den Vorgaben: ok = false mit Grund, kein Wurf', () => {
    const g = chainGrid(3);
    const C = tileIndex(chainModel, 'C');
    const r = solveWfc(chainModel, g, { seed: 1, fixed: new Map([[0, [C]], [1, [C]]]) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/widersprüchlich/);
  });

  it('Widerspruch erst in der Tiefe (Zyklen im 2D-Raster): Backtracking repariert, Ergebnis ist verträglich', () => {
    // Wang-Kacheln (Randcodes +x, −x, +z, −z), bei denen AC-3 allein Sackgassen nicht sieht (per Suche gefunden)
    const tiles: SocketTile[] = ['1100', '0010', '1010', '1001'].map((s, i) => ({ id: `W${i}`, weight: 1, sockets: [...s] }));
    const m = socketModel(tiles, [1, 0, 3, 2]);
    const g = grid2d(5, 5);
    let backtracks = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = solveWfc(m, g, { seed, restarts: 0, maxBacktracks: 200 });
      expect(r.ok).toBe(true);
      expect(wfcViolations(m, g, r.tiles)).toEqual([]);
      backtracks += r.backtracks;
    }
    expect(backtracks).toBeGreaterThan(0);
  });

  it('Unlösbar ohne sofortigen Widerspruch: Budget begrenzt, Ergebnis ok = false', () => {
    // Paritätsfalle: Ring ungerader Länge aus zwei Kacheln, die sich abwechseln müssen – AC-3 sieht es nicht sofort
    const tiles: SocketTile[] = [
      { id: 'A', weight: 1, sockets: ['a', 'b'] },
      { id: 'B', weight: 1, sockets: ['b', 'a'] },
    ];
    const m = socketModel(tiles, [1, 0]);
    const r = solveWfc(m, chainGrid(7, true), { seed: 1, maxBacktracks: 8, restarts: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBeDefined();
  });

  it('2D mit Maske und Spiegelachsen: Bänder laufen durch, Muster ist an beiden Achsen gespiegelt', () => {
    const w = 11;
    const d = 9;
    const g = grid2d(w, d, (x, z) => !(x === 5 && z === 4));
    const map = mirrorMap(bandModel, {});
    const ties = [];
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      if (!(x === 5 && z === 4)) ties.push({ a: z * w + x, b: z * w + (w - 1 - x), map }, { a: z * w + x, b: (d - 1 - z) * w + x, map });
    }
    for (let seed = 1; seed <= 6; seed++) {
      const r = solveWfc(bandModel, g, { seed, ties });
      expect(r.ok).toBe(true);
      expect(wfcViolations(bandModel, g, r.tiles, { ties })).toEqual([]);
      expect(r.tiles[4 * w + 5]).toBe(-1);
      const lab = (x: number, z: number): number | undefined => (x < 0 || z < 0 || x >= w || z >= d ? undefined : r.tiles[z * w + x]!);
      expect(findPinwheels(lab, { minX: 0, minZ: 0, maxX: w - 1, maxZ: d - 1 })).toEqual([]);
    }
  });

  it('3D-Raster: Säulen-Kacheln stapeln sich nur auf sich selbst', () => {
    // P = Pfeiler (oben/unten 'p'), A = Luft; seitlich alles erlaubt
    const tiles: SocketTile[] = [
      { id: 'A', weight: 3, sockets: ['s', 's', 's', 's', 'a', 'a'] },
      { id: 'P', weight: 1, sockets: ['s', 's', 's', 's', 'p', 'p'] },
    ];
    const m = socketModel(tiles, [1, 0, 3, 2, 5, 4]);
    const g = grid3d(4, 3, 4);
    const r = solveWfc(m, g, { seed: 9 });
    expect(r.ok).toBe(true);
    expect(wfcViolations(m, g, r.tiles)).toEqual([]);
    for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
      const col = [0, 1, 2].map((y) => r.tiles[(y * 4 + z) * 4 + x]);
      expect(new Set(col).size).toBe(1);
    }
  });

  it('Modell ohne Kacheln: ok = false (Review F, A4); leeres Raster bleibt ok', () => {
    const empty = socketModel([], [1, 0]);
    expect(solveWfc(empty, chainGrid(3), { seed: 1 }).ok).toBe(false);
    expect(solveWfc(empty, chainGrid(0), { seed: 1 }).ok).toBe(true);
  });

  it('Bindung ohne Involution wird abgewiesen', () => {
    expect(() => solveWfc(chainModel, chainGrid(3), { seed: 1, ties: [{ a: 0, b: 2, map: [1, 2, 3, 0] }] })).toThrow(/Involution/);
  });
});

describe('Windrad-Wächter', () => {
  const grid = (rows: string[]): { lab: (x: number, z: number) => number | undefined; b: { minX: number; minZ: number; maxX: number; maxZ: number } } => ({
    lab: (x, z) => (z < 0 || z >= rows.length || x < 0 || x >= rows[0]!.length ? undefined : rows[z]![x] === '#' ? 1 : 0),
    b: { minX: 0, minZ: 0, maxX: rows[0]!.length - 1, maxZ: rows.length - 1 },
  });

  it('erkennt Windrad und „Plus mit Haken“ (5 × 5), auch eingebettet', () => {
    const hooked = grid([
      '.......',
      '.#.###.',
      '.#.#...',
      '.#####.',
      '...#.#.',
      '.###.#.',
      '.......',
    ]);
    expect(findPinwheels(hooked.lab, hooked.b).length).toBeGreaterThan(0);
    // Gegenprobe: halbe Figur (nur 2-zählig) ist kein Windrad
    const half = grid(['##.', '...', '.##']);
    expect(findPinwheels(half.lab, half.b)).toEqual([]);
  });

  it('spiegelsymmetrische Figuren (Kreuz, Ring, Schachbrett, Raute) sind erlaubt', () => {
    for (const rows of [
      ['..#..', '..#..', '#####', '..#..', '..#..'],
      ['#####', '#...#', '#...#', '#...#', '#####'],
      ['#.#.#', '.#.#.', '#.#.#', '.#.#.', '#.#.#'],
      ['..#..', '.#.#.', '#...#', '.#.#.', '..#..'],
    ]) {
      const g = grid(rows);
      expect(findPinwheels(g.lab, g.b), rows.join('/')).toEqual([]);
    }
  });

  it('4-zählig ohne Spiegel (Windrad 4 × 4 um einen Gitterpunkt) schlägt an', () => {
    const win = [
      1, 1, 0, 1,
      0, 0, 0, 1,
      1, 0, 0, 0,
      1, 0, 1, 1,
    ];
    expect(isChiralC4(win, 4)).toBe(true);
    expect(isChiralC4([1, 1, 1, 1, 0, 1, 1, 1, 1], 3)).toBe(false); // Ring: spiegelsymmetrisch
  });
});

describe('Lauflängen-Ketten', () => {
  it('Läufe wechseln die Art, Breiten wie erlaubt, Palindrom mit Enden als Beet', () => {
    const rc = runChainModel([{ id: 'bed', widths: [[2, 1], [3, 1]] }, { id: 'path', widths: [[1, 1]] }]);
    const seen = new Set<string>();
    for (const n of [7, 8, 11, 14]) {
      const g = chainGrid(n);
      const ties = palindromeTies(n, rc.mirror);
      const fixed = new Map([[0, rc.startsOf('bed')], [n - 1, rc.endsOf('bed')]]);
      for (let seed = 1; seed <= 8; seed++) {
        const r = solveWfc(rc.model, g, { seed, ties, fixed });
        expect(r.ok, `n=${n} seed=${seed} ${r.reason}`).toBe(true);
        expect(wfcViolations(rc.model, g, r.tiles, { ties, fixed })).toEqual([]);
        const s = [...r.tiles].map((t) => (rc.kindOf[t] === 'bed' ? 'b' : 'p')).join('');
        expect(s).toBe([...s].reverse().join(''));
        for (const run of s.match(/b+/g) ?? []) expect([2, 3]).toContain(run.length);
        expect(s).not.toMatch(/pp/);
        seen.add(s);
      }
    }
    expect(seen.size).toBeGreaterThan(4);
  });
});

describe('Windrad-Wächter: Figuren (Review F, A1)', () => {
  const lab = (rows: string[]) => (x: number, z: number): number | undefined => {
    const c = rows[z]?.[x];
    return c === undefined ? undefined : c === '#' ? 1 : c === 'o' ? 2 : c === '*' ? 3 : 0;
  };
  const box = (rows: string[]) => ({ minX: 0, minZ: 0, maxX: rows[0]!.length - 1, maxZ: rows.length - 1 });

  it('Fremdblock im Hüllrechteck, 11 × 11 und zwei ähnliche Materialien (Gruppe) schlagen an', () => {
    // Windrad 4 × 4 (acht Blöcke wie im Review, Andesit), eine Blume (*) im Hüllquadrat
    const small = ['.#.*', '.###', '###.', '..#.'];
    expect(findPinwheelFigures(lab(small), box(small)).length).toBeGreaterThan(0);
    // Hakenkreuz 11 × 11
    const big: string[] = [];
    for (let z = 0; z < 11; z++) {
      let r = '';
      for (let x = 0; x < 11; x++) {
        const on = x === 5 || z === 5 || (z === 0 && x >= 5) || (x === 10 && z >= 5) || (z === 10 && x <= 5) || (x === 0 && z <= 5);
        r += on ? '#' : '.';
      }
      big.push(r);
    }
    expect(findPinwheels(lab(big), box(big)).length).toBeGreaterThan(0);
    expect(findPinwheelFigures(lab(big), box(big)).length).toBeGreaterThan(0);
    // zwei Materialien (# und o) bilden zusammen das Windrad – nur als Gruppe sichtbar
    const mixed = ['.o..', '.#o#', 'o##.', '..o.'];
    expect(findPinwheelFigures(lab(mixed), box(mixed))).toEqual([]);
    expect(findPinwheelFigures(lab(mixed), box(mixed), [[1, 2]]).length).toBeGreaterThan(0);
  });

  it('Kreuz, Ring, Rechteck-Figuren schlagen nicht an', () => {
    for (const rows of [['..#..', '..#..', '#####', '..#..', '..#..'], ['#####', '#...#', '#...#', '#####'], ['###', '###']]) {
      expect(findPinwheelFigures(lab(rows), box(rows), [[1, 2]])).toEqual([]);
    }
  });
});
