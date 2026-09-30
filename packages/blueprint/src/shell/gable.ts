/**
 * Satteldach (Giebel) über Rechteck-Zerlegung + Max (research/03 §C9; Korrekturen aus Spike T4 §4,
 * übernommen aus spikes/algorithms/src/roof/gable.ts):
 *
 * 1. Grundriss gierig in Rechtecke zerlegen (größtes Rechteck aus noch freien Zellen zuerst).
 * 2. Firstachse: das erste Rechteck entlang seiner Langseite; jedes weitere („Flügel“) senkrecht zu seiner
 *    längsten Kontaktkante mit einem früheren Rechteck (der First läuft INS Hauptdach).
 * 3. Flügel entlang der Firstachse in angrenzende Grundrissteile verlängern, bis ihr Profil unter dem Dach
 *    verschwindet oder der Grundriss endet (sonst Giebel mitten im Hauptdach).
 * 4. Neu gegenüber dem Spike:
 *    - Pultdach an höheren Wänden: ein Rechteck, das mit mindestens der Hälfte einer Seite an die Sperrzone
 *      (obere Etage) grenzt, steigt einseitig zu ihr an.
 *    - Überstand: jedes Rechteck wächst um `overhang` nach allen Seiten (Traufe und Ortgang).
 *    - Ausgabe als Höhenfeld an Zellmitte und Viertelpunkten, damit Klassifikation, Treppenformen an Kehlen
 *      und Stabilisierung dieselben wie beim Walmdach sind (roof.ts).
 * 5. Varianten je Rechteck (research/18 D6, D14; `GableVariant`, Standard `gable` = bisheriges Verhalten):
 *    Pultdach (alle Rechtecke einseitig), Krüppelwalm `min(d_t, d_g + k)`, Fußwalm `d_g ≥ k ? d_t : min(d_t, d_g)`
 *    (senkrechter Sprung = zurückgesetzter Ziergiebel) und Saltbox `min(d_vorn + a, d_hinten)` (Vorderseite um a
 *    Ringe höher, First aus der Mitte). d_t = Abstand zur Traufe, d_g = Abstand zum Giebelende (vergrößertes Rechteck).
 * 6. W2 (Baustandard D6/D8): an höheren Wänden auf Wunsch ein Quergiebel statt des Pultdachs (`crossAtWall`, der
 *    First läuft senkrecht in die Wand); Pultdach der Variante nur bis `maxDepth` Tiefe in Fallrichtung, darüber
 *    Satteldach.
 * Die Giebelwände (Dreiecke unter dem Dach) setzt `deriveShell` allgemein für jede Dachform.
 */
import type { HorizontalDir } from '@mcda/core';
import { OPP, axisOf } from './grid.js';
import { buildRoof, type RoofExtras, type RoofField, type RoofPlan } from './roof.js';

export interface Rect {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
}

/** Form eines Rechtecks: Satteldach (First entlang x oder z) oder Pultdach (steigt zur Seite `up`). */
export type RectRoof = { readonly type: 'gable'; readonly alongX: boolean } | { readonly type: 'shed'; readonly up: HorizontalDir };

/**
 * Profil-Variante der Rechtecke (Pultdächer an höheren Wänden bleiben in jeder Variante Pultdächer).
 * `front` = Vorderseite des Hauses (Haustür): Saltbox hebt sie an, das Pultdach steigt von ihr weg.
 * `rows`: Krüppelwalm = Walm-Ringe oben (Standard 1–2 je nach Tiefe), Fußwalm = Walm-Ringe unten über dem Überstand.
 */
export type GableVariant =
  | { readonly kind: 'gable' }
  /** `maxDepth` (additiv, W2 D8): tiefere Rechtecke (in Fallrichtung) bekommen ein Satteldach statt des Pultdachs. */
  | { readonly kind: 'shed'; readonly front?: HorizontalDir; readonly maxDepth?: number }
  | { readonly kind: 'half_hip'; readonly rows?: number }
  | { readonly kind: 'dutch_gable'; readonly rows?: number }
  | { readonly kind: 'saltbox'; readonly front?: HorizontalDir };

const GABLE: GableVariant = { kind: 'gable' };

/** Seite quer zum First (true = First entlang x → Seiten Nord/Süd), zu der `front` zeigt; sonst Süd bzw. Ost. */
function crossSide(alongX: boolean, front: HorizontalDir | undefined): HorizontalDir {
  if (front !== undefined && axisOf(front) === (alongX ? 'z' : 'x')) return front;
  return alongX ? 'south' : 'east';
}

/** Gierige Zerlegung: wiederholt das größte Rechteck aus freien Zellen (Histogramm je Zeile). */
export function decomposeRects(mask: Uint8Array, w: number, d: number): Rect[] {
  const free = mask.slice();
  const rects: Rect[] = [];
  const hgt = new Int32Array(w);
  for (;;) {
    let best: Rect | undefined;
    hgt.fill(0);
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) hgt[x] = free[z * w + x] ? hgt[x]! + 1 : 0;
      for (let x0 = 0; x0 < w; x0++) {
        let minH = Infinity;
        for (let x1 = x0; x1 < w && hgt[x1]! > 0; x1++) {
          minH = Math.min(minH, hgt[x1]!);
          if (best === undefined || (x1 - x0 + 1) * minH > best.w * best.d) best = { x: x0, z: z - minH + 1, w: x1 - x0 + 1, d: minH };
        }
      }
    }
    if (best === undefined) return rects;
    rects.push(best);
    for (let z = best.z; z < best.z + best.d; z++) for (let x = best.x; x < best.x + best.w; x++) free[z * w + x] = 0;
  }
}

/** Firstachse je Rechteck (true = First entlang x). */
export function ridgeAxes(rects: readonly Rect[]): boolean[] {
  return rects.map((r, i) => {
    if (i === 0) return r.w >= r.d;
    let ns = 0; // gemeinsame Kante an der Nord-/Südseite mit einem früheren Rechteck
    let ew = 0;
    for (let j = 0; j < i; j++) {
      const o = rects[j]!;
      const ox = Math.max(0, Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x));
      const oz = Math.max(0, Math.min(r.z + r.d, o.z + o.d) - Math.max(r.z, o.z));
      if (o.z + o.d === r.z || r.z + r.d === o.z) ns = Math.max(ns, ox);
      if (o.x + o.w === r.x || r.x + r.w === o.x) ew = Math.max(ew, oz);
    }
    if (ns > ew) return false; // Kontakt oben/unten → First entlang z (läuft ins Nachbardach)
    if (ew > ns) return true;
    return r.w >= r.d;
  });
}

/** Kontaktlänge je Seite mit der Sperrzone. */
function contacts(r: Rect, keepOut: Uint8Array, w: number, d: number): Record<HorizontalDir, number> {
  const k = (x: number, z: number): number => (x >= 0 && z >= 0 && x < w && z < d ? keepOut[z * w + x]! : 0);
  const out = { north: 0, south: 0, east: 0, west: 0 };
  for (let x = r.x; x < r.x + r.w; x++) {
    out.north += k(x, r.z - 1);
    out.south += k(x, r.z + r.d);
  }
  for (let z = r.z; z < r.z + r.d; z++) {
    out.west += k(r.x - 1, z);
    out.east += k(r.x + r.w, z);
  }
  return out;
}

/** Dachhöhe eines Rechtecks am Punkt (px, pz) in Zellkoordinaten; `undefined` außerhalb. */
function profileAt(r: Rect, k: RectRoof, px: number, pz: number): number | undefined {
  if (px < r.x || px > r.x + r.w || pz < r.z || pz > r.z + r.d) return undefined;
  if (k.type === 'gable') return k.alongX ? Math.min(pz - r.z, r.z + r.d - pz) : Math.min(px - r.x, r.x + r.w - px);
  switch (k.up) {
    case 'north':
      return r.z + r.d - pz;
    case 'south':
      return pz - r.z;
    case 'east':
      return px - r.x;
    case 'west':
      return r.x + r.w - px;
  }
}

const rectInside = (mask: Uint8Array, w: number, d: number, r: Rect): boolean => {
  if (r.x < 0 || r.z < 0 || r.x + r.w > w || r.z + r.d > d) return false;
  for (let z = r.z; z < r.z + r.d; z++) for (let x = r.x; x < r.x + r.w; x++) if (!mask[z * w + x]) return false;
  return true;
};

export interface GableLayout {
  /** Rechtecke nach Verlängerung, ohne Überstand. */
  readonly rects: readonly Rect[];
  readonly roofs: readonly RectRoof[];
  /** Nur mit `GableLayoutOptions.verge`: true = Flügel (Quergiebel, kein Teilungsstreifen des ersten Rechtecks). */
  readonly wings?: readonly boolean[];
}

/**
 * Additiv (W2, Baustandard D6): Dach an höheren Wänden. `crossAtWall` = statt des Pultdachs ein Quergiebel, dessen First
 * senkrecht zur höheren Wand in sie hineinläuft (Kappung auf Wandhöhe wie beim Pultdach).
 */
export interface GableLayoutOptions {
  readonly crossAtWall?: boolean;
  /**
   * Additiv (W3, Dach-Teilung, plan/spikes/W3RD_dachdetails.md): Satteldach-Rechtecke, deren Spannweite (quer zum
   * First, ohne Überstand) `maxSpan` übersteigt und deren Außenmaß mit Überstand ≥ `minOuter` ist, werden geteilt: gleich
   * breite Streifen (Breite ≤ `maxSpan`, benachbarte Streifen teilen sich höchstens 2 Spalten), zwischen ihnen Kehlen.
   * Gedrungene Rechtecke (Länge < 1,5 × Spannweite) werden zur Reihe von Quergiebeln (Streifen entlang der Langseite,
   * First quer zur alten Richtung), lange Rechtecke zu parallelen Satteldächern (Streifen quer, First bleibt). Die
   * Neigung bleibt, die Firsthöhe sinkt auf die halbe Streifenbreite.
   */
  readonly split?: { readonly maxSpan: number; readonly minOuter: number; readonly overhang: number };
  /**
   * Additiv (M2, `RoofDetail.roofOverhang: 'refined'`): Ortgang (Überstand ENTLANG des Firsts) getrennt von der Traufe
   * (Überstand quer zum First, = `overhang`). `main` gilt für das erste Rechteck (und Teilungsstreifen), `wing` für
   * die Flügel (Quergiebel): dort endet das Dach bündig mit der Giebelwand. Fehlt das Feld, wächst jedes Rechteck
   * gleichmäßig um `overhang` (Stand vorher, bitgleich).
   */
  readonly verge?: { readonly main: number; readonly wing: number };
}

/**
 * W3 (Dach-Teilung): Streifen [a, a + ws) über die Länge `len` – n gleich breite Streifen (ws ≤ maxSpan), spiegelsymmetrisch
 * verteilt, Nachbarn überlappen sich um 0–2 Spalten (bei ungeradem n liegt der Mittelstreifen mittig). Leer, wenn keine
 * Teilung mit Streifen ≥ 5 möglich ist.
 */
export function splitStrips(len: number, maxSpan: number): Array<{ readonly a: number; readonly w: number }> {
  for (let n = 2; n <= 8; n++) {
    // Mindestbreite, damit n Streifen mit höchstens 2 Spalten Überlappung die Länge decken
    let ws = Math.ceil((len + (n - 1)) / n);
    if (n % 2 === 1 && (len - ws) % 2 !== 0) ws++; // Mittelstreifen mittig
    if (ws > maxSpan) continue;
    if (ws < 5) return [];
    const room = len - ws; // Summe der Versätze
    const a: number[] = [];
    for (let j = 0; j < n; j++) a.push(j <= (n - 1) / 2 ? Math.floor((j * room) / (n - 1)) : 0);
    for (let j = 0; j < n; j++) if (j > (n - 1) / 2) a[j] = room - a[n - 1 - j]!;
    const ok = a.every((x, j) => j === 0 || (x <= a[j - 1]! + ws && x >= a[j - 1]! + ws - 2));
    if (ok) return a.map((x) => ({ a: x, w: ws }));
  }
  return [];
}

/** Rechtecke, Firstachsen, Pultdächer und Flügel-Verlängerung (ohne Überstand). */
export function gableLayout(
  footprint: Uint8Array, w: number, d: number, keepOut?: Uint8Array, variant: GableVariant = GABLE, opts: GableLayoutOptions = {},
): GableLayout {
  const rects0 = decomposeRects(footprint, w, d);
  const axes0 = ridgeAxes(rects0);
  // W3: Dach-Teilung – breite Satteldach-Rechtecke (nicht an höheren Wänden) werden zu einer Reihe von Quergiebeln
  const rects: Rect[] = [];
  const axes: boolean[] = [];
  /** Streifen einer Teilung: nicht verlängern (sie füllen ihr Rechteck genau). */
  const strip: boolean[] = [];
  rects0.forEach((r, i) => {
    const alongX = axes0[i]!;
    const span = alongX ? r.d : r.w;
    const len = alongX ? r.w : r.d;
    const sp = opts.split;
    const atWall = keepOut !== undefined && Object.values(contacts(r, keepOut, w, d)).some((c) => c > 0);
    const wanted = sp !== undefined && variant.kind !== 'shed' && !atWall && span > sp.maxSpan && span + 2 * sp.overhang >= sp.minOuter;
    // gedrungene Rechtecke (Länge < 1,5 × Spannweite): Reihe von Quergiebeln quer zur Langseite; lange Baukörper
    // (Langhaus): parallele Satteldächer entlang der Langseite – der lange First bleibt, die Kehle liegt in der Mitte
    const across = len < 1.5 * span;
    const parts = wanted ? splitStrips(across ? len : span, sp.maxSpan) : [];
    if (parts.length === 0) {
      rects.push(r);
      axes.push(alongX);
      strip.push(false);
      return;
    }
    for (const q of parts) {
      const cutX = alongX === across; // Streifen entlang x geschnitten
      rects.push(cutX ? { x: r.x + q.a, z: r.z, w: q.w, d: r.d } : { x: r.x, z: r.z + q.a, w: r.w, d: q.w });
      axes.push(across ? !alongX : alongX);
      strip.push(true);
    }
  });
  /** Pultdach aus der Variante (nicht an einer höheren Wand): wird wie ein Satteldach-Flügel verlängert. */
  const ownShed = rects.map(() => false);
  const roofs: RectRoof[] = rects.map((r, i) => {
    if (keepOut !== undefined) {
      const c = contacts(r, keepOut, w, d);
      const sides = (Object.keys(c) as HorizontalDir[]).filter((s) => c[s] > 0 && 2 * c[s] >= (s === 'north' || s === 'south' ? r.w : r.d));
      if (sides.length > 0) {
        const up = sides.sort((a, b) => c[b] - c[a])[0]!;
        const tie = sides.filter((s) => c[s] === c[up]).length > 1;
        if (!tie) return opts.crossAtWall === true ? { type: 'gable', alongX: axisOf(up) === 'x' } : { type: 'shed', up };
      }
    }
    if (variant.kind === 'shed') {
      const up = OPP[crossSide(axes[i]!, variant.front)];
      // D8: Pultdach nur für schmale Baukörper (Tiefe in Fallrichtung ≤ maxDepth), sonst Satteldach
      if (variant.maxDepth !== undefined && (axisOf(up) === 'z' ? r.d : r.w) > variant.maxDepth) return { type: 'gable', alongX: axes[i]! };
      ownShed[i] = true;
      return { type: 'shed', up };
    }
    return { type: 'gable', alongX: axes[i]! };
  });
  // Höhen an Zellmitten aus dem unverlängerten Satz (Pass 1), dann Flügel verlängern (Pass 2)
  const height = new Float64Array(w * d).fill(-Infinity);
  const apply = (r: Rect, k: RectRoof): void => {
    for (let z = Math.max(0, r.z); z < Math.min(d, r.z + r.d); z++) {
      for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x++) {
        const h = profileAt(r, k, x + 0.5, z + 0.5)!;
        if (h > height[z * w + x]!) height[z * w + x] = h;
      }
    }
  };
  rects.forEach((r, i) => apply(r, roofs[i]!));
  const extended = rects.map((r, i) => {
    const k = roofs[i]!;
    if (i === 0 || strip[i] === true || (k.type !== 'gable' && !ownShed[i])) return r;
    const alongX = k.type === 'gable' ? k.alongX : axisOf(k.up) === 'z';
    let e = r;
    for (const dir of [-1, 1] as const) {
      for (;;) {
        const t: Rect = alongX
          ? dir < 0 ? { ...e, x: e.x - 1, w: e.w + 1 } : { ...e, w: e.w + 1 }
          : dir < 0 ? { ...e, z: e.z - 1, d: e.d + 1 } : { ...e, d: e.d + 1 };
        if (!rectInside(footprint, w, d, t)) break;
        let buried = true;
        const len = alongX ? t.d : t.w;
        for (let s = 0; s < len && buried; s++) {
          const x = alongX ? (dir < 0 ? t.x : t.x + t.w - 1) : t.x + s;
          const z = alongX ? t.z + s : dir < 0 ? t.z : t.z + t.d - 1;
          if (profileAt(t, k, x + 0.5, z + 0.5)! > height[z * w + x]! + 1e-9) buried = false;
        }
        if (buried) break;
        e = t;
      }
    }
    apply(e, k);
    return e;
  });
  return { rects: extended, roofs, ...(opts.verge !== undefined ? { wings: extended.map((_, i) => i > 0 && strip[i] !== true) } : {}) };
}

type Profile = (px: number, pz: number) => number | undefined;

/**
 * Höhenprofil eines um den Überstand vergrößerten Rechtecks `g` (ungewachsen `r`) je Variante. Sprünge (Fußwalm)
 * liegen auf Zellgrenzen, weil k ganzzahlig ist; die Viertelpunkt-Klassifikation bleibt eindeutig.
 */
function rectProfile(g: Rect, r: Rect, kind: RectRoof, variant: GableVariant, overhang: number): Profile {
  const plain: Profile = (px, pz) => profileAt(g, kind, px, pz);
  if (kind.type !== 'gable' || variant.kind === 'gable' || variant.kind === 'shed') return plain;
  const alongX = kind.alongX;
  const inside = (px: number, pz: number): boolean => px >= g.x && px <= g.x + g.w && pz >= g.z && pz <= g.z + g.d;
  /** Abstand zur nächsten Traufe (quer zum First) bzw. zum nächsten Giebelende (entlang des Firsts). */
  const dt = (px: number, pz: number): number => (alongX ? Math.min(pz - g.z, g.z + g.d - pz) : Math.min(px - g.x, g.x + g.w - px));
  const dg = (px: number, pz: number): number => (alongX ? Math.min(px - g.x, g.x + g.w - px) : Math.min(pz - g.z, g.z + g.d - pz));
  /** Ringe bis zum First (inklusive Überstand). */
  const R = Math.ceil((alongX ? g.d : g.w) / 2);
  switch (variant.kind) {
    case 'half_hip': {
      const k = Math.max(0, R - Math.max(1, variant.rows ?? (R >= 5 ? 2 : 1)) - 1);
      return (px, pz) => (inside(px, pz) ? Math.min(dt(px, pz), dg(px, pz) + k) : undefined);
    }
    case 'dutch_gable': {
      const k = overhang + Math.max(1, variant.rows ?? Math.floor(R / 2) - overhang);
      return (px, pz) => {
        if (!inside(px, pz)) return undefined;
        const t = dt(px, pz);
        const e = dg(px, pz);
        return e >= k ? t : Math.min(t, e);
      };
    }
    case 'saltbox': {
      // a ≈ Tiefe/3, gerade: der First liegt dann wie beim symmetrischen Satteldach auf einer Zellmitte bzw. -grenze
      const a = Math.max(2, 2 * Math.round((alongX ? r.d : r.w) / 6));
      const up = crossSide(alongX, variant.front);
      const lo = up === 'north' || up === 'west' ? a : 0;
      const hi = up === 'south' || up === 'east' ? a : 0;
      return (px, pz) => {
        if (!inside(px, pz)) return undefined;
        return alongX ? Math.min(pz - g.z + lo, g.z + g.d - pz + hi) : Math.min(px - g.x + lo, g.x + g.w - px + hi);
      };
    }
  }
}

/** Höhenfeld des Satteldachs (Max über alle Rechteck-Profile, Rechtecke um den Überstand vergrößert). */
export function gableField(
  footprint: Uint8Array, w: number, d: number, overhang: number, keepOut?: Uint8Array, variant: GableVariant = GABLE, opts: GableLayoutOptions = {},
): RoofField & GableLayout {
  const layout = gableLayout(footprint, w, d, keepOut, variant, opts);
  const profiles = layout.rects.map((r, k) => {
    const roof = layout.roofs[k]!;
    const vg = opts.verge;
    if (vg === undefined) {
      const g = { x: r.x - overhang, z: r.z - overhang, w: r.w + 2 * overhang, d: r.d + 2 * overhang };
      return rectProfile(g, r, roof, variant, overhang);
    }
    // M2: Traufe = `overhang` quer zum First, Ortgang = `verge` entlang des Firsts
    const along = layout.wings?.[k] === true ? vg.wing : vg.main;
    const alongX = roof.type === 'gable' ? roof.alongX : axisOf(roof.up) === 'z';
    const gx = alongX ? along : overhang;
    const gz = alongX ? overhang : along;
    const g = { x: r.x - gx, z: r.z - gz, w: r.w + 2 * gx, d: r.d + 2 * gz };
    return rectProfile(g, r, roof, variant, overhang);
  });
  const mask = new Uint8Array(w * d);
  const hc = new Float64Array(w * d).fill(-Infinity);
  const hq = new Float64Array(4 * w * d).fill(-Infinity);
  const OFF: ReadonlyArray<readonly [number, number]> = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      for (const prof of profiles) {
        const c = prof(x + 0.5, z + 0.5);
        if (c === undefined) continue;
        if (c > hc[i]!) hc[i] = c;
        OFF.forEach(([qx, qz], q) => {
          const h = prof(x + qx, z + qz)!;
          if (h > hq[4 * i + q]!) hq[4 * i + q] = h;
        });
      }
      mask[i] = hc[i]! > 0 && keepOut?.[i] !== 1 ? 1 : 0;
    }
  }
  return { w, d, mask, hc, hq, ...layout };
}

export function gableRoof(footprint: Uint8Array, w: number, d: number, overhang: number, extras: RoofExtras = {}, variant: GableVariant = GABLE): RoofPlan & GableLayout {
  const field = gableField(footprint, w, d, overhang, extras.keepOut, variant);
  return { ...buildRoof(field, overhang, extras.cap), rects: field.rects, roofs: field.roofs };
}
