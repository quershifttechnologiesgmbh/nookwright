/**
 * W2-FW (plan/spikes/W2FW_fenster.md): Fenstermodule als Katalogeinheiten und Laternen an den Fensterachsen.
 * Module (Stücke als Varianten, Standardwahl je Theme über `styleTags`), F6 „ein Modul je Linie“ mit Fassadenraster,
 * jedes Wandfenster bekommt ein Modul, Laternen je Seite (spiegelgleich, nie im Eingangsbereich, nie vor Glas).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, deriveShell, type RoofStyle, type Shell, type ShellAnchor } from '@mcda/blueprint';
import { Catalog, parseComponentDef } from '@mcda/catalog';
import { CellSet, key3, type Vec3 } from '@mcda/core';
import { ExteriorSite, WINDOW_MODULES, planExterior, type ExteriorPlacement } from '../src/index.js';
import { moduleKit, windowModuleComponent, windowModuleFor } from '../src/windows.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.json5') ? [join(d, n)] : []));
const catalog = Catalog.of(walk(join(ROOT, 'components')).map((f) => {
  const r = parseComponentDef(readFileSync(f, 'utf8'), f);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
}));
const THEMES = readdirSync(join(ROOT, 'themes')).filter((n) => n.endsWith('.json5')).map((n) => /\bid:\s*"([a-z0-9_]+)"/.exec(readFileSync(join(ROOT, 'themes', n), 'utf8'))![1]!);

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
const RULES = { windowFrame: true, pierFrom: 6, skin: true, grid: true, jambs: true } as const;
const FACADE = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4, rules: RULES } as const;
const alongStep = (f: string): readonly [number, number] => (f === 'north' || f === 'south' ? [1, 0] : [0, 1]);
const planeOf = (a: ShellAnchor): number => (a.facing === 'north' || a.facing === 'south' ? a.pos[2] : a.pos[0]);

/** Stücke des Fenstermoduls rund um ein Fenster (Spalten −1 … span, Reihen −1 … h, 1 vor der Wand). */
/** W9-G2 (27.09.2026): Obergeschosse als Fachwerk markieren (`studs`, wie `withTimberStuds` in der Pipeline). */
function timberAbove(raw: Shell): Shell {
  return raw.facadeGrid === undefined ? raw : { ...raw, facadeGrid: raw.facadeGrid.map((g) => (g.floorIndex >= 1 ? { ...g, studs: g.posts } : g)) };
}

function partsAround(a: ShellAnchor, h: number, byCell: ReadonlyMap<string, ExteriorPlacement>): string {
  const [dx, dz] = alongStep(a.facing);
  const out = new Set<string>();
  for (let j = -1; j <= (a.span ?? 1); j++) {
    for (let y = -1; y <= h; y++) {
      const pl = byCell.get(key3([a.pos[0] + dx * j, a.pos[1] + y, a.pos[2] + dz * j]));
      // W4 (27.09.2026): Laternen (Pfosten) und der Akzent des Obergeschosses (`chain_lantern`) gehören nicht zum Kit
      if (pl !== undefined && pl.anchor === 'window' && pl.variantId !== 'lantern' && pl.variantId !== 'chain_lantern') out.add(`${pl.variantId?.replace(/~\d+$/, '')}@${j < 0 || j >= (a.span ?? 1) ? 'side' : 'mid'}${y}`);
    }
  }
  return [...out].sort().join(' ');
}

describe('W2-FW: Fenstermodule im Katalog', () => {
  it('sechs Module (W6: + Wehrbau Holz), jedes mit Sturz und Bank; Läden/Wangen, Kasten und Laterne je nach Modul', () => {
    for (const id of WINDOW_MODULES) {
      const kit = moduleKit(catalog, id);
      expect(kit, id).toBeDefined();
      expect(kit!.lintel && kit!.sill, id).toBe(true);
      expect(kit!.lantern, id).toBe(true);
      const def = catalog.get(windowModuleComponent(id));
      expect(def.mount, id).toBe('facade');
      expect(def.variants?.[0]?.id, `${id}: erste Variante = ganzes Modul (Vorschau)`).toBe('module');
    }
    expect(moduleKit(catalog, 'townhouse')!.jamb).toBe('shutter');
    expect(moduleKit(catalog, 'cottage')!.boxes.length).toBeGreaterThan(2);
    expect(moduleKit(catalog, 'timber')!.jamb, 'Fachwerk: keine Läden vor den Ständern').toBeUndefined();
    expect(moduleKit(catalog, 'stone')!.jamb).toBe('frame');
    expect(moduleKit(catalog, 'nordic')!.jamb).toBe('frame');
    expect(moduleKit(catalog, 'fort')!.jamb, 'W6: Stammwangen statt Läden').toBe('frame');
    expect(moduleKit(catalog, 'fort')!.boxes).toEqual([]);
  });

  it('je Theme eine Standardwahl (styleTags), genau ein Modul je Theme; Stil schlägt Theme; ohne Theme „townhouse“', () => {
    for (const t of THEMES) {
      const owners = WINDOW_MODULES.filter((m) => catalog.get(windowModuleComponent(m)).styleTags?.includes(t) === true);
      expect(owners, `Theme ${t}`).toHaveLength(1);
      expect(windowModuleFor(catalog, {}, t)).toBe(owners[0]);
    }
    expect(windowModuleFor(catalog, {}, 'timber')).toBe('timber');
    expect(windowModuleFor(catalog, {}, 'nordic')).toBe('nordic');
    expect(windowModuleFor(catalog, { windowModule: 'stone' }, 'timber')).toBe('stone');
    expect(windowModuleFor(catalog, {}, undefined)).toBe('townhouse');
    expect(windowModuleFor(catalog, {}, 'unbekannt')).toBe('townhouse');
  });
});

/**
 * Belegte Spalten je Linie des Rasters (Wandreihen, 1 vor der Wand; ohne Sockel/Gesims) – wie `ExteriorSite`.
 * W5 (27.09.2026, Review N3): Traufkonsolen in der Traufzone (Dachzelle direkt darüber) gehören zur Dachkante und
 * zählen nicht – dieselbe Regel wie `ExteriorSite.eaveZone` und die F7-Messung.
 */
function lineStats(shell: ReturnType<typeof deriveShell>, placements: readonly ExteriorPlacement[]) {
  const roofAt = new Set(shell.cells.filter((c) => c.kind === 'roof').map((c) => key3(c.pos)));
  const eaveZone = (c: Vec3): boolean => roofAt.has(key3([c[0], c[1] + 1, c[2]]));
  const cells: Array<{ pos: readonly number[]; accessory: boolean }> = [
    ...shell.cells.filter((c) => c.kind === 'facade' && !['wall_plinth', 'foundation', 'wall_cornice'].includes(c.role)).map((c) => ({ pos: c.pos, accessory: false })),
    ...placements.flatMap((p) => p.cells.filter((c) => p.group !== 'eaveBraces' || !eaveZone(c)).map((c) => ({ pos: c, accessory: p.group === 'eaveLanterns' || p.group === 'eaveBraces' }))),
  ];
  return (shell.facadeGrid ?? []).flatMap((g) => {
    const rooms = [...shell.rooms.values()].filter((r) => r.baseY === g.y0 + 1);
    if (rooms.length === 0) return [];
    const top = g.y0 + Math.max(...rooms.map((r) => r.height));
    const ns = g.out === 'north' || g.out === 'south';
    const front = g.plane + (ns ? (g.out === 'north' ? -1 : 1) : g.out === 'west' ? -1 : 1);
    const busy = new Set<number>();
    const other = new Set<number>();
    for (const c of cells) {
      const col = ns ? c.pos[0]! : c.pos[2]!;
      if ((ns ? c.pos[2] : c.pos[0]) !== front || col < g.from || col > g.to || c.pos[1]! <= g.y0 || c.pos[1]! > top) continue;
      busy.add(col);
      if (!c.accessory) other.add(col);
    }
    // Spalten, die nur durch Zubehör belegt sind
    const accessory = new Set([...busy].filter((col) => !other.has(col)));
    return [{ key: `${g.out}|${g.plane}|${g.y0}`, inner: g.to - g.from + 1, busy, accessory }];
  });
}

describe('W2-FW: jedes Fenster bekommt sein Modul (F6 je Linie), Laternen je Seite – mit Fassadenraster', () => {
  for (const [name, make] of HOUSES) {
    for (const roof of ['hip', 'gable'] as const satisfies readonly RoofStyle[]) {
      for (const module of WINDOW_MODULES) {
        it(`${name} · ${roof} · ${module}`, () => {
          const p = make();
          const shell = deriveShell(p.state, { roof, facade: FACADE });
          const site = new ExteriorSite(shell, catalog, 1);
          const plan = planExterior(shell, catalog, { seed: p.state.seed, style: { windowModule: module }, roomTypes: {} });
          const again = planExterior(shell, catalog, { seed: p.state.seed, style: { windowModule: module }, roomTypes: {} });
          expect(again).toEqual(plan);
          const byCell = new Map(plan.placements.flatMap((x) => x.cells.map((c) => [key3(c), x] as const)));
          const windows = (shell.anchors ?? []).filter((a) => a.kind === 'window');
          const doors = (shell.anchors ?? []).filter((a) => a.kind === 'door');
          const lines = new Map<string, string[]>();
          let withModule = 0;
          let walls = 0;
          for (const a of windows) {
            const lvl = site.levelOf(a.floorIndex, a.pos);
            if (lvl === undefined || a.pos[1] > lvl.topY) continue;
            walls++;
            const wall: Vec3 = [a.pos[0] - (a.facing === 'east' ? 1 : a.facing === 'west' ? -1 : 0), a.pos[1], a.pos[2] - (a.facing === 'south' ? 1 : a.facing === 'north' ? -1 : 0)];
            let h = 0;
            while (site.at([wall[0], wall[1] + h, wall[2]])?.kind === 'window') h++;
            const sig = partsAround(a, Math.max(1, h), byCell);
            if (sig !== '') withModule++;
            const k = `${a.floorIndex}|${a.facing}|${planeOf(a)}`;
            // W9-G2 (27.09.2026): liegt die Sturzreihe schon unter bzw. in der Traufe (Dach darüber oder Hüllzelle), deckt
            // die Traufe das Fenster – der Sturz fehlt dort bewusst und zählt für F6 nicht (vorher fiel der Sturz für die
            // ganze Seite weg, auch im Erdgeschoss)
            const top: Vec3 = [a.pos[0], a.pos[1] + Math.max(1, h), a.pos[2]];
            const covered = !site.outside(top) || shell.cells.some((c) => c.kind === 'roof' && c.pos[0] === top[0] && c.pos[2] === top[2] && c.pos[1] <= top[1]);
            const norm = sig.replace(/box_[a-z_]+/g, 'box');
            (lines.get(k) ?? lines.set(k, []).get(k)!).push(covered ? `${norm.replace(/ ?lintel@\S+/g, '').trim()} (Traufe)` : norm);
          }
          // jedes Wandfenster trägt Stücke des Moduls; je Linie alle dasselbe (F6) – unter der Traufe ohne Sturz
          expect(withModule, `${name} ${module}: Fenster mit Modul`).toBe(walls);
          for (const [k, sigs] of lines) {
            const open = sigs.filter((x) => !x.endsWith('(Traufe)'));
            const eave = sigs.filter((x) => x.endsWith('(Traufe)')).map((x) => x.slice(0, -' (Traufe)'.length));
            expect(new Set(open).size, `${name} ${module} ${k}: gemischte Linie ${[...new Set(open)].join(' | ')}`).toBeLessThanOrEqual(1);
            const stripped = new Set([...open.map((x) => x.replace(/ ?lintel@\S+/g, '').trim()), ...eave]);
            expect(stripped.size, `${name} ${module} ${k}: gemischte Linie ohne Sturz ${[...stripped].join(' | ')}`).toBe(1);
          }
          // Laternen des Moduls: je Seite mit Fenstern mindestens eine Laterne (Modul oder Traufe), nie neben der Tür
          const lanterns = plan.placements.filter((x) => x.anchor === 'window' && x.group === 'eaveLanterns');
          // W4 (27.09.2026, Deko-Budget F7): Laternen nur, wo die Linie nicht schon durch die Module halb belegt ist
          const stats = lineStats(shell, plan.placements);
          // … und nie über einem Dach (F8: Fenster des Obergeschosses über dem Dach eines tieferen Teils)
          const roofLow = new Map<string, number>();
          for (const c of shell.cells) if (c.kind === 'roof') roofLow.set(`${c.pos[0]},${c.pos[2]}`, Math.min(roofLow.get(`${c.pos[0]},${c.pos[2]}`) ?? Infinity, c.pos[1]));
          const overRoof = (f: string): boolean => windows.some((a) => a.facing === f && (roofLow.get(`${a.pos[0]},${a.pos[2]}`) ?? Infinity) < a.pos[1]);
          const full = (f: string): boolean => overRoof(f) || stats.filter((l) => l.key.startsWith(`${f}|`) && l.busy.size > 0).every((l) => l.busy.size + 2 > Math.floor(l.inner / 2)); // Laternen kommen paarweise
          if (lanterns.length === 0) for (const f of new Set(windows.map((a) => a.facing))) expect(full(f), `${name} ${module}: Seite ${f} ohne Laterne, aber im Budget`).toBe(true);
          for (const l of lanterns) {
            const c = l.cells[0]!;
            for (const d of doors) {
              const near = d.facing === (['south', 'west', 'north', 'east'] as const)[l.pose.rot] && Math.abs(d.pos[0] - c[0]) + Math.abs(d.pos[2] - c[2]) <= 2;
              expect(near, `${name} ${module}: Laterne ${c} im Eingangsbereich`).toBe(false);
            }
          }
          const lit = new Set(plan.placements.filter((x) => /lantern/.test(x.componentId) || x.variantId === 'lantern').map((x) => `${(['south', 'west', 'north', 'east'] as const)[x.pose.rot]}`));
          for (const f of new Set(windows.map((a) => a.facing))) expect(lit.has(f) || full(f), `${name} ${module}: Seite ${f} ohne Laterne`).toBe(true);
        });
      }
    }
  }
});

describe('W4 (27.09.2026): Akzent im Obergeschoss, Deko-Budget je Linie (F7), nichts über Dächern (F8)', () => {
  for (const [name, make] of HOUSES) {
    for (const module of WINDOW_MODULES) {
      it(`${name} · ${module}: Zubehör über dem Budget nur als Akzent, keine Außen-Deko über einem Dach`, () => {
        const p = make();
        const shell = deriveShell(p.state, { roof: 'gable', facade: FACADE });
        const plan = planExterior(shell, catalog, { seed: p.state.seed, style: { windowModule: module, density: 2 }, roomTypes: {} });
        for (const l of lineStats(shell, plan.placements)) {
          // Ist die Linie voller als die Hälfte, stammt vom Zubehör höchstens der Akzent (ein Stück bzw. ein Paar)
          if (l.busy.size > Math.floor(l.inner / 2)) expect(l.accessory.size, `${name} ${module} ${l.key}: Zubehör über dem Budget (${l.busy.size}/${l.inner})`).toBeLessThanOrEqual(2);
        }
        const roofLow = new Map<string, number>();
        for (const c of shell.cells) if (c.kind === 'roof') roofLow.set(`${c.pos[0]},${c.pos[2]}`, Math.min(roofLow.get(`${c.pos[0]},${c.pos[2]}`) ?? Infinity, c.pos[1]));
        for (const pl of plan.placements) {
          if (pl.group === 'chimneys' || pl.group === 'ridgeDecor') continue;
          for (const c of pl.cells) expect((roofLow.get(`${c[0]},${c[2]}`) ?? Infinity) < c[1], `${name} ${module}: ${pl.componentId} ${c} über einem Dach`).toBe(false);
        }
      });
    }
  }

  it('Fachwerk-Obergeschoss: höchstens ein Akzent je Seite – Laternen an Ketten links und rechts des Mittelfensters bzw. am Mittelpfosten', () => {
    const p = sample(true);
    // W9-G2 (27.09.2026): Fachwerk-Linien tragen `studs` (setzt die Pipeline, `withTimberStuds`); hier wie dort das
    // Obergeschoss als Fachwerk markieren – sonst bekäme es Rahmenwangen wie ein Steingeschoss
    const raw = deriveShell(p.state, { roof: 'gable', facade: FACADE });
    const shell = timberAbove(raw);
    const plan = planExterior(shell, catalog, { seed: p.state.seed, style: { windowModule: 'timber' }, roomTypes: {} });
    const accents = plan.placements.filter((x) => x.variantId === 'chain_lantern');
    expect(accents.length).toBeGreaterThan(0);
    const bySide = new Map<string, ExteriorPlacement[]>();
    const at = new Map(shell.cells.map((c) => [key3(c.pos), c] as const));
    for (const a of accents) {
      const k = `${a.pose.rot}|${a.floorIndex}`;
      (bySide.get(k) ?? bySide.set(k, []).get(k)!).push(a);
      expect(a.floorIndex, 'nur im Obergeschoss').toBeGreaterThanOrEqual(1);
      // Laterne unten, Kette direkt darüber; beides in Außenluft
      expect(a.cells).toHaveLength(2);
      expect(a.cells.map((c) => c[1]).sort((x, y) => x - y)[1]).toBe(Math.min(...a.cells.map((c) => c[1])) + 1);
      for (const c of a.cells) expect(at.get(key3(c))).toBeUndefined();
    }
    for (const [k, list] of bySide) expect(list.length, k).toBeLessThanOrEqual(2);
    // andere Module haben keinen Akzent
    const townhouse = planExterior(shell, catalog, { seed: p.state.seed, style: { windowModule: 'townhouse' }, roomTypes: {} });
    expect(townhouse.placements.filter((x) => x.variantId === 'chain_lantern')).toEqual([]);
  });
});

describe('W9-G2 (27.09.2026, plan/spikes/W9G2_fensterrahmen.md): Rahmen aus einem Guss', () => {
  const frameOf = (module: 'townhouse' | 'cottage' | 'timber', timberUpper = false) => {
    const p = sample(true);
    const raw = deriveShell(p.state, { roof: 'gable', facade: FACADE });
    const shell = timberUpper ? timberAbove(raw) : raw;
    const plan = planExterior(shell, catalog, { seed: p.state.seed, style: { windowModule: module }, roomTypes: {} });
    const byCell = new Map(plan.placements.flatMap((x) => x.cells.map((c) => [key3(c), x] as const)));
    const site = new ExteriorSite(shell, catalog, 1);
    const windows = (shell.anchors ?? []).filter((a) => a.kind === 'window' && a.floorIndex >= 0).filter((a) => {
      const lvl = site.levelOf(a.floorIndex, a.pos);
      return lvl !== undefined && a.pos[1] <= lvl.topY;
    });
    return { shell, plan, byCell, windows, site };
  };
  const heightOf = (site: ExteriorSite, a: ShellAnchor): number => {
    const wall: Vec3 = [a.pos[0] - (a.facing === 'east' ? 1 : a.facing === 'west' ? -1 : 0), a.pos[1], a.pos[2] - (a.facing === 'south' ? 1 : a.facing === 'north' ? -1 : 0)];
    let h = 0;
    while (site.at([wall[0], wall[1] + h, wall[2]])?.kind === 'window') h++;
    return Math.max(1, h);
  };

  it('Katalog: Stadthaus, Cottage und Fachwerk haben die Rahmenwange (Holz der Läden, flache Falltür, dehnbar)', () => {
    for (const [id, role] of [['townhouse', 'beam'], ['cottage', 'shutter'], ['timber', 'shutter']] as const) {
      expect(moduleKit(catalog, id)!.frameJamb, id).toBe(true);
      const v = catalog.get(windowModuleComponent(id)).variants!.find((x) => x.id === 'frame_jamb')!;
      expect(Object.values(v.legend ?? {})[0]).toMatchObject({ role, shape: 'trapdoor', orient: { open: true } });
      expect(v.stretch?.max, id).toBeGreaterThanOrEqual(3);
    }
    for (const id of ['stone', 'nordic', 'fort'] as const) expect(moduleKit(catalog, id)!.frameJamb, id).toBe(false);
  });

  it('Stadthaus ohne Luft für Läden: jedes Wandfenster mit Wangen links und rechts, Sturz und Bank über die ganze Breite (keine Kreuzform)', () => {
    const { plan, byCell, windows, site } = frameOf('townhouse');
    expect(plan.placements.some((x) => x.variantId?.startsWith('frame_jamb') === true)).toBe(true);
    let framed = 0;
    for (const a of windows) {
      const sig = partsAround(a, heightOf(site, a), byCell);
      if (!sig.includes('frame_jamb@side')) continue;
      framed++;
      // Ring: die Ecken von Bank und (wo nicht die Traufe deckt) Sturz sind besetzt – nie Wangen mit schmalem Sturz/Bank
      expect(sig, `${a.pos}`).toMatch(/sill@side-1/);
      if (/lintel@mid/.test(sig)) expect(sig, `${a.pos}`).toMatch(/lintel@side/);
      // Spiegelsymmetrisch: beide Wangen
      const [dx, dz] = alongStep(a.facing);
      for (const j of [-1, a.span ?? 1]) expect(byCell.get(key3([a.pos[0] + dx * j, a.pos[1], a.pos[2] + dz * j]))?.variantId?.startsWith('frame_jamb'), `${a.pos} ${j}`).toBe(true);
    }
    expect(framed).toBeGreaterThan(0);
    // je Fenster entweder Läden (mit Luft, W7-A) oder Rahmenwangen, nie beides
    for (const a of windows) {
      const sig = partsAround(a, heightOf(site, a), byCell);
      expect(/(^| )jamb@side/.test(sig) && /frame_jamb@side/.test(sig), `${a.pos}: ${sig}`).toBe(false);
    }
  });

  it('Fachwerk-Linien: keine Wange, Sturz und Kasten nur so breit wie die Scheibe (das Fachwerk rahmt)', () => {
    const { byCell, windows, site, shell } = frameOf('timber', true);
    // Giebelfenster über einer Fachwerk-Seite: auch ohne eigene Rasterlinie keine Wange
    const gables = (shell.anchors ?? []).filter((a) => a.kind === 'window' && !windows.includes(a));
    for (const a of gables) expect(partsAround(a, heightOf(site, a), byCell), `Giebel ${a.pos}`).not.toMatch(/frame_jamb/);
    const upper = windows.filter((a) => a.floorIndex >= 1);
    expect(upper.length).toBeGreaterThan(0);
    for (const a of upper) {
      const sig = partsAround(a, heightOf(site, a), byCell);
      expect(sig, `${a.pos}`).not.toMatch(/frame_jamb/);
      expect(sig, `${a.pos}`).not.toMatch(/@side/);
    }
  });

  it('Cottage (frame_fit): nur die unterste Fensterreihe einer Seite bekommt den Rahmen', () => {
    const { byCell, windows, site } = frameOf('cottage');
    const low = new Map<string, number>();
    for (const a of windows) low.set(`${a.facing}|${planeOf(a)}`, Math.min(low.get(`${a.facing}|${planeOf(a)}`) ?? Infinity, a.pos[1]));
    let framed = 0;
    for (const a of windows) {
      const sig = partsAround(a, heightOf(site, a), byCell);
      if (!sig.includes('frame_jamb')) continue;
      framed++;
      expect(a.pos[1], `${a.pos}`).toBe(low.get(`${a.facing}|${planeOf(a)}`));
    }
    expect(framed).toBeGreaterThan(0);
  });

  it('ohne Fassadenraster keine Rahmenwangen (alte Hüllen)', () => {
    const p = sample(true);
    const shell = deriveShell(p.state, { roof: 'gable' });
    for (const module of ['townhouse', 'cottage', 'timber'] as const) {
      const plan = planExterior(shell, catalog, { seed: p.state.seed, style: { windowModule: module }, roomTypes: {} });
      expect(plan.placements.filter((x) => x.variantId?.startsWith('frame_jamb') === true), module).toEqual([]);
    }
  });

  it('deterministisch und F5: vor keiner Scheibe steht eine Wange', () => {
    for (const module of ['townhouse', 'cottage', 'timber'] as const) {
      const a = frameOf(module);
      const b = frameOf(module);
      expect(b.plan).toEqual(a.plan);
      // Zellen direkt vor den Scheiben (Anker = Spalte vor der Wand)
      const view = new Set<string>();
      for (const w of a.windows) {
        const [dx, dz] = alongStep(w.facing);
        for (let j = 0; j < (w.span ?? 1); j++) for (let y = 0; y < heightOf(a.site, w); y++) view.add(key3([w.pos[0] + dx * j, w.pos[1] + y, w.pos[2] + dz * j]));
      }
      for (const pl of a.plan.placements) {
        if (pl.variantId?.startsWith('frame_jamb') !== true) continue;
        for (const c of pl.cells) expect(view.has(key3(c)), `${module} ${c}`).toBe(false);
      }
    }
  });
});
