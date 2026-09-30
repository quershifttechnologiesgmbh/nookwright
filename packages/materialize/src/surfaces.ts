/**
 * Pipeline-Schritt 4b „Muster“ (research/12 §3–§5, §7.5): Flächen-Regeln des Themes (`surfaces`) ändern
 * Rolle, Form und Achse VORHANDENER Hüllzellen – nie die Belegung. Nur Zellen mit der Standardrolle der
 * Hülle (Boden `floor_primary`, Wand `wall_primary`, Decke `ceiling`) werden umgestaltet; alles andere
 * (Türen, Fenster, Pfeiler, Stürze, Dach, eigene Rollen) bleibt unverändert.
 *
 * Reihenfolge je Bodenzelle (erste passende Regel gewinnt): Türschwelle → Wandfuß → Bordüre → Muster → Grundrolle.
 * Die Achse ist ein Hinweis: sie gilt nur, wenn der aufgelöste Block eine Achse hat (Stamm, Holz).
 *
 * Additiv (F1): Wandregeln mit `timber` legen Fachwerk über die Wand (timber.ts); im Fachwerk werden auch Eckquader
 * (`wall_quoin`) zu Ständern bzw. Fachwerkzellen (research/12 §3.6); außerhalb des Fachwerks gilt „Ecke nach
 * Material“ (W2, Baustandard W3/I1): Eckstamm bei Holzfeld, Quader nur in der Eckzelle (`quoinOut`). Regeln mit
 * `along` legen Stämme entlang der Wand
 * (Schwelle auf der Bodenplatte). Dachregeln (research/16 D12) tauschen nur die Rolle von `roof_main`-Zellen; Form und
 * Ausrichtung bleiben.
 */
import type { ShellCell } from '@mcda/blueprint';
import { isWoodRole, type CeilingRecipe, type FloorPattern, type FloorRecipe, type ResolvedTheme, type SurfaceRule, type SurfaceWhen } from '@mcda/catalog';
import type { Axis2, CellContext, RoomFrame } from './context.js';
import { surfaceRole } from './shell-shapes.js';
import { TIMBER_DEFAULTS, timberOut } from './timber.js';

export interface SurfaceOut {
  readonly role: string;
  readonly shape: string;
  /** Achse für Stämme/Holz (x | y | z). */
  readonly axis?: 'x' | 'y' | 'z';
  /**
   * W2 (Baustandard I3): Teppich in der Zelle ÜBER der Bodenzelle (Läufer). Die Bodenplatte behält ihre Grundrolle,
   * damit der Raum darunter keine Wolle in der Decke sieht; der Teppich weicht Möbeln (`lining.ts`).
   */
  readonly carpet?: { readonly role: string; readonly shape: string };
}

/** Standardrollen der Hülle je Zellart, die Flächen-Regeln umgestalten dürfen. */
export const SURFACE_DEFAULT_ROLES: Readonly<Partial<Record<ShellCell['kind'], string>>> = {
  floor: 'floor_primary',
  wall: 'wall_primary',
  ceiling: 'ceiling',
  roof: 'roof_main',
};

const inRange = (v: number, r: number | readonly [number, number]): boolean => (typeof r === 'number' ? v === r : v >= r[0] && v <= r[1]);
const mod = (a: number, m: number): number => ((a % m) + m) % m;

export function matchesWhen(when: SurfaceWhen | undefined, ctx: CellContext): boolean {
  if (when === undefined) return true;
  if (when.roomTypes !== undefined && (ctx.roomType === undefined || !when.roomTypes.includes(ctx.roomType))) return false;
  if (when.exterior !== undefined && ctx.exterior !== when.exterior) return false;
  if (when.hRel !== undefined && !inRange(ctx.hRel, when.hRel)) return false;
  if (when.fromTop !== undefined && !inRange(ctx.H - 1 - ctx.hRel, when.fromTop)) return false;
  if (when.minHeight !== undefined && ctx.H < when.minHeight) return false;
  if (when.maxHeight !== undefined && ctx.H > when.maxHeight) return false;
  if (when.storey !== undefined && !inRange(ctx.storey, when.storey)) return false;
  if (when.topStorey !== undefined && ctx.topStorey !== when.topStorey) return false;
  if (when.bottomStorey !== undefined && (ctx.bottomStorey ?? true) !== when.bottomStorey) return false;
  if (when.roofLine !== undefined && (ctx.roofLine === undefined || !when.roofLine.includes(ctx.roofLine))) return false;
  if (when.upperFrame !== undefined && (ctx.upperFrame === true) !== when.upperFrame) return false;
  return true;
}

function firstMatch<T extends { readonly when?: SurfaceWhen | undefined }>(rules: readonly T[] | undefined, ctx: CellContext): T | undefined {
  return rules?.find((r) => matchesWhen(r.when, ctx));
}

/** W7-A (27.09.2026): erste passende Wandregel des Themes für eine Zelle – dieselbe Wahl wie die Wand-Ausgabe (`wallOut`). */
export function wallRuleOf(theme: ResolvedTheme, ctx: CellContext): SurfaceRule | undefined {
  return firstMatch(theme.surfaces.wall, ctx);
}

/** Ring-Zelle: Stamm parallel zur Wand, an Ecken achsenneutral. */
function ring(role: string, shape: string, corner: string, ctx: CellContext): SurfaceOut {
  if (ctx.corner || ctx.wallAxis === undefined) return { role, shape: corner };
  return { role, shape, axis: ctx.wallAxis };
}

const other = (a: Axis2): Axis2 => (a === 'x' ? 'z' : 'x');

/** Läufer-Breite nach research/12 §4: 1 (quer ≤ 5), 2 (≤ 8), sonst 3. */
function runnerWidth(cross: number): number {
  return cross <= 5 ? 1 : cross <= 8 ? 2 : 3;
}

function patternOut(p: FloorPattern, ctx: CellContext, frame: RoomFrame, base: SurfaceOut): SurfaceOut | undefined {
  const { u, v } = ctx;
  const out = (shape: string | undefined, fallbackShape: string, axis?: Axis2): SurfaceOut =>
    ({ role: p.role, shape: shape ?? fallbackShape, ...(axis !== undefined ? { axis } : {}) });
  switch (p.type) {
    case 'checker': {
      const s = p.size ?? 1;
      return (Math.floor(u / s) + Math.floor(v / s)) % 2 === 1 ? out(p.shape, base.shape) : undefined;
    }
    case 'diagonal':
      return mod(u + v, p.period ?? 4) < (p.width ?? 2) ? out(p.shape, base.shape) : undefined;
    case 'herringbone': {
      const l = p.length ?? 2;
      return out(p.shape, 'log', mod(u - v, 2 * l) < l ? frame.uAxis : frame.vAxis);
    }
    case 'basketweave': {
      const s = p.size ?? 3;
      if (mod(u, s + 1) === s || mod(v, s + 1) === s) {
        return p.joint !== undefined ? { role: p.joint.role, shape: p.joint.shape ?? base.shape } : undefined;
      }
      return out(p.shape, 'log', (Math.floor(u / (s + 1)) + Math.floor(v / (s + 1))) % 2 === 0 ? frame.uAxis : frame.vAxis);
    }
    case 'joints':
      return mod(v + 3 * u, p.period ?? 5) === 0 ? out(p.shape, base.shape) : undefined;
    case 'rings': {
      const r = Math.floor(Math.max(Math.abs(2 * u - (frame.uLen - 1)), Math.abs(2 * v - (frame.vLen - 1))) / 2);
      return r % (p.period ?? 2) === 0 ? out(p.shape, base.shape) : undefined;
    }
    case 'runner': {
      const door = frame.mainDoor;
      if (door === undefined) return undefined;
      const along: Axis2 = door.toward === 'east' || door.toward === 'west' ? 'x' : 'z';
      const cross = other(along);
      const crossLen = cross === frame.uAxis ? frame.uLen : frame.vLen;
      const k = p.width ?? runnerWidth(crossLen);
      const off = (cross === 'x' ? ctx.x : ctx.z) - (cross === 'x' ? door.x : door.z);
      const lo = -Math.floor((k - 1) / 2);
      const hi = Math.ceil((k - 1) / 2);
      if (off < lo || off > hi) return undefined;
      // W2 (Baustandard I3): der Läufer ist ein Teppich AUF dem Boden, nie Wolle in der Bodenplatte – sonst sähe der
      // Raum darunter ihn in der Decke (X4 B3). Die Platte bleibt Grundrolle; die Form des Musters gilt nicht mehr.
      const edge = k >= 3 && p.edge !== undefined && (off === lo || off === hi);
      return { ...base, carpet: { role: edge ? p.edge!.role : p.role, shape: 'carpet' } };
    }
  }
}

function floorOut(theme: ResolvedTheme, cell: ShellCell, ctx: CellContext): SurfaceOut | undefined {
  const recipes = theme.surfaces.floor;
  const frame = ctx.frame;
  const shortSide = frame !== undefined ? Math.min(frame.uLen, frame.vLen) : 0;
  if (ctx.wallDist === 0) {
    if (ctx.door) {
      // Türschwelle: Bordüre, wenn einer der Räume beiderseits eine hat (der Rahmen läuft durch die Tür),
      // sonst die Grundrolle des Träger-Raums, sonst wie der Wandfuß
      const sides: CellContext[] = [ctx, ...(ctx.doorSideTypes ?? []).map((t) => ({ ...ctx, roomType: t }))];
      for (const side of sides) {
        const r = firstMatch(recipes, side);
        if (r?.border === undefined || r.border.thresholds === false) continue;
        return ctx.wallAxis !== undefined
          ? { role: r.border.role, shape: r.border.shape ?? 'log', axis: ctx.wallAxis }
          : { role: r.border.role, shape: r.border.corner ?? 'wood' };
      }
      const own = firstMatch(recipes, ctx);
      if (own?.role !== undefined) return { role: own.role, shape: cell.shape };
    }
    const f = firstMatch(theme.surfaces.footing, ctx);
    return f !== undefined ? ruleOut(f, cell, ctx) : undefined;
  }
  const r: FloorRecipe | undefined = firstMatch(recipes, ctx);
  if (r === undefined) return undefined;
  const base: SurfaceOut = { role: r.role ?? cell.role, shape: cell.shape };
  const b = r.border;
  // Mindestbreiten je Theme (research/30 K5, „Clamp Overlap“): Standard 3 für den Rand, 5 für den zweiten Ring
  if (b !== undefined && frame !== undefined && shortSide >= (b.minSide ?? 3)) {
    if (ctx.wallDist === 1) return ring(b.role, b.shape ?? 'log', b.corner ?? 'wood', ctx);
    if (ctx.wallDist === 2 && b.inner !== undefined && shortSide >= (b.inner.minSide ?? 5)) {
      return ring(b.inner.role, b.inner.shape ?? b.shape ?? 'log', b.corner ?? 'wood', ctx);
    }
  }
  if (r.pattern !== undefined && frame !== undefined) {
    const p = patternOut(r.pattern, ctx, frame, base);
    if (p !== undefined) return p;
  }
  return base;
}

/**
 * Balkenpositionen entlang u (0 … len−1), Achsabstand `period`, möglichst spiegelsymmetrisch zur Mitte
 * (research/12 §5: Balkenraster). Bei ungerader Restbreite wird zuerst der Abstand ±1 versucht.
 */
export function beamPositions(len: number, period: number): number[] {
  const key = len * 64 + period;
  let r = BEAMS.get(key);
  if (r === undefined) {
    r = computeBeams(len, period);
    BEAMS.set(key, r);
  }
  return [...r];
}

const BEAMS = new Map<number, readonly number[]>();

function computeBeams(len: number, period: number): number[] {
  const c2 = len - 1; // doppelte Mitte
  const tryWith = (p: number): number[] | undefined => {
    const n = Math.floor((len - 1) / p);
    if (p < 2 || n < 1) return undefined;
    if ((c2 - (n - 1) * p) % 2 !== 0) return undefined;
    return Array.from({ length: n }, (_, k) => (c2 + (2 * k - (n - 1)) * p) / 2);
  };
  const sym = tryWith(period) ?? tryWith(period + 1) ?? tryWith(period - 1);
  if (sym !== undefined) return sym;
  const n = Math.floor((len - 1) / period);
  if (n < 1) return [];
  const off = Math.floor((len - 1 - (n - 1) * period) / 2);
  return Array.from({ length: n }, (_, k) => off + k * period);
}

function ceilingOut(theme: ResolvedTheme, cell: ShellCell, ctx: CellContext): SurfaceOut | undefined {
  const r: CeilingRecipe | undefined = firstMatch(theme.surfaces.ceiling, ctx);
  if (r === undefined) return undefined;
  if (ctx.wallDist === 0) {
    if (r.plate === undefined) return undefined;
    return ctx.wallAxis !== undefined
      ? { role: r.plate.role, shape: r.plate.shape ?? 'log', axis: ctx.wallAxis }
      : { role: r.plate.role, shape: r.plate.corner ?? 'wood' };
  }
  const base: SurfaceOut = { role: r.role ?? cell.role, shape: cell.shape };
  const frame = ctx.frame;
  const bm = r.beams;
  if (bm === undefined || frame === undefined) return base;
  const onBeam = beamPositions(frame.uLen, bm.period ?? 3).includes(ctx.u);
  const onGirder = frame.vLen >= (bm.girderSpan ?? 8) && ctx.v === Math.floor((frame.vLen - 1) / 2);
  if (onBeam && onGirder) return { role: bm.role, shape: bm.crossing ?? 'wood' };
  if (onBeam) return { role: bm.role, shape: bm.shape ?? 'log', axis: frame.vAxis };
  if (onGirder) return { role: bm.role, shape: bm.shape ?? 'log', axis: frame.uAxis };
  return base;
}

/** Wand-/Wandfuß-Regel: Rolle und Form; mit `along` Stamm entlang der Wand, an Spalten ohne Laufrichtung `corner`. */
function ruleOut(r: SurfaceRule, cell: ShellCell, ctx: CellContext): SurfaceOut {
  if (r.along !== true) return { role: r.role, shape: r.shape ?? cell.shape };
  return ctx.wallAxis !== undefined ? { role: r.role, shape: r.shape ?? cell.shape, axis: ctx.wallAxis } : { role: r.role, shape: r.corner ?? 'wood' };
}

function wallOut(theme: ResolvedTheme, cell: ShellCell, ctx: CellContext, seed: number): SurfaceOut | undefined {
  const r: SurfaceRule | undefined = firstMatch(theme.surfaces.wall, ctx);
  if (r === undefined) return undefined;
  return r.timber !== undefined ? timberOut(r, r.timber, cell, ctx, seed) : ruleOut(r, cell, ctx);
}

/** Holzfläche je Theme und Rolle (W3), einmal je aufgelöstem Theme gerechnet. */
const woodRoles = new WeakMap<ResolvedTheme, Map<string, boolean>>();
function woodField(theme: ResolvedTheme, role: string): boolean {
  let m = woodRoles.get(theme);
  if (m === undefined) woodRoles.set(theme, (m = new Map()));
  let w = m.get(role);
  if (w === undefined) m.set(role, (w = isWoodRole(theme, role)));
  return w;
}

/**
 * Eckquader nach Material (W2, Baustandard W3 und I1), außerhalb des Fachwerks:
 *  - Die **Eckzelle** (Pfeiler an der Außenecke) ist nur von außen sichtbar. Ist das Wandfeld dort Holz, wird sie ein
 *    Eckstamm über die volle Höhe (`beam`, Stamm senkrecht) statt eines Steinquaders; sonst bleibt der Quader.
 *  - Die **verzahnten Nachbarzellen** liegen im Wandfeld und sind bei 1 Block dicken Wänden auch innen im Raum zu
 *    sehen. Sie werden wieder Wandfeld (Regel der Wand an dieser Stelle) – kein Quader auf der Innenseite.
 * Welche Regel die Wand trägt, entscheidet die erste passende Wandregel des Themes (sonst `wall_primary`).
 */
function quoinOut(theme: ResolvedTheme, r: SurfaceRule | undefined, cell: ShellCell, ctx: CellContext): SurfaceOut | undefined {
  const field = r?.role ?? SURFACE_DEFAULT_ROLES.wall!;
  if (cell.kind === 'wall') return r !== undefined ? ruleOut(r, cell, ctx) : { role: field, shape: cell.shape };
  return woodField(theme, field) ? { role: 'beam', shape: 'log', axis: 'y' } : undefined;
}

/** Dach (D12): nur die Rolle wechselt, Form und Ausrichtung der Hülle bleiben. */
function roofOut(theme: ResolvedTheme, cell: ShellCell, ctx: CellContext): SurfaceOut | undefined {
  const r = firstMatch(theme.surfaces.roof, ctx);
  return r !== undefined ? { role: r.role, shape: cell.shape } : undefined;
}

/**
 * Flächen-Regel für eine Hüllzelle; `undefined` = Zelle bleibt, wie die Hülle sie liefert.
 * Rein: hängt nur von Theme, Zelle, Kontext und Seed (Fachwerk-Motive) ab.
 */
export function applySurfaces(theme: ResolvedTheme, shellCell: ShellCell, ctx: CellContext, seed = 0): SurfaceOut | undefined {
  // W2 (D4): Giebelfeld ohne eigene Theme-Rolle verhält sich wie die Wand (Wandregeln, Fachwerk – bitgleich zu vorher)
  const early = surfaceRole((r) => Object.hasOwn(theme.roles, r), shellCell.role);
  const cell = early === shellCell.role ? shellCell : { ...shellCell, role: early };
  if (SURFACE_DEFAULT_ROLES[cell.kind] !== cell.role) {
    // Fachwerk-Geschoss: Eckquader werden Ständer bzw. Fachwerkzellen (research/12 §3.6)
    if (cell.role !== 'wall_quoin' || (cell.kind !== 'wall' && cell.kind !== 'pillar')) return undefined;
    const r = firstMatch(theme.surfaces.wall, ctx);
    return r?.timber !== undefined ? timberOut(r, r.timber, cell, ctx, seed) : quoinOut(theme, r, cell, ctx);
  }
  switch (cell.kind) {
    case 'floor': return floorOut(theme, cell, ctx);
    case 'wall': return wallOut(theme, cell, ctx, seed);
    case 'ceiling': return ceilingOut(theme, cell, ctx);
    case 'roof': return roofOut(theme, cell, ctx);
    default: return undefined;
  }
}

/**
 * Alle (Rolle, Form)-Paare, die die Flächen-Regeln eines Themes erzeugen können (für Vertragstests:
 * jede Kombination muss in jeder Zielversion auflösbar sein).
 */
export function surfaceRoleShapes(theme: ResolvedTheme): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (role: string, shape: string): void => {
    m.set(role, (m.get(role) ?? new Set()).add(shape));
  };
  const s = theme.surfaces;
  for (const r of s.floor ?? []) {
    if (r.role !== undefined) add(r.role, 'block');
    if (r.border !== undefined) {
      add(r.border.role, r.border.shape ?? 'log');
      add(r.border.role, r.border.corner ?? 'wood');
      if (r.border.inner !== undefined) {
        add(r.border.inner.role, r.border.inner.shape ?? r.border.shape ?? 'log');
        add(r.border.inner.role, r.border.corner ?? 'wood');
      }
    }
    const p = r.pattern;
    if (p !== undefined) {
      // Läufer (W2, I3): Teppich auf dem Boden statt Block in der Platte
      if (p.type === 'runner') add(p.role, 'carpet');
      else add(p.role, p.shape ?? (p.type === 'herringbone' || p.type === 'basketweave' ? 'log' : 'block'));
      if (p.type === 'basketweave' && p.joint !== undefined) add(p.joint.role, p.joint.shape ?? 'block');
      if (p.type === 'runner' && p.edge !== undefined) add(p.edge.role, 'carpet');
    }
  }
  for (const r of [...(s.wall ?? []), ...(s.footing ?? [])]) {
    add(r.role, r.shape ?? 'block');
    if (r.along === true) add(r.role, r.corner ?? 'wood');
    if (r.timber !== undefined) {
      const wood = r.timber.role ?? TIMBER_DEFAULTS.role;
      add(wood, 'log');
      add(wood, 'wood');
    }
  }
  // Dachregeln behalten die Form der Dachzelle
  for (const r of s.roof ?? []) for (const shape of ['stairs', 'slab', 'block']) add(r.role, shape);
  for (const r of s.ceiling ?? []) {
    if (r.role !== undefined) add(r.role, 'block');
    if (r.beams !== undefined) {
      add(r.beams.role, r.beams.shape ?? 'log');
      add(r.beams.role, r.beams.crossing ?? 'wood');
    }
    if (r.plate !== undefined) {
      add(r.plate.role, r.plate.shape ?? 'log');
      add(r.plate.role, r.plate.corner ?? 'wood');
    }
  }
  return m;
}
