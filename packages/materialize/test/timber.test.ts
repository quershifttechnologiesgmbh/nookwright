/**
 * Fachwerk (F1, research/18 F1, research/12 §3.3/§3.5, research/16 R1/R6/U3/D12): Feldrhythmus, Motive als ASCII,
 * Symmetrie, Determinismus, Öffnungen bleiben frei, Theme `timber` am echten `deriveShell` (Vorlage „Fachwerkhaus“).
 *
 * Zeichen der Ansichten (von außen): | Ständer (Stamm senkrecht), - Riegel/Schwelle/Rähm (Stamm liegend),
 * x Strebe bzw. Eckholz (`wood`), . Gefach, # Stein, g Glas, D Tür, / Treppe, _ Stufe.
 */
import { Project, TARGET_VERSIONS as PROJECT_VERSIONS, deriveShell, type RoofStyle, type Shell, type ShellOptions } from '@mcda/blueprint';
import { TIMBER_MOTIFS, type TimberMotif, type WallTimber } from '@mcda/catalog';
import { CellSet, key3 } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import {
  applySurfaces, bayLayout, fieldWidths, fitMotif, hasLoneInfill, materialize, motifGrid, pickMotif, shellContext, timberPart, TIMBER_BRACE_MIN,
  type CellContext, type MaterializeResult, type SurfaceOut, type TimberPart, type WallLine,
} from '../src/index.js';
import { VERSIONS, platformView, themes } from './fixtures.js';

const ROOFS: readonly RoofStyle[] = ['flat', 'hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox'];
const FULL: Omit<ShellOptions, 'roof'> = {
  overhang: 1,
  roofDetail: { pitch: 'steep', trim: true, verge: 'closed', gableWindows: true },
  facade: { plinthProfile: true, cornice: true, quoins: true, pilasters: 4, brackets: 3 },
};

interface House {
  readonly shell: Shell;
  readonly roomTypes: Record<string, string>;
}

/** Vorlage „Fachwerkhaus“ der App: zwei Etagen auf 17 × 12, Treppe im Lager. */
function fachwerkhaus(options: ShellOptions = { roof: 'gable', ...FULL }): House {
  const p = Project.create({ id: 'f', name: 'F', seed: 2026, themeId: 'timber', targetVersion: PROJECT_VERSIONS['26.3'], floor: { y0: 0, height: 3 } });
  p.addFloor();
  for (const [f, x1, z1, x2, z2, t] of [
    [0, 0, 0, 9, 6, 'solar'], [0, 10, 0, 16, 6, 'kitchen'], [0, 0, 7, 16, 11, 'storage'],
    [1, 0, 0, 8, 6, 'bedroom'], [1, 9, 0, 16, 6, 'study'], [1, 0, 7, 16, 11, 'guest_room'],
  ] as const) p.paintRoom(f, CellSet.rect(x1, z1, x2, z2), t);
  p.placeStairs(0, [3, 10], 'east');
  return { shell: deriveShell(p.state, options), roomTypes: Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId])) };
}

/** Eingeschossiges Beispielhaus (Küche, Schlafzimmer, Lager, Schmiede). */
function beispielhaus(roof: RoofStyle = 'gable'): House {
  const p = Project.create({ id: 's', name: 'S', seed: 2026, themeId: 'timber', targetVersion: PROJECT_VERSIONS['26.3'], floor: { y0: 0, height: 3 } });
  for (const [x1, z1, x2, z2, t] of [[0, 0, 8, 6, 'kitchen'], [9, 0, 14, 6, 'bedroom'], [0, 7, 14, 11, 'storage'], [15, 0, 22, 11, 'smithy']] as const) {
    p.paintRoom(0, CellSet.rect(x1, z1, x2, z2), t);
  }
  return { shell: deriveShell(p.state, { roof }), roomTypes: Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId])) };
}

const build = (h: House, themeId = 'timber', seed = 2026, version = '26.3'): MaterializeResult =>
  materialize({ shell: h.shell, placements: [], theme: themes.get(themeId), platform: platformView(version), seed, roomTypes: h.roomTypes });

function glyph(name: string, props: Readonly<Record<string, string>>): string {
  if (name === 'air') return ' ';
  if (name.endsWith('_log')) return props['axis'] === 'y' ? '|' : '-';
  if (name.endsWith('_wood')) return 'x';
  if (name.includes('glass')) return 'g';
  if (name.endsWith('_door')) return 'D';
  if (name === 'calcite' || name === 'mushroom_stem' || name.endsWith('terracotta') || name === 'diorite') return '.';
  if (name.endsWith('_stairs')) return '/';
  if (name.endsWith('_slab')) return '_';
  return '#';
}

/** Ansicht der Wandebene z = const (x0…x1) bzw. x = const (z0…z1), Zeilen von y1 abwärts bis y0. */
function view(r: MaterializeResult, plane: { z: number } | { x: number }, from: number, to: number, y0: number, y1: number): string[] {
  const rows: string[] = [];
  for (let y = y1; y >= y0; y--) {
    let s = '';
    for (let a = from; a <= to; a++) {
      const st = r.volume.stateAt('z' in plane ? [a, y, plane.z] : [plane.x, y, a]);
      s += glyph(st.name, st.properties);
    }
    rows.push(s);
  }
  return rows;
}

const PART_CHAR: Record<TimberPart, string> = { post: '|', rail: '-', brace: 'x', infill: '.' };
const ascii = (g: TimberPart[][]): string[] => [...g].reverse().map((row) => row.map((p) => PART_CHAR[p]).join(''));

// ---------------------------------------------------------------- Feldrhythmus

describe('Feldrhythmus (research/12 §3.5, research/16 R1)', () => {
  it('Feldbreiten je freiem Stück: Wunschbreite 3, spiegelsymmetrisch, Rest von der Mitte aus', () => {
    const want: Record<number, number[]> = {
      1: [1], 2: [2], 3: [3], 4: [4], 5: [2, 2], 6: [1, 2, 1], 7: [3, 3], 8: [2, 2, 2], 9: [2, 3, 2], 10: [3, 2, 3], 11: [3, 3, 3], 12: [3, 4, 3], 13: [2, 3, 3, 2],
    };
    for (const [r, w] of Object.entries(want)) expect(fieldWidths(Number(r), 3), `r=${r}`).toEqual(w);
    for (let r = 1; r <= 40; r++) {
      for (const bay of [2, 3, 4]) {
        const w = fieldWidths(r, bay);
        expect(w.reduce((a, b) => a + b, 0) + w.length - 1, `r=${r}`).toBe(r); // Felder + Ständer = Stück
        expect(w, `r=${r} bay=${bay}`).toEqual([...w].reverse());
        expect(Math.min(...w)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('Ständer an Pfeilern und neben jeder Öffnung, Felder dazwischen; nearOpening entlang der Linie', () => {
    // Nordfassade OG des Fachwerkhauses: Ecken 0/16, T-Stoß 8, Fenster 4 und 12
    const pillar = Array.from({ length: 17 }, (_, i) => i === 0 || i === 8 || i === 16);
    const opening = Array.from({ length: 17 }, (_, i) => i === 4 || i === 12);
    const L = bayLayout(pillar, opening, 3);
    const line = L.post.map((p, i) => (p ? '|' : opening[i] ? 'g' : '.')).join('');
    expect(line).toBe('|..|g|..|..|g|..|');
    expect(L.nBays).toBe(6);
    expect(L.openBay).toEqual([false, true, false, false, true, false]);
    expect(L.bayW.filter((_, i) => !L.post[i])).toEqual([2, 2, 1, 2, 2, 2, 2, 1, 2, 2]);
    expect(L.nearOpening).toEqual([4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4]);
    // Lange fensterlose Wand: Rhythmus 1 + 3
    const blank = bayLayout(Array.from({ length: 17 }, (_, i) => i === 0 || i === 16), new Array<boolean>(17).fill(false), 3);
    expect(blank.post.map((p) => (p ? '|' : '.')).join('')).toBe('|...|...|...|...|');
  });
});

// ---------------------------------------------------------------- Motive

describe('W4 (27.09.2026, Review S5): kein Doppelständer', () => {
  it('Laibungsständer entfällt neben Rasterpfosten, Rasterpfosten neben Pfeiler; Bild bleibt spiegelgleich', () => {
    // Obergeschoss der Taverne (golden tavern-timber): Ecken 0/22, Fenster 3/8/14/19, Raster 5/11/17
    const len = 23;
    const pillar = Array.from({ length: len }, (_, i) => i === 0 || i === len - 1);
    const opening = Array.from({ length: len }, (_, i) => [3, 8, 14, 19].includes(i));
    const grid = Array.from({ length: len }, (_, i) => [5, 11, 17].includes(i));
    const L = bayLayout(pillar, opening, 4, grid);
    const line = L.post.map((p, i) => (p ? '|' : opening[i] ? 'g' : '.')).join('');
    // W7 (27.09.2026): Regel „Gefach ≥ 2“ – vorher '|.|g.|.|g|.|.|g|.|.g|.|' mit 1 breiten Putzstreifen zwischen Eck-,
    // Raster- und Laibungsständern; jetzt stehen die Fenster frei im Putzfeld des Rasters
    expect(line).toBe('|..g.|..g..|..g..|.g..|');
    expect(line).toBe([...line].reverse().join(''));
    // Pfeiler (Wandende) direkt neben einem Rasterpfosten: der Rasterpfosten entfällt
    const p2 = Array.from({ length: 9 }, (_, i) => i === 0 || i === 8);
    const g2 = Array.from({ length: 9 }, (_, i) => i === 1 || i === 7);
    const L2 = bayLayout(p2, new Array<boolean>(9).fill(false), 3, g2);
    const s2 = L2.post.map((p) => (p ? '|' : '.')).join('');
    expect(s2.includes('||')).toBe(false);
  });
});

describe('W7 (27.09.2026, Review W4-R Runde 4): keine 1 breiten Putzstreifen zwischen Ständern', () => {
  const layout = (len: number, pillars: readonly number[], openings: readonly number[], posts: readonly number[], bay = 4): string => {
    const opening = Array.from({ length: len }, (_, i) => openings.includes(i));
    const L = bayLayout(Array.from({ length: len }, (_, i) => pillars.includes(i)), opening, bay, Array.from({ length: len }, (_, i) => posts.includes(i)));
    return L.post.map((p, i) => (p ? '|' : opening[i] ? 'g' : '.')).join('');
  };
  it('Feld zusammenlegen: Rasterpfosten zwischen zwei Streifen entfällt (Taverne timber, Rückseite OG)', () => {
    // vorher |..|g|.|.|gg|.|.|g|..| – die Rasterpfosten 7 und 14 trugen zugleich die Trennwände (W1 Anschluss-Stamm)
    expect(layout(22, [0, 21], [4, 10, 11, 17], [7, 14])).toBe('|..|g|...|gg|...|g|..|');
    expect(layout(15, [0, 14], [4, 10], [7])).toBe('|..|g|...|g|..|');
  });
  it('Fenster frei ins Gefach, wenn am Eckständer nur ein Streifen bliebe (Stadthaus timber)', () => {
    // vorher |.|g|.|.|g|.| bzw. |.|g|.| (Zebra aus Streifen); der Rasterpfosten bleibt, die Fenster stehen mittig
    expect(layout(13, [0, 12], [3, 9], [6])).toBe('|..g..|..g..|');
    expect(layout(7, [0, 6], [3], [])).toBe('|..g..|');
  });
  it('ruhige Linien bleiben unverändert (Fachwerkhaus: Felder 2 breit, Laibungsständer)', () => {
    expect(layout(17, [0, 16], [4, 12], [8])).toBe('|..|g|..|..|g|..|');
  });
  it('Zufallslinien: kein Streifen zwischen zwei Ständern (außer zwischen Pfeilern bzw. Pfosten zwischen zwei Öffnungen), spiegelgleich, Pfeiler bleiben, nie ein Ständer auf einer Öffnung', () => {
    let s = 7;
    const rnd = (n: number): number => ((s = (s * 1103515245 + 12345) % 2147483648), s % n);
    for (let t = 0; t < 400; t++) {
      const half = 4 + rnd(12);
      const len = 2 * half + (rnd(2) === 0 ? 1 : 0);
      const mirror = (k: number): number => len - 1 - k;
      const pick = (p: number): number[] => {
        const out = new Set<number>();
        for (let i = 1; i < half; i++) if (rnd(p) === 0) (out.add(i), out.add(mirror(i)));
        return [...out];
      };
      const pillars = [0, len - 1, ...(rnd(4) === 0 ? pick(9) : [])];
      const openings = pick(4).filter((i) => !pillars.includes(i));
      const grid = pick(3).filter((i) => !pillars.includes(i));
      const bay = 3 + rnd(2);
      const pillar = Array.from({ length: len }, (_, i) => pillars.includes(i));
      const opening = Array.from({ length: len }, (_, i) => openings.includes(i));
      const L = bayLayout(pillar, opening, bay, Array.from({ length: len }, (_, i) => grid.includes(i)));
      const line = L.post.map((p, i) => (p ? '|' : opening[i] ? 'g' : '.')).join('');
      const where = `${line} (Pfeiler ${pillars.join(',')}, Raster ${grid.join(',')}, bay ${bay})`;
      expect(line, where).toBe([...line].reverse().join(''));
      pillars.forEach((i) => expect(L.post[i], where).toBe(true));
      openings.forEach((i) => expect(L.post[i], where).toBe(false));
      const fixed = (k: number): boolean => pillar[k] === true || (opening[k - 1] === true && opening[k + 1] === true);
      for (let i = 1; i + 1 < len; i++) {
        if (L.post[i] || opening[i] || !L.post[i - 1] || !L.post[i + 1]) continue;
        expect(fixed(i - 1) && fixed(i + 1), `Streifen bei ${i}: ${where}`).toBe(true);
      }
    }
  });
  it('ohne Raster bitgleich zu vorher (Streifen bleiben, alte Vorlagen und Tests)', () => {
    const pillar = Array.from({ length: 13 }, (_, i) => i === 0 || i === 12);
    const opening = Array.from({ length: 13 }, (_, i) => i === 3 || i === 9);
    const L = bayLayout(pillar, opening, 3);
    expect(L.post.map((p, i) => (p ? '|' : opening[i] ? 'g' : '.')).join('')).toBe('|.|g|...|g|.|');
  });
});

describe('Motive je Feld (research/18 F1, ASCII von oben nach unten)', () => {
  const grid = (m: TimberMotif, bw: number, h: number, mirror = false): string[] => ascii(motifGrid(m, bw, h, mirror));

  it('3 × 3: Andreaskreuz, Strebe / und \\, K-Strebe, Raute, Fußbänder, nur Riegel, leer', () => {
    expect(grid('cross', 3, 3)).toEqual(['x.x', '.x.', 'x.x']);
    expect(grid('brace', 3, 3)).toEqual(['..x', '.x.', 'x..']);
    expect(grid('brace', 3, 3, true)).toEqual(['x..', '.x.', '..x']);
    expect(grid('k', 3, 3)).toEqual(['x..', '.x.', 'x..']);
    expect(grid('k', 3, 3, true)).toEqual(['..x', '.x.', '..x']);
    expect(grid('rhombus', 3, 3)).toEqual(['.x.', 'x.x', '.x.']);
    expect(grid('feet', 3, 3)).toEqual(['...', '...', 'x.x']);
    expect(grid('rail', 3, 3)).toEqual(['...', '---', '...']);
    expect(grid('none', 3, 3)).toEqual(['...', '...', '...']);
  });

  it('andere Feldgrößen: hohe Felder mit 45°-Fußstrebe, breite mit flacher Strebe, 5 × 5 und 5 × 3', () => {
    expect(grid('brace', 2, 3)).toEqual(['..', '.x', 'x.']);
    expect(grid('brace', 4, 3)).toEqual(['...x', '.xx.', 'x...']);
    expect(grid('cross', 4, 3)).toEqual(['x..x', '.xx.', 'x..x']);
    expect(grid('brace', 3, 2)).toEqual(['.xx', 'x..']);
    expect(grid('cross', 5, 5)).toEqual(['x...x', '.x.x.', '..x..', '.x.x.', 'x...x']);
    expect(grid('rhombus', 5, 3)).toEqual(['..x..', '.x.x.', '..x..']);
    expect(grid('k', 3, 5)).toEqual(['x..', '.x.', '..x', '.x.', 'x..']);
    expect(grid('cross', 3, 4)).toEqual(['...', 'x.x', '.x.', 'x.x']);
  });

  // W4 (27.09.2026, Review S5): Streben nur in Feldern ab 3 × 4 (Vorbilder: Diagonalen nur in großen Feldern) und nur,
  // wenn kein Gefach-Einzelfeld entsteht (kein Hell/Dunkel-Schachbrett); sonst Ersatz bis zum leeren Gefach
  it('Ersatzkette, wenn das Motiv nicht ins Feld passt', () => {
    expect(fitMotif('rhombus', 5, 5)).toBe('rhombus');
    expect(fitMotif('rhombus', 4, 5)).toBe('cross');
    expect(fitMotif('cross', 3, 4)).toBe('brace'); // Kreuz im 3 × 4-Feld ließe Einzelzellen
    expect(fitMotif('k', 3, 4)).toBe('k');
    expect(fitMotif('feet', 3, 4)).toBe('feet');
    // kleine Felder (≤ 2 breit oder ≤ 3 hoch): leeres Gefach
    expect(fitMotif('cross', 3, 3)).toBe('none');
    expect(fitMotif('rhombus', 5, 3)).toBe('none');
    expect(fitMotif('brace', 2, 5)).toBe('none');
    expect(fitMotif('k', 3, 3)).toBe('none');
    expect(fitMotif('rail', 3, 2)).toBe('none');
    expect(fitMotif('rail', 3, 3)).toBe('rail');
    // jedes Motiv, das passt, liefert ein Raster der Feldgröße ohne Gefach-Einzelzelle
    for (const m of TIMBER_MOTIFS) for (let bw = 1; bw <= 6; bw++) for (let h = 1; h <= 6; h++) {
      const f = fitMotif(m, bw, h);
      const g = motifGrid(f, bw, h);
      expect(g.length).toBe(h);
      expect(g.every((row) => row.length === bw)).toBe(true);
      if (f !== 'none') expect(hasLoneInfill(g), `${m} → ${f} ${bw}×${h}`).toBe(false);
      if (!['none', 'rail'].includes(f)) expect(bw >= TIMBER_BRACE_MIN.bw && h >= TIMBER_BRACE_MIN.h, `${f} ${bw}×${h}`).toBe(true);
    }
    expect(hasLoneInfill(motifGrid('cross', 3, 3))).toBe(true); // das alte Schachbrett
  });

  it('Motivwahl: Spiegelpaare gleich (rechts gespiegelt), Mittelfeld nur symmetrisch, per Seed deterministisch', () => {
    const motifs: TimberMotif[] = ['brace', 'k', 'cross', 'none'];
    for (let seed = 0; seed < 40; seed++) {
      for (const n of [1, 2, 3, 5, 6]) {
        for (let k = 0; k < n; k++) {
          const a = pickMotif(motifs, seed, 77, k, n, 5, 5);
          const b = pickMotif(motifs, seed, 77, n - 1 - k, n, 5, 5);
          expect(a.motif).toBe(b.motif);
          if (k !== n - 1 - k) expect(a.mirror).not.toBe(b.mirror);
          else expect(['cross', 'none', 'rhombus', 'feet', 'rail']).toContain(a.motif);
          expect(pickMotif(motifs, seed, 77, k, n, 5, 5)).toEqual(a);
        }
      }
    }
    const used = new Set(Array.from({ length: 40 }, (_, seed) => pickMotif(motifs, seed, 77, 0, 4, 5, 5).motif));
    expect(used.size).toBeGreaterThanOrEqual(3); // der Seed wählt wirklich
  });
});

// ---------------------------------------------------------------- Symmetrie (synthetische Linien)

/** Bauteile einer Linie (Zeilen von oben) über `timberPart` mit einem schlanken Kontext. */
function lineParts(line: WallLine, t: WallTimber, H: number, seed: number): string[] {
  const rows: string[] = [];
  for (let r = H - 1; r >= 0; r--) {
    let s = '';
    for (let i = 0; i < line.len; i++) {
      if (line.pillar[i]) {
        s += '|';
        continue;
      }
      // Fenster in den Reihen 1…H−1; darunter liegt die Brüstung
      if (line.opening[i] && r >= 1) {
        s += 'g';
        continue;
      }
      const ctx = { line, along: i, hRel: r, H, wallAxis: line.axis, ...(line.opening[i] ? { openingSide: 'below' as const } : {}) } as unknown as CellContext;
      s += PART_CHAR[timberPart(t, { kind: 'wall' }, ctx, seed)];
    }
    rows.push(s);
  }
  return rows;
}

describe('Symmetrie je Fassade', () => {
  it('symmetrische Linien (Pfeiler, Fenster, Doppelfenster) ergeben spiegelgleiche Fachwerkbilder', () => {
    let checked = 0;
    for (let len = 3; len <= 27; len++) {
      for (const holes of [[], [2], [4], [2, 6], [3, 4]]) {
        const opening = Array.from({ length: len }, (_, i) => holes.some((p) => i === p || i === len - 1 - p) && i > 0 && i < len - 1);
        const pillar = Array.from({ length: len }, (_, i) => i === 0 || i === len - 1 || (len % 2 === 1 && len >= 15 && i === (len - 1) / 2 && !opening[i]));
        const line: WallLine = { key: len * 31 + holes.length, axis: 'x', len, pillar, opening, gable: false };
        for (const H of [2, 3, 4, 5]) {
          for (const seed of [1, 2, 3]) {
            const t: WallTimber = { motifs: ['brace', 'k', 'cross', 'rhombus', 'feet', 'rail', 'none'], ...(H === 2 ? { sill: true } : {}) };
            const rows = lineParts(line, t, H, seed);
            for (const row of rows) expect(row, `${len}/${holes.join(',')}/H${H}/s${seed}\n${rows.join('\n')}`).toBe([...row].reverse().join(''));
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

// ---------------------------------------------------------------- Fachwerkhaus im Theme timber

describe('Theme timber am Fachwerkhaus (deriveShell, Satteldach steil, volles Außenprofil)', () => {
  const h = fachwerkhaus();
  const r = build(h);

  // W2 (26.09.2026): Regel D2 – kein Kniestock-Band mehr über der Traufe, die Reihe über der Traufe gehört zur Dachfläche
  // W5 (27.09.2026, Review W4-R N7/N1): D5 für Mehrgeschosser – das steile Dach (13 Reihen) wäre höher als 1,5 × Wand (8);
  // ein Kniestock (Reihe 9, Fachwerk mit durchlaufenden Ständern) hebt es um 1. Die Eckständer laufen bis unter die
  // Traufe durch (Rähm-Ecke `|` statt `x`).
  it('Nordfassade: Stein-EG, Schwelle, OG mit Ständern/Brüstungsriegeln, Rähm, Kniestock, Dachfüllung über der Traufe', () => {
    expect(view(r, { z: 0 }, 0, 16, 0, 10)).toEqual([
      '#################', // 10 Dachfüllung (Traufanschluss D2), keine Wand über der Traufe
      '|..|.|..|..|.|..|', //  9 W5: Kniestock, Ständer wie im OG
      '|-------x-------|', //  8 Rähm (Deckenrähm), T-Stoß rundum Rinde; W5: Eckständer laufen durch
      '|..|g|..|..|g|..|', //  7
      // W13-E (2026-09-28): fensterlose Felder mit Brustriegel (Motiv `rail`, Theme timber OG); vorher '|..|g|..|..|g|..|'
      '|--|g|--|--|g|--|', //  6 W4 (27.09.2026, S5): keine Streben in Feldern unter 3 × 4
      '|..|-|..|..|-|..|', //  5 Brüstungsriegel unter den Fenstern
      'x-------x-------x', //  4 Schwelle auf der Bodenplatte des OG
      '##g####g#|###-###', //  3 Erdgeschoss Stein (Eckquader, Pfeiler am T-Stoß, Sturz)
      '##g####g#|###D###',
      '#########|###D###',
      '#################', //  0 Fundament
    ]);
  });

  it('Giebel (West): eigenes Stockwerk über dem Rähm – Ständer im Rhythmus, Riegel alle 4 Reihen, Giebelfenster gerahmt', () => {
    // W2 (26.09.2026): Regel D3 – unter jeder Ortgangtreppe das Windbrett (`#`, roof_trim) statt Giebelwand
    // W5 (27.09.2026): Kniestock 1 (N7) – der Giebel steht eine Reihe höher, Eckständer bis unter die Traufe (N1)
    // W13-E (2026-09-28): Ständerrhythmus des Obergeschosses 3 statt 4 (Theme timber) – der Giebel hat 2 Ständer mehr
    // (Spalten 2 und 5; vorher nur der T-Stoß 7)
    expect(view(r, { x: 0 }, 0, 11, 4, 20)).toEqual([
      '     ##     ', // 20 Windbrett
      '    /|./    ',
      '    #|.#    ',
      '   /.|.|/   ',
      '   #-|-|#   ', // 16 Riegel (4 Reihen über dem Riegel darunter)
      '  /..|.|./  ',
      '  #..--|.#  ', // 14 Sturzriegel über dem Giebelfenster
      ' /|.|gg|../ ', // 13 Giebelfenster, Ständer daneben
      ' #|----|--# ', // 12 Riegel (4 Reihen über dem Rähm)
      '/.|..|.|.../',
      '#.|..|.|...#', // 10 Giebel: Ständer im Rhythmus 3, T-Stoß 7; außen das Windbrett
      '|.|..|.|...|', //  9 W5: Kniestock, Eckständer laufen durch
      '|------x---|', //  8 Rähm
      '|.|gg|.||g||', //  7 OG: Doppelfenster und Fenster, je mit Laibungsständern
      '|.|gg|.||g||',
      '|.|--|.||-||', //  5 Brüstungsriegel
      'x------x---x', //  4 Schwelle
    ]);
    const gable = h.shell.cells.filter((c) => c.kind === 'window' && c.pos[0] === 0 && c.pos[1] > 8);
    expect(gable.length).toBeGreaterThan(0);
    for (const w of gable) {
      for (const dz of [-1, 1]) {
        const st = r.volume.stateAt([0, w.pos[1], w.pos[2] + dz]);
        if (st.name.endsWith('_log') || st.name.includes('glass')) continue;
        throw new Error(`neben Giebelfenster ${key3(w.pos)}: ${st.name}`);
      }
    }
  });

  it('EG unter dem OG bleibt Stein, Obergeschoss und Giebel sind Fachwerk (Holz dunkel, Gefach hell)', () => {
    const ctx = shellContext(h.shell, h.roomTypes);
    const theme = themes.get('timber');
    let wood = 0;
    let infill = 0;
    h.shell.cells.forEach((c, i) => {
      const cx = ctx[i]!;
      if (c.kind !== 'wall' || !cx.exterior) return;
      const out = applySurfaces(theme, c, cx, 2026);
      if (cx.storey === 0) {
        // W2 (26.09.2026): Regel W3/I1 – die verzahnten Quader-Nachbarn werden wieder Wandfeld (Stein), sonst bleibt die Zelle
        if (c.role === 'wall_quoin') expect(out?.role, key3(c.pos)).toBe('wall_primary');
        else expect(out, key3(c.pos)).toBeUndefined();
        return;
      }
      expect(['beam', 'wall_infill'], key3(c.pos)).toContain(out?.role);
      if (out?.role === 'beam') wood++;
      else infill++;
    });
    // Fachwerk mit `bay: 4` aus dem Theme (F1-Nachtrag: Holzanteil 53,3 % → 45,7 % gegenüber dem Standard 3), die
    // helle Füllung bleibt sichtbar
    // W13-E (2026-09-28): Obergeschoss im Rhythmus 3 mit Brustriegel in fensterlosen Feldern – 52,6 % Holz (vorher < 50 %
    // mit `bay: 4`); im blinden A/B-Test (3 Prüfer) war die dichtere Fassung besser
    const share = wood / (wood + infill);
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.55);
    const names = new Set([...r.volume.cells()].map((c) => c.state.name));
    for (const n of ['dark_oak_log', 'dark_oak_wood', 'calcite', 'mushroom_stem']) expect(names.has(n), n).toBe(true);
  });

  // W13-E (2026-09-28): das Theme nimmt im Obergeschoss selbst den Rhythmus 3 (vorher 4, „Theme < Standard 3“)
  it('`bay` steuert den Holzanteil: Feldbreite 4 ist heller als 3, das Theme nimmt im OG 3', () => {
    const shell: Shell = fachwerkhaus({ roof: 'gable', ...FULL }).shell;
    const ctx = shellContext(shell, {});
    const bayOf = (bay: number | undefined) => {
      const theme = themes.get('timber');
      const timber = (t: WallTimber): WallTimber => (bay === undefined ? t : { ...t, bay });
      return {
        ...theme,
        surfaces: { ...theme.surfaces, wall: (theme.surfaces.wall ?? []).map((r) => (r.timber !== undefined ? { ...r, timber: timber(r.timber) } : r)) },
      };
    };
    /** Anteil der Holz-Zellen an den Außenwandzellen des OG und der Giebel. */
    const woodShare = (theme: ReturnType<typeof bayOf>): number => {
      let wood = 0;
      let infill = 0;
      shell.cells.forEach((c, i) => {
        const cx = ctx[i]!;
        if (c.kind !== 'wall' || !cx.exterior || cx.storey === 0) return;
        const out = applySurfaces(theme, c, cx, 2026);
        if (out?.role === 'beam') wood++;
        else if (out?.role === 'wall_infill') infill++;
      });
      return wood / (wood + infill);
    };
    const themen = woodShare(bayOf(undefined));
    const standard = woodShare(bayOf(3));
    const weit = woodShare(bayOf(4));
    expect(weit, `bay 4 ${weit.toFixed(3)} vs Standard ${standard.toFixed(3)}`).toBeLessThan(standard);
    expect(themen, `Theme ${themen.toFixed(3)} vs Standard ${standard.toFixed(3)}`).toBeCloseTo(standard, 5);
    expect(themen).toBeLessThan(0.55);
  });

  it('Eckquader im OG werden Eckständer (research/12 §3.6), im Stein-EG bleiben sie', () => {
    for (const [x, z] of [[0, 0], [16, 0], [0, 11], [16, 11]] as const) {
      expect(r.volume.stateAt([x, 6, z]).name, `OG ${x},${z}`).toBe('dark_oak_log');
      // W2 (26.09.2026): Regel W3 – Eckquader mit sichtbarem Helligkeitsabstand (Tiefenschieferziegel statt poliertem Andesit)
      expect(r.volume.stateAt([x, 2, z]).name, `EG ${x},${z}`).toBe('deepslate_bricks');
    }
  });
});

describe('Öffnungen, Determinismus, Physik – alle 9 Dachformen', () => {
  it('Fenster und Türen nie überdeckt, Laibungsständer daneben, Brüstungsriegel darunter; 0 harte Verstöße', () => {
    const theme = themes.get('timber');
    for (const roof of ROOFS) {
      for (const h of [fachwerkhaus({ roof, ...FULL }), beispielhaus(roof)]) {
        const ctx = shellContext(h.shell, h.roomTypes);
        const r = build(h);
        const byPos = new Map(h.shell.cells.map((c) => [key3(c.pos), c] as const));
        h.shell.cells.forEach((c, i) => {
          const where = `${roof} ${c.kind} ${key3(c.pos)}`;
          if (c.kind === 'window' || c.kind === 'door' || c.kind === 'lintel') {
            expect(applySurfaces(theme, c, ctx[i]!, 2026), where).toBeUndefined();
            const name = r.volume.stateAt(c.pos).name;
            if (c.kind === 'window') expect(name.includes('glass') || name.endsWith('_stairs'), `${where}: ${name}`).toBe(true);
            if (c.kind === 'door') expect(name.endsWith('_door'), `${where}: ${name}`).toBe(true);
          }
          // Fachwerk-Wandzellen neben Fenstern: Ständer; darunter: Riegel oder Schwelle (liegender Stamm)
          const cx = ctx[i]!;
          const out: SurfaceOut | undefined = c.kind === 'wall' && cx.exterior ? applySurfaces(theme, c, cx, 2026) : undefined;
          if (out === undefined || (out.role !== 'beam' && out.role !== 'wall_infill')) return;
          if (cx.openingSide === 'beside') expect(out, where).toEqual({ role: 'beam', shape: 'log', axis: 'y' });
          const below = byPos.get(key3([c.pos[0], c.pos[1] + 1, c.pos[2]]));
          // W4 (27.09.2026): Okulus-Ecke (Wand statt Treppe) liegt unter der Seitenscheibe und neben der unteren – dort gilt der Ständer
          if (below?.kind === 'window' && cx.wallAxis !== undefined && cx.openingSide !== 'beside') expect(out, where).toEqual({ role: 'beam', shape: 'log', axis: cx.wallAxis });
        });
        expect(r.violations.filter((v) => v.kind !== 'spawn').map((v) => v.message), roof).toEqual([]);
      }
    }
  });

  it('gleicher Seed → gleiche Welt; kleine Felder ohne Motiv, gleiche Ständer', () => {
    const h = fachwerkhaus();
    const dump = (m: MaterializeResult): string => [...m.volume.cells()].map((c) => `${key3(c.pos)}=${c.state.name}${JSON.stringify(c.state.properties)}`).join('\n');
    expect(dump(build(h, 'timber', 5))).toBe(dump(build(h, 'timber', 5)));
    const facades = new Set<string>();
    const posts = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const rows = view(build(h, 'timber', seed), { z: 0 }, 0, 16, 5, 7);
      facades.add(rows.join('\n'));
      posts.add(rows.map((row) => row.replace(/[^|]/g, ' ')).join('\n'));
    }
    // W4 (27.09.2026, Review S5): das OG (lichte Höhe 3) hat nur Felder unter 3 × 4 – leeres Gefach, seed-unabhängig;
    // die Motivwahl je Seed prüft „Motivwahl“ oben an großen Feldern
    expect(facades.size).toBe(1);
    expect(posts.size).toBe(1);
  });

  it('Fassaden mit symmetrischen Öffnungen sind spiegelsymmetrisch (Nord- und Südfassade des OG, alle Seeds)', () => {
    const h = fachwerkhaus();
    for (let seed = 1; seed <= 6; seed++) {
      const r = build(h, 'timber', seed);
      for (const z of [0, 11]) {
        for (const row of view(r, { z }, 0, 16, 4, 8)) expect(row, `z=${z} seed=${seed}`).toBe([...row].reverse().join(''));
      }
    }
  });
});

// ---------------------------------------------------------------- Eingeschossig, Dach (D12), Bitgleichheit

describe('Eingeschossige Bauteile und Dach', () => {
  it('Beispielhaus: Steinsockel, Schwelle in Reihe 0, Fachwerk 2 hoch, Rähm; Giebel mit Riegel', () => {
    const r = build(beispielhaus());
    const south = view(r, { z: 11 }, 0, 22, 0, 4);
    expect(south[4]).toMatch(/^#+$/); // Fundament
    expect(south[3]!.replace(/[|x]/g, '')).toMatch(/^-+$/); // Schwelle (Ständer an Pfeilern)
    expect(south[0]!.replace(/x/g, '')).toMatch(/^-+$/); // Rähm = Deckenrähm
    expect(south[1]! + south[2]!).toMatch(/\|/);
    expect(south[1]! + south[2]!).toMatch(/\./);
  });

  it('D12: Grat und Kehle des Walmdachs in roof_trim, Form und Ausrichtung wie ohne Muster', () => {
    const h = fachwerkhaus({ roof: 'hip' });
    const a = build(h, 'timber');
    const b = build(h, 'medieval');
    const ctx = shellContext(h.shell, h.roomTypes);
    let trims = 0;
    h.shell.cells.forEach((c, i) => {
      if (c.kind !== 'roof' || c.role !== 'roof_main') return;
      const sa = a.volume.stateAt(c.pos);
      const sb = b.volume.stateAt(c.pos);
      expect(sa.properties, key3(c.pos)).toEqual(sb.properties);
      if (ctx[i]!.roofLine !== undefined) {
        expect(sa.name, key3(c.pos)).toBe('dark_oak_stairs');
        trims++;
      } else expect(sa.name).toBe(sb.name);
    });
    expect(trims).toBeGreaterThan(8);
  });

  it('jede Rolle/Form der Flächen-Regeln von timber löst in beiden Versionen auf (inkl. Holz, Strebe, Gefach)', () => {
    for (const version of VERSIONS) {
      const r = build(fachwerkhaus(), 'timber', 2026, version);
      const names = new Set([...r.volume.cells()].map((c) => c.state.name));
      for (const n of ['dark_oak_log', 'dark_oak_wood', 'calcite']) expect(names.has(n), `${version} ${n}`).toBe(true);
    }
  });
});
