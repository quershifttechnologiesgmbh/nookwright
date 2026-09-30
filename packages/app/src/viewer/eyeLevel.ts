/**
 * Augenhöhe (W10): Kamera ≈ 1,7 Blöcke über dem Boden vor der Haupttür, 3/4 aus der Türachse geschwenkt, waagerecht
 * blickend – wie Architekturfotografie und wie die Galerie der Website (`website/js/camera-rig.js`). Rein.
 *
 * `shift`: mit Shift (Bild verschoben statt Kamera gekippt, senkrechte Kanten bleiben senkrecht) und längerer
 * Brennweite (32°); ohne Shift (Texturen-Ansicht, 70° wie im Spiel) steht der Bau so, dass er ohne Kippen ins Bild passt.
 */
import type { Shell } from '@mcda/blueprint';

type V3 = readonly [number, number, number];

export interface EyeDoor {
  /** Türblock (untere Hälfte), Weltkoordinaten */
  readonly pos: V3;
  /** Richtung nach außen (x, z) */
  readonly out: readonly [number, number];
}

export interface EyeCamera {
  readonly position: V3;
  /** Blickpunkt in Augenhöhe (waagerecht) */
  readonly target: V3;
  /** Vertikaler Öffnungswinkel in Grad */
  readonly fov: number;
  /** Bildverschiebung nach oben in Bildhöhen (0 ohne Shift) */
  readonly shiftY: number;
}

const STEP: Readonly<Record<string, readonly [number, number]>> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

/** Haupttür der Hülle: `isMain`, sonst die tiefste Außentür; Türblock = Innenzelle + Richtung, Höhe = Raumboden. */
export function mainDoorOf(shell: Shell): EyeDoor | undefined {
  let best: { door: EyeDoor; main: boolean } | undefined;
  for (const room of shell.rooms.values()) {
    for (const d of room.doors) {
      const step = STEP[d.toward];
      if (step === undefined) continue;
      const door: EyeDoor = { pos: [d.inside[0] + step[0], room.baseY, d.inside[1] + step[1]], out: step };
      if (d.isMain && (best === undefined || !best.main || door.pos[1] < best.door.pos[1])) best = { door, main: true };
    }
  }
  return best?.door;
}

export const EYE_HEIGHT = 1.7;

/**
 * Kamera in Augenhöhe auf den Quader `box` (Weltzellen, inklusive). Ohne Tür: von Süden.
 * @param aspect Breite/Höhe des Bildes
 */
export function eyeLevelCamera(box: { readonly min: V3; readonly max: V3 }, door: EyeDoor | undefined, aspect: number, opts: { readonly shift?: boolean; readonly fov?: number; readonly swingDeg?: number } = {}): EyeCamera {
  const shift = opts.shift ?? true;
  const fov = opts.fov ?? (shift ? 32 : 70);
  const swing = ((opts.swingDeg ?? 38) * Math.PI) / 180;
  const bc = [(box.min[0] + box.max[0] + 1) / 2, (box.min[2] + box.max[2] + 1) / 2] as const;
  const out = door?.out ?? ([0, 1] as const);
  let sign = 1;
  if (door !== undefined) {
    const perp = [-out[1], out[0]] as const;
    const lateral = (door.pos[0] + 0.5 - bc[0]) * perp[0] + (door.pos[2] + 0.5 - bc[1]) * perp[1];
    sign = lateral < -0.5 ? -1 : 1;
  }
  const a = swing * sign;
  const dir = [out[0] * Math.cos(a) - out[1] * Math.sin(a), out[0] * Math.sin(a) + out[1] * Math.cos(a)] as const;
  const aim = door !== undefined ? [(door.pos[0] + 0.5 + bc[0]) / 2, (door.pos[2] + 0.5 + bc[1]) / 2] as const : bc;
  const floor = door?.pos[1] ?? box.min[1] + 1;
  const eyeY = floor + EYE_HEIGHT;
  const pts: V3[] = [];
  for (const x of [box.min[0], box.max[0] + 1]) for (const y of [Math.max(floor, box.min[1]), box.max[1] + 1]) for (const z of [box.min[2], box.max[2] + 1]) pts.push([x, y, z]);
  const tanV = Math.tan((fov * Math.PI) / 360), tanH = tanV * aspect, margin = 0.9;
  const fwd = [-dir[0], -dir[1]] as const, right = [-fwd[1], fwd[0]] as const;
  const frame = (dist: number) => {
    const px = aim[0] + dir[0] * dist, pz = aim[1] + dir[1] * dist;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, ok = true;
    for (const p of pts) {
      const qx = p[0] - px, qz = p[2] - pz, depth = qx * fwd[0] + qz * fwd[1];
      if (depth < 1) { ok = false; break; }
      const u = (qx * right[0] + qz * right[1]) / depth, v = (p[1] - eyeY) / depth;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const fitsV = shift ? v1 - v0 <= 2 * tanV * margin : Math.max(v1, -v0) <= tanV * margin;
    return { px, pz, u0, u1, v0, v1, ok: ok && u1 - u0 <= 2 * tanH * margin && fitsV };
  };
  let lo = 2, hi = 8;
  while (!frame(hi).ok && hi < 4000) hi *= 1.5;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (frame(mid).ok) hi = mid; else lo = mid; }
  const f = frame(hi);
  const yaw = Math.atan2(fwd[0], fwd[1]) - Math.atan((f.u0 + f.u1) / 2);
  const look = [Math.sin(yaw), Math.cos(yaw)] as const;
  const vc = shift ? Math.max(f.v0 + tanV * 0.78, f.v1 - tanV * margin) : 0;
  return { position: [f.px, eyeY, f.pz], target: [f.px + look[0] * hi, eyeY, f.pz + look[1] * hi], fov, shiftY: vc / (2 * tanV) };
}
