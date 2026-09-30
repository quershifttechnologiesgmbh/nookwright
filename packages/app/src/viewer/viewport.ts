/**
 * Gemeinsames der beiden 3D-Ansichten (Flächenfarben mit three.js, Texturen mit @mcda/viewer), rein und testbar:
 * Klick-Erkennung neben der Orbit-Kamera (Ziehen dreht, Klick wählt) und die Schnittstelle für Kamera-Befehle.
 */

import type { EyeCamera } from './eyeLevel.js';

/** Zellquader in Weltkoordinaten (inklusive), z. B. das Haus oder die Auswahl. */
export interface FitBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** W9-G4: Blickrichtung beim Einpassen (Orbit: yaw um y, pitch über dem Horizont); fehlt = die Kamera behält sie. */
  readonly look?: { readonly yaw: number; readonly pitch: number } | undefined;
}

/** Richtung vom Ziel zur Kamera für `look` (wie `orbitAxes(…).back` in `@mcda/viewer`). */
export function lookDirection(look: { readonly yaw: number; readonly pitch: number }): [number, number, number] {
  const cp = Math.cos(look.pitch);
  return [-cp * Math.sin(look.yaw), Math.sin(look.pitch), cp * Math.cos(look.yaw)];
}

/**
 * Befehle der App an die aktive 3D-Ansicht (Taste F, Knopf „Einpassen“). `box` (W2-ED U3): auf diesen Quader
 * einpassen (Auswahl); fehlt er, auf den Quader der Szene (`fitBox`, das Haus) bzw. alles.
 */
export interface ViewportApi {
  fit(box?: FitBox): void;
  /**
   * W10 „Augenhöhe“: Kamera vor den Eingang (eyeLevel.ts). `shift` = Ansicht kann das Bild verschieben (three.js);
   * die Ansicht wählt selbst, ob sie es nutzt. Der erste eigene Dreh/Zoom kehrt zur normalen Kamera zurück.
   */
  eyeLevel?(make: (aspect: number, shift: boolean) => EyeCamera): void;
}

export interface PointerSample {
  readonly x: number;
  readonly y: number;
  /** Zeit in ms */
  readonly t: number;
}

/** Höchstens so weit (px) und so lange (ms) darf sich der Zeiger bewegen, damit es ein Klick und kein Ziehen ist. */
export const CLICK_SLOP_PX = 5;
export const CLICK_MAX_MS = 600;

export function isClick(down: PointerSample, up: PointerSample): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_SLOP_PX && up.t - down.t <= CLICK_MAX_MS;
}

type V3 = readonly [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l < 1e-9 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};

/** Kamera-Achsen zur Blickrichtung: vorwärts (zum Ziel), rechts, oben (Welt-oben = +y). */
function cameraAxes(dir: V3): { readonly f: V3; readonly r: V3; readonly u: V3 } {
  const f = unit([-dir[0], -dir[1], -dir[2]]);
  let r = unit(cross(f, [0, 1, 0]));
  if (r[0] === 0 && r[1] === 0 && r[2] === 0) r = [1, 0, 0]; // senkrecht von oben
  return { f, r, u: cross(r, f) };
}

/**
 * Abstand der Kamera vom Punkt `center` (liegt auf der Blickachse), damit alle acht Ecken des Quaders `min`–`max` ins
 * Bild passen (Blickrichtung behalten, Kamera oben = +y). `dir`: vom Ziel zur Kamera; `tanV`/`tanH`: Tangens des
 * halben vertikalen bzw. horizontalen Öffnungswinkels; `margin` ≥ 1 lässt Rand. `left`: linker Rand des nutzbaren
 * Bildes in Bildkoordinaten (−1 = ganz links; die Etagen-Leiste liegt links über der Ansicht). Enger als eine
 * Hüllkugel: flache, breite Bauten füllen das Bild (Review R1-14: nach „Übernehmen“ lag die Base klein in der Mitte).
 */
export function fitDistance(min: V3, max: V3, center: V3, dir: V3, tanV: number, tanH: number, margin = 1.08, left = -1): number {
  const { f, r, u } = cameraAxes(dir);
  let dist = 0;
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const d = sub([x, y, z], center);
        const depth = dot(d, f); // > 0: hinter dem Mittelpunkt (weiter weg)
        const h = dot(d, r) * margin;
        const bound = h >= 0 ? tanH : -left * tanH; // rechts bis 1, links bis `left`
        dist = Math.max(dist, bound > 0 ? Math.abs(h) / bound - depth : Infinity, (Math.abs(dot(d, u)) * margin) / tanV - depth);
      }
    }
  }
  return dist;
}

/**
 * Einpassen mit Zentrieren: Abstand wie {@link fitDistance}, dann das Ziel in der Bildebene so verschieben, dass der
 * Quader mittig im nutzbaren Bild liegt (die nahen unteren Ecken ragen perspektivisch weiter heraus als die fernen
 * oberen – mittig auf den Quader-Mittelpunkt blieb oben ein breiter leerer Streifen). `left` wie bei
 * {@link fitDistance}; die Mitte des nutzbaren Bildes liegt dann bei `(left + 1) / 2`. Wenige Runden genügen.
 */
export function fitView(min: V3, max: V3, dir: V3, tanV: number, tanH: number, margin = 1.08, left = -1): { readonly target: V3; readonly distance: number } {
  const { f, r, u } = cameraAxes(dir);
  const mid = (left + 1) / 2;
  let target: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let distance = fitDistance(min, max, target, dir, tanV, tanH, margin, left);
  for (let round = 0; round < 4; round++) {
    const cam: V3 = [target[0] + dir[0] * distance, target[1] + dir[1] * distance, target[2] + dir[2] * distance];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [min[0], max[0]]) {
      for (const y of [min[1], max[1]]) {
        for (const z of [min[2], max[2]]) {
          const v = sub([x, y, z], cam);
          const depth = Math.max(1e-6, dot(v, f));
          const px = dot(v, r) / (depth * tanH);
          const py = dot(v, u) / (depth * tanV);
          x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        }
      }
    }
    // Ziel so verschieben, dass die Mitte der Projektion auf die Mitte des nutzbaren Bildes fällt
    const ox = ((x0 + x1) / 2 - mid) * tanH * distance;
    const oy = ((y0 + y1) / 2) * tanV * distance;
    if (Math.abs(ox) < 1e-3 && Math.abs(oy) < 1e-3) break;
    target = [target[0] + r[0] * ox + u[0] * oy, target[1] + r[1] * ox + u[1] * oy, target[2] + r[2] * ox + u[2] * oy];
    distance = fitDistance(min, max, target, dir, tanV, tanH, margin, left);
  }
  return { target, distance };
}
