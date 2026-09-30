/**
 * Dekorateur „Verwitterung/Bewuchs“ (research/12 §6.1, Schicht 7 „Varianten derselben Rolle“): tauscht an
 * Hüllzellen freigegebener Rollen die Grundform gegen die Variante `mossy` bzw. `cracked` derselben Familie
 * (stone_bricks → mossy_stone_bricks / cracked_stone_bricks, cobblestone_stairs → mossy_cobblestone_stairs).
 * KEINE Geometrie: Belegung, Rolle, Blockart und Physik-Klasse bleiben gleich; wo die Familie die Variante
 * nicht hat (Tuff, Holz, Schiefertreppen), passiert nichts.
 *
 * Wahrscheinlichkeitsfeld je Zelle (Alter A, Faktoren moss/cracks):
 *   Moos  p = A·moss·(0,10 + 0,50·low + 0,25·wet)      low = (1 − t_fassade)², wet = Geländekontakt/innen/Traufe
 *   (W2, W5: `t_fassade` = `facade_h`, der Verlauf Sockel → Traufe über das ganze Gebäude; nur ohne ihn `wall_h`.
 *   Geländekontakt heißt unterste Wandreihe des Erdgeschosses, nicht jedes Geschosses.)
 *   Risse p = A·cracks·(0,08 + 0,12·edge)             edge = Ecke, Laibung, Traufe
 * Gesetzt wird, wenn das (gleichverteilte) Cluster-Rauschen < p ist → Flächenanteil ≈ p, aber zusammenhängend.
 * Moos hat Vorrang vor Rissen. Deterministisch per Projekt-Seed + Position.
 *
 * **Randzone statt Binärschwelle (research/30 K2, Vorbild ColorRamp):** ohne `fade` gilt weiter `u < p`. Mit
 * `fade` gelten drei Zonen: `u < pIn` immer, `pIn ≤ u < pOut` mit linear abnehmender Wahrscheinlichkeit
 * (gewürfelt mit einem feinen weißen Hash), `u ≥ pOut` nie – mit `pIn = p·(1 − fade/2)`,
 * `pOut = p·(1 + fade/2)`. Der **Erwartungswert bleibt p** (die Zone ist symmetrisch), der Rand ist aber
 * ausgefranst statt gerade. Damit braucht die Kalibrierung aus research/24 §5.3 keine Nachjustierung.
 */
import type { ResolvedTheme } from '@mcda/catalog';
import { clusterU, hash01, hashSeed, type NoiseParams } from '@mcda/core';
import type { CellContext } from './context.js';
import type { ResolvedDetail, ThemeResolver } from './theme-resolve.js';

/** Schalter/Übersteuerung in `MaterializeOptions.weathering`. */
export type WeatheringOption = false | { readonly age?: number; readonly moss?: number; readonly cracks?: number; readonly fade?: number };

export interface WeatheringSettings {
  readonly age: number;
  readonly moss: number;
  readonly cracks: number;
  /** Breite der Randzone als Anteil von p (0 = harte Schwelle, heutiges Verhalten). */
  readonly fade: number;
  readonly roles: ReadonlySet<string>;
  /**
   * W2 (I1): `false` = Wandzellen mit Raum dahinter (ab Erdgeschoss) verwittern nicht – ihre Innenseite ist im Raum
   * sichtbar. Fehlt = `true` (bisheriges Verhalten; auch für Aufrufer, die eigene Einstellungen bauen, z. B. Story).
   */
  readonly interiorFaces?: boolean;
}

const MOSS_NOISE: NoiseParams = { type: 'cluster', scale: 3, octaves: 2, dither: 0.08 };
const CRACK_NOISE: NoiseParams = { type: 'cluster', scale: 1.5, octaves: 1, dither: 0.05 };

/**
 * Rauschfelder der Verwitterung (research/30 K3): eigene **Kanäle** statt eigener Seed-Labels, damit Moos,
 * Risse und die beiden Randzonen nachweislich auf getrennten Feldern liegen – und damit ein Theme mit
 * `noise.channel: "moss"` bewusst auf dasselbe Feld legen kann (z. B. eine Rolle, die mit dem Moos fleckt).
 */
export const WEATHERING_CHANNELS = { moss: 'moss', crack: 'crack', mossFade: 'mossfade', crackFade: 'crackfade' } as const;

/**
 * Rauschfeld der Verwitterung: Saat ist die Ebene der Fläche. K8-Reparatur (W2, P0-B S1): nicht mehr die Zell-ID –
 * sonst bekam jede Zelle ihr eigenes Feld und Moos zerfiel in Einzelsteine. Beim Verschieben bleibt es trotzdem
 * stehen, weil Ebene und Koordinaten mit stabilen IDs hausrelativ sind (`shellContext` mit `relative`).
 */
const field = (seed: number, channel: string, c: { readonly plane: number }): number =>
  hashSeed(seed, 'channel', channel, c.plane);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Einstellungen aus Theme (`decor.weathering`) und Option; `undefined` = Pass aus. */
export function weatheringSettings(theme: ResolvedTheme, option?: WeatheringOption): WeatheringSettings | undefined {
  if (option === false) return undefined;
  const w = theme.decor.weathering;
  if (w === undefined) return undefined;
  const age = option?.age ?? w.age;
  if (age <= 0) return undefined;
  return {
    age,
    moss: option?.moss ?? w.moss ?? 1,
    cracks: option?.cracks ?? w.cracks ?? 1,
    fade: option?.fade ?? w.fade ?? 0,
    roles: new Set(w.roles),
    interiorFaces: w.interiorFaces ?? true,
  };
}

/**
 * W2 (I1): Liegt die Innenseite dieser Zelle in einem Raum ab dem Erdgeschoss? Wandzellen mit Raum (`frame`) sind
 * bei 1 Block dicken Wänden von innen sichtbar; Deko in Außenluft (ohne Raum), Bauwerke und Keller nicht.
 */
export function facesRoom(ctx: CellContext): boolean {
  return ctx.surface === 'wall' && ctx.kind !== 'fort' && ctx.frame !== undefined && ctx.storey >= 0;
}

/** Wahrscheinlichkeiten für Moos und Risse an einer Zelle. */
export function weatheringChance(ctx: CellContext, s: WeatheringSettings): { moss: number; cracks: number } {
  let low = 0;
  let wet = 0;
  let edge = 0;
  let dryFloor = false;
  switch (ctx.surface) {
    case 'wall':
      // W5 (W2): Moos aus demselben Verlauf wie die Fassade – am Fuß des Gebäudes, nicht an jedem Geschossfuß.
      // Ohne Fassadenachse (Bauwerke setzen sie gleich `wall_h`, Komponenten haben keine) gilt `wall_h`.
      low = (1 - clamp01(ctx.t.facade_h ?? ctx.t.wall_h ?? 0.5)) ** 2;
      wet = ctx.exterior ? (ctx.hRel <= 0 && ctx.storey <= 0 ? 0.5 : 0) : 0.2;
      edge = ctx.edge ? 1 : 0;
      break;
    case 'floor':
      if (ctx.wallDist === 0) { // Wandfuß: Geländekontakt
        low = 1;
        wet = ctx.exterior ? 1 : 0.2;
        edge = ctx.corner ? 1 : 0;
      } else {
        dryFloor = true;
        edge = ctx.wallDist === 1 ? 1 : 0;
      }
      break;
    case 'roof': {
      const rt = ctx.t.roof_t ?? 0.5;
      low = 0.5 * (1 - rt) ** 2;
      wet = rt < 0.25 ? 0.6 : 0;
      edge = ctx.edge ? 1 : 0;
      break;
    }
    case 'ceiling':
      dryFloor = true;
      break;
  }
  const moss = dryFloor ? s.age * s.moss * 0.05 : s.age * s.moss * (0.1 + 0.5 * low + 0.25 * wet);
  const cracks = s.age * s.cracks * (0.08 + 0.12 * edge);
  return { moss: clamp01(moss), cracks: clamp01(cracks) };
}

const isVariantAlready = (family: string, shape: string): boolean =>
  family.startsWith('mossy_') || family.startsWith('cracked_') || shape === 'mossy' || shape === 'cracked' || shape === 'chiseled';

/**
 * Dreizonen-Schwelle (research/30 K2): `u < pIn` gesetzt, `pIn ≤ u < pOut` mit linear abnehmender
 * Wahrscheinlichkeit (`dither` entscheidet), `u ≥ pOut` nicht. `fade = 0` → `u < p` (bitgleich zu vorher).
 */
export function zoneHit(u: number, p: number, fade: number, dither: number): boolean {
  if (p <= 0) return false;
  if (fade <= 0) return u < p;
  const pIn = Math.max(0, p * (1 - fade / 2));
  const pOut = Math.min(1, p * (1 + fade / 2));
  if (u < pIn) return true;
  if (pOut <= pIn || u >= pOut) return false;
  return dither < (pOut - u) / (pOut - pIn);
}

/**
 * Variantenwechsel für eine aufgelöste Hüllzelle; `undefined` = Block bleibt.
 * @param role Rolle NACH den Flächen-Regeln (4b)
 */
export function weatherCell(
  s: WeatheringSettings, ctx: CellContext, seed: number, role: string, detail: ResolvedDetail, resolver: ThemeResolver,
): { readonly block: string; readonly variant: 'mossy' | 'cracked' } | undefined {
  if (!s.roles.has(role) || detail.family === undefined || detail.familyShape === undefined) return undefined;
  if (isVariantAlready(detail.family, detail.familyShape)) return undefined;
  if (s.interiorFaces === false && facesRoom(ctx)) return undefined;
  const p = weatheringChance(ctx, s);
  if (p.moss > 0) {
    const u = clusterU(field(seed, WEATHERING_CHANNELS.moss, ctx), ctx.a, ctx.b, MOSS_NOISE);
    const dither = s.fade > 0 ? hash01(field(seed, WEATHERING_CHANNELS.mossFade, ctx), ctx.a, ctx.b) : 0;
    if (zoneHit(u, p.moss, s.fade, dither)) {
      const b = resolver.variantOf(detail.family, detail.familyShape, 'mossy');
      if (b !== undefined) return { block: b, variant: 'mossy' };
    }
  }
  if (p.cracks > 0) {
    const u = clusterU(field(seed, WEATHERING_CHANNELS.crack, ctx), ctx.a, ctx.b, CRACK_NOISE);
    const dither = s.fade > 0 ? hash01(field(seed, WEATHERING_CHANNELS.crackFade, ctx), ctx.a, ctx.b) : 0;
    if (zoneHit(u, p.cracks, s.fade, dither)) {
      const b = resolver.variantOf(detail.family, detail.familyShape, 'cracked');
      if (b !== undefined) return { block: b, variant: 'cracked' };
    }
  }
  return undefined;
}
