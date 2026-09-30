/**
 * Wehrmauer aus einem gezeichneten Mauerzug (research/14 §4, Tiny Glade „draw a wall and it builds itself“):
 *
 *  1. Türme planen: Tor/Torhaus > Zusatz- und Eck-Türme > Enden > Zwischentürme (Abstand); Konflikte entlang
 *     der Bogenlänge, der schwächere weicht (Hinweis).
 *  2. Grundriss = dicke Linie: Zellen mit Abstand zur Linie im halboffenen Band (−(T+1)/2, (T−1)/2]
 *     (+ außen), runde Fugen an Knicken; ohne Turm-Grundrisse. Außenrand = Brüstung, Rest = Wehrgang.
 *  3. Kronenhöhe: Gelände-Maximum im Querschnitt + Höhe, dann Lipschitz-Hülle (|Δ| ≤ 1 je Schritt, hebt nur),
 *     Tore heben auf Sturzhöhe, Turmanschlüsse auf gemeinsame Wehrgang-Höhe – Stufen werden Treppen.
 *  4. Blöcke: Sockelreihen (foundation) + Mauer; Zinnen im Rhythmus der Bogenlänge; Türme mit Durchgang
 *     zum Wehrgang; Tordurchgang mit Tür/Doppeltür/Bogen und Vortreppen; Treppenaufgang innen; Anlauf außen.
 *
 * Profil `garden` (research/18 Z2): gleiche Linie und Geländefolge, aber Dicke 1, Höhe 2 (Sockel + Feld), ohne
 * Wehrgang, Zinnen, Türme, Aufgang und Anlauf. Pfeiler (wall_quoin) an Stützpunkten und im Takt ≤ pillarEvery,
 * 1 höher als die Felder, Kappe als Stufe oder Laterne; an Toren 2 höher. Tore: Zauntor (1–2) oder Lücke (≥ 3).
 *
 *   _ . . . _ . . . L . . L     _ Kappe, L Laterne (Torpfeiler)
 *   # w w w # w w w # . . #     # Pfeiler, w Feld (Mauer oder Hecke), . Tor
 *   = = = = = = = = = . . =     = Sockel
 */
import { hashSeed, type Cell, type HorizontalDir, type Vec3 } from '@mcda/core';
import { B, PRIO, fenceGate, stair, type Block, type Site } from './canvas.js';
import { N4, Polyline, colKey, footprintOffsets, insidePolygon, snapDir } from './geometry.js';
import { isCapped, isMerlon, palindromePairs, solveAndLog, type CrenelProblem, type CrenelTile } from './crenel.js';
import { commitStairRun, planStairRun } from './stairs.js';
import { buildTower, hasRoof, resolveRoleStyle, resolveStyle, towerBaseY, type ResolvedStyle } from './tower.js';
import type { GateInfo, GateKind, TowerInfo, WallInfo, WallPlan } from './types.js';

const EPS = 1e-9;

type Rim = 'outer' | 'inner' | 'core';

interface WallCell {
  readonly x: number;
  readonly z: number;
  readonly seg: number;
  /** Bogenlänge des Fußpunkts. */
  readonly s: number;
  /** Y des obersten Geländeblocks. */
  readonly g: number;
  rim: Rim;
  /** Y des Wehrgang-Bodens (Krone). */
  c: number;
  /** Treppe auf dem Wehrgang (Stufe zum höheren Nachbarn). */
  step?: HorizontalDir;
}

interface TowerSlot {
  readonly s: number;
  readonly prio: number;
  readonly why: string;
}

interface Gate {
  readonly s: number;
  readonly seg: number;
  readonly width: number;
  readonly clear: number;
  readonly kind: GateKind;
  readonly cells: WallCell[];
  baseY: number;
  /** W3-CA: Torbau zwischen den Torhaus-Türmen. */
  readonly block: boolean;
}

export function buildWall(site: Site, plan: WallPlan, index: number, opts: { readonly maxTop?: number } = {}): { wall: WallInfo; towers: TowerInfo[] } {
  const id = plan.id ?? `w${index}`;
  const owner = `${site.prefix}:${id}`;
  const warn = (m: string): void => {
    site.warnings.push(`${owner}: ${m}`);
  };
  const line = new Polyline(plan.points, plan.closed === true && plan.points.length >= 3);
  if (line.segments.length === 0) {
    warn('Mauerzug braucht mindestens 2 verschiedene Punkte');
    return { wall: { id: owner, walkway: [], stairs: [], towers: [], gates: [] }, towers: [] };
  }
  const garden = plan.profile === 'garden';
  const T = Math.max(1, Math.round(plan.thickness ?? (garden ? 1 : 3)));
  const H = Math.max(garden ? 2 : 3, Math.round(plan.height ?? (garden ? 2 : 6)));
  const mw = Math.max(1, plan.merlon?.width ?? 1);
  const mg = Math.max(0, plan.merlon?.gap ?? 1);
  const plinthRows = Math.max(0, Math.min(H, plan.plinth?.rows ?? (garden ? 1 : 2)));
  const towerMode = plan.towers ?? (garden ? 'none' : 'auto');
  const style: ResolvedStyle = resolveStyle(plan.towerStyle, warn, 'Mauertürme');
  const r = style.r;
  const rise = Math.max(4, plan.towerRise ?? 5);
  const last = line.segments.length - 1;

  // Außenseite: geschlossen → nicht im Polygon, offen → Vorgabe (links/rechts der Zeichenrichtung)
  let outSign = (plan.outside ?? 'left') === 'left' ? 1 : -1;
  if (line.closed) {
    const g = line.segments[0]!;
    const mx = g.ax + g.ux * g.len / 2 + g.uz * 0.5;
    const mz = g.az + g.uz * g.len / 2 - g.ux * 0.5;
    outSign = insidePolygon(line.points, mx, mz) ? -1 : 1;
  }
  const outNormal = (seg: number): [number, number] => {
    const g = line.segments[seg]!;
    return [outSign * g.uz, -outSign * g.ux];
  };

  // ---------------------------------------------------------------- 1. Tore und Türme planen
  const gateSpecs = (plan.gates ?? []).map((g) => {
    const n = line.nearest(g.at[0], g.at[1]);
    const width = Math.max(1, Math.round(g.width ?? 3));
    const kind: GateKind = garden ? (width <= 2 ? 'fence_gate' : 'opening') : width === 1 ? 'door' : width === 2 ? 'double_door' : 'arch';
    return { spec: g, s: n.s, seg: n.seg, width, kind, clear: kind === 'arch' ? Math.max(2, g.height ?? 4) : 2 };
  });
  const lo = (w: number): number => -Math.floor(w / 2);
  const hi = (w: number): number => Math.floor((w - 1) / 2);
  const gateSpan = (g: { s: number; width: number }): [number, number] => [g.s + lo(g.width) - 1.5, g.s + hi(g.width) + 1.5];

  const slots: TowerSlot[] = [];
  if (towerMode !== 'none') {
    for (const g of gateSpecs) {
      if (g.spec.gatehouse !== true) continue;
      slots.push({ s: g.s + hi(g.width) + 2 + r, prio: 5, why: 'Torhaus' }, { s: g.s + lo(g.width) - 2 - r, prio: 5, why: 'Torhaus' });
    }
    for (const p of plan.extraTowers ?? []) slots.push({ s: line.nearest(p[0], p[1]).s, prio: 4, why: 'Zusatzturm' });
    const cosLimit = Math.cos(((plan.cornerAngle ?? 30) * Math.PI) / 180);
    line.points.forEach((_, i) => {
      const c = line.turnCos(i);
      if (c === undefined) slots.push({ s: line.vertexS(i), prio: 2, why: `Ende ${i}` });
      else if (c < cosLimit - EPS) slots.push({ s: line.vertexS(i), prio: 3, why: `Ecke ${i}` });
    });
  }
  const accepted: TowerSlot[] = [];
  const conflict = (s: number): string | undefined => {
    for (const g of gateSpecs) {
      const [a, b] = gateSpan(g);
      const da = line.delta(g.s, s);
      if (da + r + 0.5 > a - g.s + EPS && da - r - 0.5 < b - g.s - EPS) return 'Tor';
    }
    for (const t of accepted) if (Math.abs(line.delta(t.s, s)) < 2 * r + 2 - EPS) return 'Turm';
    if (!line.closed && (s < -EPS || s > line.total + EPS)) return 'Ende';
    return undefined;
  };
  const accept = (t: TowerSlot): void => {
    const why = conflict(t.s);
    if (why === undefined) accepted.push(t);
    else if (t.prio > 1) warn(`${t.why}: kein Turm (Konflikt mit ${why})`);
  };
  [...slots].sort((a, b) => b.prio - a.prio || a.s - b.s).forEach(accept);
  const spacing = plan.towerSpacing ?? 24;
  if (towerMode !== 'none' && spacing > 0) {
    const ss = accepted.map((t) => t.s).sort((a, b) => a - b);
    const gaps: [number, number][] = [];
    if (line.closed) {
      if (ss.length === 0) ss.push(0);
      ss.forEach((a, i) => gaps.push([a, i + 1 < ss.length ? ss[i + 1]! : ss[0]! + line.total]));
    } else {
      const bounds = [0, ...ss, line.total];
      for (let i = 0; i + 1 < bounds.length; i++) gaps.push([bounds[i]!, bounds[i + 1]!]);
    }
    for (const [a, b] of gaps) {
      const n = Math.ceil((b - a) / spacing) - 1;
      for (let j = 1; j <= n; j++) accept({ s: a + ((b - a) * j) / (n + 1), prio: 1, why: 'Abstand' });
    }
  }
  accepted.sort((a, b) => a.s - b.s);
  const centerOf = (t: TowerSlot): Cell => {
    const p = line.pointAt(t.s);
    return [Math.round(p.x), Math.round(p.z)];
  };
  // Türme, die ein anderes Bauwerk schneiden würden, entfallen
  for (let i = accepted.length - 1; i >= 0; i--) {
    const [cx, cz] = centerOf(accepted[i]!);
    if (footprintOffsets(style.shape, r).some(([dx, dz]) => site.isBlocked(cx + dx, cz + dz))) {
      warn(`${accepted[i]!.why}: kein Turm (anderes Bauwerk im Weg)`);
      accepted.splice(i, 1);
    }
  }

  // Turm-Grundrisse (absolut)
  const towerAt = new Map<number, number>();
  const towerCenters: Cell[] = [];
  accepted.forEach((t, i) => {
    const center = centerOf(t);
    towerCenters.push(center);
    for (const [dx, dz] of footprintOffsets(style.shape, r)) {
      const k = colKey(center[0] + dx, center[1] + dz);
      if (!towerAt.has(k)) towerAt.set(k, i);
    }
  });
  const inTower = (x: number, z: number): boolean => towerAt.has(colKey(x, z));

  // ---------------------------------------------------------------- 2. Grundriss (dicke Linie) und Ränder
  const half = (T - 1) / 2;
  const low = -(T + 1) / 2;
  const joinR = T / 2;
  const joins = line.points.filter((_, i) => line.closed || (i > 0 && i < line.points.length - 1));
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of line.points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const cells = new Map<number, WallCell>();
  let overlaps = 0;
  for (let z = minZ - T - 1; z <= maxZ + T + 1; z++) {
    for (let x = minX - T - 1; x <= maxX + T + 1; x++) {
      let inBand = line.segments.some((g) => {
        const t = (x - g.ax) * g.ux + (z - g.az) * g.uz;
        if (t < -EPS || t > g.len + EPS) return false;
        const o = outSign * ((x - g.ax) * g.uz - (z - g.az) * g.ux);
        return o > low + EPS && o <= half + EPS;
      });
      if (!inBand) inBand = joins.some(([vx, vz]) => Math.hypot(x - vx, z - vz) <= joinR + EPS);
      if (!inBand || inTower(x, z)) continue;
      if (site.isBlocked(x, z)) {
        overlaps++;
        continue;
      }
      const n = line.nearest(x, z);
      cells.set(colKey(x, z), { x, z, seg: n.seg, s: n.s, g: site.groundY(x, z), rim: 'core', c: 0 });
    }
  }
  if (overlaps > 0) warn(`${overlaps} Mauerzellen entfallen (anderes Bauwerk)`);
  const cellAt = (x: number, z: number): WallCell | undefined => cells.get(colKey(x, z));
  const list = [...cells.values()];

  /** Seite einer freien Nachbarzelle: außen (Feind), innen oder Stirnseite eines offenen Endes (zählt als außen). */
  const sideOf = (x: number, z: number): 'outer' | 'inner' => {
    const n = line.nearest(x, z);
    const g = line.segments[n.seg]!;
    if (!line.closed && ((n.seg === 0 && n.t < -EPS) || (n.seg === last && n.t > g.len + EPS))) return 'outer';
    return outSign * n.left < -EPS ? 'inner' : 'outer';
  };
  const isFree = (x: number, z: number): boolean => cellAt(x, z) === undefined && !inTower(x, z) && !site.isBlocked(x, z);
  for (const w of list) {
    const sides = N4.filter(([ax, az]) => isFree(w.x + ax, w.z + az)).map(([ax, az]) => sideOf(w.x + ax, w.z + az));
    w.rim = sides.includes('outer') ? 'outer' : sides.includes('inner') ? 'inner' : 'core';
  }

  // ---------------------------------------------------------------- 3. Tore, Kronenhöhe, Turmanschlüsse
  const gates: Gate[] = [];
  for (const g of gateSpecs) {
    const foot = line.pointAt(g.s);
    const gc = list.filter((w) => {
      const d = line.delta(g.s, w.s);
      return d > lo(g.width) - 0.5 - EPS && d <= hi(g.width) + 0.5 - EPS && Math.hypot(w.x - foot.x, w.z - foot.z) <= T + g.width;
    });
    if (gc.length === 0) {
      warn(`Tor bei ${g.spec.at.join(',')}: kein Mauerstück (Turm oder Lücke an dieser Stelle)`);
      continue;
    }
    gates.push({
      s: g.s, seg: g.seg, width: g.width, clear: g.clear, kind: g.kind, cells: gc, baseY: Math.max(...gc.map((w) => w.g + 1)),
      block: !garden && g.spec.gatehouse === true && g.spec.gateBlock === true && g.kind === 'arch',
    });
  }
  const passage = new Set(gates.flatMap((g) => g.cells));
  /** W3-CA: Mauerzellen des Torbaus – das Tor und je eine Spalte bis zu den Torhaus-Türmen. */
  function blockSpan(g: Gate): WallCell[] {
    const foot = line.pointAt(g.s);
    return list.filter((w) => {
      const d = line.delta(g.s, w.s);
      return d > lo(g.width) - 1.5 - EPS && d <= hi(g.width) + 1.5 + EPS && Math.hypot(w.x - foot.x, w.z - foot.z) <= T + g.width + 2;
    });
  }

  const R = Math.ceil(T / 2);
  for (const w of list) {
    let gmax = -Infinity;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) gmax = Math.max(gmax, site.groundY(w.x + dx, w.z + dz));
    w.c = gmax + H;
  }
  if (!garden) for (const g of gates) for (const w of g.cells) w.c = Math.max(w.c, g.baseY + g.clear + 1);
  // W3-CA: der Torbau braucht zwischen den Torhaus-Türmen eine ebene Krone (keine Stufen im überdeckten Durchgang)
  for (const g of gates) if (g.block) for (const w of blockSpan(g)) w.c = Math.max(w.c, g.baseY + g.clear + 1);

  const relax = (): void => {
    for (let changed = true; changed;) {
      changed = false;
      for (const w of list) {
        for (const [ax, az] of N4) {
          const n = cellAt(w.x + ax, w.z + az);
          if (n !== undefined && n.c < w.c - 1) {
            n.c = w.c - 1;
            changed = true;
          }
        }
      }
    }
  };
  const towerBase = towerCenters.map((c) => towerBaseY(site, c, style.shape, r));
  const adjacent: WallCell[][] = towerCenters.map(() => []);
  for (const w of list) {
    const seen = new Set<number>();
    for (const [ax, az] of N4) {
      const t = towerAt.get(colKey(w.x + ax, w.z + az));
      if (t !== undefined && !seen.has(t)) {
        seen.add(t);
        adjacent[t]!.push(w);
      }
    }
  }
  const level = towerCenters.map(() => -Infinity);
  for (let changed = true; changed;) {
    changed = false;
    relax();
    adjacent.forEach((adj, t) => {
      const L = Math.max(towerBase[t]! + 3, ...adj.map((w) => w.c));
      level[t] = L;
      // Gartenmauer: Türmchen heben die niedrige Mauer nicht an
      if (!garden) for (const w of adj) {
        if (w.c < L) {
          w.c = L;
          changed = true;
        }
      }
    });
    // W3-CA: Torbau – die Krone zwischen den Torhaus-Türmen bleibt eben (höchster Wert gilt für alle Zellen)
    for (const g of gates) {
      if (!g.block) continue;
      const span = blockSpan(g);
      if (span.length === 0) continue;
      const top = Math.max(...span.map((w) => w.c));
      for (const w of span) {
        if (w.c < top) {
          w.c = top;
          changed = true;
        }
      }
    }
  }

  // Stufen auf dem Wehrgang: Treppe zum höheren Nachbarn in Laufrichtung
  for (const w of list) {
    if (garden || w.rim === 'outer') continue;
    const g = line.segments[w.seg]!;
    let best = 0.7;
    for (const [ax, az, d] of N4) {
      const n = cellAt(w.x + ax, w.z + az);
      const dot = Math.abs(ax * g.ux + az * g.uz);
      if (n !== undefined && n.rim !== 'outer' && n.c === w.c + 1 && dot >= best - EPS) {
        best = dot + EPS;
        w.step = d;
      }
    }
  }

  // Grundriss am Boden belegen, Tor-Vorplätze freihalten (bevor Türme ihre Türen suchen)
  for (const w of list) site.block(w.x, w.z);
  const fronts = gates.map((g) => {
    const out: { x: number; z: number; d: HorizontalDir }[] = [];
    for (const w of g.cells) {
      for (const [ax, az, d] of N4) {
        const x = w.x + ax;
        const z = w.z + az;
        if (cellAt(x, z) !== undefined || inTower(x, z) || out.some((f) => f.x === x && f.z === z)) continue;
        out.push({ x, z, d });
      }
    }
    for (const f of out) site.block(f.x, f.z);
    return out;
  });

  // ---------------------------------------------------------------- 4a. Türme
  // W3-CA (Turmsatz): Ecktürme und Torhaus-Türme mit eigenem Abschluss; ohne Überschreibung der Stil des Mauerzugs
  const cornerStyle = plan.towerStyle?.corner !== undefined ? resolveRoleStyle(plan.towerStyle, plan.towerStyle.corner, warn, 'Ecktürme') : style;
  const gateStyle = plan.towerStyle?.gate !== undefined ? resolveRoleStyle(plan.towerStyle, plan.towerStyle.gate, warn, 'Torhaus-Türme') : style;
  const styleOf = (t: TowerSlot): ResolvedStyle => (t.why === 'Torhaus' ? gateStyle : t.why.startsWith('Ecke') ? cornerStyle : style);
  const gateBlock = !garden && gateSpecs.some((g) => g.spec.gatehouse === true && g.spec.gateBlock === true && g.kind === 'arch');
  const towers: TowerInfo[] = accepted.map((t, i) => {
    const center = towerCenters[i]!;
    const tid = `${owner}.t${i}`;
    const L = level[i]!;
    const openings: Cell[] = [];
    for (const w of adjacent[i]!) {
      if (w.rim === 'outer') continue;
      for (const [ax, az] of N4) if (towerAt.get(colKey(w.x + ax, w.z + az)) === i) openings.push([w.x + ax, w.z + az]);
    }
    // Tür zur Innenseite: gegen die Außennormalen der Segmente, die den Turm berühren
    const near = line.nearest(center[0], center[1]);
    const pref: [number, number] = [0, 0];
    line.segments.forEach((g, k) => {
      const tt = Math.min(Math.max((center[0] - g.ax) * g.ux + (center[1] - g.az) * g.uz, 0), g.len);
      if (Math.hypot(center[0] - g.ax - g.ux * tt, center[1] - g.az - g.uz * tt) <= near.dist + 0.5) {
        const [nx, nz] = outNormal(k);
        pref[0] -= nx;
        pref[1] -= nz;
      }
    });
    // W3-CA: Torbau – beide Torhaus-Türme gleich hoch (der Torbau reicht bis zu ihrer Plattform)
    const jitter = t.why === 'Torhaus' && gateBlock ? hashSeed(site.seed, owner, 'gate-rise') % 2 : hashSeed(site.seed, tid, 'rise') % 2;
    const own = styleOf(t);
    // W9-G5 (Materialspiel): Holzdach und Zinnenkappen an allen Mauertürmen, Hurde an den Torhaus-Türmen des Torbaus
    const accents = plan.accents === true
      ? { roof: 'roof_tower', cap: 'crown_cap', ...(t.why === 'Torhaus' && gateBlock ? { crown: 'hoarding' } : {}) }
      : undefined;
    return buildTower(site, {
      id: tid, center, style: own, baseY: towerBase[i]!,
      topY: L + rise + jitter, wallLevel: L, wall: owner, openings, doorPref: pref,
      spire: hasRoof(own.top) && hashSeed(site.seed, tid, 'spire') % 2 === 0,
      ...(opts.maxTop !== undefined && hasRoof(own.top) ? { maxTop: opts.maxTop } : {}),
      ...(accents !== undefined ? { accents } : {}),
    });
  });

  // ---------------------------------------------------------------- 4b. Mauerkörper, Brüstung, Zinnen
  const put = (x: number, y: number, z: number, b: Block, prio: number): boolean => site.canvas.put([x, y, z], b, owner, prio);
  // feat/tiled-wfc: Zinnenfolge je Bogenlängen-Slot aus dem Tiled-WFC (jeder Abschnitt gespiegelt, Knicke Zinnen)
  const crenels = garden || site.tiled === undefined ? undefined
    : wallCrenels(line, list, mw, hashSeed(site.seed, owner, 'wall-crenel'), site.tiled.themeId, (p) => solveAndLog(p, owner, 'wall', (e) => site.tiledLog.push(e)));
  if (garden) gardenBody(plan, line, list, gates, plinthRows, put);
  else for (const w of list) {
    const top = w.rim === 'outer' ? w.c + 1 : w.c;
    for (let y = w.g + 1; y <= top; y++) {
      // Sockel · Mauerkörper · Wehrgang-Belag (oberste Reihe innen) · Brüstung (außen über dem Wehrgang-Boden)
      const b = y < w.g + 1 + plinthRows ? B.base : y > w.c ? B.parapet : y === w.c && w.rim !== 'outer' ? B.walkway : B.wall;
      put(w.x, y, w.z, b, PRIO.wall);
    }
    if (w.rim === 'outer') {
      const slot = Math.round(w.s);
      const t = crenels?.get(slot);
      if (t === undefined ? ((slot % (mw + mg)) + (mw + mg)) % (mw + mg) < mw : isMerlon(t)) put(w.x, w.c + 2, w.z, B.parapet, PRIO.wall);
      if (t !== undefined && isCapped(t)) put(w.x, w.c + 3, w.z, B.cap, PRIO.wall);
    } else if (w.step !== undefined) {
      put(w.x, w.c + 1, w.z, stair('walkway', w.step), PRIO.stairs);
    }
  }

  // ---------------------------------------------------------------- 4c. Tore: Durchgang, Tür/Bogen, Vortreppen
  const gateInfos: GateInfo[] = gates.map((g, gi) => {
    const y0 = g.baseY;
    // Gartenmauer: ganze Mauer über der Schwelle frei (kein Sturz)
    for (const w of g.cells) for (let y = y0 + 1; y <= (garden ? Math.max(y0 + g.clear, w.c) : y0 + g.clear); y++) site.canvas.reserve([w.x, y, w.z], owner);
    const [nx, nz] = outNormal(g.seg);
    const facing = snapDir(nx, nz);
    const seg = line.segments[g.seg]!;
    if (g.kind === 'fence_gate') {
      const outer = g.cells.filter((w) => w.rim === 'outer');
      for (const w of outer.length > 0 ? outer : g.cells) put(w.x, y0 + 1, w.z, fenceGate(facing), PRIO.door);
    } else if (g.kind === 'opening') {
      // offene Lücke
    } else if (g.kind !== 'arch') {
      const outer = g.cells.filter((w) => w.rim === 'outer');
      const doorCells = outer.length > 0 ? outer : g.cells;
      // Doppeltür: die Tür links (gegen den Uhrzeigersinn von `facing`) bekommt hinge=left
      const [lx, lz] = [nz, -nx];
      const mid = doorCells.reduce((a, w) => a + w.x * lx + w.z * lz, 0) / doorCells.length;
      for (const w of doorCells) {
        const hinge = g.kind === 'door' || w.x * lx + w.z * lz > mid ? 'left' : 'right';
        put(w.x, y0 + 1, w.z, { role: 'door', shape: 'door', orient: { facing, half: 'lower', hinge } }, PRIO.door);
        put(w.x, y0 + 2, w.z, { role: 'door', shape: 'door', orient: { facing, half: 'upper', hinge } }, PRIO.door);
      }
    } else {
      // Bogen: umgedrehte Treppen in den obersten Ecken, Rückseite zur Laibung
      const slotOf = (w: WallCell): number => Math.round(line.delta(g.s, w.s));
      const slotsOf = g.cells.map(slotOf);
      const minS = Math.min(...slotsOf);
      const maxS = Math.max(...slotsOf);
      for (const w of g.cells) {
        const sl = slotOf(w);
        if (sl === minS) put(w.x, y0 + g.clear, w.z, stair('wall_primary', snapDir(-seg.ux, -seg.uz), 'top'), PRIO.door);
        else if (sl === maxS) put(w.x, y0 + g.clear, w.z, stair('wall_primary', snapDir(seg.ux, seg.uz), 'top'), PRIO.door);
      }
    }
    const approach: Cell[] = [];
    const seenApproach = new Set<number>();
    const addApproach = (x: number, z: number): void => {
      if (seenApproach.has(colKey(x, z))) return;
      seenApproach.add(colKey(x, z));
      approach.push([x, z]);
    };
    for (const f of fronts[gi]!) {
      for (let y = y0 + 1; y <= y0 + g.clear; y++) site.canvas.reserve([f.x, y, f.z], owner);
      addApproach(f.x, f.z);
      const run = planStairRun(site, [f.x, f.z], f.d, y0, { ownStart: true });
      if (run !== undefined) {
        commitStairRun(site, run, 'foundation', owner);
        for (const [x, , z] of run.steps) addApproach(x, z);
      } else warn(`Tor bei s=${g.s.toFixed(1)}: Vortreppe bei ${f.x},${f.z} nicht möglich`);
    }
    const foot = line.pointAt(g.s);
    return {
      center: [Math.round(foot.x), Math.round(foot.z)] as Cell, width: g.width, kind: g.kind, baseY: y0, clear: g.clear,
      passage: g.cells.map((w): Vec3 => [w.x, y0 + 1, w.z]),
      approach,
    };
  });

  // ---------------------------------------------------------------- 4c'. Torbau (W3-CA)
  const walled = new Set<WallCell>();
  for (const g of gates) if (g.block) gateHouseBlock(g);

  /**
   * Torbau: das Mauerstück zwischen den Torhaus-Türmen wird bis zu deren Plattform hochgezogen. Der Wehrgang läuft als
   * überdeckter Durchgang (Kernreihe) hindurch, mit einer Laterne unter der Decke und Scharten in beiden Fronten; oben
   * eine Plattform mit Zinnen, außen als Pechnase eine Zelle vor der Mauer auf Kragsteinen. Im Bogen hängt ein
   * hochgezogenes Fallgitter (Zaun, 1–2 Reihen unter dem Sturz). Zinnen je Seite spiegelgleich zur Torachse.
   */
  function gateHouseBlock(g: Gate): void {
    const reach = hi(g.width) + 2 + r;
    const pair = accepted.flatMap((t, i) => (t.why === 'Torhaus' && Math.abs(Math.abs(line.delta(g.s, t.s)) - reach) < 1 ? [towers[i]!] : []));
    const span = blockSpan(g);
    const c = span[0]?.c;
    const Y = Math.min(...pair.map((t) => t.topY));
    const why = pair.length !== 2 ? `${pair.length} Torhaus-Türme` : c === undefined ? 'kein Mauerstück'
      : span.some((w) => w.c !== c || w.step !== undefined) ? 'Wehrgang nicht eben' : !span.some((w) => w.rim === 'core') ? 'Mauer zu dünn'
        : Y - c < 4 ? 'Türme zu niedrig' : undefined;
    if (why !== undefined || c === undefined) {
      warn(`Tor bei s=${g.s.toFixed(1)}: Torbau nicht möglich (${why})`);
      return;
    }
    const [nx, nz] = outNormal(g.seg);
    const inward = snapDir(-nx, -nz);
    const slot = (w: WallCell): number => Math.round(line.delta(g.s, w.s));
    const merlon = (w: WallCell): boolean => slot(w) % 2 === 0;
    // W9-G5: mit Akzenten ist die Krone des Torbaus eine Hurde (Holz) mit Kappen auf den Zinnen, wie die Torhaus-Türme
    const crown: Block = plan.accents === true ? { ...B.parapet, role: 'hoarding' } : B.parapet;
    for (const w of span) {
      put(w.x, Y, w.z, B.walkway, PRIO.wall);
      if (w.rim === 'core') {
        if (slot(w) === 0 && Y - 1 >= c + 3) put(w.x, Y - 1, w.z, B.hangingLantern, PRIO.feature);
        continue;
      }
      for (let y = c + 1; y < Y; y++) put(w.x, y, w.z, B.wall, PRIO.wall);
      if (Math.abs(slot(w)) <= 1) put(w.x, c + 2, w.z, B.slit, PRIO.feature);
      if (w.rim === 'inner') walled.add(w);
      const qx = w.x + Math.round(nx);
      const qz = w.z + Math.round(nz);
      const nose = w.rim === 'outer' && cellAt(qx, qz) === undefined && !inTower(qx, qz) && site.canvas.at([qx, Y, qz]) === undefined;
      const [px, pz] = nose ? [qx, qz] : [w.x, w.z];
      if (nose) put(px, Y, pz, stair('wall_primary', inward, 'top'), PRIO.wall);
      put(px, Y + 1, pz, crown, PRIO.wall);
      if (merlon(w)) {
        put(px, Y + 2, pz, crown, PRIO.wall);
        if (plan.accents === true && site.canvas.at([px, Y + 3, pz]) === undefined) put(px, Y + 3, pz, { role: 'crown_cap', shape: 'slab', orient: { half: 'bottom' } }, PRIO.feature);
      }
    }
    if (plan.accents === true) gateBanners(pair, snapDir(nx, nz));
    // Fallgitter: Kernreihe des Durchgangs, 1–2 Reihen unter dem Sturz (mindestens 3 Reihen bleiben frei)
    const bars = Math.min(2, g.clear - 3);
    for (const w of g.cells) {
      if (w.rim !== 'core') continue;
      for (let k = 0; k < bars; k++) put(w.x, g.baseY + g.clear - k, w.z, B.fence, PRIO.door);
    }
  }

  /**
   * W9-G5: Bannerpaar an den Torhaus-Türmen – je ein Wandbanner mittig auf der Feldseite jedes Turms, beide in derselben
   * Höhe (spiegelgleich zur Torachse): die höchste Reihe unter dem Kragsteinkranz, in der hinter Banner und Tuch (eine
   * Reihe tiefer) volle Turmwand steht (keine Scharte) und vor dem Turm beide Zellen frei sind. Passt es an einem Turm
   * nicht, entfällt das Paar (Hinweis) – nie ein einzelnes Banner.
   */
  function gateBanners(pair: readonly TowerInfo[], out: HorizontalDir): void {
    const [ax, az] = N4.find((n) => n[2] === out)!;
    const solid = (p: Vec3): boolean => {
      const b = site.canvas.at(p);
      return b !== undefined && b.shape === 'block' && (b.role === 'wall_primary' || b.role === 'fort_base');
    };
    const open = (p: Vec3): boolean => site.canvas.at(p) === undefined && !site.canvas.isReserved(p);
    const fits = (t: TowerInfo, y: number): boolean => {
      const back = (yy: number): Vec3 => [t.center[0] + ax * r, yy, t.center[1] + az * r];
      const front = (yy: number): Vec3 => [t.center[0] + ax * (r + 1), yy, t.center[1] + az * (r + 1)];
      return solid(back(y)) && solid(back(y - 1)) && open(front(y)) && open(front(y - 1));
    };
    const top = Math.min(...pair.map((t) => t.topY)) - 1;
    const low = Math.max(...pair.map((t) => (t.wallLevel ?? t.baseY) + 2));
    for (let y = top; y >= low; y--) {
      if (!pair.every((t) => fits(t, y))) continue;
      for (const t of pair) put(t.center[0] + ax * (r + 1), y, t.center[1] + az * (r + 1), { role: 'textile_primary', shape: 'wall_banner', orient: { facing: out } }, PRIO.feature);
      return;
    }
    warn('Torhaus: kein Platz für das Bannerpaar');
  }

  // ---------------------------------------------------------------- 4d. Treppenaufgänge (innen, entlang der Mauer)
  const stairs: { bottom: Vec3; top: Vec3 }[] = [];
  const hasWalkway = list.some((w) => w.rim !== 'outer');
  const mode = garden ? 'none' : plan.stairs ?? 'auto';
  if (mode !== 'none' && hasWalkway) {
    let targets: Cell[];
    if (mode !== 'auto') targets = [...mode];
    else if (gates.length > 0) {
      const g = gates[0]!;
      const p = line.pointAt(g.s + hi(g.width) + 3);
      targets = [[p.x, p.z]];
    } else {
      const g = [...line.segments].sort((a, b) => b.len - a.len)[0]!;
      const p = line.pointAt(g.s0 + g.len / 2);
      targets = [[p.x, p.z]];
    }
    for (const [tx, tz] of targets) {
      const cands = list
        .filter((w) => w.rim === 'inner' && w.step === undefined && !passage.has(w)
          && gates.every((g) => Math.abs(line.delta(g.s, w.s)) >= g.width / 2 + 2))
        .sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz) || a.s - b.s);
      let done = false;
      for (const w of cands.slice(0, 400)) {
        const g = line.segments[w.seg]!;
        const along = snapDir(g.ux, g.uz);
        const back = snapDir(-g.ux, -g.uz);
        for (const [ax, az] of N4) {
          const qx = w.x + ax;
          const qz = w.z + az;
          if (!isFree(qx, qz) || sideOf(qx, qz) !== 'inner') continue;
          for (const step of [back, along]) {
            const run = planStairRun(site, [qx, qz], step, w.c);
            if (run === undefined || run.steps.length === 0) continue;
            commitStairRun(site, run, 'wall_primary', owner);
            stairs.push({ top: run.steps[0]!, bottom: run.steps[run.steps.length - 1]! });
            done = true;
            break;
          }
          if (done) break;
        }
        if (done) break;
      }
      if (!done) warn(`kein Platz für einen Treppenaufgang nahe ${Math.round(tx)},${Math.round(tz)}`);
    }
  }

  // ---------------------------------------------------------------- 4e. Anlauf (Treppen am Fuß der Außenseite)
  if (plan.plinth?.batter ?? !garden) {
    for (const w of list) {
      if (w.rim !== 'outer') continue;
      for (const [ax, az, d] of N4) {
        const qx = w.x + ax;
        const qz = w.z + az;
        if (!isFree(qx, qz) || sideOf(qx, qz) !== 'outer') continue;
        const y = site.groundY(qx, qz) + 1;
        if (y <= w.c && put(qx, y, qz, stair('foundation', opposite(d)), PRIO.batter)) site.mark(qx, qz);
      }
    }
  }

  const walkway = list.filter((w) => !garden && w.rim !== 'outer' && !walled.has(w)).map((w): Vec3 => [w.x, w.c + (w.step !== undefined ? 2 : 1), w.z]);
  return {
    wall: { id: owner, walkway, stairs, towers: towers.map((t) => t.id), gates: gateInfos },
    towers,
  };
}

/**
 * Gartenmauer (Z2): Felder (Sockel + Mauer bzw. Hecke) bis zur Krone, Pfeiler an Stützpunkten, im Takt
 * ≤ pillarEvery dazwischen und beiderseits der Tore (dort 1 höher). Ein Pfeiler belegt die Querschnitte mit
 * Bogenlängen-Abstand in (−½, ½]; Taktpfeiler näher als 2 an einem Torpfeiler entfallen.
 */
function gardenBody(
  plan: WallPlan, line: Polyline, list: readonly WallCell[], gates: readonly Gate[], plinthRows: number,
  put: (x: number, y: number, z: number, b: Block, prio: number) => boolean,
): void {
  const every = Math.max(2, Math.round(plan.garden?.pillarEvery ?? 4));
  const field = plan.garden?.hedge === true ? B.hedge : B.wall;
  const top = plan.garden?.lanterns === true ? B.lantern : B.cap;
  const gatePosts = gates.flatMap((g) => [g.s - Math.floor(g.width / 2) - 1, g.s + Math.floor((g.width - 1) / 2) + 1]);
  const posts: { s: number; tall: boolean }[] = gatePosts.map((s) => ({ s, tall: true }));
  const regular: number[] = [];
  for (const g of line.segments) {
    const n = Math.max(1, Math.ceil(g.len / every - EPS));
    for (let j = 0; j < n; j++) regular.push(g.s0 + (g.len * j) / n);
  }
  if (!line.closed) regular.push(line.total);
  for (const s of regular) if (gatePosts.every((p) => Math.abs(line.delta(p, s)) >= 2 - EPS)) posts.push({ s, tall: false });
  const passage = new Set(gates.flatMap((g) => g.cells));
  for (const w of list) {
    // Torzellen: Schwelle aus Sockelsteinen (darüber reserviert das Tor)
    for (let y = w.g + 1; y <= w.c; y++) put(w.x, y, w.z, y < w.g + 1 + plinthRows || passage.has(w) ? B.base : field, PRIO.wall);
    if (passage.has(w)) continue;
    const hit = posts.filter((p) => {
      const d = line.delta(p.s, w.s);
      return d > -0.5 + EPS && d <= 0.5 + EPS;
    });
    if (hit.length === 0) continue;
    const peak = w.c + (hit.some((p) => p.tall) ? 2 : 1);
    for (let y = w.g + 1 + plinthRows; y <= peak; y++) put(w.x, y, w.z, B.pillar, PRIO.wall);
    put(w.x, peak + 1, w.z, top, PRIO.wall);
  }
}

const opposite = (d: HorizontalDir): HorizontalDir => ({ north: 'south', south: 'north', east: 'west', west: 'east' } as const)[d];

/**
 * Zinnen eines Mauerzugs aus dem Tiled-WFC (feat/tiled-wfc): Kette über die Bogenlängen-Slots der Außenkante (Ring bei
 * geschlossenem Zug), jeder gerade Abschnitt ein Palindrom, Knickpunkte Zinnen. Unlösbar → `undefined` (fester Takt).
 */
function wallCrenels(
  line: Polyline, list: readonly WallCell[], width: number, seed: number, themeId: string | undefined, solve: (p: CrenelProblem) => CrenelTile[] | undefined,
): Map<number, CrenelTile> | undefined {
  const slots = [...new Set(list.filter((w) => w.rim === 'outer').map((w) => Math.round(w.s)))];
  if (slots.length === 0) return undefined;
  const L = Math.round(line.total);
  const ring = line.closed && L >= 3;
  const lo = ring ? 0 : Math.min(...slots, 0);
  const hi = ring ? L - 1 : Math.max(...slots, L);
  const n = hi - lo + 1;
  const idx = (slot: number): number => (ring ? ((slot % L) + L) % L : slot - lo);
  const ranges: [number, number][] = [];
  const corners = new Set<number>();
  for (const g of line.segments) {
    const a = Math.round(g.s0);
    const b = Math.round(g.s0 + g.len);
    if (b > a) ranges.push([a, b]);
    corners.add(idx(a));
    corners.add(idx(b));
  }
  const mirror = palindromePairs(ranges).map(([a, b]): [number, number] => {
    const [i, j] = [idx(a), idx(b)];
    return [Math.min(i, j), Math.max(i, j)];
  });
  const tiles = solve({
    n, ring, mirror, merlons: [...corners].filter((i) => i >= 0 && i < n), preferWidth: width, seed, ...(themeId !== undefined ? { themeId } : {}),
  });
  if (tiles === undefined) return undefined;
  const out = new Map<number, CrenelTile>();
  for (const slot of slots) out.set(slot, tiles[idx(slot)]!);
  return out;
}
