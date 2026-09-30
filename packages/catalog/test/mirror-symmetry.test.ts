/**
 * W8-I (2026-09-27): Katalogweite statische Prüfung der Windrad-Regel (HANDOFF §1: keine hakenkreuzähnlichen Formen;
 * 4-fach drehsymmetrische Anordnungen müssen spiegelsymmetrisch sein).
 *
 * Anlass: `table/tavern_table` legte seine vier Hocker-Sockets mit Drehsinn an (n (0,−1), s (1,2), w (−1,1), e (2,0));
 * mit allen vier Hockern ergab das genau das Tetromino-Windrad (plan/spikes/W8G_windrad_waechter.md §7). Der
 * Welt-Wächter (W8-G) entfernt so etwas nur nachträglich – der Katalog selbst darf keine chiralen Anordnungen enthalten.
 *
 * Geprüft wird jede Form jeder Komponente (`catalog/components/**`: Möbel, Deko, Außen-Module; Basis und jede
 * Variante) als Belegungsmuster aus **Blöcken + Andockpunkten** (eine Kind-Zelle je Socket an `at`, jeder Socket-Typ):
 *
 *  - **Regel A (Windrad)** – für jede zulässige Socket-Auswahl (Pflicht-Sockets immer, optionale beliebig,
 *    `pairWith`-Paare gemeinsam): kein Muster darf um 90° drehsymmetrisch sein, ohne an einer der vier Achsen
 *    spiegelsymmetrisch zu sein (`C4`). Ansichten: jede Schicht (y) als Binärmaske, mit Marken (Material ohne
 *    Ausrichtung bzw. Socket-Art) und je Marke; Draufsicht, Front und Seite als Binärmaske und je Marke. Dazu
 *    Teilfenster 3 … 15 je Schicht und in der Draufsicht mit `findPinwheels` aus `@mcda/core` (`window`: exakt chirale
 *    4-zählige Teilfigur in einem größeren Muster).
 *  - **Regel B (Sitzgruppe)** – gleichartige Boden-Andockpunkte (`adjacent` mit gleichem `accepts`: Hocker um einen
 *    Tisch, Stühle vor dem Altar, Nachttisch-Paar) bilden mit dem Grundriss eine Gruppe, und die muss eine Spiegelachse
 *    haben (`seats`) – alle Sockets der Art und ebenso nur die Pflicht-Sockets der Art (ab zwei). Eine chirale
 *    2-zählige Sitzgruppe (S-Figur) oder drei Arme eines Windrads sind für sich kein Hakenkreuz, aber dessen halbe
 *    Anlage: beim alten Tavernentisch waren die zwei Pflicht-Hocker eine S-Figur und alle vier das Windrad, der alte
 *    Spieltisch hatte drei der vier Arme. Zufällig fehlende Kinder (Kirchenbank mit Lücke, S-Figur als Teilmenge) sind
 *    Rauschen, kein Entwurf – sie prüft nur Regel A.
 *
 * Drehungen ändern die Symmetrieklasse nicht (Konjugation); `findingsOf(def, [0, 1, 2, 3])` prüft sie auf Wunsch mit,
 * die Gegenprobe unten belegt die Gleichheit.
 *
 * Grenzen: Kind-Komponenten zählen als eine Zelle am Andockpunkt (die Kinder sind 1 × 1: Hocker, Kerzen, Krüge …),
 * Blockausrichtungen (Treppen-Blickrichtung) zählen nicht zur Marke.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPinwheels } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { parseComponentDef, type ComponentDef, type MaterialSpec, type SocketDef } from '../src/index.js';

const CATALOG_DIR = fileURLToPath(new URL('../../../catalog/components', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json5') ? [p] : [];
    });
}

type P3 = readonly [number, number, number];
interface Cell3 {
  readonly at: P3;
  readonly label: string;
}
interface Form {
  readonly name: string;
  readonly cells: readonly Cell3[];
  readonly size: P3;
  readonly sockets: readonly SocketDef[];
}
interface Content {
  readonly layers?: readonly (readonly string[])[] | undefined;
  readonly legend?: Readonly<Record<string, MaterialSpec>> | undefined;
  readonly cells?: ReadonlyArray<{ readonly at: readonly number[]; readonly mat: MaterialSpec }> | undefined;
}

const matLabel = (m: MaterialSpec): string => (m.block !== undefined ? m.block : `${m.role}/${m.shape}`);
const socketLabel = (s: SocketDef): string => `socket:${[...s.accepts].sort().join('|')}`;

/** Formen wie `expandComponent` (@mcda/furnishing): Inhalt aus der Variante, sonst aus der Basis; Sockets ebenso. */
function formsOf(def: ComponentDef): Form[] {
  const forms: Form[] = [];
  const build = (name: string, src: Content, sockets: readonly SocketDef[]): void => {
    const cells: Cell3[] = [];
    if (src.layers !== undefined) {
      src.layers.forEach((layer, y) =>
        layer.forEach((row, z) =>
          [...row].forEach((ch, x) => {
            if (ch === '.' || ch === '_') return;
            const m = src.legend?.[ch];
            cells.push({ at: [x, y, z], label: m === undefined ? ch : matLabel(m) });
          }),
        ),
      );
    } else if (src.cells !== undefined) {
      for (const c of src.cells) cells.push({ at: [c.at[0]!, c.at[1]!, c.at[2]!], label: matLabel(c.mat) });
    }
    const size: P3 = [Math.max(0, ...cells.map((c) => c.at[0])) + 1, Math.max(0, ...cells.map((c) => c.at[1])) + 1, Math.max(0, ...cells.map((c) => c.at[2])) + 1];
    forms.push({ name, cells, size, sockets });
  };
  if (def.layers !== undefined || def.cells !== undefined) build('(basis)', def, def.sockets ?? []);
  for (const v of def.variants ?? []) {
    const src: Content = v.layers !== undefined || v.cells !== undefined ? v : def;
    if (src.layers === undefined && src.cells === undefined) continue;
    build(v.id, src, v.sockets ?? def.sockets ?? []);
  }
  return forms;
}

/** Zulässige Socket-Auswahlen: Pflicht immer, optionale beliebig, `pairWith`-Paare gemeinsam (höchstens 2^12). */
function socketSelections(sockets: readonly SocketDef[]): SocketDef[][] {
  const withAt = sockets.filter((s) => s.at !== undefined);
  const required = withAt.filter((s) => s.required === true);
  const groups: SocketDef[][] = [];
  const done = new Set<string>();
  for (const s of withAt) {
    if (s.required === true || done.has(s.id)) continue;
    const partner = withAt.find((o) => o !== s && o.required !== true && !done.has(o.id) && (s.pairWith === o.id || o.pairWith === s.id));
    const g = partner === undefined ? [s] : [s, partner];
    for (const x of g) done.add(x.id);
    groups.push(g);
  }
  if (groups.length > 12) return [required, withAt];
  return Array.from({ length: 1 << groups.length }, (_, mask) => [...required, ...groups.flatMap((g, i) => ((mask >> i) & 1 ? g : []))]);
}

type Grid = Map<string, string>; // "u,v" → Marke
const key = (u: number, v: number): string => `${u},${v}`;

/** Symmetrie eines (markierten) 2D-Musters um die Mitte seiner Hülle: Spiegelachse, 90°- und 180°-Drehung. */
function symmetry(grid: Grid): { readonly mirror: boolean; readonly c4: boolean; readonly c2: boolean } {
  const pts = [...grid.keys()].map((k) => k.split(',').map(Number) as [number, number]);
  const u0 = Math.min(...pts.map((p) => p[0]));
  const v0 = Math.min(...pts.map((p) => p[1]));
  const W = Math.max(...pts.map((p) => p[0])) - u0 + 1;
  const H = Math.max(...pts.map((p) => p[1])) - v0 + 1;
  const inv = (f: (u: number, v: number) => readonly [number, number]): boolean =>
    pts.every(([u, v]) => {
      const [a, b] = f(u - u0, v - v0);
      return grid.get(key(a + u0, b + v0)) === grid.get(key(u, v));
    });
  const mirror =
    inv((u, v) => [W - 1 - u, v]) || inv((u, v) => [u, H - 1 - v]) || (W === H && (inv((u, v) => [v, u]) || inv((u, v) => [W - 1 - v, W - 1 - u])));
  return { mirror, c4: W === H && inv((u, v) => [v, W - 1 - u]), c2: inv((u, v) => [W - 1 - u, H - 1 - v]) };
}

/** Drehung um q Vierteldrehungen in der Draufsicht (Box `size`); Sockets dürfen außerhalb der Box liegen. */
function rotate(p: P3, size: P3, q: number): P3 {
  let [x, , z] = p;
  let w = size[0];
  let d = size[2];
  for (let i = 0; i < q; i++) {
    [x, z] = [d - 1 - z, x];
    [w, d] = [d, w];
  }
  return [x, p[1], z];
}

interface Finding {
  readonly id: string;
  readonly form: string;
  readonly rot: number;
  readonly sockets: string;
  readonly view: string;
  readonly kind: 'C4' | 'window' | 'seats';
}

const format = (f: Finding): string => `${f.kind} ${f.id} [${f.form}] Sockets ${f.sockets}: ${f.view}`;

/** Alle Befunde einer Komponente (je Form, Drehung, Auswahl, Ansicht und Art höchstens einer). */
function findingsOf(def: ComponentDef, rotations: readonly number[] = [0]): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const report = (f: Finding): void => {
    const k = `${f.form}|${f.rot}|${f.sockets}|${f.view}|${f.kind}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(f);
    }
  };
  for (const form of formsOf(def)) {
    for (const rot of rotations) {
      const turn = (c: Cell3): Cell3 => ({ at: rotate(c.at, form.size, rot), label: c.label });
      const toCell = (s: SocketDef): Cell3 => ({ at: s.at as unknown as P3, label: socketLabel(s) });

      // Regel B: Sitzgruppen (gleichartige Boden-Andockpunkte) mit Spiegelachse
      const seatKinds = [...new Set(form.sockets.filter((s) => s.type === 'adjacent' && s.at !== undefined).map(socketLabel))];
      for (const kind of seatKinds) {
        const all = form.sockets.filter((s) => s.type === 'adjacent' && s.at !== undefined && socketLabel(s) === kind);
        for (const sel of [all, all.filter((s) => s.required === true)]) {
          if (sel.length < 2) continue;
          const g: Grid = new Map();
          for (const c of [...form.cells, ...sel.map(toCell)].map(turn)) g.set(key(c.at[0], c.at[2]), '#');
          if (!symmetry(g).mirror) report({ id: def.id, form: form.name, rot, sockets: sel.map((s) => s.id).join('+'), view: `Draufsicht Sitzgruppe ${kind}`, kind: 'seats' });
        }
      }

      // Regel A: kein Windrad in irgendeiner Auswahl
      for (const sel of socketSelections(form.sockets)) {
        const cells = [...form.cells, ...sel.map(toCell)].map(turn);
        const sockets = sel.map((s) => s.id).join('+') || '–';
        const labels = [...new Set(cells.map((c) => c.label))];
        const found = (view: string, kind: Finding['kind']): void => report({ id: def.id, form: form.name, rot, sockets, view, kind });
        const check = (view: string, pick: (c: Cell3) => readonly [number, number] | undefined, opts: { labels: boolean; windows: boolean }): void => {
          const bin: Grid = new Map();
          const lab: Grid = new Map();
          for (const c of cells) {
            const p = pick(c);
            if (p === undefined) continue;
            bin.set(key(...p), '#');
            if (!lab.has(key(...p))) lab.set(key(...p), c.label);
          }
          const grids: Array<[string, Grid]> = [[view, bin]];
          if (opts.labels) grids.push([`${view} Marken`, lab]);
          if (labels.length > 1) {
            for (const l of labels) {
              const g: Grid = new Map();
              for (const c of cells) {
                const p = pick(c);
                if (p !== undefined && c.label === l) g.set(key(...p), '#');
              }
              grids.push([`${view} nur ${l}`, g]);
            }
          }
          for (const [name, g] of grids) {
            if (g.size < 2) continue;
            const s = symmetry(g);
            if (s.c4 && !s.mirror) found(name, 'C4');
          }
          if (opts.windows && lab.size >= 4) {
            const pts = [...lab.keys()].map((k) => k.split(',').map(Number) as [number, number]);
            const bounds = {
              minX: Math.min(...pts.map((p) => p[0])),
              minZ: Math.min(...pts.map((p) => p[1])),
              maxX: Math.max(...pts.map((p) => p[0])),
              maxZ: Math.max(...pts.map((p) => p[1])),
            };
            // Fenster weit über das Muster hinaus prüft schon `symmetry` als Ganzes
            const top = Math.min(15, Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) + 2);
            const sizes = Array.from({ length: Math.max(0, top - 2) }, (_, i) => i + 3);
            for (const [name, g] of [[`${view} Marken`, lab], [view, bin]] as const) {
              const ids = new Map([...new Set(g.values())].map((l, i) => [l, i]));
              const hits = findPinwheels((u, v) => {
                const l = g.get(key(u, v));
                return l === undefined ? undefined : ids.get(l);
              }, bounds, sizes);
              if (hits.length > 0) found(`${name} Fenster ${hits[0]!.size} bei (${hits[0]!.x}, ${hits[0]!.z})`, 'window');
            }
          }
        };
        const ys = [...new Set(cells.map((c) => c.at[1]))].sort((a, b) => a - b);
        for (const y of ys) check(`Schicht y=${y}`, (c) => (c.at[1] === y ? [c.at[0], c.at[2]] : undefined), { labels: true, windows: true });
        check('Draufsicht', (c) => [c.at[0], c.at[2]], { labels: false, windows: true });
        check('Front', (c) => [c.at[0], c.at[1]], { labels: false, windows: false });
        check('Seite', (c) => [c.at[2], c.at[1]], { labels: false, windows: false });
      }
    }
  }
  return out;
}

const files = walk(CATALOG_DIR);
const defs = files.map((f) => {
  const rel = relative(CATALOG_DIR, f).replaceAll('\\', '/');
  const r = parseComponentDef(readFileSync(f, 'utf8'), rel);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
});

describe('W8-I: Windrad-Regel im Katalog (Blöcke + Andockpunkte spiegelsymmetrisch)', () => {
  it('prüft alle Komponenten-Dateien, auch Außen-Module', () => {
    expect(defs.length).toBeGreaterThan(300);
    expect(defs.some((d) => d.mount === 'facade' || d.mount === 'roof' || d.mount === 'eave')).toBe(true);
  });

  it('keine Komponente bildet mit ihren Andockpunkten ein Windrad (Regel A), jede Sitzgruppe ist gespiegelt (Regel B)', () => {
    const lines = defs.flatMap((d) => findingsOf(d)).map(format);
    expect(lines).toEqual([]);
  });
});

describe('W8-I: Gegenproben des Prüfers', () => {
  const table = (sockets: Array<[string, P3, boolean?]>): ComponentDef =>
    ({
      id: 'test/table',
      kind: 'static',
      category: 'furniture',
      tags: ['t'],
      obtainability: 'survival',
      mount: 'floor',
      rotations: 'all',
      layers: [['TT', 'TT']],
      legend: { T: { block: 'minecraft:oak_slab' } },
      sockets: sockets.map(([id, at, required]) => ({ id, type: 'adjacent', at: [...at], accepts: ['bar_stool'], ...(required === true ? { required } : {}) })),
    }) as unknown as ComponentDef;

  it('meldet den alten Tavernentisch: Windrad mit vier Hockern, S-Figur der Pflicht-Hocker – in jeder Drehung gleich', () => {
    const old = table([
      ['n', [0, 0, -1], true],
      ['s', [1, 0, 2], true],
      ['w', [-1, 0, 1]],
      ['e', [2, 0, 0]],
    ]);
    const f = findingsOf(old, [0, 1, 2, 3]);
    for (const rot of [0, 1, 2, 3]) {
      expect(f.some((x) => x.rot === rot && x.kind === 'C4' && x.sockets === 'n+s+w+e' && x.view === 'Schicht y=0')).toBe(true);
      expect(f.some((x) => x.rot === rot && x.kind === 'window' && x.sockets === 'n+s+w+e')).toBe(true);
      expect(f.some((x) => x.rot === rot && x.kind === 'seats' && x.sockets === 'n+s')).toBe(true);
      expect(f.some((x) => x.rot === rot && x.kind === 'seats' && x.sockets === 'n+s+w+e')).toBe(true);
    }
    const perRot = [0, 1, 2, 3].map((r) => f.filter((x) => x.rot === r).map((x) => `${x.kind}|${x.sockets}|${x.view.replace(/ bei .*/, '')}`).sort());
    for (const r of perRot) expect(r).toEqual(perRot[0]);
  });

  it('meldet den alten Spieltisch (drei Arme eines Windrads) als Sitzgruppe ohne Spiegelachse', () => {
    const old = table([
      ['n', [0, 0, -1]],
      ['s', [1, 0, 2]],
      ['w', [-1, 0, 1]],
    ]);
    expect(findingsOf(old).map(format)).toEqual(['seats test/table [(basis)] Sockets n+s+w: Draufsicht Sitzgruppe socket:bar_stool']);
  });

  it('lässt den neuen Tavernentisch (diagonal gespiegelt) und Bänke paarweise gegenüber durch', () => {
    const fixed = table([
      ['n', [0, 0, -1], true],
      ['s', [0, 0, 2], true],
      ['w', [-1, 0, 0]],
      ['e', [2, 0, 0]],
    ]);
    expect(findingsOf(fixed, [0, 1, 2, 3])).toEqual([]);
    const benches = table([
      ['n1', [0, 0, -1]],
      ['n2', [1, 0, -1]],
      ['s1', [0, 0, 2]],
      ['s2', [1, 0, 2]],
    ]);
    // n1+s2 allein ist eine S-Figur, aber nur als zufällige Teilmenge – Regel B prüft die Anlage, nicht den Zufall
    expect(findingsOf(benches)).toEqual([]);
  });

  it('erkennt ein Windrad aus zwei Materialien in einer Schicht und als Teilfenster in einem größeren Boden', () => {
    const floor = (rows: string[]): ComponentDef =>
      ({
        id: 'test/floor',
        kind: 'static',
        category: 'decor',
        tags: ['t'],
        obtainability: 'survival',
        mount: 'floor',
        rotations: 'all',
        layers: [rows],
        legend: { A: { block: 'minecraft:stone' }, B: { block: 'minecraft:oak_planks' } },
      }) as ComponentDef;
    expect(findingsOf(floor(['ABAA', 'ABBB', 'BBBA', 'AABA'])).some((x) => x.kind === 'C4')).toBe(true);
    // dieselbe Figur in einem 8 × 6-Boden mit asymmetrischem Rand: nur das Teilfenster findet sie
    const big = findingsOf(floor(['BAAAAAAA', 'AAABAAAA', 'AAABBBAA', 'AABBBAAA', 'AAAABAAA', 'AAAAAAAA']));
    expect(big.some((x) => x.kind === 'window')).toBe(true);
    expect(big.some((x) => x.kind === 'C4')).toBe(false);
    // spiegelsymmetrisches Kreuz: nichts
    expect(findingsOf(floor(['ABA', 'BBB', 'ABA']))).toEqual([]);
  });
});
