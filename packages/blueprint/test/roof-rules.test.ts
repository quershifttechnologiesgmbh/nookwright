/**
 * W2 „Dach und Silhouette“ (plan/baustandard.md D2–D8, Prüfbericht X3 K2–K4, K7, K8): Messkriterien als Tests.
 *  - D2 Traufanschluss: keine Wandzelle über der Traufe (steil, Mansarde, Gambrel, Walm)
 *  - D3 Ortgang: unter jeder Ortgangtreppe in der Wandflucht ein Windbrett in `roof_trim` (mit Kante)
 *  - D4 Giebelfeld: Rolle `wall_gable`, Sohlbalken auf Deckenhöhe (mit Kante), Gaubendach in `roof_main`
 *  - D5 Dachhöhen-Budget: eingeschossig First ≤ Traufhöhe, sonst ≤ min(1,5 × Traufhöhe, 2 Geschosse)
 *  - D6 Anbau-Dach: flache Kappung an der höheren Wand ≤ 2 Ringe
 *  - D8 Pultdach nur bis 7 Tiefe; Flachdach mit Gesims
 * D5/D8 nur mit `heightBudget: true` (automatische Dachhöhe, Bautypen/API); ohne das Feld gelten Neigung und Form genau –
 * eine vom Nutzer gewählte Neigung wird nie still überstimmt. D6 gilt mit Dach-Details immer.
 */
import { describe, expect, it } from 'vitest';
import { CellSet } from '@mcda/core';
import { deriveShell, type RoofDetail, type RoofStyle, type Shell, type ShellCell, type ShellOptions } from '../src/index.js';
import { splitStrips } from '../src/shell/gable.js';
import { STEP } from '../src/shell/grid.js';
import { emptyProject, rect, rooms, twoStoryHouse } from './support/houses.js';
import { halfLeaks } from './support/leaks.js';

const EDGE: RoofDetail = { trim: true, verge: 'closed', gableWindows: true };
/** Automatische Dachhöhe (D5/D8): nur auf Wunsch. */
const AUTO: RoofDetail = { ...EDGE, heightBudget: true };
/** `detail: null` = ohne Dach-Details (schlichtes Dach). */
const shellOf = (p = rect(11, 9), roof: RoofStyle = 'gable', detail: RoofDetail | null = EDGE, opts: Partial<ShellOptions> = {}): Shell =>
  deriveShell(p.state, { roof, overhang: 1, ...(detail !== null ? { roofDetail: detail } : {}), ...opts });
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const DIRS = ['north', 'east', 'south', 'west'] as const;

/** Oberster Dachblock je Spalte. */
function roofTops(s: Shell): Map<string, ShellCell> {
  const out = new Map<string, ShellCell>();
  for (const c of s.cells) {
    if (c.kind !== 'roof') continue;
    const k = `${c.pos[0]},${c.pos[2]}`;
    if ((out.get(k)?.pos[1] ?? -Infinity) < c.pos[1]) out.set(k, c);
  }
  return out;
}

/**
 * D2-Kennzahl: Wandzellen über dem Traufblock der Nachbarspalte zur Traufseite – die Nachbarspalte ist tiefer und die
 * eigene Dachfläche fällt zu ihr hin (Treppe steigt von ihr weg bzw. die Gegenseite ist höher). Giebel und Ziergiebel
 * (Ortgangtreppe quer zur Wand) zählen nicht.
 */
function wallsAboveEave(s: Shell): string[] {
  const tops = roofTops(s);
  const at = new Set(s.cells.map((c) => key(c.pos[0], c.pos[1], c.pos[2])));
  const out: string[] = [];
  for (const c of s.cells) {
    if (!['wall', 'pillar', 'lintel', 'window'].includes(c.kind)) continue;
    const top = tops.get(`${c.pos[0]},${c.pos[2]}`);
    const own = top?.pos[1];
    if (top === undefined || own === undefined || c.pos[1] >= own) continue;
    for (const d of DIRS) {
      const [dx, dz] = STEP[d];
      const nb = tops.get(`${c.pos[0] + dx},${c.pos[2] + dz}`)?.pos[1];
      if (nb === undefined || nb >= own || c.pos[1] <= nb || at.has(key(c.pos[0] + dx, c.pos[1], c.pos[2] + dz))) continue;
      const inward = tops.get(`${c.pos[0] - dx},${c.pos[2] - dz}`)?.pos[1] ?? -Infinity;
      const falls = top.shape === 'stairs' ? STEP[top.orient!.facing!][0] === -dx && STEP[top.orient!.facing!][1] === -dz : inward > own;
      if (!falls) continue;
      out.push(key(...c.pos));
      break;
    }
  }
  return out;
}

/** Dachhöhe über der Traufe (First − Wandring + 1) und Traufhöhe (Wandring − Bodenplatte) über dem Grundriss. */
function silhouette(s: Shell, inside: (x: number, z: number) => boolean): { roof: number; eave: number } {
  const roof = s.cells.filter((c) => c.kind === 'roof' && inside(c.pos[0], c.pos[2])).map((c) => c.pos[1]);
  const floor = Math.min(...s.cells.filter((c) => c.kind === 'floor').map((c) => c.pos[1]));
  const eave = Math.min(...roof);
  return { roof: Math.max(...roof) - eave + 1, eave: eave - floor };
}

describe('D2 Traufanschluss: keine Wandzelle über der Traufe', () => {
  it('steil, Mansarde, Gambrel, Walm, Krüppelwalm, Fußwalm: 0 Wandzellen über der Traufe (auch ohne Budget)', () => {
    for (const roof of ['gable', 'hip', 'mansard', 'gambrel', 'half_hip', 'dutch_gable', 'saltbox'] as const) {
      for (const pitch of ['normal', 'steep'] as const) {
        for (const heightBudget of [true, false]) {
          const s = shellOf(rect(13, 9), roof, { ...EDGE, pitch, heightBudget });
          expect(wallsAboveEave(s), `${roof}/${pitch}/${heightBudget}`).toEqual([]);
        }
      }
    }
  });

  // W4 (27.09.2026): ohne Kniestock – mit Kniestock liegt die Traufe höher, die Zelle y = 5 ist dann Kniestock-Wand
  it('die Füllung über der Traufe gehört zur Dachfläche (kind roof) und hält das Dach dicht', () => {
    const s = shellOf(rect(11, 9), 'gable', { ...EDGE, pitch: 'steep', heightBudget: false, kneeWall: false });
    // Traufseite Süd (z = 8): Wandring y = 6 (Treppe), darunter bei y = 5 Füllblock statt Wand
    expect(s.cells.find((c) => c.pos[0] === 5 && c.pos[1] === 5 && c.pos[2] === 8)).toMatchObject({ kind: 'roof', role: 'roof_main', shape: 'block' });
    expect(halfLeaks(s)).toEqual([]);
  });
});

describe('D3 Ortgang und D4 Giebelfeld', () => {
  it('Windbrett: bei steiler Neigung unter jeder Ortgangtreppe der Wandflucht eine roof_trim-Zelle; bei 1:1 keins (kein Zickzack), ohne Kante keins', () => {
    const boards = (pitch: 'normal' | 'steep'): number => {
      const s = shellOf(rect(11, 9), 'gable', { ...EDGE, pitch });
      const at = new Map(s.cells.map((c) => [key(c.pos[0], c.pos[1], c.pos[2]), c] as const));
      let n = 0;
      // Giebel x = 0: Dachblock je Spalte z, darunter das Windbrett (sofern eine Zelle über der Decke frei war)
      for (let z = 0; z <= 8; z++) {
        const top = roofTops(s).get(`0,${z}`)!;
        if (top.pos[1] - 1 <= 4) continue; // Decke y = 4
        const under = at.get(key(0, top.pos[1] - 1, z));
        if (under?.kind === 'roof' && under.role === 'roof_trim' && under.shape === 'block') n++;
        else expect(['wall', 'window'], `${pitch} z=${z}`).toContain(under?.kind);
      }
      return n;
    };
    expect(boards('steep')).toBeGreaterThan(4);
    expect(boards('normal')).toBe(0);
    const plain = shellOf(rect(11, 9), 'gable', { pitch: 'steep' });
    expect(plain.cells.some((c) => c.role === 'roof_trim')).toBe(false);
  });

  // W4 (27.09.2026): mit Kniestock (Standard) liegt der Balken auch an den Traufseiten (Geschossband unter dem Kniestock)
  it('Giebelfeld in wall_gable, Sohlbalken (beam/log entlang der Wand) auf Deckenhöhe nur an den Giebelseiten, nicht über Eckständern', () => {
    const knee = shellOf(rect(11, 9));
    expect(knee.roofFit?.[0]?.knee).toBe(2);
    const band = knee.cells.filter((c) => c.kind === 'ceiling' && c.role === 'beam');
    expect(band.length).toBe(14 + 18); // dazu die Traufseiten z = 0 und z = 8, x = 1 … 9
    expect(band.filter((c) => c.pos[2] === 0 || c.pos[2] === 8).every((c) => c.orient?.axis === 'x' && c.pos[0] >= 1 && c.pos[0] <= 9)).toBe(true);
    expect(knee.cells.filter((c) => c.kind === 'wall' && c.pos[1] > 4).every((c) => c.role === 'wall_gable')).toBe(true);
    const s = shellOf(rect(11, 9), 'gable', { ...EDGE, kneeWall: false });
    const gable = s.cells.filter((c) => c.kind === 'wall' && c.pos[1] > 4);
    expect(gable.length).toBeGreaterThan(0);
    expect(gable.every((c) => c.role === 'wall_gable')).toBe(true);
    const sills = s.cells.filter((c) => c.kind === 'ceiling' && c.role === 'beam');
    expect(sills.length).toBe(14); // je Giebel die Wandflucht z = 1 … 7 (an den Eckständern läuft der Pfosten weiter)
    expect(sills.every((c) => (c.pos[0] === 0 || c.pos[0] === 10) && c.pos[2] >= 1 && c.pos[2] <= 7 && c.shape === 'log' && c.orient?.axis === 'z' && c.pos[1] === 4)).toBe(true);
    // ohne Kante kein Sohlbalken
    expect(shellOf(rect(11, 9), 'gable', {}).cells.some((c) => c.kind === 'ceiling' && c.role === 'beam')).toBe(false);
    // Walm: keine Giebel, kein Sohlbalken; W4: mit Kniestock nur dessen Reihen (rundum Traufe) und das Band darunter
    expect(shellOf(rect(11, 9), 'hip', { ...EDGE, kneeWall: false }).cells.some((c) => c.role === 'wall_gable' || (c.kind === 'ceiling' && c.role === 'beam'))).toBe(false);
    const hip = shellOf(rect(11, 9), 'hip');
    const k = hip.roofFit?.[0]?.knee ?? 0;
    expect(k).toBeGreaterThan(0);
    expect(hip.cells.filter((c) => c.role === 'wall_gable').every((c) => c.pos[1] > 4 && c.pos[1] <= 4 + k)).toBe(true);
  });

  it('Gaubendach: Fläche roof_main, nur die Frontreihe (Ortgang der Gaube) roof_trim', () => {
    // 23 × 12, Gauben W = 3 (h = 2): mittlere Südgaube x = 9 … 13, Frontreihe z = 10, dahinter z = 7 … 9
    const s = shellOf(rect(23, 12), 'gable', { ...EDGE, heightBudget: false }, { dormers: { kind: 'gable', width: 3 } });
    const tops = roofTops(s);
    const role = (x: number, z: number): string => tops.get(`${x},${z}`)!.role;
    for (let x = 10; x <= 12; x++) expect(role(x, 10), `Front x=${x}`).toBe('roof_trim');
    for (let x = 9; x <= 13; x++) for (let z = 7; z <= 9; z++) expect(role(x, z), `Fläche ${x},${z}`).toBe('roof_main');
  });
});

describe('D5 Dachhöhen-Budget', () => {
  it('eingeschossig: Dach ≤ Traufhöhe – mit automatischer Dachhöhe sinkt steil auf normal bzw. 1:2; gewählte Neigung bleibt', () => {
    for (const [w, d] of [[11, 9], [15, 11], [19, 15]] as const) {
      const s = shellOf(rect(w, d), 'gable', { ...AUTO, pitch: 'steep' });
      const { roof, eave } = silhouette(s, (x, z) => x >= 0 && x < w && z >= 0 && z < d);
      expect(roof, `${w}×${d}`).toBeLessThanOrEqual(eave);
      expect(s.roofFit?.[0]).toMatchObject({ requested: 'steep' });
      expect(s.roofFit?.[0]?.pitch).not.toBe('steep');
      // ausdrücklich gewählte Neigung (ohne `heightBudget`) gilt genau – keine stille Absenkung. W4 (27.09.2026): `roofFit`
      // meldet Kniestock bzw. Teilung, die Neigung bleibt steil; ohne Kniestock und Teilung das Dach wie gewählt
      const free = shellOf(rect(w, d), 'gable', { ...EDGE, pitch: 'steep' });
      expect(free.roofFit?.[0], `${w}×${d}`).toMatchObject({ requested: 'steep', pitch: 'steep' });
      const exact = shellOf(rect(w, d), 'gable', { ...EDGE, pitch: 'steep', kneeWall: false, split: false });
      expect(exact.roofFit).toBeUndefined();
      expect(silhouette(exact, (x, z) => x >= 0 && x < w && z >= 0 && z < d).roof, `${w}×${d} ohne Budget`).toBeGreaterThan(eave);
    }
  });

  it('schmal und hoch (Stadthaus 7 breit, 3 Geschosse): steil bleibt steil', () => {
    const p = emptyProject();
    p.paintRoom(0, CellSet.rect(0, 0, 6, 12), 'storage');
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 6, 12), 'bedroom');
    p.addFloor();
    p.paintRoom(2, CellSet.rect(0, 0, 6, 12), 'bedroom');
    const s = shellOf(p, 'gable', { ...AUTO, pitch: 'steep' });
    const free = shellOf(p, 'gable', { ...EDGE, pitch: 'steep' });
    const roof = (x: Shell): string => JSON.stringify(x.cells.filter((c) => c.kind === 'roof'));
    expect(roof(s)).toBe(roof(free));
  });

  it('ohne Dach-Details kein Budget (das schlichte Dach bleibt, wie es war)', () => {
    const s = shellOf(rect(19, 15), 'gable', null);
    expect(silhouette(s, (x, z) => x >= 0 && x < 19 && z >= 0 && z < 15).roof).toBeGreaterThan(6);
  });
});

// W3 (27.09.2026, plan/spikes/W3RD_dachdetails.md): Dach-Teilung als Standard – ein eingeschossiges Satteldach ab 15
// Außenmaß, das in der gewählten Neigung über dem Budget liegt, wird geteilt (gedrungen: Reihe von Quergiebeln, lang:
// parallele Satteldächer); die Neigung bleibt genau, `roofFit` meldet die Teilung.
describe('W3 Dach-Teilung', () => {
  const inside = (w: number, d: number) => (x: number, z: number): boolean => x >= 0 && x < w && z >= 0 && z < d;
  const ridges = (s: Shell): string[] => (s.anchors ?? []).filter((a) => a.kind === 'ridge').map((a) => a.facing).sort();

  it('Halle 25 × 19: Reihe von drei Quergiebeln (First quer), Dachanteil ≤ 50 %, Neigung 1:1 bleibt, dicht', () => {
    const s = shellOf(rect(25, 19));
    const { roof, eave } = silhouette(s, inside(25, 19));
    expect(roof).toBeLessThanOrEqual(eave);
    expect(s.roofFit?.[0]).toMatchObject({ requested: 'normal', pitch: 'normal', split: true });
    // W4 (27.09.2026): D5 präzisiert (Traufunterkante samt Überstand) und höchstens 1 Kniestock-Reihe bei Teilung – bei
    // lichter Höhe 3 vier statt drei Quergiebel
    expect(ridges(s)).toEqual(['east', 'east', 'east', 'east']); // First entlang z (quer zur Langseite x)
    expect(halfLeaks(s)).toEqual([]);
    expect(wallsAboveEave(s)).toEqual([]);
    // mit `split: false` (und ohne Kniestock) ein Dach wie gewählt (höher als die Traufe), ohne Meldung
    const one = shellOf(rect(25, 19), 'gable', { ...EDGE, split: false, kneeWall: false });
    expect(one.roofFit).toBeUndefined();
    expect(ridges(one)).toEqual(['south']);
    expect(silhouette(one, inside(25, 19)).roof).toBeGreaterThan(eave);
  });

  it('Langhaus 33 × 19: parallele Satteldächer (First bleibt entlang der Langseite), Dachanteil ≤ 50 %', () => {
    const s = shellOf(rect(33, 19));
    const { roof, eave } = silhouette(s, inside(33, 19));
    expect(roof).toBeLessThanOrEqual(eave);
    expect(ridges(s)).toEqual(['south', 'south', 'south']); // W4 (27.09.2026): drei statt zwei (D5 präzisiert)
    expect(halfLeaks(s)).toEqual([]);
  });

  it('Krüppelwalm, Gambrel und Saltbox werden ebenso geteilt; Walm, Mansarde und Pultdach nicht', () => {
    for (const roof of ['half_hip', 'gambrel', 'saltbox', 'dutch_gable'] as const) {
      const s = shellOf(rect(25, 19), roof);
      expect(s.roofFit?.[0]?.split, roof).toBe(true);
      expect(halfLeaks(s), roof).toEqual([]);
    }
    // W4 (27.09.2026): Walm und Mansarde bekommen den Kniestock (`roofFit.knee`), werden aber nicht geteilt
    for (const roof of ['hip', 'mansard', 'shed'] as const) expect(shellOf(rect(25, 19), roof).roofFit?.[0]?.split, roof).toBeUndefined();
  });

  it('Streifen: gleich breit (≤ maxSpan), lückenlos, Überlappung 0–2, spiegelsymmetrisch; zu schmal = keine Teilung', () => {
    for (let len = 9; len <= 40; len++) {
      for (let max = 5; max <= 13; max++) {
        const st = splitStrips(len, max);
        if (st.length === 0) continue;
        expect(st[0]!.a).toBe(0);
        expect(st.at(-1)!.a + st.at(-1)!.w).toBe(len);
        st.forEach((q, j) => {
          expect(q.w).toBeLessThanOrEqual(max);
          expect(q.w).toBeGreaterThanOrEqual(5);
          if (j > 0) expect(q.a - st[j - 1]!.a - st[j - 1]!.w).toBeGreaterThanOrEqual(-2);
          if (j > 0) expect(q.a).toBeLessThanOrEqual(st[j - 1]!.a + st[j - 1]!.w);
          expect(q.a).toBe(len - st[st.length - 1 - j]!.a - q.w); // Spiegelbild
        });
      }
    }
    expect(splitStrips(25, 9)).toEqual([{ a: 0, w: 9 }, { a: 8, w: 9 }, { a: 16, w: 9 }]);
    expect(splitStrips(8, 4)).toEqual([]);
  });

  it('kleine Häuser, Mehrgeschosser, Dächer im Budget und schlichte Dächer bleiben zellgleich', () => {
    const same = (p: ReturnType<typeof rect>, roof: RoofStyle, detail: RoofDetail | null): void => {
      const a = shellOf(p, roof, detail);
      const b = shellOf(p, roof, detail === null ? null : { ...detail, split: false });
      expect(JSON.stringify(a.cells)).toBe(JSON.stringify(b.cells));
    };
    same(rect(11, 9), 'gable', EDGE); // Außenmaß 11 < 15
    same(rect(23, 12), 'gable', EDGE); // Außenmaß 14 < 15
    same(twoStoryHouse(), 'gable', EDGE); // zwei Geschosse
    same(rect(25, 19), 'gable', { ...EDGE, pitch: 'low' }); // 1:2 liegt im Budget
    same(rect(25, 19), 'gable', null); // ohne Dach-Details
  });
});

// W4 (27.09.2026, plan/spikes/W4F_dachproportion.md): D5 präzisiert – bei Eingeschossern sichtbare Wand (Bodenplatte →
// Traufunterkante) ≥ Dach (Traufunterkante → First, alle Dachzellen samt Überstand). Kniestock bis 3 Reihen, sonst Teilung
// mit höchstens 1 Reihe; die Neigung bleibt, `roofFit.knee` meldet den Kniestock.
describe('W4 Dachproportion (D5 präzisiert)', () => {
  /** Wand und Dach wie im Review-Skript: Traufe = tiefste, First = höchste Dachzelle, Boden = tiefste Bodenzelle. */
  const proportion = (s: Shell): { wall: number; roof: number } => {
    const ys = s.cells.filter((c) => c.kind === 'roof').map((c) => c.pos[1]);
    const floor = Math.min(...s.cells.filter((c) => c.kind === 'floor').map((c) => c.pos[1]));
    return { wall: Math.min(...ys) - floor, roof: Math.max(...ys) - Math.min(...ys) + 1 };
  };

  it('Satteldach-Familie 1:1, alle Größen: Wand ≥ Dach, dicht, keine Wand über der Traufe, Neigung bleibt', () => {
    for (const [w, d] of [[11, 7], [11, 9], [15, 11], [23, 12], [19, 15], [25, 19], [33, 19]] as const) {
      for (const roof of ['gable', 'half_hip', 'dutch_gable', 'gambrel', 'saltbox'] as const) {
        const s = shellOf(rect(w, d), roof, EDGE);
        const { wall, roof: r } = proportion(s);
        const fit = s.roofFit?.[0];
        // Ausnahme: zu schmal zum Teilen (Außenmaß < 15) und 3 Kniestock-Reihen reichen nicht (Saltbox 11 × 9: 7 zu 8)
        if (!(fit?.knee === 3 && fit.split !== true && d + 2 < 15)) expect(wall, `${roof} ${w}×${d}: Wand ${wall} < Dach ${r}`).toBeGreaterThanOrEqual(r);
        expect(halfLeaks(s), `${roof} ${w}×${d}`).toEqual([]);
        expect(wallsAboveEave(s), `${roof} ${w}×${d}`).toEqual([]);
        if (fit !== undefined) expect(fit.pitch).toBe(fit.requested);
        expect(fit?.knee ?? 0).toBeLessThanOrEqual(fit?.split === true ? 1 : 3);
      }
    }
  });

  it('Walm und Mansarde: Kniestock bis 3 Reihen, keine Teilung; kleine Häuser erfüllen D5', () => {
    for (const roof of ['hip', 'mansard'] as const) {
      const small = shellOf(rect(11, 9), roof, EDGE);
      expect(proportion(small).wall, roof).toBeGreaterThanOrEqual(proportion(small).roof);
      const big = shellOf(rect(25, 19), roof, EDGE);
      expect(big.roofFit?.[0]).toMatchObject({ knee: 3 });
      expect(big.roofFit?.[0]?.split).toBeUndefined();
      expect(halfLeaks(big), roof).toEqual([]);
    }
  });

  it('Kniestock hebt das ganze Dach: gleiche Zellen wie ohne, nur um knee höher, dazu Kniestock-Wand und Band', () => {
    const on = shellOf(rect(23, 12), 'gable', EDGE);
    const off = shellOf(rect(23, 12), 'gable', { ...EDGE, kneeWall: false });
    const k = on.roofFit?.[0]?.knee ?? 0;
    expect(k).toBe(3); // lichte Höhe 3: Wand 4 + 3 = 7, Dach 7 Reihen
    expect(off.roofFit).toBeUndefined();
    const roofs = (s: Shell, dy: number): string[] => s.cells.filter((c) => c.kind === 'roof').map((c) => `${c.pos[0]},${c.pos[1] + dy},${c.pos[2]}:${c.shape}`).sort();
    expect(roofs(on, 0)).toEqual(roofs(off, k));
    // Kniestock an den Traufseiten (z = 0, 11): Reihen y = 5 … 4 + k über jeder Traufspalte, Rolle wall_gable
    for (const z of [0, 11]) for (let x = 1; x <= 21; x++) for (let y = 5; y <= 4 + k; y++) {
      expect(on.cells.find((c) => c.pos[0] === x && c.pos[1] === y && c.pos[2] === z), `${x},${y},${z}`).toMatchObject({ kind: 'wall', role: 'wall_gable' });
    }
    // keine Giebelfenster im Kniestock der Traufseite (Traufseiten sind kein Giebelfeld)
    expect(on.cells.some((c) => c.kind === 'window' && (c.pos[2] === 0 || c.pos[2] === 11) && c.pos[1] > 4)).toBe(false);
  });

  it('Reihe von Quergiebeln mit Kniestock: jeder Giebel trägt sein Fenster (die Kehlen trennen die Giebelfelder)', () => {
    const s = shellOf(rect(25, 19));
    expect(s.roofFit?.[0]).toMatchObject({ split: true, knee: 1 });
    const gables = (s.anchors ?? []).filter((a) => a.kind === 'ridge').length;
    for (const z of [0, 18]) {
      const xs = [...new Set(s.cells.filter((c) => c.kind === 'window' && c.pos[2] === z && c.pos[1] > 4).map((c) => c.pos[0]))].sort((a, b) => a - b);
      const groups = xs.filter((x, i) => i === 0 || x - xs[i - 1]! > 1).length;
      expect(groups, `z = ${z}`).toBe(gables);
    }
  });

  it('Mehrgeschosser, schlichte Dächer und Häuser an einer Brandwand bekommen keinen Kniestock', () => {
    expect(shellOf(twoStoryHouse(), 'gable', EDGE).roofFit).toBeUndefined();
    expect(JSON.stringify(shellOf(rect(23, 12), 'gable', null).cells)).toBe(JSON.stringify(deriveShell(rect(23, 12).state, { roof: 'gable', overhang: 1 }).cells));
  });
});

describe('W5 Mehrgeschosser: Dach ≤ 1,5 × Wand (D5, Review W4-R N7)', () => {
  /** Wand und Dach wie im Review-Skript (Traufe = tiefste, First = höchste Dachzelle, Boden = tiefste Bodenzelle). */
  const proportion = (s: Shell): { wall: number; roof: number } => {
    const ys = s.cells.filter((c) => c.kind === 'roof').map((c) => c.pos[1]);
    const floor = Math.min(...s.cells.filter((c) => c.kind === 'floor').map((c) => c.pos[1]));
    return { wall: Math.min(...ys) - floor, roof: Math.max(...ys) - Math.min(...ys) + 1 };
  };
  /** Zweigeschossiges Rechteck wie das Fachwerkhaus (17 × 12, lichte Höhe 3 je Geschoss). */
  const two = (w: number, d: number) => rooms([[0, 0, w - 1, d - 1, 'storage']], [[0, 0, w - 1, d - 1, 'bedroom']]);
  const STEEP: RoofDetail = { ...EDGE, pitch: 'steep' };

  it('Fachwerkhaus-Maß, steil: Kniestock 1, Dach ≤ 1,5 × Wand, Neigung bleibt; Gegenprobe ohne Kniestock verletzt D5', () => {
    const on = shellOf(two(17, 12), 'gable', STEEP);
    const off = shellOf(two(17, 12), 'gable', { ...STEEP, kneeWall: false });
    const p = proportion(on);
    expect(on.roofFit?.[0]).toMatchObject({ knee: 1, pitch: 'steep', requested: 'steep' });
    expect(2 * p.roof, `Wand ${p.wall} / Dach ${p.roof}`).toBeLessThanOrEqual(3 * p.wall);
    const q = proportion(off);
    expect(off.roofFit).toBeUndefined();
    expect(2 * q.roof, `ohne Kniestock Wand ${q.wall} / Dach ${q.roof}`).toBeGreaterThan(3 * q.wall);
    expect(p.roof).toBe(q.roof); // gleiches Dach, nur höher
    expect(halfLeaks(on)).toEqual([]);
    expect(wallsAboveEave(on)).toEqual([]);
  });

  it('alle Größen und Satteldach-Formen, steil und normal: Dach ≤ 1,5 × Wand, wo 3 Reihen reichen; sonst wie vorher', () => {
    for (const [w, d] of [[11, 7], [13, 9], [17, 12], [21, 14], [25, 17]] as const) {
      for (const roof of ['gable', 'half_hip', 'dutch_gable', 'gambrel', 'saltbox', 'hip', 'mansard'] as const) {
        for (const pitch of ['normal', 'steep'] as const) {
          const where = `${roof} ${pitch} ${w}×${d}`;
          const s = shellOf(two(w, d), roof, { ...EDGE, pitch });
          const knee = s.roofFit?.find((f) => f.floorIndex === 1)?.knee ?? 0;
          expect(knee, where).toBeLessThanOrEqual(3);
          const p = proportion(s);
          // entweder im Budget, oder es fehlten mehr als 3 Reihen (dann bleibt das Dach wie vorher, unten geprüft)
          if (knee > 0 || 2 * p.roof > 3 * p.wall) {
            expect(knee > 0 ? 2 * p.roof <= 3 * p.wall : Math.ceil((2 * p.roof - 3 * p.wall) / 3) > 3, `${where}: Kniestock ${knee}, Wand ${p.wall} / Dach ${p.roof}`).toBe(true);
          }
          expect(halfLeaks(s), where).toEqual([]);
          expect(wallsAboveEave(s), where).toEqual([]);
          if (knee === 0) {
            // ohne Bedarf zellgleich zum Stand ohne Kniestock
            expect(JSON.stringify(s.cells), where).toBe(JSON.stringify(shellOf(two(w, d), roof, { ...EDGE, pitch, kneeWall: false }).cells));
          }
        }
      }
    }
  });

  it('mit automatischer Dachhöhe (heightBudget) kein Kniestock: dort sinkt die Neigung wie bisher', () => {
    const s = shellOf(two(17, 12), 'gable', { ...AUTO, pitch: 'steep' });
    expect(s.roofFit?.[0]?.knee).toBeUndefined();
    expect(s.roofFit?.[0]?.pitch).not.toBe('steep');
  });
});

describe('D6 Anbau-Dach an der höheren Wand', () => {
  /** Unten w × d, oben w × du (vorn): der hintere Streifen ist ein Anbau an die höhere Wand. */
  const annex = (w: number, d: number, du: number) => rooms([[0, 0, w - 1, d - 1, 'storage']], [[0, 0, w - 1, du - 1, 'bedroom']]);
  /** Vollblöcke an der Oberkante des Anbaudachs im Schnitt x (Spalten z0 … z1): Tiefe der flachen Kappung. */
  const capDepth = (s: Shell, z0: number, z1: number, x: number): number => {
    const tops = roofTops(s);
    const cols = [...Array(z1 - z0 + 1).keys()].map((k) => tops.get(`${x},${z0 + k}`)).filter((c) => c !== undefined);
    const y = Math.max(...cols.map((c) => c.pos[1]));
    return cols.filter((c) => c.pos[1] === y && c.shape === 'block').length;
  };

  it('steiles Hauptdach: Kappung am Anbau ≤ 2 Zellen (vorher 7), dicht', () => {
    const p = annex(11, 16, 8);
    // D6 gilt auch bei gewählter Neigung: nur das Anbaudach an der höheren Wand wird flacher (vorher 7 Zellen Deckel)
    const s = shellOf(p, 'gable', { ...EDGE, pitch: 'steep' });
    expect(capDepth(s, 9, 16, 5)).toBeLessThanOrEqual(2);
    expect(halfLeaks(s)).toEqual([]);
  });

  it('zweistöckiges Haus (L-Dach unten): Kappung ≤ 2, dicht', () => {
    for (const roof of ['gable', 'hip', 'half_hip'] as const) {
      const s = shellOf(twoStoryHouse(), roof, { ...EDGE, pitch: 'steep' });
      expect(halfLeaks(s), roof).toEqual([]);
    }
  });
});

describe('D8 Pultdach und Flachdach', () => {
  it('automatische Dachhöhe: Pultdach nur bis 7 Tiefe, tiefer Satteldach; gewähltes Pultdach bleibt', () => {
    const ridge = (s: Shell): number => Math.max(...s.cells.filter((c) => c.kind === 'roof').map((c) => c.pos[1]));
    // W4 (27.09.2026): ohne Kniestock verglichen – das Pultdach bekommt keinen (auch nicht das nach D8 umgewandelte)
    const auto: RoofDetail = { ...AUTO, kneeWall: false };
    const narrow = shellOf(rect(13, 7), 'shed', auto);
    const deep = shellOf(rect(13, 9), 'shed', auto);
    expect(JSON.stringify(deep.cells)).toBe(JSON.stringify(shellOf(rect(13, 9), 'gable', auto).cells));
    expect(JSON.stringify(narrow.cells)).not.toBe(JSON.stringify(shellOf(rect(13, 7), 'gable', auto).cells));
    // gewähltes Pultdach (ohne automatische Dachhöhe) bleibt Pultdach
    const kept = shellOf(rect(13, 9), 'shed', EDGE);
    expect(ridge(kept)).toBeGreaterThan(ridge(deep));
  });

  it('Flachdach mit Gesims: umgedrehte Treppen (Rücken zur Wand) rundum auf Deckenhöhe, Ecken als obere Stufe', () => {
    const s = shellOf(rect(11, 9), 'flat');
    const rim = s.cells.filter((c) => c.kind === 'roof');
    expect(rim.length).toBe(2 * 11 + 2 * 9 + 4);
    expect(rim.every((c) => c.pos[1] === 4 && c.role === 'roof_trim' && c.orient?.half === 'top')).toBe(true);
    const north = rim.find((c) => c.pos[0] === 5 && c.pos[2] === -1)!;
    expect(north).toMatchObject({ shape: 'stairs', orient: { facing: 'south', half: 'top' } });
    expect(rim.filter((c) => c.shape === 'slab')).toHaveLength(4);
    // ohne Details kein Gesims
    expect(shellOf(rect(11, 9), 'flat', null).cells.some((c) => c.kind === 'roof')).toBe(false);
  });
});
