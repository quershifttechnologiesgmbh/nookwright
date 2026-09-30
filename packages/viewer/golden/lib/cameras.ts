/**
 * Goldene Galerie (P0-A): feste Kameras je Bau, abgeleitet aus Weltgröße und Analyse (rein, reproduzierbar).
 *
 * Ansichten (Name → Inhalt):
 * - `fassade-n|o|s|w`: parallel, frontal, flach; nur der Bau (Box der Bau-Spalten + 2 Blöcke Rand).
 * - `hero-so`, `hero-nw`: Schrägansicht der ganzen Welt (Perspektive 40°, 30° von oben, eng um den Umriss).
 * - `nah-ecke`: Außenecke Südost vom Sockel bis zur Traufe; `nah-traufe`: Traufe/Ortgang an der Südwest-Ecke,
 *   leicht von unten (beide nur der Hauptbau + 1 Block, damit weder Baum noch Nebengebäude davorstehen);
 *   `nah-eingang`: Haupttür von außen, Hauptbau mit 4 Blöcken Umfeld (Weg, Stufen, Laternen).
 * - `schnitt-k`: Draufsicht (parallel, 72° geneigt, von Süden) mit Schnitt über Etage k, Tageslicht von oben.
 * - `innen-k`: niedrige Innenkamera (Augenhöhe 1,62) in der größten Fläche der Etage k.
 * - W10 Präsentation (zuerst im Kontaktbogen): `auge` (Augenhöhe 1,7 vor dem Eingang, 3/4, Erdhaus frontal),
 *   `auge-abend`, `tief` (tiefe 3/4-Ansicht) – mit Präsentations-Look (Sonne, weiche Schatten, Dunst; `look`).
 *   W10-B: bei Burgen steht `tief` vorn (`firstViewFor`); die Augenhöhe tritt bei verdeckter Sicht in den Hof.
 *
 * Kameras liegen in Weltkoordinaten des Rasters (0 … size−1); `variant` sagt, welcher Ausschnitt gerendert wird.
 */
import { FOV_Y, orbitAxes, type Orbit } from '../../src/camera.js';
import type { Analysis, Box, Corner, Dir, Floor } from './analyze.js';
import { DIR_STEP } from './analyze.js';
import type { Vec3 } from './grid.js';

export type ProjectionSpec =
  | { readonly kind: 'perspective'; readonly fovY: number; /** W10: Shift nach oben in Bildhöhen */ readonly shiftY?: number }
  | { readonly kind: 'orthographic'; readonly halfHeight: number };

export interface VariantSpec {
  readonly key: string;
  /** Ausschnitt (inklusive) in Rasterkoordinaten */
  readonly box: Box;
}

export interface ViewSpec {
  readonly name: string;
  /** Anzeige, deutsch */
  readonly label: string;
  readonly group: 'praesentation' | 'fassade' | 'hero' | 'nah' | 'schnitt' | 'innen';
  readonly variant: string;
  readonly projection: ProjectionSpec;
  readonly orbit: Orbit;
  /** W10: Präsentations-Look; ohne = Minecraft-Licht wie bisher */
  readonly look?: ViewLook;
}

export interface CameraOptions {
  /** Breite/Höhe des Bildes */
  readonly aspect: number;
  /** W10: Bau im Hügel (Erdhaus) – Augenhöhe frontal statt 3/4 */
  readonly buried?: boolean;
  /** W10: belegte Zelle (Sichtlinien der Augenhöhe); ohne: keine Suche, fester Schwenk */
  readonly solid?: (x: number, y: number, z: number) => boolean;
  /** W10-B: erste Präsentations-Ansicht (`firstViewFor`); ohne: Augenhöhe */
  readonly first?: 'auge' | 'tief';
}

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Gier-Winkel, damit die Kamera in Richtung (bx, bz) vom Ziel steht (Blick entgegengesetzt). */
export function yawFromBack(bx: number, bz: number): number {
  return Math.atan2(-bx, bz);
}

const corners = (b: { min: Vec3; max: Vec3 }): Vec3[] => {
  const out: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push([x, y, z]);
  return out;
};

/** Box aus Zellen (inklusive) → Quader in Blockkoordinaten (Kanten bei min und max+1). */
export const solidOf = (b: Box): { min: Vec3; max: Vec3 } => ({ min: b.min, max: [b.max[0] + 1, b.max[1] + 1, b.max[2] + 1] });

const center = (b: { min: Vec3; max: Vec3 }): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];

/** Parallelprojektion, die den Quader ganz zeigt (Rand `margin`). */
export function fitOrthographic(solid: { min: Vec3; max: Vec3 }, yaw: number, pitch: number, aspect: number, margin = 1.06): { orbit: Orbit; halfHeight: number } {
  const target = center(solid);
  const axes = orbitAxes({ target, yaw, pitch, distance: 1 });
  let hx = 0, hy = 0;
  for (const p of corners(solid)) {
    const q: Vec3 = [p[0] - target[0], p[1] - target[1], p[2] - target[2]];
    hx = Math.max(hx, Math.abs(q[0] * axes.right[0] + q[1] * axes.right[1] + q[2] * axes.right[2]));
    hy = Math.max(hy, Math.abs(q[0] * axes.up[0] + q[1] * axes.up[1] + q[2] * axes.up[2]));
  }
  const halfHeight = Math.max(hy, hx / aspect, 2) * margin;
  const radius = 0.5 * Math.hypot(solid.max[0] - solid.min[0], solid.max[1] - solid.min[1], solid.max[2] - solid.min[2]);
  return { orbit: { target, yaw, pitch, distance: radius + 20 }, halfHeight };
}

/** Perspektive (vertikaler Winkel `fovY`), deren Abstand den Quader ganz zeigt. */
export function fitPerspective(solid: { min: Vec3; max: Vec3 }, yaw: number, pitch: number, fovY: number, aspect: number, margin = 1.04): Orbit {
  return fitPerspectivePoints(corners(solid), yaw, pitch, fovY, aspect, margin);
}

/**
 * Perspektive, die alle Punkte zeigt und sie mittig ins Bild setzt: Abstand aus der engsten Bedingung je Punkt, dann
 * das Ziel in der Bildebene um die Mitte der Bildausdehnung verschieben (wenige Runden, konvergiert schnell).
 */
export function fitPerspectivePoints(points: readonly Vec3[], yaw: number, pitch: number, fovY: number, aspect: number, margin = 1.04): Orbit {
  if (points.length === 0) return { target: [0, 0, 0], yaw, pitch, distance: 10 };
  const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[k]!); hi[k] = Math.max(hi[k]!, p[k]!); }
  let target: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const { right, up, back } = orbitAxes({ target, yaw, pitch, distance: 1 });
  const tanV = Math.tan(fovY / 2), tanH = tanV * aspect;
  const dot = (q: Vec3, a: Vec3): number => q[0] * a[0] + q[1] * a[1] + q[2] * a[2];
  const distanceFor = (t: Vec3): number => {
    let d = 0;
    for (const p of points) {
      const q: Vec3 = [p[0] - t[0], p[1] - t[1], p[2] - t[2]];
      const z = dot(q, back);
      d = Math.max(d, z + Math.abs(dot(q, right)) / tanH, z + Math.abs(dot(q, up)) / tanV);
    }
    return d * margin;
  };
  for (let it = 0; it < 6; it++) {
    const d = distanceFor(target);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of points) {
      const q: Vec3 = [p[0] - target[0], p[1] - target[1], p[2] - target[2]];
      const w = Math.max(1e-3, d - dot(q, back));
      const u = dot(q, right) / w, v = dot(q, up) / w;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
    if (Math.abs(uc) < 1e-4 && Math.abs(vc) < 1e-4) break;
    target = [target[0] + (right[0] * uc + up[0] * vc) * d, target[1] + (right[1] * uc + up[1] * vc) * d, target[2] + (right[2] * uc + up[2] * vc) * d];
  }
  return { target, yaw, pitch, distance: clamp(distanceFor(target), 2, 390) };
}

/** Umriss-Punkte der Welt: je belegter Spalte die vier Ecken oben (über dem höchsten Block) und unten. */
export function hullPoints(a: Pick<Analysis, 'size' | 'columnTop' | 'columnBottom'>, box?: Box): Vec3[] {
  const [sx, , sz] = a.size;
  const out: Vec3[] = [];
  const x0 = box?.min[0] ?? 0, x1 = box?.max[0] ?? sx - 1, z0 = box?.min[2] ?? 0, z1 = box?.max[2] ?? sz - 1;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const top = a.columnTop[x + sx * z]!;
      if (top < 0) continue;
      const bottom = a.columnBottom[x + sx * z]!;
      for (const [cx, cz] of [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]] as const) out.push([cx, top + 1, cz], [cx, bottom, cz]);
    }
  }
  return out;
}

const expand = (b: Box, dx: number, size: Vec3, y0?: number, y1?: number): Box => ({
  min: [Math.max(0, b.min[0] - dx), clamp(y0 ?? b.min[1], 0, size[1] - 1), Math.max(0, b.min[2] - dx)],
  max: [Math.min(size[0] - 1, b.max[0] + dx), clamp(y1 ?? b.max[1], 0, size[1] - 1), Math.min(size[2] - 1, b.max[2] + dx)],
});

const FACADES: ReadonlyArray<readonly [string, string, number, number]> = [
  ['fassade-n', 'Fassade Nord', 0, -1],
  ['fassade-o', 'Fassade Ost', 1, 0],
  ['fassade-s', 'Fassade Süd', 0, 1],
  ['fassade-w', 'Fassade West', -1, 0],
];

const DIAG: Readonly<Record<string, readonly [number, number]>> = {
  north: [0, -1], northeast: [1, -1], east: [1, 0], southeast: [1, 1], south: [0, 1], southwest: [-1, 1], west: [-1, 0], northwest: [-1, -1],
};

/** Standard-Blickwinkel für Nahaufnahmen (vertikal). */
export const CLOSE_FOV = 45 * DEG;
export const HERO_FOV = 40 * DEG;
export const INTERIOR_FOV = FOV_Y; // 70° wie Minecraft
/** Draufsicht: fast senkrecht, von Süden (Möbel bleiben als Körper lesbar) */
export const PLAN_PITCH = 72 * DEG;

function cornerView(name: string, label: string, c: Corner, fromBelow: boolean): ViewSpec {
  const len = Math.hypot(c.out[0], c.out[1]);
  const bx = c.out[0] / len, bz = c.out[1] / len;
  // Außenkante der Eckspalte
  const ex = c.x + (c.out[0] > 0 ? 1 : 0), ez = c.z + (c.out[1] > 0 ? 1 : 0);
  if (!fromBelow) {
    const y0 = c.groundY + 1, y1 = c.eaveY + 2;
    const h = Math.max(4, y1 - y0);
    const distance = clamp((h / 2) / Math.tan(CLOSE_FOV / 2) * 1.15, 6, 40);
    return {
      name, label, group: 'nah', variant: 'haupt', projection: { kind: 'perspective', fovY: CLOSE_FOV },
      orbit: { target: [ex, (y0 + y1) / 2, ez], yaw: yawFromBack(bx, bz), pitch: 10 * DEG, distance },
    };
  }
  return {
    name, label, group: 'nah', variant: 'haupt', projection: { kind: 'perspective', fovY: CLOSE_FOV },
    orbit: { target: [ex, c.eaveY + 0.5, ez], yaw: yawFromBack(bx, bz), pitch: -12 * DEG, distance: 9 },
  };
}

function interiorView(f: Floor): ViewSpec | undefined {
  const s = f.spot;
  if (s === undefined) return undefined;
  const [dx, dz] = DIAG[s.dir]!;
  const len = Math.hypot(dx, dz);
  const fx = dx / len, fz = dz / len;
  const pitch = 8 * DEG; // leicht nach unten
  const distance = 4;
  const eye: Vec3 = [s.pos[0] + 0.5, s.pos[1] + 1.62, s.pos[2] + 0.5];
  const cp = Math.cos(pitch);
  const target: Vec3 = [eye[0] + fx * cp * distance, eye[1] - Math.sin(pitch) * distance, eye[2] + fz * cp * distance];
  return {
    name: `innen-${f.index}`, label: `Innen Etage ${f.index} (y ${f.feetY})`, group: 'innen', variant: 'voll',
    projection: { kind: 'perspective', fovY: INTERIOR_FOV },
    orbit: { target, yaw: yawFromBack(-fx, -fz), pitch, distance },
  };
}

/** Varianten (Ausschnitte) und Ansichten eines Baus. */
export function deriveCameras(a: Analysis, opts: CameraOptions): { variants: VariantSpec[]; views: ViewSpec[] } {
  const { aspect } = opts;
  const size = a.size;
  const whole: Box = { min: [0, 0, 0], max: [size[0] - 1, size[1] - 1, size[2] - 1] };
  // Sockel statt Gelände: beim Erdhaus liegt der Hügel über der Tür (W7-J)
  const baseY = Math.max(0, a.baseY - 1);
  const bau = expand(a.building, 2, size, baseY, a.building.max[1]);
  // Nahaufnahmen: nur der Hauptbau (+1: Sockel, Blumenkästen), damit weder Baum noch Nebengebäude davorstehen;
  // der Eingang mit 4 Blöcken Umfeld (Weg, Stufen, Laternen vor der Tür)
  const haupt = expand(a.main, 1, size, 0, size[1] - 1);
  const umfeld = expand(a.main, 4, size, baseY, size[1] - 1);
  const variants: VariantSpec[] = [{ key: 'voll', box: whole }, { key: 'bau', box: bau }, { key: 'haupt', box: haupt }, { key: 'umfeld', box: umfeld }];
  // W10: Präsentation zuerst (Augenhöhe ist das erste Bild)
  const views: ViewSpec[] = presentationViews(a, aspect, opts.buried === true, opts.solid, opts.first);

  // Fassaden: Bau-Box (+1) frontal, parallel
  const frame = solidOf(expand(a.building, 1, size, baseY, a.building.max[1]));
  for (const [name, label, bx, bz] of FACADES) {
    const fit = fitOrthographic(frame, yawFromBack(bx, bz), 0, aspect);
    views.push({ name, label, group: 'fassade', variant: 'bau', projection: { kind: 'orthographic', halfHeight: fit.halfHeight }, orbit: fit.orbit });
  }

  // Hero: ganze Welt schräg von oben, eng um den Umriss aller Spalten
  const hull = hullPoints(a);
  views.push({ name: 'hero-so', label: 'Schrägansicht Südost', group: 'hero', variant: 'voll', projection: { kind: 'perspective', fovY: HERO_FOV }, orbit: fitPerspectivePoints(hull, yawFromBack(1, 1), 30 * DEG, HERO_FOV, aspect) });
  views.push({ name: 'hero-nw', label: 'Schrägansicht Nordwest', group: 'hero', variant: 'voll', projection: { kind: 'perspective', fovY: HERO_FOV }, orbit: fitPerspectivePoints(hull, yawFromBack(-1, -1), 30 * DEG, HERO_FOV, aspect) });

  // Nahaufnahmen
  if (a.corners.se !== undefined) views.push(cornerView('nah-ecke', 'Außenecke Südost', a.corners.se, false));
  if (a.corners.sw !== undefined) views.push(cornerView('nah-traufe', 'Traufe/Ortgang Südwest', a.corners.sw, true));
  const door = a.mainDoor;
  if (door !== undefined && door.outward !== undefined) {
    const [ox, oz] = DIR_STEP[door.outward as Dir];
    views.push({
      name: 'nah-eingang', label: `Eingang (${door.outward})`, group: 'nah', variant: 'umfeld', projection: { kind: 'perspective', fovY: CLOSE_FOV },
      orbit: { target: [door.pos[0] + 0.5 + ox * 0.5, door.pos[1] + 1.2, door.pos[2] + 0.5 + oz * 0.5], yaw: yawFromBack(ox, oz), pitch: 20 * DEG, distance: 10 },
    });
  }

  // Schnitte und Innenkameras je Etage
  for (const f of a.floors) {
    const key = `schnitt-${f.index}`;
    variants.push({ key, box: expand(a.building, 1, size, baseY, f.cutY) });
    const fb = solidOf(expand(a.building, 1, size, Math.max(baseY, f.feetY - 1), f.cutY));
    const fit = fitOrthographic(fb, 0, PLAN_PITCH, aspect, 1.04);
    views.push({ name: key, label: `Schnitt Etage ${f.index} (y ${f.feetY}, bis ${f.cutY})`, group: 'schnitt', variant: key, projection: { kind: 'orthographic', halfHeight: fit.halfHeight }, orbit: fit.orbit });
  }
  for (const f of a.floors) {
    const v = interiorView(f);
    if (v !== undefined) views.push(v);
  }
  return { variants, views };
}

/** Filter `--views`: Name oder Präfix (`fassade`, `nah-ecke`, `innen`). Leer = alle. */
export function selectViews(views: readonly ViewSpec[], filter: readonly string[]): ViewSpec[] {
  if (filter.length === 0) return [...views];
  return views.filter((v) => filter.some((f) => v.name === f || v.name.startsWith(`${f}-`) || v.group === f));
}

// ---------------------------------------------------------------------------------------------- Präsentation (W10)

/** Präsentations-Look einer Ansicht (Weltkoordinaten des Rasters; der Harness rechnet in die Variante um). */
export interface ViewLook {
  readonly sunDir: Vec3;
  readonly mood: 'tag' | 'abend';
  /** Oberkante des Bodens bis zum Horizont (Raster-y) */
  readonly groundY: number;
  readonly hazeFrom: number;
}

/** Augenhöhe 1,7 Blöcke, Hero-Brennweite 32° (länger als die 70° im Spiel), Schwenk 38° aus der Türachse. */
export const EYE_HEIGHT = 1.7;
export const EYE_FOV = 32 * DEG;
export const EYE_SWING = 38 * DEG;
/** Tiefe Schrägansicht: 14° von oben */
export const LOW_PITCH = 14 * DEG;

/** W10-B (wie website/js/camera-rig.js): größter Schwenk, Aufschlag für die Gegenseite, Hof-Standpunkt, Nähe-Gewicht */
export const MAX_SWING = 50 * DEG;
const FLIP_PENALTY = 0.08;
export const YARD_PENALTY = 0.04;
export const YARD_FOV_MAX = 56 * DEG;
const NEAR = 10;
/** Golden: ab dieser Höhe über dem Sockel zählt eine Spalte außerhalb des Eingangsflügels als Bau (Treffer sichtbar) */
const TALL = 5;
/** W13-A: Mindestgröße (Spalten) eines frei stehenden Nebenbaus, der das Wohnhaus verdecken kann (Scheune ja, Brunnen/Laube nein). */
const NEBENBAU_COLUMNS = 60;
/** W13-A: so viele Blöcke niedriger muss das Ende eines Flügels sein, damit die Augenhöhe zu ihm schwenkt. */
const LOW_END = 4;

interface EyeFrame {
  readonly eye: Vec3;
  readonly yaw: number;
  readonly shiftY: number;
  /** vertikaler Öffnungswinkel (W10-B: weiter weg längere, im Hof kürzere Brennweite) */
  readonly fovY: number;
  readonly distance: number;
  /** Azimut der Kamera vom Motiv aus (Richtung sin, cos) und der Türachse */
  readonly azimuth: number;
  readonly frontAz: number;
  readonly sign: number;
  /** Anteil verdeckter Sichtlinien (0 ohne `solid`) */
  readonly occluded: number;
  /** W10-B: Standpunkt im Hof (zwischen Hindernis und Fassade) und abgeschnittener Anteil des Baus */
  readonly yard: boolean;
  readonly cut: number;
}

/** Eingangsflügel (W10-B): der Bau-Teil mit der Haupttür (beim Gehöft das Wohnhaus), sonst der Hauptbau. */
function wingOf(a: Analysis): Box {
  const d = a.mainDoor;
  if (d === undefined) return a.main;
  const hit = a.components.find((c) => d.pos[0] >= c.box.min[0] - 1 && d.pos[0] <= c.box.max[0] + 1 && d.pos[2] >= c.box.min[2] - 1 && d.pos[2] <= c.box.max[2] + 1);
  return hit?.box ?? a.main;
}

/**
 * W13-A (Runde 2): Seite (entlang `perp`, ±1) des Eingangsflügels, an deren Ende ein deutlich niedrigerer Baukörper steht
 * (Anbau, Werkstatt, Brauhaus: höchster Block im äußeren Fünftel ≥ `LOW_END` unter dem der Gegenseite), sonst 0. Die
 * Augenhöhe schwenkt dann zu dieser Seite: der niedrige Anbau steht vorn, der hohe Hauptbau dahinter – die gestaffelten
 * Dächer sind im ersten Bild zu sehen (vorher lag der Anbau oft am fernen Ende hinter Hecken).
 */
function lowEndSide(a: Analysis, perp: readonly [number, number]): number {
  const w = wingOf(a), sx = a.size[0];
  const cols: Array<[number, number]> = [];
  for (let x = w.min[0]; x <= w.max[0]; x++) {
    for (let z = w.min[2]; z <= w.max[2]; z++) {
      const top = a.columnTop[x + sx * z] ?? -1;
      if (top >= a.baseY + TALL) cols.push([x * perp[0] + z * perp[1], top]);
    }
  }
  if (cols.length === 0) return 0;
  const lo = Math.min(...cols.map((c) => c[0])), hi = Math.max(...cols.map((c) => c[0]));
  const slice = Math.max(3, Math.round((hi - lo + 1) / 5));
  const peak = (from: number, to: number): number => Math.max(...cols.filter((c) => c[0] >= from && c[0] <= to).map((c) => c[1]));
  const minus = peak(lo, lo + slice - 1), plus = peak(hi - slice + 1, hi);
  return plus <= minus - LOW_END ? 1 : minus <= plus - LOW_END ? -1 : 0;
}

/**
 * Augenhöhe wie auf der Website (website/js/camera-rig.js heroCamera): Kamera 1,7 Blöcke über dem Boden vor der
 * Haupttür, waagerecht; Schwenk zur Seite der Tür; der kleinste Abstand, bei dem der Bau ins Bild passt (`far` > 1: weiter
 * weg mit längerer Brennweite, gleich groß im Bild); das Bild per Shift verschoben (Fuß knapp über dem unteren Rand),
 * senkrechte Kanten bleiben senkrecht. `yard`: Standpunkt im Hof – auf dem Strahl vor der Tür bis knapp vor das erste
 * Hindernis (braucht `solid`), Brennweite bis 56°, Tür im mittleren Bildbereich (frontal: in der Mitte).
 */
export function eyeFrame(a: Analysis, aspect: number, swing = EYE_SWING, flip = 1, far = 1, solid?: CameraOptions['solid'], margin = 0.9, base = 0.78, yard = false): EyeFrame {
  const b = a.building;
  const door = a.mainDoor !== undefined && a.mainDoor.outward !== undefined ? a.mainDoor : undefined;
  const floor = door !== undefined ? door.pos[1] : a.baseY + 1;
  const bc: [number, number] = [(b.min[0] + b.max[0] + 1) / 2, (b.min[2] + b.max[2] + 1) / 2];
  const out = door !== undefined ? DIR_STEP[door.outward as Dir] : ([0, 1] as const);
  let sign = 1;
  if (door !== undefined) {
    const perp = [-out[1], out[0]];
    const lateral = (door.pos[0] + 0.5 - bc[0]) * perp[0]! + (door.pos[2] + 0.5 - bc[1]) * perp[1]!;
    sign = lateral < -0.5 ? -1 : 1;
    const low = lowEndSide(a, perp as [number, number]);
    if (low !== 0) sign = low;
  }
  sign *= flip;
  const ang = swing * sign;
  const dir: [number, number] = [out[0] * Math.cos(ang) - out[1] * Math.sin(ang), out[0] * Math.sin(ang) + out[1] * Math.cos(ang)];
  const doorXZ: [number, number] = door !== undefined ? [door.pos[0] + 0.5, door.pos[2] + 0.5] : bc;
  const aim: [number, number] = yard && door !== undefined ? [doorXZ[0] + out[0] * 0.5, doorXZ[1] + out[1] * 0.5] : door !== undefined ? [(doorXZ[0] + bc[0]) / 2, (doorXZ[1] + bc[1]) / 2] : bc;
  // Umriss: Spaltenköpfe im Bau-Quader, dazu die Fußecken auf Türhöhe
  const pts: Vec3[] = hullPoints(a, b).filter((_, i) => i % 2 === 0);
  for (const x of [b.min[0], b.max[0] + 1]) for (const z of [b.min[2], b.max[2] + 1]) pts.push([x, floor, z]);
  const eyeY = floor + EYE_HEIGHT;
  const fwd: [number, number] = [-dir[0], -dir[1]];
  const right: [number, number] = [-fwd[1], fwd[0]];
  interface Frame { u0: number; u1: number; v0: number; v1: number; du: number; behind: boolean; px: number; pz: number }
  const frame = (dist: number): Frame => {
    const px = aim[0] + dir[0] * dist, pz = aim[1] + dir[1] * dist;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, behind = false;
    for (const p of pts) {
      const qx = p[0] - px, qy = p[1] - eyeY, qz = p[2] - pz;
      const depth = qx * fwd[0] + qz * fwd[1];
      if (depth < 1) { behind = true; break; }
      const u = (qx * right[0] + qz * right[1]) / depth, v = qy / depth;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const dx = doorXZ[0] - px, dz = doorXZ[1] - pz;
    const du = (dx * right[0] + dz * right[1]) / Math.max(0.5, dx * fwd[0] + dz * fwd[1]);
    return { u0, u1, v0, v1, du, behind, px, pz };
  };
  const fits = (f: Frame, tv: number): boolean => !f.behind && f.u1 - f.u0 <= 2 * tv * aspect * margin && f.v1 - f.v0 <= 2 * tv * margin;
  let dist: number, f: Frame, tanV = Math.tan(EYE_FOV / 2), cut = 0;
  if (!yard || door === undefined || solid === undefined) {
    let lo = 2, hi = 8;
    while (!fits(frame(hi), tanV) && hi < 2000) hi *= 1.5;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (fits(frame(mid), tanV)) hi = mid; else lo = mid;
    }
    dist = hi * far;
    f = frame(dist);
    if (far > 1) {
      let a0 = tanV / far / 1.5, a1 = tanV;
      for (let k = 0; k < 30; k++) { const m = (a0 + a1) / 2; if (fits(f, m)) a1 = m; else a0 = m; }
      tanV = a1;
    }
  } else {
    dist = yardDepth(door, dir, solid) - 1.2;
    f = frame(Math.max(dist, 1));
    tanV = Math.tan(YARD_FOV_MAX / 2);
    for (let d = EYE_FOV; d <= YARD_FOV_MAX + 1e-9; d += 2 * DEG) if (fits(f, Math.tan(d / 2))) { tanV = Math.tan(d / 2); break; }
    const w = f.u1 - f.u0, h = f.v1 - f.v0;
    cut = f.behind || dist < 4 ? 1 : Math.max(0, w - 2 * tanV * aspect * margin) / w + Math.max(0, h - 2 * tanV * margin) / h;
  }
  const tanH = tanV * aspect;
  let uc = (f.u0 + f.u1) / 2;
  const keep = tanH * (!yard ? 0.6 : swing === 0 ? 0.05 : 0.3);
  if (door !== undefined) uc = Math.min(f.du + keep, Math.max(f.du - keep, uc));
  const yaw = Math.atan2(fwd[0], -fwd[1]) + Math.atan(uc);
  const fitsV = f.v1 - f.v0 <= 2 * tanV * margin;
  const vc = fitsV ? Math.max(f.v0 + tanV * base, f.v1 - tanV * margin) : f.v0 + tanV * base;
  const eye: Vec3 = [f.px, eyeY, f.pz];
  return {
    eye, yaw, shiftY: vc / (2 * tanV), fovY: 2 * Math.atan(tanV), distance: dist,
    azimuth: Math.atan2(dir[0], dir[1]), frontAz: Math.atan2(out[0], out[1]), sign,
    occluded: solid === undefined ? 0 : occludedShare(a, eye, solid), yard, cut,
  };
}

/** Hof-Tiefe: Abstand von der Tür bis zum ersten belegten Block auf dem Strahl (Türboden bis über Augenhöhe, ± eine halbe Zelle). */
function yardDepth(door: NonNullable<Analysis['mainDoor']>, dir: readonly [number, number], solid: NonNullable<CameraOptions['solid']>): number {
  const o = DIR_STEP[door.outward as Dir];
  const x0 = door.pos[0] + 0.5 + o[0] * 0.5, z0 = door.pos[2] + 0.5 + o[1] * 0.5;
  const side = [-dir[1] * 0.45, dir[0] * 0.45] as const;
  for (let s = 1.5; s < 80; s += 0.25) {
    for (const k of [0, -1, 1]) {
      const x = Math.floor(x0 + dir[0] * s + side[0] * k), z = Math.floor(z0 + dir[1] * s + side[1] * k);
      for (let y = door.pos[1]; y <= door.pos[1] + 2; y++) if (solid(x, y, z)) return s;
    }
  }
  return 80;
}

/**
 * Anteil verdeckter Sichtlinien (wie camera-rig.js): vom Auge zu festen Zielpunkten im Eingangsflügel (Tür dreifach);
 * verdeckt, wenn der erste belegte Block außerhalb des Bau-Quaders (+1) liegt oder das Auge in einem Block steckt. W10-B:
 * nahe Hindernisse zählen voll, fernere anteilig (`NEAR` / Abstand, mindestens ein Fünftel).
 */
export function occludedShare(a: Analysis, eye: Vec3, solid: NonNullable<CameraOptions['solid']>): number {
  // der ganze Bau (Burg: Mauerring und Türme gehören dazu – ihre Treffer sind sichtbar, nicht verdeckt)
  // W10-B: im übrigen Bau nur hohe Teile (Mauerring, Türme, Scheune); niedrige – Zaun, Torpfosten, Hecke – verdecken
  const bb = a.building, m = wingOf(a), sx = a.size[0];
  const inBox = (b: Box, x: number, z: number): boolean => x >= b.min[0] - 1 && x <= b.max[0] + 1 && z >= b.min[2] - 1 && z <= b.max[2] + 1;
  // W13-A (Runde 2): ein frei stehender, großer Nebenbau (Scheune des Gehöfts) verdeckt das Wohnhaus, wenn er vor ihm
  // steht – vorher zählte er als sichtbarer Bau, und die erste Ansicht zeigte vor allem die Scheune
  const others = a.components.filter((c) => c.box !== m && c.columns >= NEBENBAU_COLUMNS).map((c) => c.box);
  const inOther = (x: number, z: number): boolean => others.some((b) => x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]);
  const inMain = (x: number, y: number, z: number): boolean => y >= a.baseY - 1
    && (inBox(m, x, z) || (inBox(bb, x, z) && !inOther(x, z) && x >= 0 && x < sx && (a.columnTop[x + sx * z] ?? -1) >= a.baseY + TALL));
  const cell = (p: Vec3): [number, number, number] => [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
  if (solid(...cell(eye))) return 1;
  const y0 = Math.max(a.baseY + 1, m.min[1]), y1 = m.max[1] + 1, ym = y0 + Math.min(4, (y1 - y0) / 2);
  const cx = (m.min[0] + m.max[0] + 1) / 2, cz = (m.min[2] + m.max[2] + 1) / 2;
  const targets: Array<[Vec3, number]> = [
    [[cx, y0 + 1.5, cz], 1], [[cx, ym + 2, cz], 1], [[cx, (y0 + y1) / 2, cz], 1],
    [[m.min[0] + 1.5, ym, m.min[2] + 1.5], 1], [[m.max[0] - 0.5, ym, m.min[2] + 1.5], 1],
    [[m.min[0] + 1.5, ym, m.max[2] - 0.5], 1], [[m.max[0] - 0.5, ym, m.max[2] - 0.5], 1],
  ];
  // Raster über den ganzen Bau (Bäume und Büsche vor einem Teil der Fassade): 3 × 3 Spalten in zwei Höhen
  for (const fx of [0.15, 0.5, 0.85]) for (const fz of [0.15, 0.5, 0.85]) for (const fy of [0.25, 0.6]) {
    targets.push([[m.min[0] + (m.max[0] + 1 - m.min[0]) * fx, y0 + (y1 - y0) * fy, m.min[2] + (m.max[2] + 1 - m.min[2]) * fz], 0.5]);
  }
  for (const [x, z] of [[m.min[0] + 1.5, m.min[2] + 1.5], [m.max[0] - 0.5, m.min[2] + 1.5], [m.min[0] + 1.5, m.max[2] - 0.5], [m.max[0] - 0.5, m.max[2] - 0.5]] as const) targets.push([[x, y0 + 1.6, z], 0.5]);
  const d = a.mainDoor;
  if (d !== undefined) targets.push([[d.pos[0] + 0.5, d.pos[1] + 1.2, d.pos[2] + 0.5], 3], [[d.pos[0] + 0.5, d.pos[1] + 0.4, d.pos[2] + 0.5], 1]);
  let hidden = 0, total = 0;
  for (const [t, w] of targets) {
    total += w;
    const dx = t[0] - eye[0], dy = t[1] - eye[1], dz = t[2] - eye[2];
    const len = Math.hypot(dx, dy, dz);
    const steps = Math.ceil(len / 0.25);
    for (let k = 2; k < steps; k++) {
      const s = k / steps;
      const [x, y, z] = cell([eye[0] + dx * s, eye[1] + dy * s, eye[2] + dz * s]);
      if (!solid(x, y, z)) continue;
      if (!inMain(x, y, z)) hidden += w * Math.min(1, Math.max(0.2, NEAR / (s * len)));
      break;
    }
  }
  return hidden / total;
}

/**
 * Augenhöhe mit Sichtlinien-Suche: feste Kandidaten (Schwenk bis 50°, Seite, Abstand), geringste Verdeckung (+ kleine
 * Aufschläge), sonst der erste; ist auch der beste verdeckt, zusätzlich Standpunkte im Hof (W10-B).
 */
export function bestEyeFrame(a: Analysis, aspect: number, swing: number, solid?: CameraOptions['solid']): EyeFrame {
  if (solid === undefined) return eyeFrame(a, aspect, swing);
  const swings = (swing === 0 ? [0, 10 * DEG, 18 * DEG, 28 * DEG] : [swing, swing - 12 * DEG, swing + 10 * DEG, swing - 22 * DEG, 0]).filter((s) => s >= 0 && s <= MAX_SWING + 1e-9);
  const penalty = (sw: number, flip: number): number => (Math.abs(sw - swing) / DEG) * 0.002 + (flip < 0 ? FLIP_PENALTY : 0);
  let best: EyeFrame | undefined, bestScore = Infinity;
  for (const sw of swings) {
    for (const flip of sw === 0 ? [1] : [1, -1]) {
      for (const far of [1, 1.2, 1.45, 1.8, 2.2]) {
        const f = eyeFrame(a, aspect, sw, flip, far, solid);
        const score = f.occluded + penalty(sw, flip) + (far - 1) * 0.05;
        if (score < bestScore - 1e-9) { best = f; bestScore = score; }
        if (bestScore === 0) return best!;
      }
    }
  }
  if (a.mainDoor === undefined || bestScore <= YARD_PENALTY) return best!;
  for (const sw of swings) {
    for (const flip of sw === 0 ? [1] : [1, -1]) {
      const f = eyeFrame(a, aspect, sw, flip, 1, solid, 0.9, 0.78, true);
      if (f.cut >= 1) continue;
      const score = f.occluded + penalty(sw, flip) + YARD_PENALTY + f.cut * 0.4;
      if (score < bestScore - 1e-9) { best = f; bestScore = score; }
    }
  }
  return best!;
}

/** Sonne: von der Gegenseite des Schwenks (Eingangsfassade im Licht, Seite im Streiflicht), 32° hoch, abends 9°. */
export function sunDirFor(f: Pick<EyeFrame, 'frontAz' | 'sign'>, mood: 'tag' | 'abend' = 'tag'): Vec3 {
  const az = f.frontAz + f.sign * 25 * DEG;
  const el = (mood === 'abend' ? 9 : 32) * DEG;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

/**
 * Erste Ansicht (W10-B, gleiche Regel wie website/js/camera-rig.js `firstView`): Wehranlagen zeigen zuerst die tiefe
 * Schrägansicht (in Augenhöhe ist die breite Anlage klein im Bild), alle anderen die Augenhöhe. Die Website misst den
 * Anteil der Wehrblöcke; das Raster hier kennt keine Kategorien, daher der Bautyp (Burg) als Merkmal.
 */
// W16-B (28.09.2026, Review R7-2; W13-A offen 1): das Gehöft zeigt zuerst die tiefe Schrägansicht – in Augenhöhe steht
// die Anlage (Wohnhaus, Scheune, Silo, Feld, Garten) als Wand vor leerem Himmel; im blinden A/B lag `tief` 0,5 Noten
// über `auge` (plan/spikes/W16B_bauernhaus.md)
export const LOW_FIRST_TYPES: readonly string[] = ['castle_compact', 'farmhouse'];
export function firstViewFor(type: string | undefined): 'auge' | 'tief' {
  return type !== undefined && LOW_FIRST_TYPES.includes(type) ? 'tief' : 'auge';
}

/**
 * Präsentations-Ansichten: `auge` (Augenhöhe), `auge-abend`, `tief` (tiefe 3/4-Ansicht, 14°). Erdhaus frontal.
 * `first` = 'tief' (Wehranlagen, W10-B): die tiefe Schrägansicht steht vorn.
 */
export function presentationViews(a: Analysis, aspect: number, buried: boolean, solid?: CameraOptions['solid'], first: 'auge' | 'tief' = 'auge'): ViewSpec[] {
  const f = bestEyeFrame(a, aspect, buried ? 0 : EYE_SWING, solid);
  const groundY = a.baseY + 1 - 0.02;
  const look = (mood: 'tag' | 'abend', hazeFrom: number): ViewLook => ({ sunDir: sunDirFor(f, mood), mood, groundY, hazeFrom });
  const cp = Math.cos(f.yaw), sp = Math.sin(f.yaw);
  const eyeOrbit: Orbit = { target: [f.eye[0] + sp * 10, f.eye[1], f.eye[2] - cp * 10], yaw: f.yaw, pitch: 0, distance: 10 };
  const eyeProj: ProjectionSpec = { kind: 'perspective', fovY: f.fovY, shiftY: f.shiftY };
  // Umriss des Baus ab dem Sockel (Fußpunkte unter dem Gelände auf den Sockel heben, nicht weglassen)
  const hull = hullPoints(a, a.building).map((p): Vec3 => [p[0], Math.max(p[1], a.baseY), p[2]]);
  const low = fitPerspectivePoints(hull, yawFromBack(Math.sin(f.azimuth), Math.cos(f.azimuth)), LOW_PITCH, HERO_FOV, aspect);
  const eye: ViewSpec[] = [
    { name: 'auge', label: buried ? 'Augenhöhe frontal' : 'Augenhöhe 3/4', group: 'praesentation', variant: 'voll', projection: eyeProj, orbit: eyeOrbit, look: look('tag', f.distance) },
    { name: 'auge-abend', label: 'Augenhöhe am Abend', group: 'praesentation', variant: 'voll', projection: eyeProj, orbit: eyeOrbit, look: look('abend', f.distance) },
  ];
  const tief: ViewSpec = { name: 'tief', label: 'Tiefe Schrägansicht', group: 'praesentation', variant: 'voll', projection: { kind: 'perspective', fovY: HERO_FOV }, orbit: low, look: look('tag', low.distance) };
  return first === 'tief' ? [tief, ...eye] : [...eye, tief];
}
