/**
 * Außen-Solver (X1): Invarianten an echten Hüllen (Beispielhaus, zweistöckig, L-Grundriss; Walm- und Satteldach,
 * mit und ohne Außenprofil) – nur Außenluft, keine Überschneidung, Laufwege vor Türen frei, vor Scheiben nur
 * durchsichtige Pflanzen, Läden paarweise an der Wand, je Fassade eine Pflanze, deterministisch; Schalter, Dichte,
 * Vortreppe am Gelände, Schornsteine nur über Feuerstellen.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, deriveShell, type FacadeStyle, type RoofStyle, type Shell } from '@mcda/blueprint';
import { Catalog, parseComponentDef } from '@mcda/catalog';
import { CellSet, key3, type Vec3 } from '@mcda/core';
import { EXTERIOR_GROUPS, ExteriorSite, planExterior, type ExteriorPlacement, type ExteriorStyle } from '../src/index.js';
import { between } from '../src/roof.js';

const DIR = fileURLToPath(new URL('../../../catalog/components', import.meta.url));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.json5') ? [join(d, n)] : []));
const catalog = Catalog.of(walk(DIR).map((f) => {
  const r = parseComponentDef(readFileSync(f, 'utf8'), f);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
}));
const ALL_FACADE: FacadeStyle = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4 };

function sample(twoStory = false): Project {
  const p = Project.create({ id: 's', name: 'Beispielhaus', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
  p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
  if (twoStory) {
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 8, 6), 'bedroom');
    p.paintRoom(1, CellSet.rect(9, 0, 14, 6), 'alchemy');
    p.paintRoom(1, CellSet.rect(0, 7, 14, 11), 'library');
    p.placeStairs(0, [3, 10], 'east');
  }
  return p;
}

function lHouse(): Project {
  const p = Project.create({ id: 'l', name: 'L-Haus', seed: 7, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 14), 'hallway');
  p.paintRoom(0, CellSet.rect(9, 8, 20, 14), 'tavern');
  return p;
}

const HOUSES: ReadonlyArray<readonly [string, () => Project]> = [['Beispielhaus', () => sample()], ['zweistöckig', () => sample(true)], ['L-Grundriss', lHouse]];
const roomTypes = (p: Project): Record<string, string> => Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId]));
/** Feuerstelle als Einrichtung: eine Herdzelle in der Küche, eine Esse in der Schmiede. */
const FIRES = [{ componentId: 'work/kitchen_hearth', cells: [[2, 1, 2]] as Vec3[] }, { componentId: 'work/forge', cells: [[18, 1, 2]] as Vec3[] }];

function checkInvariants(shell: Shell, placements: readonly ExteriorPlacement[]): void {
  const site = new ExteriorSite(shell, catalog, 1);
  const seen = new Set<string>();
  for (const p of placements) {
    expect(p.cells.length, p.id).toBeGreaterThan(0);
    for (const c of p.cells) {
      expect(site.outside(c), `${p.id}: ${c} nicht in Außenluft`).toBe(true);
      expect(seen.has(key3(c)), `${p.id}: ${c} doppelt belegt`).toBe(false);
      seen.add(key3(c));
    }
  }
  expect(new Set(placements.map((p) => p.id)).size).toBe(placements.length);
  const byPos = new Map(placements.flatMap((p) => p.cells.map((c) => [key3(c), p] as const)));
  for (const a of shell.anchors ?? []) {
    if (a.kind === 'door') {
      // Laufweg: Zelle vor der Tür und eine weiter, 2 hoch
      for (const k of [0, 1]) for (const h of [0, 1]) {
        const d = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[a.facing];
        const q: Vec3 = [a.pos[0] + d[0]! * k, a.pos[1] + h, a.pos[2] + d[1]! * k];
        expect(byPos.get(key3(q))?.id, `Laufweg vor Tür ${a.pos} bei ${q}`).toBeUndefined();
      }
    }
  }
  // vor Scheiben nur Kastenpflanzen
  for (const c of shell.cells.filter((x) => x.kind === 'window')) {
    for (const d of [[0, -1], [0, 1], [1, 0], [-1, 0]] as const) {
      const q: Vec3 = [c.pos[0] + d[0], c.pos[1], c.pos[2] + d[1]];
      const p = byPos.get(key3(q));
      // W2-FW: der Kasten ist ein Stück des Fenstermoduls (`box_*`), seine Blume steht vor der untersten Scheibe
      if (p !== undefined) expect(`${p.componentId}#${p.variantId}`, `vor Scheibe ${c.pos}`).toMatch(/^exterior\/window_module_[a-z]+#box_/);
    }
  }
}

describe('planExterior: Invarianten an echten Hüllen', () => {
  for (const [name, make] of HOUSES) {
    for (const roof of ['hip', 'gable'] as const satisfies readonly RoofStyle[]) {
      for (const facade of [undefined, ALL_FACADE]) {
        it(`${name} · ${roof}${facade !== undefined ? ' · Außenprofil' : ''}`, () => {
          const p = make();
          const shell = deriveShell(p.state, { roof, ...(facade !== undefined ? { facade } : {}) });
          for (const density of [0, 1, 2]) {
            const plan = planExterior(shell, catalog, { seed: p.state.seed, style: { density }, placements: FIRES, roomTypes: roomTypes(p) });
            checkInvariants(shell, plan.placements);
            expect(planExterior(shell, catalog, { seed: p.state.seed, style: { density }, placements: FIRES, roomTypes: roomTypes(p) })).toEqual(plan);
            if (density >= 1) expect(plan.placements.length, `Dichte ${density}`).toBeGreaterThan(5);
          }
        });
      }
    }
  }
});

describe('planExterior: Regeln', () => {
  const p = sample();
  const shell = deriveShell(p.state, { roof: 'hip' });
  const plan = (style: ExteriorStyle, extra: Partial<Parameters<typeof planExterior>[2]> = {}) =>
    planExterior(shell, catalog, { seed: 2026, style, placements: FIRES, roomTypes: roomTypes(p), ...extra });

  // W2 (26.09.2026): Regel F6/W2-FW – Fenster-Stücke kommen aus dem Fenstermodul; Kästen hat z. B. das Modul „cottage“
  it('Dichte 2: alle Fenster-, Eingangs- und Dachgruppen kommen vor; Läden paarweise', () => {
    const r = plan({ density: 2, sills: false, windowModule: 'cottage' });
    // W4 (27.09.2026): kein Firstabschluss auf zwei Firstreihen (wirkte wie Hörner) – das Beispielhaus (12 tief) hat zwei
    for (const g of ['shutters', 'flowerBoxes', 'stoop', 'portal', 'entranceDecor', 'chimneys', 'eaveLanterns'] as const) expect(r.counts[g], g).toBeGreaterThan(0);
    expect(r.counts.shutters % 2).toBe(0);
    expect(r.counts.flowerBoxes).toBeGreaterThan(0);
    expect(r.counts.ridgeDecor).toBe(0);
  });


  it('je Fassade dieselbe Pflanze (Symmetrie)', () => {
    const r = plan({ density: 2, sills: false, windowModule: 'cottage' });
    const byFacade = new Map<string, Set<string>>();
    for (const b of r.placements.filter((x) => x.variantId?.startsWith('box_') === true)) {
      const k = `${b.floorIndex}|${b.pose.rot}|${b.pose.rot % 2 === 0 ? b.cells[0]![2] : b.cells[0]![0]}`;
      byFacade.set(k, (byFacade.get(k) ?? new Set()).add(b.variantId!));
    }
    expect(byFacade.size).toBeGreaterThan(1);
    for (const [k, v] of byFacade) expect(v.size, k).toBe(1);
  });

  it('Schalter: abgeschaltete Gruppen fehlen, alles aus = nichts', () => {
    const off = Object.fromEntries(EXTERIOR_GROUPS.map((g) => [g, false])) as ExteriorStyle;
    expect(plan(off).placements).toEqual([]);
    for (const g of EXTERIOR_GROUPS) expect(plan({ density: 2, [g]: false }).counts[g], g).toBe(0);
  });

  it('Dichte 0: nur Vortreppe, Portal/Vordach und Schornsteine', () => {
    const groups = new Set(plan({ density: 0 }).placements.map((x) => x.group));
    for (const g of groups) expect(['stoop', 'portal', 'canopy', 'chimneys']).toContain(g);
    expect(groups.has('stoop') && groups.has('chimneys')).toBe(true);
  });

  it('Schornsteine nur über Feuerstellen; ohne Einrichtung bleibt alles andere zellgleich', () => {
    const withFire = plan({});
    const without = planExterior(shell, catalog, { seed: 2026, style: {}, roomTypes: roomTypes(p) });
    expect(withFire.counts.chimneys).toBe(2);
    expect(without.counts.chimneys).toBe(0);
    const near = (ps: readonly ExteriorPlacement[]) => ps.filter((x) => x.group !== 'chimneys' && x.group !== 'ridgeDecor');
    expect(near(without.placements)).toEqual(near(withFire.placements));
    // Kopf ≥ 2 über der Dachfläche, oben Lagerfeuer, darüber nichts von der Hülle.
    // W3 (27.09.2026): Schornstein-Kopf ruhig – statt des Kragrings (W2 D7) ein Mantel aus offenen Falltüren um jedes
    // Lagerfeuer (Lage des Lagerfeuers, ≥ 1 frei über dem Dach darunter); keine Lage ist breiter als die darunter
    const site = new ExteriorSite(shell, catalog, 1);
    for (const c of withFire.placements.filter((x) => x.group === 'chimneys')) {
      const top = Math.max(...c.cells.map((q) => q[1]));
      const head = c.cells.filter((q) => q[1] === top);
      const fires = head.filter(([x, , z]) => c.cells.some((q) => q[0] === x && q[2] === z && q[1] === top - 1));
      expect(fires.length, `Lagerfeuer ${c.cells[0]}`).toBeGreaterThanOrEqual(1);
      for (const [x, , z] of fires) {
        const shaft = c.cells.filter((q) => q[0] === x && q[2] === z && q[1] < top);
        const foot = Math.min(...shaft.map((q) => q[1]));
        expect(top - 1 - site.top(x, z), `Schornstein ${c.cells[0]}`).toBeGreaterThanOrEqual(2);
        expect(site.at([x, foot - 1, z])?.kind).toMatch(/roof|ceiling/);
      }
      const mantle = head.filter((q) => !fires.includes(q));
      expect(mantle.length, `Mantel ${c.cells[0]}`).toBeGreaterThanOrEqual(2 * fires.length + 2);
      for (const [x, y, z] of mantle) {
        expect(fires.some((f) => Math.abs(f[0] - x) + Math.abs(f[2] - z) === 1 && f[1] === y), `Mantel am Feuer ${x},${y},${z}`).toBe(true);
        expect(y - site.top(x, z), `Mantel frei ${x},${y},${z}`).toBeGreaterThanOrEqual(2);
      }
      // ruhige Silhouette: Ausdehnung je Lage (ohne Mantel) nimmt nach oben nicht zu
      const body = c.cells.filter((q) => !mantle.includes(q));
      const ys = [...new Set(body.map((q) => q[1]))].sort((a, b) => a - b);
      const ext = (y: number, i: 0 | 2): number => { const v = body.filter((q) => q[1] === y).map((q) => q[i]); return Math.max(...v) - Math.min(...v); };
      for (let k = 1; k < ys.length; k++) {
        for (const i of [0, 2] as const) expect(ext(ys[k]!, i), `Silhouette ${c.cells[0]} y=${ys[k]}`).toBeLessThanOrEqual(ext(ys[k - 1]!, i));
      }
    }
  });

  // W4 (27.09.2026, M8): am Krüppelwalm stand der gestufte Fuß am Firstende über der Dachkante (farmhouse-rustic)
  it('Schornstein am Krüppelwalm: Fuß und Schulter nie über der Dach-Silhouette (Traufansicht), Fuß ≥ 2 vor der Kante', () => {
    const q = Project.create({ id: 'k', name: 'Krüppelwalm', seed: 7, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 4 } });
    q.paintRoom(0, CellSet.rect(0, 0, 3, 10), 'kitchen');
    q.paintRoom(0, CellSet.rect(4, 0, 16, 10), 'storage');
    const hh = deriveShell(q.state, { roof: 'half_hip', roofDetail: { pitch: 'normal', trim: true, verge: 'closed' } });
    const fires = [{ componentId: 'work/kitchen_hearth', cells: [[1, 1, 3]] as Vec3[] }];
    const site = new ExteriorSite(hh, catalog, 1);
    const tops = new Map<string, number>();
    for (const c of hh.cells) if (c.kind === 'roof') tops.set(`${c.pos[0]},${c.pos[2]}`, Math.max(tops.get(`${c.pos[0]},${c.pos[2]}`) ?? -Infinity, c.pos[1]));
    let n = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const r = planExterior(hh, catalog, { seed, style: { density: 1 }, placements: fires, roomTypes: roomTypes(q) });
      for (const c of r.placements.filter((x) => x.group === 'chimneys')) {
        n++;
        const yTop = Math.max(...c.cells.map((v) => v[1]));
        const y0 = Math.min(...c.cells.map((v) => v[1]));
        const foot = c.cells.filter((v) => v[1] === y0);
        const alongX = new Set(foot.map((v) => v[0])).size > 1 || new Set(foot.map((v) => v[2])).size === 1;
        const neck = new Set(c.cells.filter((v) => v[1] === yTop - 1).map((v) => `${v[0]},${v[2]}`));
        for (const v of c.cells.filter((w) => w[1] < yTop && !neck.has(`${w[0]},${w[2]}`))) {
          let sil = -Infinity;
          for (const [k, y] of tops) { const [x, z] = k.split(',').map(Number); if ((alongX ? x : z) === (alongX ? v[0] : v[2])) sil = Math.max(sil, y); }
          expect(v[1], `Seed ${seed}: ${c.componentId} ${v}`).toBeLessThanOrEqual(sil);
        }
        if (foot.length > 1) {
          const ax = alongX ? [1, 0] : [0, 1];
          const lo = foot.reduce((m, v) => (v[0] + v[2] < m[0] + m[2] ? v : m));
          const hi = foot.reduce((m, v) => (v[0] + v[2] > m[0] + m[2] ? v : m));
          for (const k of [1, 2]) {
            expect(site.top(lo[0] - k * ax[0]!, lo[2] - k * ax[1]!), `Seed ${seed}: Rand`).toBeGreaterThanOrEqual(y0 - 1);
            expect(site.top(hi[0] + k * ax[0]!, hi[2] + k * ax[1]!), `Seed ${seed}: Rand`).toBeGreaterThanOrEqual(y0 - 1);
          }
        }
      }
    }
    expect(n).toBe(24); // ein Raum, ein Schornstein je Seed
  });

  it('E3: Vortreppe folgt dem Gelände (bündig: keine, 1: Stufe, 3: Podest + Stufen, 6: Hinweis)', () => {
    const y0 = 0;
    const stoop = (ground: number) => plan({ density: 1 }, { ground: () => ground });
    expect(stoop(y0).counts.stoop).toBe(0);
    expect(stoop(y0 - 1).placements.filter((x) => x.group === 'stoop').map((x) => x.variantId)).toEqual(['step', 'step', 'step']);
    const high = stoop(y0 - 3).placements.filter((x) => x.group === 'stoop');
    expect(high.filter((x) => x.variantId === 'step').map((x) => x.cells[0]![1]).sort((a, b) => a - b)).toEqual([-2, -1]);
    expect(high.filter((x) => x.variantId === 'block').length).toBe(4); // Podest + 2 darunter + 1 unter der oberen Stufe
    const tooHigh = stoop(y0 - 6);
    expect(tooHigh.counts.stoop).toBe(0);
    expect(tooHigh.warnings.join()).toContain('Vortreppe');
  });

  it('Aushängeschild nur an Werkstätten/Wirtshaus hinter der Tür', () => {
    const shop = (type: string) => plan({ density: 1 }, { roomTypes: { ...roomTypes(p), [p.state.rooms[1]!.id]: type } }).placements.filter((x) => x.componentId === 'exterior/shop_sign').length;
    expect(shop('tavern')).toBe(1);
    expect(shop('bedroom')).toBe(0);
  });

  it('Traufenlaternen-Takt zwischen den Ecken ist spiegelsymmetrisch', () => {
    for (let span = 3; span < 40; span++) {
      for (const every of [4, 6, 8]) {
        const ks = between(span, every);
        expect(ks.map((k) => span - 1 - k).sort((a, b) => a - b), `${span}/${every}`).toEqual(ks);
        const pts = [-1, ...ks, span];
        expect(Math.max(...pts.slice(1).map((q, i) => q - pts[i]!)), `${span}/${every}`).toBeLessThanOrEqual(every + 1);
      }
    }
  });
});

describe('Anbau-Grundrisse (Shell.annexes, angedockter Turm) sind für Außen-Teile belegt', () => {
  it('keine Außen-Zelle im Turm-Grundriss, auch bei hoher Dichte; Spalten gelten nicht als Außenluft', () => {
    const p = sample();
    const tower = { id: 'turm', footprint: CellSet.rect(2, 12, 6, 16), top: 8, openings: [{ floorIndex: 0, at: [4, 11] as const }] };
    const shell = deriveShell(p.state, { roof: 'gable', annexes: [tower] });
    expect(shell.annexes?.map((a) => a.id)).toEqual(['turm']);
    const site = new ExteriorSite(shell, catalog, 2026);
    expect(site.outside([4, 1, 14])).toBe(false);
    expect(site.outside([4, 1, 18])).toBe(true);
    for (const density of [1, 2]) {
      const plan = planExterior(shell, catalog, { seed: 2026, style: { density }, placements: FIRES, roomTypes: roomTypes(p) });
      const inside = plan.placements.flatMap((pl) => pl.cells).filter((c) => tower.footprint.has(c[0], c[2]));
      expect(inside, `Dichte ${density}`).toEqual([]);
    }
  });
});

describe('Baukörper am Hang (V0): Außen-Teile nutzen die Höhen ihres Baukörpers', () => {
  const hill = (lowFirst: boolean): Project => {
    const p = Project.create({ id: 'h', name: 'Hang', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
    p.addVolume({ name: 'Unterhaus', baseOffset: -3 });
    const low = p.state.volumes!.at(-1)!.id;
    const main = () => p.paintRoom(0, CellSet.rect(0, 0, 10, 8), 'kitchen');
    const lower = () => p.paintRoom(0, CellSet.rect(11, 0, 19, 8), 'storage', { volumeId: low });
    if (lowFirst) [lower(), main()];
    else [main(), lower()];
    return p;
  };
  const partsOf = (p: Project): string[] => {
    const shell = deriveShell(p.state, { roof: 'gable' });
    const plan = planExterior(shell, catalog, { seed: 2026, style: { density: 2 }, placements: [], roomTypes: {} });
    return plan.placements.map((pl) => `${pl.componentId}@${pl.cells.map((c) => c.join(',')).join(' ')}`).sort();
  };

  it('Ergebnis hängt nicht davon ab, welcher Baukörper zuerst gemalt wurde', () => {
    const a = partsOf(hill(false));
    expect(a.length).toBeGreaterThan(10);
    expect(partsOf(hill(true))).toEqual(a);
  });
});

describe('W2 (Baustandard F4/F6/F7): Deko-Kit je Seite, Laternen an Pfosten, Eingang frei – mit Fassadenraster', () => {
  const RULES = { windowFrame: true, pierFrom: 6, skin: true, grid: true, jambs: true } as const;
  const along = (f: string): readonly [number, number] => (f === 'north' || f === 'south' ? [1, 0] : [0, 1]);
  for (const [name, make] of HOUSES) {
    for (const roof of ['hip', 'gable'] as const satisfies readonly RoofStyle[]) {
      it(`${name} · ${roof}`, () => {
        const p = make();
        const shell = deriveShell(p.state, { roof, facade: { ...ALL_FACADE, rules: RULES } });
        const site = new ExteriorSite(shell, catalog, 1);
        for (const density of [1, 2]) {
          const plan = planExterior(shell, catalog, { seed: p.state.seed, style: { density }, placements: FIRES, roomTypes: roomTypes(p) });
          checkInvariants(shell, plan.placements);
          const byCell = new Map(plan.placements.flatMap((x) => x.cells.map((c) => [key3(c), x] as const)));
          // F6: je Seite (Außenrichtung + Wandebene) haben alle Wandfenster Läden oder keins, Kasten/Bank je Geschoss gleich
          const sides = new Map<string, Array<{ shutters: boolean; under: string; floor: number }>>();
          for (const a of (shell.anchors ?? []).filter((x) => x.kind === 'window')) {
            const lvl = site.levelOf(a.floorIndex, a.pos);
            if (lvl === undefined || a.pos[1] > lvl.topY) continue;
            const [dx, dz] = along(a.facing);
            const left: Vec3 = [a.pos[0] - dx, a.pos[1], a.pos[2] - dz];
            const below: Vec3 = [a.pos[0], a.pos[1] - 1, a.pos[2]];
            const k = `${a.facing}|${a.facing === 'north' || a.facing === 'south' ? a.pos[2] : a.pos[0]}`;
            (sides.get(k) ?? sides.set(k, []).get(k)!).push({ shutters: byCell.get(key3(left))?.group === 'shutters', under: byCell.get(key3(below))?.group ?? '-', floor: a.floorIndex });
          }
          for (const [k, list] of sides) {
            expect(new Set(list.map((x) => x.shutters)).size, `${name} Dichte ${density} ${k}: Läden gemischt`).toBe(1);
            for (const f of new Set(list.map((x) => x.floor))) expect(new Set(list.filter((x) => x.floor === f).map((x) => x.under)).size, `${k} G${f}: Kasten/Bank gemischt`).toBe(1);
          }
          // F7: Traufenlaternen (Anker Traufe) nur auf Pfostenspalten des Rasters
          for (const l of plan.placements.filter((x) => x.group === 'eaveLanterns' && x.anchor === 'eave' && x.componentId === 'exterior/eave_lantern')) {
            const c = l.cells[0]!;
            const onPost = (shell.facadeGrid ?? []).some((g) => (g.out === 'north' || g.out === 'south' ? g.posts.includes(c[0]) : g.posts.includes(c[2])));
            expect(onPost, `${name}: Laterne ${c} nicht an einem Pfosten`).toBe(true);
          }
          // W3 (27.09.2026): Traufkonsolen im Takt – an Pfosten bzw. Linienenden des Rasters oder (Füllung langer
          // Lücken) mindestens 2 vom nächsten Pfosten, vor Wand (keine Scheibe), nie im Eingangsbereich (±1), unter einer
          // Dachzelle. W4 (27.09.2026): liegt die Traufe in einer Wandreihe, zählen die Konsolen zum Deko-Budget der Linie
          // (F7) – an vollen Linien entfallen sie (vorher: mindestens eine je Gebäude). W5 (27.09.2026, Review N3): die
          // Konsole steht in der Traufzone (Dachzelle darüber) und zählt nicht mehr zum Budget
          const braces = plan.placements.filter((x) => x.componentId === 'exterior/eave_brace');
          const doorsA = (shell.anchors ?? []).filter((a) => a.kind === 'door');
          for (const b of braces) {
            const c = b.cells[0]!;
            const onGrid = (shell.facadeGrid ?? []).some((g) => {
              const u = g.out === 'north' || g.out === 'south' ? c[0] : c[2];
              return g.posts.includes(u) || u === g.from || u === g.to || [g.from, ...g.posts, g.to].every((q) => Math.abs(q - u) >= 2);
            });
            expect(onGrid, `${name}: Konsole ${c} nicht im Takt`).toBe(true);
            expect(site.solidWall([c[0] - (b.pose.rot === 0 ? 0 : b.pose.rot === 2 ? 0 : b.pose.rot === 1 ? -1 : 1), c[1], c[2] - (b.pose.rot === 0 ? 1 : b.pose.rot === 2 ? -1 : 0)]), `${name}: Konsole ${c} nicht vor Wand`).toBe(true);
            expect(doorsA.some((d) => Math.abs(d.pos[0] - c[0]) + Math.abs(d.pos[2] - c[2]) <= 1 && d.pos[1] <= c[1] && c[1] - d.pos[1] <= 4), `${name}: Konsole ${c} am Eingang`).toBe(false);
            expect(site.at([c[0], c[1] + 1, c[2]])?.kind, `${name}: Konsole ${c} ohne Traufe`).toBe('roof');
          }
          // F4: an der Haustür Portal oder Vordach (Tür ±1 ist frei von Wandvorlagen)
          expect(plan.counts.portal + plan.counts.canopy, `${name} Dichte ${density}: Eingang ohne Portal/Vordach`).toBeGreaterThan(0);
        }
      });
    }
  }
});

describe('W4-D Gruppe „Traufkonsolen“ (eaveBraces, vorher Teil von eaveLanterns)', () => {
  const RULES = { windowFrame: true, pierFrom: 6, skin: true, grid: true, jambs: true } as const;
  const p = sample(true);
  const shell = deriveShell(p.state, { roof: 'gable', facade: { ...ALL_FACADE, rules: RULES } });
  const plan = (style: ExteriorStyle) => planExterior(shell, catalog, { seed: p.state.seed, style, placements: FIRES, roomTypes: roomTypes(p) });
  const braces = (x: ReturnType<typeof plan>) => x.placements.filter((pl) => pl.componentId === 'exterior/eave_brace');
  const lanterns = (x: ReturnType<typeof plan>) => x.placements.filter((pl) => pl.componentId === 'exterior/eave_lantern');

  it('eigene Gruppe mit eigener Zahl; ID und Seed wie vorher (Präfix eaveLanterns ⇒ Blöcke bitgleich)', () => {
    // W4 (27.09.2026): die Traufe dieses Hauses liegt in der obersten Wandreihe – Konsolen zählen dort zum Deko-Budget
    // (F7); ohne Fenstermodule ist die Linie frei und die Konsolen stehen. W5 (27.09.2026, Review N3): in der Traufzone
    // zählen sie nicht mehr (siehe „W5 Traufkonsolen“)
    const all = plan({ density: 1, shutters: false, flowerBoxes: false, sills: false, hoods: false });
    expect(braces(all).length).toBeGreaterThan(0);
    expect(braces(all).every((b) => b.group === 'eaveBraces' && b.id.startsWith('x1:eaveLanterns:eave_brace@'))).toBe(true);
    expect(all.counts.eaveBraces).toBe(braces(all).length);
    expect(EXTERIOR_GROUPS).toContain('eaveBraces');
  });

  it('ohne Angabe folgt eaveBraces den Traufenlaternen (bitgleich); einzeln schaltbar', () => {
    const all = plan({ density: 1 });
    const noLanterns = plan({ density: 1, eaveLanterns: false });
    expect(lanterns(noLanterns)).toHaveLength(0);
    expect(braces(noLanterns)).toHaveLength(0); // wie vor W4-D
    const onlyBraces = plan({ density: 1, eaveLanterns: false, eaveBraces: true });
    expect(lanterns(onlyBraces)).toHaveLength(0);
    // ohne Laternen stehen die Konsolen auch an den Pfosten, die sonst eine Laterne tragen
    expect(braces(onlyBraces).length).toBeGreaterThanOrEqual(braces(all).length);
    const noBraces = plan({ density: 1, eaveBraces: false });
    expect(braces(noBraces)).toHaveLength(0);
    // W15: die Fassaden-Details (Standard dezent) belegen zuletzt, was frei ist – ohne Konsolen auch deren Zellen
    const noDetail = (xs: typeof all.placements) => xs.filter((pl) => pl.group !== 'detailBlocks');
    expect(noDetail(noBraces.placements)).toEqual(noDetail(all.placements).filter((pl) => pl.group !== 'eaveBraces'));
  });
});

describe('W5 (27.09.2026, Review N3): Traufkonsolen in der Traufzone außerhalb des Deko-Budgets, auch über dem Kniestock', () => {
  const RULES = { windowFrame: true, pierFrom: 6, skin: true, grid: true, jambs: true } as const;
  for (const [name, make] of HOUSES) {
    for (const knee of [true, false]) {
      it(`${name} · Kniestock ${knee ? 'an' : 'aus'}: Konsolen trotz voller Fensterlinien, jede unter einer Dachzelle vor Wand/Rähm`, () => {
        const p = make();
        const shell = deriveShell(p.state, { roof: 'gable', roofDetail: { kneeWall: knee }, facade: { ...ALL_FACADE, rules: RULES } });
        const site = new ExteriorSite(shell, catalog, 1);
        const plan = planExterior(shell, catalog, { seed: p.state.seed, style: { density: 1 }, placements: FIRES, roomTypes: roomTypes(p) });
        checkInvariants(shell, plan.placements);
        const braces = plan.placements.filter((x) => x.componentId === 'exterior/eave_brace');
        // Fenstermodule füllen die Linien (Budget voll) – die Konsolen stehen trotzdem
        expect(braces.length, `${name}: keine Konsole`).toBeGreaterThan(0);
        for (const b of braces) {
          const c = b.cells[0]!;
          expect(site.eaveZone(c), `${name}: Konsole ${c} nicht in der Traufzone`).toBe(true);
          const out = (['south', 'west', 'north', 'east'] as const)[b.pose.rot];
          const back: Vec3 = [c[0] - (out === 'east' ? 1 : out === 'west' ? -1 : 0), c[1], c[2] - (out === 'south' ? 1 : out === 'north' ? -1 : 0)];
          expect(site.solidWall(back) || site.at(back)?.kind === 'ceiling', `${name}: Konsole ${c} ohne Wand/Rähm dahinter`).toBe(true);
        }
        const kneeRows = shell.roofFit?.some((f) => (f.knee ?? 0) > 0) === true;
        if (name === 'Beispielhaus') expect(kneeRows).toBe(knee); // das eingeschossige Beispielhaus hebt das Dach um 3 Reihen
        if (kneeRows) {
          // über dem Kniestock liegt die Traufe höher als Decke + 2 (dort meldet die Hülle keinen Traufanker)
          const top = Math.max(...[...shell.rooms.values()].filter((r) => r.floorIndex === 0).map((r) => r.baseY - 1 + r.height));
          expect(braces.some((b) => b.cells[0]![1] > top + 1), `${name}: keine Konsole am Kniestock`).toBe(true);
        }
        expect(planExterior(shell, catalog, { seed: p.state.seed, style: { density: 1 }, placements: FIRES, roomTypes: roomTypes(p) })).toEqual(plan);
      });
    }
  }
});

describe('W5 (Review W4-R N9, F7 „je Pfosten höchstens 1 Zubehör“): keine Laternen übereinander an Ecken und Pfosten', () => {
  const RULES = { windowFrame: true, pierFrom: 6, skin: true, grid: true, jambs: true } as const;
  const lanternsOf = (placements: readonly ExteriorPlacement[]): ExteriorPlacement[] =>
    placements.filter((pl) => /lantern/.test(`${pl.componentId} ${pl.variantId ?? ''}`));
  const cases = HOUSES.flatMap(([name, make]) => (['hip', 'gable'] as const).flatMap((roof) => ['medieval', 'timber'].map((themeId) => [name, make, roof, themeId] as const)));
  let skipped = 0;
  for (const [name, make, roof, themeId] of cases) {
    it(`${name} · ${roof} · ${themeId}`, () => {
      const p = make();
      const shell = deriveShell(p.state, { roof, overhang: 1, facade: { ...ALL_FACADE, rules: RULES } });
      const site = new ExteriorSite(shell, catalog, 1);
      const corners = (shell.anchors ?? []).filter((a) => a.kind === 'corner');
      /** Ecke, an der eine Ecklaterne hängen könnte (erste Hüllzelle über der Diagonale ab Kopfhöhe trägt). */
      const hanging = (a: (typeof corners)[number]): boolean => {
        const lvl = site.levelOf(a.floorIndex, a.pos)!;
        for (let y = lvl.baseY + 2; y <= lvl.topY + 2; y++) if (site.at([a.pos[0], y + 1, a.pos[2]]) !== undefined) return site.hangsFrom([a.pos[0], y, a.pos[2]]);
        return false;
      };
      for (const density of [1, 2]) {
        const plan = planExterior(shell, catalog, { seed: p.state.seed, style: { density }, placements: FIRES, roomTypes: roomTypes(p), themeId });
        const lan = lanternsOf(plan.placements);
        // nie zwei Laternen-Platzierungen in derselben Spalte (x, z)
        const cols = new Map<string, string>();
        for (const l of lan) {
          for (const k of new Set(l.cells.map((c) => `${c[0]},${c[2]}`))) {
            expect(cols.get(k), `${name} Dichte ${density}: ${l.id} über ${cols.get(k)}`).toBeUndefined();
            cols.set(k, l.id);
          }
        }
        // Ecklaterne nur, wenn keine der beiden Wände an der Ecke auf derselben Etage eine Laterne trägt
        for (const c of lan.filter((l) => l.anchor === 'corner')) {
          const lvl = site.levelOf(c.floorIndex, c.cells[0]!)!;
          const [x, , z] = c.cells[0]!;
          const other = lan.filter((l) => l.anchor !== 'corner' && l.cells.some((q) => (q[0] === x || q[2] === z) && q[1] >= lvl.baseY && q[1] <= lvl.topY + 2));
          expect(other.map((o) => o.id), `${name} Dichte ${density}: Ecke ${x},${z}`).toEqual([]);
        }
        // je Etage ganz oder gar nicht: hat eine Etage Ecklaternen, ist auch an ihren übrigen Ecken keine Nachbarwand
        // belegt (sonst hätte die Front eine Ecke mit und eine ohne Laterne; das Deko-Budget F7 darf einzelne streichen)
        const withLantern = new Set(lan.filter((l) => l.anchor === 'corner').map((l) => l.floorIndex));
        for (const a of corners.filter((x) => withLantern.has(x.floorIndex) && hanging(x))) {
          const lvl = site.levelOf(a.floorIndex, a.pos)!;
          expect(lan.filter((l) => l.anchor !== 'corner' && l.cells.some((q) => (q[0] === a.pos[0] || q[2] === a.pos[2]) && q[1] >= lvl.baseY && q[1] <= lvl.topY + 2)).map((l) => l.id), `${name} Dichte ${density} Ecke ${a.pos}`).toEqual([]);
        }
        skipped += corners.filter((a) => hanging(a) && !withLantern.has(a.floorIndex)).length;
      }
    });
  }
  it('Gegenprobe: in dieser Menge entfallen Ecklaternen wegen belegter Nachbarwände', () => {
    expect(skipped).toBeGreaterThan(0);
  });
});

describe('W6 (27.09.2026, Review W4-R R2): jede Fassadenseite mit Fenstern trägt eine Außenlaterne (Mindestlicht)', () => {
  const RULES = { windowFrame: true, pierFrom: 6, skin: true, grid: true, jambs: true } as const;
  /** Seiten (Außenrichtung|Wandebene) mit Wandfenstern ohne Laterne davor (1–2 Reihen, ohne Ecklaternen). */
  const darkSides = (shell: Shell, placements: readonly ExteriorPlacement[]): string[] => {
    const site = new ExteriorSite(shell, catalog, 1);
    const lan = placements.filter((pl) => pl.anchor !== 'corner' && /lantern/.test(`${pl.componentId} ${pl.variantId ?? ''}`));
    const sides = new Map<string, { out: string; plane: number; lo: number; hi: number }>();
    for (const a of (shell.anchors ?? []).filter((x) => x.kind === 'window' && x.floorIndex >= 0)) {
      const lvl = site.levelOf(a.floorIndex, a.pos);
      if (lvl === undefined || a.pos[1] > lvl.topY) continue;
      const ns = a.facing === 'north' || a.facing === 'south';
      const plane = ns ? a.pos[2] + (a.facing === 'north' ? 1 : -1) : a.pos[0] + (a.facing === 'west' ? 1 : -1);
      const u = ns ? a.pos[0] : a.pos[2];
      const k = `${a.facing}|${plane}`;
      const s = sides.get(k) ?? sides.set(k, { out: a.facing, plane, lo: u, hi: u }).get(k)!;
      s.lo = Math.min(s.lo, u);
      s.hi = Math.max(s.hi, u + (a.span ?? 1) - 1);
    }
    return [...sides].filter(([k, s]) => {
      const g = (shell.facadeGrid ?? []).filter((x) => `${x.out}|${x.plane}` === k);
      const from = g.length > 0 ? Math.min(...g.map((x) => x.from)) : s.lo - 3;
      const to = g.length > 0 ? Math.max(...g.map((x) => x.to)) : s.hi + 3;
      const ns = s.out === 'north' || s.out === 'south';
      const sgn = s.out === 'north' || s.out === 'west' ? -1 : 1;
      return !lan.some((l) => l.cells.some((c) => {
        const d = ((ns ? c[2] : c[0]) - s.plane) * sgn;
        const u = ns ? c[0] : c[2];
        return d >= 1 && d <= 2 && u >= from && u <= to;
      }));
    }).map(([k]) => k);
  };
  for (const [name, make] of HOUSES) {
    for (const roof of ['hip', 'gable'] as const) {
      for (const themeId of ['medieval', 'timber', 'rustic', 'nordic']) {
        it(`${name} · ${roof} · ${themeId}`, () => {
          const p = make();
          const shell = deriveShell(p.state, { roof, overhang: 1, facade: { ...ALL_FACADE, rules: RULES } });
          for (const density of [0.75, 1, 2]) {
            const plan = planExterior(shell, catalog, { seed: p.state.seed, style: { density }, placements: FIRES, roomTypes: roomTypes(p), themeId });
            expect(darkSides(shell, plan.placements), `${name} ${themeId} Dichte ${density}`).toEqual([]);
            // Gegenprobe: ohne Laternen-Gruppe sind Seiten ohne Eingang dunkel (die Prüfung greift)
            const off = planExterior(shell, catalog, { seed: p.state.seed, style: { density, eaveLanterns: false }, placements: FIRES, roomTypes: roomTypes(p), themeId });
            expect(darkSides(shell, off.placements).length, `${name} ${themeId} Gegenprobe`).toBeGreaterThan(0);
          }
        });
      }
    }
  }
});
