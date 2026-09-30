/**
 * Orbit-Kamera als reine Mathematik (testbar ohne DOM): Zielpunkt, Gier (yaw), Neigung (pitch), Abstand.
 * Ergebnis ist eine View-Matrix (spaltenweise, wie WebGL/gl-matrix) für deepslates `drawStructure`.
 */

import type { Vec3 } from './port.js';

export interface Orbit {
  /** Blickziel in Strukturkoordinaten (Blockeinheiten) */
  readonly target: Vec3;
  /** Drehung um die Hochachse (Radiant) */
  readonly yaw: number;
  /** Neigung: > 0 = Kamera über dem Ziel (Radiant) */
  readonly pitch: number;
  readonly distance: number;
}

/** Vertikaler Öffnungswinkel von deepslates Projektion (Renderer.getPerspective). */
export const FOV_Y = (70 * Math.PI) / 180;
const PITCH_LIMIT = Math.PI / 2 - 0.01;
export const MIN_DISTANCE = 1.5;
export const MAX_DISTANCE = 400;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Kamera, die einen Quader der Größe `size` (ab 0,0,0) ganz zeigt; Blick von Südosten schräg oben. */
export function fitOrbit(size: Vec3, aspect = 1, yaw = -Math.PI / 4, pitch = 0.6): Orbit {
  const radius = 0.5 * Math.hypot(size[0], size[1], size[2]);
  const halfFov = Math.min(FOV_Y / 2, Math.atan(Math.tan(FOV_Y / 2) * aspect));
  const distance = clamp((radius / Math.sin(halfFov)) * 1.05, MIN_DISTANCE, MAX_DISTANCE);
  return { target: [size[0] / 2, size[1] / 2, size[2] / 2], yaw, pitch, distance };
}

export function rotateOrbit(o: Orbit, dYaw: number, dPitch: number): Orbit {
  return { ...o, yaw: o.yaw + dYaw, pitch: clamp(o.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT) };
}

export function zoomOrbit(o: Orbit, factor: number): Orbit {
  return { ...o, distance: clamp(o.distance * factor, MIN_DISTANCE, MAX_DISTANCE) };
}

/** Rotationsteil der View-Matrix als Zeilen (Kamera-Achsen in Weltkoordinaten): rechts, oben, rückwärts. */
export function orbitAxes(o: Orbit): { right: Vec3; up: Vec3; back: Vec3 } {
  const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw), cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
  // R = Rx(pitch) · Ry(yaw)
  return {
    right: [cy, 0, sy],
    up: [sp * sy, cp, -sp * cy],
    back: [-cp * sy, sp, cp * cy],
  };
}

/** Verschiebt das Ziel in der Bildebene; dx/dy in Bildschirm-Anteilen der Höhe (1 = ganze Höhe). */
export function panOrbit(o: Orbit, dx: number, dy: number): Orbit {
  const { right, up } = orbitAxes(o);
  const s = 2 * o.distance * Math.tan(FOV_Y / 2);
  const t = o.target;
  return { ...o, target: [t[0] - right[0] * dx * s + up[0] * dy * s, t[1] - right[1] * dx * s + up[1] * dy * s, t[2] - right[2] * dx * s + up[2] * dy * s] };
}

/** Kameraposition in Weltkoordinaten. */
export function orbitEye(o: Orbit): Vec3 {
  const { back } = orbitAxes(o);
  return [o.target[0] + back[0] * o.distance, o.target[1] + back[1] * o.distance, o.target[2] + back[2] * o.distance];
}

/** View-Matrix = T(0, 0, −d) · Rx(pitch) · Ry(yaw) · T(−target), spaltenweise. */
export function orbitView(o: Orbit): Float32Array {
  const { right, up, back } = orbitAxes(o);
  const [tx, ty, tz] = o.target;
  const dot = (a: Vec3): number => a[0] * tx + a[1] * ty + a[2] * tz;
  const m = new Float32Array(16);
  m[0] = right[0]; m[4] = right[1]; m[8] = right[2]; m[12] = -dot(right);
  m[1] = up[0]; m[5] = up[1]; m[9] = up[2]; m[13] = -dot(up);
  m[2] = back[0]; m[6] = back[1]; m[10] = back[2]; m[14] = -dot(back) - o.distance;
  m[15] = 1;
  return m;
}

/** Wendet eine spaltenweise 4×4-Matrix auf einen Punkt an (für Tests und Picking). */
export function transformPoint(m: Float32Array, p: Vec3): Vec3 {
  const [x, y, z] = p;
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}
