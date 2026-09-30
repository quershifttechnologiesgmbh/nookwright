/**
 * Tageszeit und Lightmap wie Minecraft (rein): Aus Tageszeit, Helligkeits-Einstellung und Flackern entstehen
 * Uniforms für den Shader; `lightmapColor` ist die CPU-Fassung derselben Formel (Tests, Doku), `LIGHTMAP_GLSL`
 * die Shader-Fassung. Beide müssen gleich bleiben.
 *
 * Grundlage: Minecraft `Level.getSkyDarken`, `DimensionType.timeOfDay`, `LightTexture` und `lightmap.fsh`
 * (Kurve f/(4−3f), Blocklicht ×1,5 mit „kubischer“ Warmfärbung, Himmelslicht (f, f, 1) → 35 % Weiß,
 * Helligkeit = Mischung mit 1−(1−x)⁴). Ergänzt um eine leichte Warmtönung des Blocklichts, eine kühle
 * Tönung des Himmelslichts und ein Abendrot (Farbe von `getSunriseColor`).
 */

export type Rgb = readonly [number, number, number];

/** Minecraft-Ticks: 0 = 6:00, 6000 = Mittag, 12000 = 18:00, 13000 ≈ Sonnenuntergang, 18000 = Mitternacht. */
export const DAY_TIME = { sunrise: 0, noon: 6000, sunset: 12000, dusk: 12800, night: 14000, midnight: 18000 } as const;

const clamp = (v: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, v));
const frac = (v: number): number => v - Math.floor(v);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: Rgb, b: Rgb, t: number): [number, number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** Sonnenstand 0..1 (Minecraft `timeOfDay`): 0 = Mittag, 0,5 = Mitternacht. */
export function celestialAngle(dayTime: number): number {
  const d0 = frac(dayTime / 24000 - 0.25);
  const d1 = 0.5 - Math.cos(d0 * Math.PI) / 2;
  return (d0 * 2 + d1) / 3;
}

/** Minecraft `getSkyDarken` bei klarem Himmel: 1 am Tag, 0,2 in der Nacht. */
export function skyDarken(dayTime: number): number {
  const t = celestialAngle(dayTime);
  const f = 1 - clamp(1 - (Math.cos(t * Math.PI * 2) * 2 + 0.2));
  return f * 0.8 + 0.2;
}

/** Stärke des Abend-/Morgenrots 0..1 (Minecraft `getSunriseColor`, Alpha). */
export function sunGlow(dayTime: number): number {
  const c = Math.cos(celestialAngle(dayTime) * Math.PI * 2);
  if (c < -0.4 || c > 0.4) return 0;
  const f = c / 0.4 * 0.5 + 0.5;
  const a = 1 - (1 - Math.sin(f * Math.PI)) * 0.99;
  return a * a;
}

export interface DayLighting {
  readonly dayTime: number;
  readonly skyDarken: number;
  /** Faktor des Himmelslichts in der Lightmap (Minecraft: darken·0,95 + 0,05) */
  readonly skyFactor: number;
  /** Farbe des Himmelslichts (kühl am Tag, rötlich in der Dämmerung, blau in der Nacht) */
  readonly skyColor: Rgb;
  /** Hintergrund (Himmelsfarbe) */
  readonly background: Rgb;
  readonly glow: number;
}

const DAY_SKY: Rgb = [0.62, 0.76, 0.9];
const NIGHT_SKY: Rgb = [0.02, 0.03, 0.07];
const GLOW: Rgb = [0.98, 0.52, 0.3];
/** Kühle Tönung des Himmelslichts (Tag) */
export const SKY_TINT: Rgb = [0.9, 0.95, 1.0];
/** Warme Tönung des Blocklichts (Laternen, Kerzen, Feuer) */
export const BLOCK_TINT: Rgb = [1.0, 0.88, 0.7];

/** Uniform-Werte einer Tageszeit (ändert nur Uniforms, kein Mesh). */
export function dayLighting(dayTime: number): DayLighting {
  const darken = skyDarken(dayTime);
  const glow = sunGlow(dayTime);
  // Minecraft: (f, f, 1) → 35 % Richtung Weiß; dazu kühl am Tag und etwas Abendrot
  const base = mix3([darken, darken, 1], [1, 1, 1], 0.35);
  const cool: Rgb = [base[0] * SKY_TINT[0], base[1] * SKY_TINT[1], base[2] * SKY_TINT[2]];
  const skyColor = mix3(cool, [1.0, 0.72, 0.52], glow * 0.45);
  const day = clamp((darken - 0.2) / 0.8);
  const background = mix3(mix3(NIGHT_SKY, DAY_SKY, day), GLOW, glow * 0.55);
  return { dayTime, skyDarken: darken, skyFactor: darken * 0.95 + 0.05, skyColor, background, glow };
}

/** Uhrzeit „hh:mm“ einer Minecraft-Tageszeit. */
export function clockOf(dayTime: number): string {
  const minutes = Math.round((((dayTime / 1000 + 6) % 24) + 24) % 24 * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Flackern des Blocklichts (Minecraft: kleiner Zufallswert auf den Faktor 1,5). Hier deterministisch aus der
 * Zeit (Sekunden), Amplitude ≈ ±0,08 – subtil.
 */
export function flicker(seconds: number): number {
  const t = seconds;
  return 0.08 * (0.5 * Math.sin(t * 7.3) + 0.3 * Math.sin(t * 13.1 + 1.7) + 0.2 * Math.sin(t * 23.7 + 0.3));
}

export interface LightmapParams {
  readonly skyFactor: number;
  readonly skyColor: Rgb;
  /** Minecraft 1,5 (+ Flackern) */
  readonly blockFactor: number;
  readonly blockTint: Rgb;
  /** Minecraft-Einstellung „Helligkeit“: 0 düster … 1 hell (Standard 0,5) */
  readonly brightness: number;
}

export function lightmapParams(day: DayLighting, brightness = 0.5, flick = 0): LightmapParams {
  return { skyFactor: day.skyFactor, skyColor: day.skyColor, blockFactor: 1.5 + flick, blockTint: BLOCK_TINT, brightness };
}

const curve = (level: number): number => {
  const f = clamp(level / 15);
  return f / (4 - 3 * f);
};

/** Lichtfarbe für Blocklicht und Himmelslicht (0–15, auch gebrochen) – CPU-Fassung von `LIGHTMAP_GLSL`. */
export function lightmapColor(block: number, sky: number, p: LightmapParams): Rgb {
  const b = curve(block) * p.blockFactor;
  const s = curve(sky) * p.skyFactor;
  const warm = [b, b * ((b * 0.6 + 0.4) * 0.6 + 0.4), b * (b * b * 0.6 + 0.4)];
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    let c = Math.min(warm[k]!, 1) * p.blockTint[k]! + p.skyColor[k]! * s;
    c = clamp(mix(c, 0.75, 0.04));
    const inv = 1 - c;
    c = mix(c, 1 - inv * inv * inv * inv, p.brightness);
    out[k] = clamp(mix(c, 0.75, 0.04));
  }
  return [out[0]!, out[1]!, out[2]!];
}

/** GLSL-Fassung (ES 3.00) von `lightmapColor`; Uniforms: uSkyFactor, uSkyColor, uBlockFactor, uBlockTint, uBrightness. */
export const LIGHTMAP_GLSL = `
uniform float uSkyFactor;
uniform vec3 uSkyColor;
uniform float uBlockFactor;
uniform vec3 uBlockTint;
uniform float uBrightness;

float lightCurve(float level) {
  float f = clamp(level / 15.0, 0.0, 1.0);
  return f / (4.0 - 3.0 * f);
}

vec3 lightmap(float block, float sky) {
  float b = lightCurve(block) * uBlockFactor;
  float s = lightCurve(sky) * uSkyFactor;
  vec3 warm = vec3(b, b * ((b * 0.6 + 0.4) * 0.6 + 0.4), b * (b * b * 0.6 + 0.4));
  vec3 c = min(warm, vec3(1.0)) * uBlockTint + uSkyColor * s;
  c = clamp(mix(c, vec3(0.75), 0.04), 0.0, 1.0);
  vec3 inv = 1.0 - c;
  c = mix(c, 1.0 - inv * inv * inv * inv, uBrightness);
  return clamp(mix(c, vec3(0.75), 0.04), 0.0, 1.0);
}
`;
