/**
 * Dachformen und Dach-Details (research/18 §4: D1 Neigung, D2 Kanten, D3 Glockenfuß, D6 Krüppel-/Fußwalm,
 * D7 Mansard/Gambrel, D14 Saltbox; research/16 D1–D3: Traufbrett, doppelter Ortgang, Firstkante). Alles bleibt im
 * Höhenfeld-Rahmen von roof.ts/gable.ts:
 *
 * 1. Grundriss-Feld (45°, in Ringen): Walm = Chebyshev-DT (hip, mansard), Rechteck-Profile (gable, gambrel, shed,
 *    half_hip, dutch_gable, saltbox). Klassifikation und Treppenwahl wie bisher (`buildRoof`).
 * 2. Vertikales Profil: Ring k (0 = äußerster Traufring) → Block. Anstieg je Ring in Halbblöcken: 1 = 1:2 (Stufen
 *    unten/oben im Wechsel), 2 = 1:1 (Treppen), 4 = 2:1 (Treppe auf Füllblock). Oberkante H(0) = 2,
 *    H(k) = H(k−1) + Anstieg; ein Treppenring braucht gerades H (sonst −1). Treppe bei y = H/2 − 1, Stufe unten bei
 *    ungeradem, oben bei geradem H. Mansard/Gambrel: unten steil, ab dem Knick m flach; Glockenfuß: Überstand und
 *    Wandring eine Stufe flacher. `normal` ohne Details ist bitgenau das bisherige Dach (y = t).
 * 3. Schließen: jede Dachspalte reicht bis 1 über ihren tiefsten Dach-Nachbarn (Füllblöcke). Füllblöcke tiefer als
 *    der vorige Ring (Sprung im Feld, Fußwalm) sind Wand – der zurückgesetzte Ziergiebel. Giebelwände an offenen
 *    Außenkanten wie bisher von der Decke bis unter den Dachblock.
 * 4. Kanten (`trim`): Traufe, Ortgang, First und Grate in `roof_trim`; `verge: 'closed'` setzt unter jede
 *    Ortgangzelle eine umgedrehte Treppe (Front zur Traufe) bzw. eine obere Stufe – doppelte Giebelkante.
 * 5. Gauben (B2, D4): zweites Feld per Maximum (dormers.ts); die Frontwand entsteht als Sprung wie beim Ziergiebel,
 *    Pfosten als `pillar`, unter der Gauben-Traufe läuft die Haupttreppe weiter (Schulter). Aussparung (`noRoof`):
 *    Grundriss angedockter Bauwerke ohne Dachblock.
 *
 * W2 (plan/baustandard.md, Prüfbericht X3 K2–K4, K7, K8):
 *  - D2 Traufanschluss: an reinen Traufspalten ist alles zwischen Decke und Dachblock über dem Traufblock davor
 *    Dachfüllung – kein Wandband über der Traufe (steil, Mansarde, Gambrel).
 *  - D3 Ortgang: unter jeder Ortgangtreppe in der Wandflucht, deren Nachbar entlang des Ortgangs ≥ 2 tiefer liegt
 *    (steil), liegt die oberste Zelle als Windbrett in `roof_trim` (mit Kante) – kein Zickzack der Giebelwand.
 *  - D4 Giebelfeld: Wandzellen unter dem Dach in `wall_gable` (Rückfall `wall_primary`), mit Kante auf Deckenhöhe ein
 *    Sohlbalken (`sills`, derive.ts ersetzt die Decke). Gaubendach in `roof_main`, nur seine Frontreihe in `roof_trim`.
 *  - D6 (mit Dach-Details): `fitRoof` hält eine Kappung an höheren Wänden ≤ 2 Ringe tief (flacher, sonst Quergiebel).
 *  - D5/D8 (nur mit `heightBudget: true`, automatische Dachhöhe): `fitRoof` senkt die Neigung, bis das Dach ins
 *    Höhen-Budget passt; Pultdach nur bis 7 Tiefe. Eine ausdrücklich gewählte Neigung (ohne das Feld) gilt genau.
 */
import type { HorizontalDir, Vec3 } from '@mcda/core';
import { dormerCell, dormerRows, frontHalf, planDormers, withDormers, type Dormer, type DormerKind } from './dormers.js';
import { gableField, type GableVariant } from './gable.js';
import { CCW, CW, DIRS, OPP, STEP, axisOf } from './grid.js';
import { buildRoof, classifyField, hipField, optionsForPattern, type RoofField, type RoofPlan } from './roof.js';
import type { DormerStyle, RoofDetail, RoofPitch, RoofStyle, ShellKind, ShellOrient } from './types.js';

export type PitchedRoof = Exclude<RoofStyle, 'flat'>;

/** Anstieg je Ring in Halbblöcken. */
const RISE: Readonly<Record<RoofPitch, number>> = { low: 1, normal: 2, steep: 4 };
/** Mansard/Gambrel: unterer (steiler) und oberer (flacher) Teil je Neigung. */
const BREAK_RISE: Readonly<Record<RoofPitch, readonly [number, number]>> = { low: [2, 1], normal: [4, 1], steep: [4, 2] };
/** Eine Stufe flacher (Glockenfuß): 2:1 → 1:1 → 1:2. */
const flatter = (rise: number): number => (rise >= 4 ? 2 : 1);

export type RingForm = 'stairs' | 'slab_bottom' | 'slab_top';

export interface RoofProfile {
  /** y des Dachblocks je Ring k, relativ zum äußersten Traufring (k = 0). */
  readonly y: readonly number[];
  readonly form: readonly RingForm[];
}

/** Knick des Mansard-/Gambreldachs in Ringen über der Wandlinie (research/18 D7: 2–3). */
export function mansardBreak(detail: RoofDetail | undefined, maxT: number): number {
  if (detail?.mansardBreak !== undefined) return Math.max(0, Math.floor(detail.mansardBreak));
  return Math.min(3, Math.max(1, Math.round(maxT / 2)));
}

/** Vertikales Profil für `rings` Ringe (k = 0 … rings − 1; k = t + Überstand). */
export function roofProfile(style: PitchedRoof, detail: RoofDetail | undefined, overhang: number, rings: number): RoofProfile {
  const pitch = detail?.pitch ?? 'normal';
  const broken = style === 'mansard' || style === 'gambrel';
  const m = broken ? mansardBreak(detail, rings - 1 - overhang) : 0;
  const riseAt = (k: number): number => {
    const t = k - overhang;
    const r = broken ? BREAK_RISE[pitch][t < m ? 0 : 1] : RISE[pitch];
    return detail?.flare === true && t <= 0 ? flatter(r) : r;
  };
  const y: number[] = [];
  const form: RingForm[] = [];
  let H = 2;
  for (let k = 0; k < rings; k++) {
    const rise = riseAt(k);
    if (k > 0) {
      H += rise;
      if (rise >= 2 && H % 2 === 1) H -= 1;
    }
    if (rise >= 2) {
      form.push('stairs');
      y.push(H / 2 - 1);
    } else {
      form.push(H % 2 === 1 ? 'slab_bottom' : 'slab_top');
      y.push(H % 2 === 1 ? (H - 1) / 2 : H / 2 - 1);
    }
  }
  return { y, form };
}

export interface RoofSpec {
  readonly style: PitchedRoof;
  readonly detail?: RoofDetail;
  readonly overhang: number;
  /** Vorderseite (Blickrichtung der Haustür nach außen): Saltbox hebt sie an, das Pultdach steigt von ihr weg. */
  readonly front: HorizontalDir;
  /** Gauben (D4, dormers.ts); fehlt = keine. */
  readonly dormers?: DormerStyle;
}

/** M2: getrennter Überstand von Traufe und Ortgang (`RoofDetail.roofOverhang: 'refined'`); Standard `legacy` = gleichmäßig. */
export const DEFAULT_ROOF_OVERHANG: NonNullable<RoofDetail['roofOverhang']> = 'legacy';
export const roofOverhangRefined = (detail: RoofDetail | undefined): boolean => (detail?.roofOverhang ?? DEFAULT_ROOF_OVERHANG) === 'refined';
/**
 * M2 (plan/spikes/FN_inspiration_gebaeude.md): Traufe bis 2 Blöcke, Ortgang schmal – das Hauptdach 1 Block, Flügel
 * (Quergiebel) bündig mit der Giebelwand (0). Ohne Überstand (0) bleibt alles 0.
 */
export const vergeOverhang = (eave: number): { readonly main: number; readonly wing: number } => ({ main: Math.min(eave, 1), wing: 0 });

/** Automatische Dachhöhe (W2, Baustandard D5/D8): nur mit `heightBudget: true`. */
export const roofBudgetOn = (detail: RoofDetail | undefined): boolean => detail?.heightBudget === true;

/** D8: Pultdach nur bis zu dieser Tiefe in Fallrichtung (Außenmaß), darüber Satteldach. */
export const SHED_MAX_DEPTH = 7;
/** D6: flache Kappung an einer höheren Wand höchstens so viele Ringe (Zellen). */
export const MAX_CAP_RINGS = 2;
/**
 * W3 (Dach-Teilung, plan/spikes/W3RD_dachdetails.md): ab diesem Außenmaß quer zum First (Spannweite + 2 × Überstand)
 * wird ein eingeschossiges Satteldach, das über dem Höhen-Budget liegt, geteilt („ab ~15 Breite“, Minecraft-Wiki).
 * Dächer, die doppelt so schnell steigen (steil, Gambrel mit steilem Unterteil), schon ab `SPLIT_MIN_OUTER_STEEP`.
 */
export const SPLIT_MIN_OUTER = 15;
export const SPLIT_MIN_OUTER_STEEP = 13;
/** W3: Mindest-Außenmaß der Teilung je Dach (steil bzw. Gambrel früher). */
const splitMinOuter = (spec: RoofSpec): number => (spec.style === 'gambrel' || spec.detail?.pitch === 'steep' ? SPLIT_MIN_OUTER_STEEP : SPLIT_MIN_OUTER);
/** W3: Dach-Teilung ist Standard (fehlt = an); `split: false` = ein Dach wie angegeben. */
export const roofSplitOn = (detail: RoofDetail | undefined): boolean => detail?.split !== false;
/**
 * W4 (D5 präzisiert, plan/spikes/W4F_dachproportion.md): höchstens so viele Kniestock-Reihen hebt die Hülle ein
 * ungeteiltes eingeschossiges Dach an (Bauernhaus 13 tief: 2, Beispielhaus 12 tief: 2); darüber wird geteilt.
 */
export const MAX_KNEE = 3;
/** W4: ein geteiltes Dach (W3) bekommt höchstens so viele Kniestock-Reihen – sonst lieber schmalere Streifen. */
export const MAX_SPLIT_KNEE = 1;
/** W4: Kniestock ist Standard (fehlt = an); `kneeWall: false` = Traufe auf Deckenhöhe wie bisher. */
export const roofKneeOn = (detail: RoofDetail | undefined): boolean => detail?.kneeWall !== false;

/**
 * Grundriss-Feld (45°, in Ringen) je Dachform. `cross` (W2 D6): Quergiebel statt Pultdach an höheren Wänden
 * (nur Satteldach-Familie; Walm/Mansarde steigen über die Distanztransformation ohnehin zur Wand an).
 */
export function roofField(spec: RoofSpec, region: Uint8Array, w: number, d: number, keepOut?: Uint8Array, cross = false, maxSpan?: number): RoofField {
  const o = spec.overhang;
  const rows = spec.detail?.halfHipRows !== undefined ? { rows: spec.detail.halfHipRows } : {};
  const maxDepth = roofBudgetOn(spec.detail) ? { maxDepth: SHED_MAX_DEPTH } : {};
  const variant: GableVariant | undefined =
    spec.style === 'shed' ? { kind: 'shed', front: spec.front, ...maxDepth }
    : spec.style === 'half_hip' ? { kind: 'half_hip', ...rows }
    : spec.style === 'dutch_gable' ? { kind: 'dutch_gable', ...rows }
    : spec.style === 'saltbox' ? { kind: 'saltbox', front: spec.front }
    : undefined;
  if (spec.style === 'hip' || spec.style === 'mansard') return hipField(region, w, d, o, keepOut);
  return gableField(region, w, d, o, keepOut, variant, {
    ...(cross ? { crossAtWall: true } : {}),
    ...(maxSpan !== undefined ? { split: { maxSpan, minOuter: splitMinOuter(spec), overhang: o } } : {}),
    ...(roofOverhangRefined(spec.detail) ? { verge: vergeOverhang(o) } : {}),
  });
}

/** Lage einer Dachetage im Raster (Weltkoordinaten über `x0`/`z0`). */
export interface RoofSite {
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly d: number;
  /** Dachregion: Grundriss dieser Etage ohne den der Etage darüber. */
  readonly region: Uint8Array;
  /** Grundriss dieser Etage. */
  readonly footprint: Uint8Array;
  /** Grundriss der Etage darüber (Sperrzone: weder Saat noch Dach). */
  readonly upper?: Uint8Array;
  /** Höchster Dachblock (absolut) an der Wand der Etage darüber; darüber flach. */
  readonly capY?: number;
  /** y der Decke dieser Etage. */
  readonly ceilingY: number;
  /** Aussparung (Grundriss angedockter Bauwerke): dort kein Dachblock, die Form des Dachs bleibt sonst gleich. */
  readonly noRoof?: Uint8Array;
  /**
   * Additiv (Baukörper): Spalten, die als geschlossen gelten – dort trägt ein Nachbar-Baukörper die Brandwand, an der
   * Kante dorthin entsteht keine Giebelwand (die Brandwand schließt den Dachraum).
   */
  readonly closed?: Uint8Array;
  /** Additiv (W2 D5): Bezugsgrößen des Dachhöhen-Budgets; fehlt = kein Budget (nur die Kappungsregel D6). */
  readonly budget?: RoofBudget;
}

/** Dachhöhen-Budget (W2, Baustandard D5) einer Dachetage. */
export interface RoofBudget {
  /** Bodenplatte des Erdgeschosses des Baukörpers (Traufhöhe = Deckenhöhe + 1 − groundY). */
  readonly groundY: number;
  /** Geschosshöhe dieser Etage (lichte Höhe + Platte). */
  readonly storey: number;
  /** Eingeschossiger Baukörper: First ≤ Traufhöhe (Dachanteil ≤ 50 %). */
  readonly single: boolean;
}

export interface RoofBlock {
  readonly pos: Vec3;
  /** Rasterindex der Spalte (für die Raum-Zuordnung). */
  readonly i: number;
  readonly kind: Extract<ShellKind, 'roof' | 'wall' | 'pillar'>;
  readonly role: string;
  readonly shape: string;
  readonly orient?: ShellOrient;
}

/** Frontwand einer Gaube für `placeDormerWindows`: Scheibenspalten und -reihen (Brüstung = y0 − 1, Rähm = y1 + 1). */
export interface DormerFront {
  readonly kind: DormerKind;
  /** Nach außen (Fallrichtung der Hauptfläche). */
  readonly dir: HorizontalDir;
  /** Spalten der Scheiben (Welt x, z) in Laufrichtung. */
  readonly panes: ReadonlyArray<readonly [number, number]>;
  readonly y0: number;
  readonly y1: number;
  /** Additiv (W3, Glasgiebel): oberste Scheibenreihe je Spalte (fehlt = `y1` für alle). */
  readonly tops?: readonly number[];
}

/** Wandspalte unter dem Dach (Giebeldreieck, Kniestock, Ziergiebel) für Giebelfenster. */
export interface GableColumn {
  readonly x: number;
  readonly z: number;
  /** Nach außen. */
  readonly dir: HorizontalDir;
  readonly y0: number;
  readonly y1: number;
  /** Gruppe (Decke der Etage): Spalten verschiedener Etagen bilden nie ein gemeinsames Dreieck. */
  readonly group: number;
}

export interface RoofBuild {
  readonly plan: RoofPlan;
  readonly profile: RoofProfile;
  readonly blocks: RoofBlock[];
  /** Oberster Dachblock je Spalte (−∞ ohne Dach). */
  readonly top: Float64Array;
  readonly gables: GableColumn[];
  /** Gauben mit Platz für Brüstung und Scheibe (D4). */
  readonly dormers: DormerFront[];
  /**
   * Additiv (W2 D4): Sohlbalken – Deckenzellen in der Wandflucht unter einem Giebelfeld (Luft zur Giebelseite), Achse
   * entlang der Wand. `deriveShell` ersetzt dort die Decke durch einen liegenden Balken (`beam`).
   */
  readonly sills: ReadonlyArray<{ readonly pos: Vec3; readonly axis: 'x' | 'z' }>;
  /** Tatsächliche Neigung (W2 D5/D6: das Budget kann sie senken). */
  readonly pitch: RoofPitch;
  /** Additiv (W3): Dach-Teilung angewandt. */
  readonly split?: boolean;
  /** Additiv (W4, D5): Kniestock-Reihen über der Decke (fehlt = 0). */
  readonly knee?: number;
}

/** Feld, Profil und Kappung einer Dach-Variante (vor den Blöcken). */
interface RoofFrame {
  readonly main: RoofField;
  readonly maxRing: number;
  readonly profile: RoofProfile;
  readonly base: number;
  readonly kCap: number;
  /** W4 (D5): Kniestock – Reihen Wand über der Decke, um die das ganze Dach angehoben ist (0 = Traufe wie bisher). */
  readonly knee: number;
}

/** Grundriss-Feld samt Aussparung und höchstem Ring (hängt nicht von der Neigung ab). */
function roofPlanField(spec: RoofSpec, site: RoofSite, cross: boolean, maxSpan?: number): { main: RoofField; maxRing: number } {
  const { w, d, region, upper } = site;
  const field = roofField(spec, region, w, d, upper, cross, maxSpan);
  const cut = site.noRoof;
  const main = cut === undefined ? field : { ...field, mask: field.mask.map((v, i) => (cut[i] === 1 ? 0 : v)) };
  let maxRing = spec.overhang;
  for (let i = 0; i < w * d; i++) if (main.mask[i]) maxRing = Math.max(maxRing, Math.round(main.hc[i]! + 0.5) - 1);
  return { main, maxRing };
}

function roofFrame(spec: RoofSpec, site: RoofSite, cross: boolean, planField = roofPlanField(spec, site, cross), knee = 0): RoofFrame {
  const { ceilingY } = site;
  const o = spec.overhang;
  const { main, maxRing } = planField;
  const profile = roofProfile(spec.style, spec.detail, o, maxRing + 1);
  // Traufe wie bisher auf Deckenhöhe − Überstand + 1; der Wandring darf nie in der Decke liegen. W4: ein Kniestock hebt
  // das ganze Dach um `knee` Reihen (die Wand darunter schließt `roofBlocks` wie am Giebel).
  const base = ceilingY + 1 + knee - o + Math.max(0, o - profile.y[o]!);
  let kCap = Infinity;
  if (site.capY !== undefined) {
    kCap = -1;
    profile.y.forEach((y, k) => {
      if (base + y <= site.capY!) kCap = k;
    });
  }
  return { main, maxRing, profile, base, kCap, knee };
}

/** Neigungen von der gewünschten abwärts (D5: steil → normal → niedrig). */
const PITCHES_DOWN: Readonly<Record<RoofPitch, readonly RoofPitch[]>> = { steep: ['steep', 'normal', 'low'], normal: ['normal', 'low'], low: ['low'] };

type Fit = { spec: RoofSpec; cross: boolean; frame: RoofFrame; split?: boolean };

/**
 * W2 (Baustandard D5/D6): Neigung und Form so wählen, dass (a) das Dach ins Höhen-Budget passt und (b) eine flache
 * Kappung an einer höheren Wand höchstens `MAX_CAP_RINGS` tief ist. Reihenfolge: gewünschte Neigung, dann flacher; an
 * höheren Wänden zuerst das Pultdach (bis 1:2), dann der Quergiebel. Passt nichts, gewinnt die Variante mit der
 * kleinsten Überschreitung (bei Gleichstand die frühere).
 * W4 (D5 präzisiert, plan/spikes/W4F_dachproportion.md): eingeschossige Baukörper zuerst über `proportionRoof`
 * (Kniestock, dann Teilung – die Neigung bleibt); nur mit `heightBudget: true` sinkt danach die Neigung.
 */
function fitRoof(spec: RoofSpec, site: RoofSite): Fit {
  const prop = proportionRoof(spec, site);
  if (prop !== undefined && (prop.ok || !roofBudgetOn(spec.detail))) return prop.fit;
  const pitch0 = spec.detail?.pitch ?? 'normal';
  const withPitch = (p: RoofPitch): RoofSpec => (p === pitch0 ? spec : { ...spec, detail: { ...spec.detail, pitch: p } });
  const gableFamily = spec.style !== 'hip' && spec.style !== 'mansard';
  const crosses = site.capY !== undefined && site.upper !== undefined && gableFamily ? [false, true] : [false];
  const b = roofBudgetOn(spec.detail) ? site.budget : undefined;
  // Traufhöhe: Wandring bzw. Füllung direkt über der Decke (K2) – Deckenhöhe + 1
  const eaveH = b === undefined ? 0 : site.ceilingY + 1 - b.groundY;
  const limit = b === undefined ? Infinity : b.single ? eaveH : Math.min(Math.floor(1.5 * eaveH), 2 * b.storey);
  const knees = prop !== undefined; // W4: eingeschossig mit Kniestock – Maß ist `kneeNeed`, nicht die Firsthöhe über der Decke
  let best: { spec: RoofSpec; cross: boolean; frame: RoofFrame; score: number } | undefined;
  for (const cross of crosses) {
    const planField = roofPlanField(spec, site, cross);
    for (const p of PITCHES_DOWN[pitch0]) {
      const s = withPitch(p);
      let f = roofFrame(s, site, cross, planField);
      const topRing = Math.min(f.maxRing, f.kCap);
      const top = f.kCap < f.maxRing ? site.capY! : f.base + f.profile.y[topRing]!;
      let over = Math.max(0, top - site.ceilingY - limit);
      if (knees) {
        const need = kneeNeed(f, site);
        over = Math.max(0, need - MAX_KNEE);
        if (need > 0) f = roofFrame(s, site, cross, planField, Math.min(need, MAX_KNEE));
      }
      const cap = f.kCap === Infinity ? 0 : Math.max(0, f.maxRing - f.kCap - MAX_CAP_RINGS);
      const score = over + cap;
      if (score === 0) return { spec: s, cross, frame: f };
      if (best === undefined || score < best.score) best = { spec: s, cross, frame: f, score };
    }
  }
  return best!;
}

/** Grenzt die Dachregion an eine geschlossene Spalte (Brandwand eines Nachbar-Baukörpers)? */
function touchesClosed(site: RoofSite): boolean {
  const { w, d, region, closed } = site;
  if (closed === undefined) return false;
  for (let i = 0; i < w * d; i++) {
    if (region[i] !== 1) continue;
    const x = i % w;
    const z = Math.floor(i / w);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < w && nz < d && closed[nz * w + nx] === 1) return true;
    }
  }
  return false;
}

/** Höhe der Dachoberkante über der Decke und Kappungs-Überschreitung eines Rahmens. */
function frameTop(f: RoofFrame, site: RoofSite): { above: number; cap: number } {
  const topRing = Math.min(f.maxRing, f.kCap);
  const top = f.kCap < f.maxRing ? site.capY! : f.base + f.profile.y[topRing]!;
  return { above: top - site.ceilingY, cap: f.kCap === Infinity ? 0 : Math.max(0, f.maxRing - f.kCap - MAX_CAP_RINGS) };
}

/**
 * W4 (Baustandard D5, präzisiert): fehlende Wandreihen eines eingeschossigen Dachs – sichtbare Wandhöhe (Bodenplatte
 * des Erdgeschosses → Traufunterkante) ≥ Dachhöhe (Traufunterkante → First, alle Dachzellen samt Überstand). Die
 * Traufunterkante ist der äußerste Ring (k = 0); die Ortgang-Unterseite endet über ihm (`roofBlocks`).
 */
function kneeNeed(f: RoofFrame, site: RoofSite): number {
  const b = site.budget!;
  const topRing = Math.min(f.maxRing, f.kCap);
  const roofH = f.profile.y[topRing]! - f.profile.y[0]! + 1;
  const wallH = f.base + f.profile.y[0]! - b.groundY;
  // W5 (N7): Mehrgeschosser – Dach ≤ 1,5 × Wand (Baustandard D5 „First ≤ 1,5 × Traufhöhe“), in ganzen Reihen
  if (!b.single) return Math.max(0, Math.ceil((2 * roofH - 3 * wallH) / 3));
  return Math.max(0, roofH - wallH);
}

/**
 * W5 (27.09.2026, Review W4-R N7, plan/spikes/W5A_fassade.md): D5 für Mehrgeschosser – das oberste Dach eines Baukörpers
 * mit mehreren Geschossen darf höchstens 1,5 × so hoch sein wie die sichtbare Wand darunter (Bodenplatte → Traufunterkante,
 * Maß wie `kneeNeed`). Fehlen dafür höchstens `MAX_KNEE` Reihen, hebt ein Kniestock das ganze Dach (Neigung bleibt, wie
 * beim Eingeschosser); sonst bleibt alles wie bisher. Nicht mit `kneeWall: false`, nicht mit `heightBudget: true` (dort
 * senkt `fitRoof` die Neigung nach dem vollen D5-Budget samt „≤ 2 Geschosse“), nicht an Brandwänden anderer Baukörper.
 */
function multiStoreyRoof(spec: RoofSpec, site: RoofSite): { fit: Fit; ok: boolean } | undefined {
  if (!roofKneeOn(spec.detail) || roofBudgetOn(spec.detail) || touchesClosed(site)) return undefined;
  const whole = roofFrame(spec, site, false);
  const need = kneeNeed(whole, site);
  if (need === 0 || need > MAX_KNEE) return undefined;
  return { fit: { spec, cross: false, frame: roofFrame(spec, site, false, undefined, need) }, ok: true };
}

/**
 * W4 (plan/spikes/W4F_dachproportion.md): Dachproportion eines eingeschossigen Baukörpers bei gewählter Neigung (sie
 * bleibt genau). Liegt das Dach über dem Budget (`kneeNeed` > 0), dann in dieser Reihenfolge:
 *  1. **Kniestock** (Drempel) bis `MAX_KNEE` Reihen: das ganze Dach steigt, die Traufwand wächst (Giebelfeld-Rolle wie
 *     am Giebel, D4) – ruhiger als eine Teilung, die Silhouette bleibt;
 *  2. **Teilung** (W3, Satteldach-Familie ab `SPLIT_MIN_OUTER` Außenmaß, nicht an Brandwänden): die breitesten Streifen,
 *     die mit höchstens `MAX_SPLIT_KNEE` Kniestock-Reihe ins Budget passen (ein geteiltes Dach soll niedrig bleiben);
 *  3. sonst der größte Kniestock (`ok: false`; mit `heightBudget: true` senkt `fitRoof` danach die Neigung).
 * Nur mit Budget (eingeschossig, keine obere Etage), nicht beim Pultdach, nicht an Brandwänden anderer Baukörper und
 * nicht mit `kneeWall: false` (dann W3: nur die Teilung nach dem Budget „First über der Decke ≤ Traufhöhe“).
 */
function proportionRoof(spec: RoofSpec, site: RoofSite): { fit: Fit; ok: boolean } | undefined {
  const b = site.budget;
  if (b === undefined || site.upper !== undefined || spec.style === 'shed') return undefined;
  if (!b.single) return multiStoreyRoof(spec, site);
  // an einer Brandwand (Häuserzeile, Anbau-Baukörper) bleibt die Traufe, wo sie ist – der Kniestock höbe das niedrigere
  // Haus an das höhere heran; dort gilt W3 (auch die Teilung entfällt an Brandwänden)
  if (!roofKneeOn(spec.detail) || touchesClosed(site)) {
    const split = splitRoof(spec, site);
    return split === undefined ? undefined : { fit: split, ok: true };
  }
  const whole = roofFrame(spec, site, false);
  const need = kneeNeed(whole, site);
  if (need === 0) return { fit: { spec, cross: false, frame: whole }, ok: true };
  if (need <= MAX_KNEE) return { fit: { spec, cross: false, frame: roofFrame(spec, site, false, undefined, need) }, ok: true };
  if (roofSplitOn(spec.detail) && spec.style !== 'hip' && spec.style !== 'mansard' && !touchesClosed(site)) {
    // Spannweite des ungeteilten Dachs ≈ 2 × höchster Ring: von dort abwärts die breitesten Streifen zuerst
    for (let m = Math.min(Math.max(site.w, site.d), 2 * whole.maxRing); m >= 5; m--) {
      const plan = roofPlanField(spec, site, false, m);
      if (plan.maxRing >= whole.maxRing) continue; // nichts geteilt
      const f = roofFrame(spec, site, false, plan);
      const k = kneeNeed(f, site);
      if (k <= MAX_SPLIT_KNEE) return { fit: { spec, cross: false, frame: k === 0 ? f : roofFrame(spec, site, false, plan, k), split: true }, ok: true };
    }
  }
  return { fit: { spec, cross: false, frame: roofFrame(spec, site, false, undefined, MAX_KNEE) }, ok: false };
}

/**
 * W3 (Dach-Teilung, Standard; plan/spikes/W3RD_dachdetails.md): Liegt das Satteldach eines eingeschossigen Baukörpers in
 * der gewählten Neigung über dem Höhen-Budget (D5: First über der Decke ≤ Traufhöhe, d. h. Dachanteil ≤ 50 %), wird es
 * ab `SPLIT_MIN_OUTER` Außenmaß geteilt (gedrungen: Reihe von Quergiebeln, lang: parallele Satteldächer; `gable.ts`):
 * die breitesten Streifen, die ins Budget passen. Die
 * Neigung bleibt genau (kein Absenken); passt keine Teilung, bleibt das Dach ungeteilt (und `fitRoof` entscheidet wie
 * bisher). Nur Satteldach-Familie ohne Pultdach, nicht mit `split: false`.
 * W4: nur noch ohne Kniestock (`kneeWall: false`); sonst gilt `proportionRoof`.
 */
function splitRoof(spec: RoofSpec, site: RoofSite): Fit | undefined {
  const b = site.budget;
  if (b === undefined || !b.single || !roofSplitOn(spec.detail) || spec.style === 'hip' || spec.style === 'mansard' || spec.style === 'shed') return undefined;
  // an einer Brandwand (Nachbar-Baukörper) oder unter einer oberen Etage bleibt der First, wie er in die Wand läuft
  if (site.upper !== undefined || touchesClosed(site)) return undefined;
  // Traufhöhe ab der Bodenplatte des Erdgeschosses; eingeschossig First über der Decke ≤ Traufhöhe (Dachanteil ≤ 50 %)
  const limit = site.ceilingY + 1 - b.groundY;
  const whole = roofFrame(spec, site, false);
  const t0 = frameTop(whole, site);
  if (t0.above <= limit || t0.cap > 0) return undefined;
  // Spannweite des ungeteilten Dachs ≈ 2 × höchster Ring: von dort abwärts die breitesten Streifen zuerst
  for (let m = Math.min(Math.max(site.w, site.d), 2 * whole.maxRing); m >= 5; m--) {
    const plan = roofPlanField(spec, site, false, m);
    if (plan.maxRing >= whole.maxRing) continue; // nichts geteilt
    const f = roofFrame(spec, site, false, plan);
    const t = frameTop(f, site);
    if (t.above <= limit && t.cap === 0) return { spec, cross: false, frame: f, split: true };
  }
  return undefined;
}

/**
 * Dach einer Etage: Feld → Klassifikation → Profil → Blöcke samt Füllung, Giebelwänden und Kanten. Mit Gauben: Feld
 * = Maximum aus Haupt- und Gaubenfeldern (dormers.ts); Profil, Traufe und Kappung bleiben die des Hauptdachs (der
 * Gaubenfirst liegt unter dem Hauptfirst). Gauben ohne Platz für Brüstung und Scheibe entfallen samt ihrer Dachfläche.
 * W2 (D5/D6/D8): Neigung und Form aus `fitRoof` (mit Dach-Details; das Budget nur mit `heightBudget: true`).
 */
export function buildRoofBlocks(spec: RoofSpec, site: RoofSite): RoofBuild {
  const { w, d, region } = site;
  const o = spec.overhang;
  const fit = spec.detail !== undefined ? fitRoof(spec, site) : { spec, cross: false, frame: roofFrame(spec, site, false) };
  const { main, profile, base, kCap } = fit.frame;
  const tCap = kCap === Infinity ? Infinity : kCap - o;
  let dormers = fit.spec.dormers === undefined ? [] : planDormers(fit.spec.dormers, { w, d, overhang: o, cells: classifyField(main, o, tCap), tCap, region });
  for (;;) {
    const { build, failed } = roofBlocks(fit.spec, site, dormers.length > 0 ? withDormers(main, dormers) : main, profile, base, kCap, dormers, fit.frame.knee);
    if (failed.size === 0) {
      return { ...build, ...(fit.split === true ? { split: true } : {}), ...(fit.frame.knee > 0 ? { knee: fit.frame.knee } : {}) };
    }
    dormers = dormers.filter((dm) => !failed.has(dm.face));
  }
}

function roofBlocks(
  spec: RoofSpec, site: RoofSite, field: RoofField, profile: RoofProfile, base: number, kCap: number, dormers: readonly Dormer[], knee = 0,
): { build: RoofBuild; failed: Set<number> } {
  const { w, d, region, footprint, upper, ceilingY } = site;
  const o = spec.overhang;
  const n = w * d;
  const plan = buildRoof(field, o, kCap === Infinity ? Infinity : kCap - o, (t) => profile.form[t + o] === 'stairs');
  /** Gauben-Teile je Spalte: Körper (keine Giebelspalte), Front (k quer, v = 0), Schulter (|k| = h vorn). */
  const part = new Map<number, { readonly dm: Dormer; readonly k: number; readonly v: number }>();
  for (const dm of dormers) {
    for (let v = 0; v <= dormerRows(dm); v++) for (let k = -dm.h; k <= dm.h; k++) part.set(dormerCell(dm, w, d, k, v), { dm, k, v });
  }
  /** Wandreihen der Frontspalten (Brüstung bis unter die Dachfüllung). */
  const frontWall = new Map<number, readonly [number, number]>();
  const cells = plan.cells;
  const top = new Float64Array(n).fill(-Infinity);
  /** Ober- und Unterkante des Dachblocks in Halbblöcken (Stufe unten: Oberkante 2y+1, Stufe oben: Unterkante 2y+1). */
  const topH = new Float64Array(n);
  const botH = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    if (c === undefined) continue;
    const ring = c.d - 1;
    const capped = ring > kCap;
    const y = capped ? site.capY! : base + profile.y[ring]!;
    const form = capped ? 'block' : profile.form[ring]!;
    top[i] = y;
    topH[i] = 2 * y + (form === 'slab_bottom' || (form === 'stairs' && c.cls === 'ridge') ? 1 : 2);
    botH[i] = 2 * y + (form === 'slab_top' ? 1 : 0);
  }

  const detail = spec.detail;
  const trim = detail?.trim === true;
  const closedVerge = detail?.verge === 'closed';
  /** W2 (D4): Sohlbalken mit der Dachkante (`trim`: Windbrett und Sohlbalken rahmen das Giebelfeld). */
  const sill = trim;
  const blocks: RoofBlock[] = [];
  const gables: GableColumn[] = [];
  const sills: Array<{ pos: Vec3; axis: 'x' | 'z' }> = [];
  const inGrid = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < w && z < d;
  /**
   * Art einer offenen Außenseite der Spalte i = (x, z): Traufe (Dach davor tiefer), Ortgang (gleich hoch) oder höhere
   * Wand (Dach davor höher) – halbblockgenau über die Oberkante (bei 1:2 teilen sich zwei Ringe eine Blockhöhe). Ohne
   * Dach davor (kein Überstand, Aussparung) nach der Treppenrichtung `up` (bergauf): gegen `up` Traufe, mit `up` höhere
   * Wand, quer Ortgang. `top` = y des Dachblocks davor.
   */
  const sideOf = (dir: HorizontalDir, x: number, z: number, i: number, up: HorizontalDir | undefined): { dir: HorizontalDir; kind: 'eave' | 'verge' | 'high'; top: number } => {
    const nx = x + STEP[dir][0];
    const nz = z + STEP[dir][1];
    const j = inGrid(nx, nz) ? nz * w + nx : -1;
    if (j >= 0 && cells[j] !== undefined) return { dir, kind: topH[j]! < topH[i]! ? 'eave' : topH[j]! === topH[i]! ? 'verge' : 'high', top: top[j]! };
    const kind = up === undefined ? 'verge' : dir === OPP[up] ? 'eave' : dir === up ? 'high' : 'verge';
    return { dir, kind, top: -Infinity };
  };
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    if (c === undefined) continue;
    const x = i % w;
    const z = Math.floor(i / w);
    const wx = site.x0 + x;
    const wz = site.z0 + z;
    const ys = top[i]!;
    const ring = c.d - 1;
    const capped = ring > kCap;
    /** Oberkante des vorigen Rings: Füllung darüber gehört zur Dachfläche, darunter ist Sprung (Wand). */
    const prev = capped || ring === 0 ? -Infinity : base + profile.y[ring - 1]!;
    /** Die Spalte muss bis zur Oberkante ihres tiefsten Dach-Nachbarn reichen (halbblockgenau, sonst Spalt). */
    let needH = botH[i]!;
    let higher = false;
    let atUpper = false;
    const outside: HorizontalDir[] = [];
    const jumps: HorizontalDir[] = [];
    for (const dir of DIRS) {
      const nx = x + STEP[dir][0];
      const nz = z + STEP[dir][1];
      if (!inGrid(nx, nz)) {
        outside.push(dir);
        continue;
      }
      const j = nz * w + nx;
      const nb = cells[j];
      if (nb === undefined) {
        if (upper?.[j] === 1) atUpper = true;
        else outside.push(dir);
        continue;
      }
      needH = Math.min(needH, topH[j]!);
      if (top[j]! < prev) jumps.push(dir);
      if (nb.d > c.d) higher = true;
    }
    /** Unterster Füllblock (ganze Blöcke); `ys` = keine Füllung. */
    const need = Math.floor(needH / 2);
    const edge = outside.length > 0 || jumps.length > 0;
    // W2: Gaubendach (ohne Schulter) als Fläche in `roof_main`, nur sein Ortgang (Frontreihe) in `roof_trim`
    const dp = part.get(i);
    const dormerRoof = dp !== undefined && !(dp.v === 0 && Math.abs(dp.k) === dp.dm.h);
    const isTrim = trim && (dormerRoof ? dp.v === 0 : edge || c.cls === 'hip' || (!capped && !atUpper && (c.cls === 'ridge' || !higher)));
    const role = isTrim ? 'roof_trim' : 'roof_main';

    // Wandlinie an der offenen Außenkante (Giebel, Kniestock, Traufe ohne Überstand)
    const open = region[i] === 1 ? DIRS.filter((dir) => {
      const nx = x + STEP[dir][0];
      const nz = z + STEP[dir][1];
      if (!inGrid(nx, nz)) return true;
      const j = nz * w + nx;
      return footprint[j] !== 1 && upper?.[j] !== 1 && site.closed?.[j] !== 1;
    }) : [];

    // Dachblock
    const form: RingForm | 'block' = capped ? 'block' : profile.form[ring]!;
    const opt = form === 'stairs' ? c.options[plan.choice[i]!] : undefined;
    let shape: string;
    let orient: ShellOrient | undefined;
    if (opt !== undefined) {
      shape = 'stairs';
      orient = { facing: opt.facing, half: 'bottom', stairShape: opt.shape };
    } else if (form === 'slab_bottom' || (form === 'stairs' && c.cls === 'ridge')) {
      shape = 'slab';
      orient = { half: 'bottom' };
    } else if (form === 'slab_top' && open.length === 0 && needH === botH[i]) {
      shape = 'slab';
      orient = { half: 'top' };
    } else shape = 'block'; // obere Stufe über Wand, Füllung oder tieferem Nachbarn ließe einen halben Spalt: Vollblock (gleiche Oberkante)
    blocks.push({ pos: [wx, ys, wz], i, kind: 'roof', role, shape, ...(orient !== undefined ? { orient } : {}) });

    // Giebel-/Seitenwand: Luft zwischen Decke und Dach an der offenen Außenkante schließen. W2: je offener Seite
    // Traufe (Dach davor tiefer), Ortgang (gleich hoch) oder höhere Wand (Dach davor höher; ohne Dach davor nach der
    // Treppenrichtung). K2 (D2): an reinen Traufspalten ist alles über dem Traufblock davor Dachfüllung, keine Wand.
    // K3 (D3): unter der Ortgangtreppe liegt die oberste Zelle als Windbrett in `roof_trim`. K4 (D4): die übrigen
    // Zellen sind Giebelfeld (`wall_gable`, Rückfall `wall_primary`), darunter auf Deckenhöhe der Sohlbalken.
    let low = ys;
    const sides = open.map((dir) => sideOf(dir, x, z, i, opt?.facing));
    // W4: mit Kniestock auch an der Traufseite – der Balken auf Deckenhöhe fasst Wand und Kniestock (Geschossband, W6)
    const sillSide = sides.find((s) => s.kind === 'verge') ?? (knee > 0 ? sides.find((s) => s.kind === 'eave') : undefined);
    if (sill && sillSide !== undefined) sills.push({ pos: [wx, ceilingY, wz], axis: axisOf(sillSide.dir) === 'x' ? 'z' : 'x' });
    if (open.length > 0 && ys - 1 >= ceilingY + 1) {
      const gableSide = sides.some((s) => s.kind !== 'eave');
      const bandFrom = gableSide ? Infinity : Math.max(...sides.map((s) => s.top)) + 1;
      // Windbrett nur, wo die Giebelwand unter der Ortgangtreppe sichtbar ausspränge (Zickzack): der Dach-Nachbar entlang
      // des Ortgangs liegt ≥ 2 tiefer (steil 2:1). Bei 1:1 und 1:2 deckt die nächste Treppe die Zelle schon ab – dort
      // bliebe vom Giebelfeld sonst nur ein schmaler Rest (Fenster, Streben).
      const zigzag = sides.some((sd) => sd.kind === 'verge' && [CW[sd.dir], CCW[sd.dir]].some((a) => {
        const nx = x + STEP[a][0];
        const nz = z + STEP[a][1];
        return inGrid(nx, nz) && cells[nz * w + nx] !== undefined && top[nz * w + nx]! <= ys - 2;
      }));
      const board = trim && zigzag ? ys - 1 : Infinity;
      let wallTop = ceilingY;
      for (let y = ceilingY + 1; y < ys; y++) {
        const pos: Vec3 = [wx, y, wz];
        if (y >= bandFrom) blocks.push({ pos, i, kind: 'roof', role, shape: 'block' });
        else if (y === board) blocks.push({ pos, i, kind: 'roof', role: 'roof_trim', shape: 'block' });
        else {
          blocks.push({ pos, i, kind: 'wall', role: 'wall_gable', shape: 'block' });
          wallTop = y;
        }
      }
      // W4: der Kniestock ist kein Giebelfeld für Fenster – weder an der Traufseite (Traufseiten hatten vorher nie
      // Wandzellen) noch in Spalten, deren Wand nur so hoch wie der Kniestock reicht (Kehle zwischen zwei Quergiebeln:
      // sonst verschmölzen die Giebel einer Reihe zu einem Lauf mit nur einem Fenster)
      if (wallTop >= ceilingY + 1 + knee) for (const sd of sides) if (sd.kind !== 'eave') gables.push({ x: wx, z: wz, dir: sd.dir, y0: ceilingY + 1, y1: wallTop, group: ceilingY });
      low = ceilingY + 1;
    } else if (need < ys) {
      // Füllblöcke: bis zum vorigen Ring Dachfläche (steile Neigung), darunter Wand (Sprung, Ziergiebel)
      const p = part.get(i);
      const e = p === undefined ? -1 : frontHalf(p.dm);
      const front = p !== undefined && p.v === 0 && Math.abs(p.k) <= e;
      // Schulter: unter der Gauben-Traufe läuft die Hauptfläche weiter (Haupttreppe auf ihrer Höhe)
      const shoulder = p !== undefined && p.v === 0 && Math.abs(p.k) === p.dm.h && p.dm.kind !== 'shed';
      const mainY = base + profile.y[o + 1]!;
      for (let y = need; y < ys; y++) {
        const pos: Vec3 = [wx, y, wz];
        if (shoulder && y === mainY && profile.form[o + 1] !== 'slab_top') {
          const up = p.dm.up;
          blocks.push(profile.form[o + 1] === 'stairs'
            ? { pos, i, kind: 'roof', role: 'roof_main', shape: 'stairs', orient: { facing: up, half: 'bottom', stairShape: 'straight' } }
            : { pos, i, kind: 'roof', role: 'roof_main', shape: 'slab', orient: { half: 'bottom' } });
        } else if (y > prev || shoulder) blocks.push({ pos, i, kind: 'roof', role: shoulder && y <= mainY ? 'roof_main' : role, shape: 'block' });
        // W3 (Gaubenmodul): keine Eckpfosten mehr – die Wangen neben der Scheibe sind Giebelfeld (`wall_gable`), wie in
        // den Vorbildern (helle Front, Glas bis unter das Gaubendach; plan/spikes/W3RD_dachdetails.md)
        else blocks.push({ pos, i, kind: 'wall', role: 'wall_gable', shape: 'block' });
      }
      if (front && need <= prev) frontWall.set(i, [need, Math.min(ys - 1, prev)]);
      if (need <= prev && footprint[i] === 1 && p === undefined) for (const dir of jumps) gables.push({ x: wx, z: wz, dir, y0: need, y1: Math.min(ys - 1, prev), group: ceilingY });
      low = need;
    }

    // Ortgang-Unterseite (D2 „geschlossene Kante“): nur außerhalb des Grundrisses (sonst steht dort die Giebelwand).
    // W4 (D5): nicht unter dem äußersten Ring – die doppelte Kante endet über der Traufunterkante statt 1 darunter.
    if (!closedVerge || capped || ring === 0 || footprint[i] === 1 || outside.length === 0) continue;
    const up = c.cls === 'slope' ? (opt?.facing ?? optionsForPattern(c.high).find((s) => s.shape === 'straight')?.facing) : undefined;
    const verge = up !== undefined ? outside.includes(CW[up]) || outside.includes(CCW[up]) : c.cls === 'ridge';
    if (!verge) continue;
    if (shape === 'stairs' && up !== undefined) {
      blocks.push({ pos: [wx, low - 1, wz], i, kind: 'roof', role, shape: 'stairs', orient: { facing: OPP[up], half: 'top' } });
    } else if (shape === 'slab' && orient?.half === 'bottom') {
      blocks.push({ pos: [wx, low - 1, wz], i, kind: 'roof', role, shape: 'slab', orient: { half: 'top' } });
    }
  }

  // Gaubenfronten: Scheiben ab der Reihe über der Brüstung, höchstens 2 hoch, Rähm darüber, wo die Wand weitergeht
  const fronts: DormerFront[] = [];
  const failed = new Set<number>();
  for (const dm of dormers) {
    const e = frontHalf(dm);
    const rowsOf = (k: number): readonly [number, number] | undefined => frontWall.get(dormerCell(dm, w, d, k, 0));
    // W3 (Gaubenmodule, plan/spikes/W3RD_dachdetails.md): Glas bis zur obersten Wandreihe (höchstens 2 hoch) – kein
    // Rähm-Balken unter dem Gaubendach, keine Eckpfosten. Die 3 breite Satteldach- bzw. Walmgaube ist ein Glasgiebel:
    // über der Brüstung füllt die Scheibe die ganze Front (Mitte 2 hoch, Wangen 1 hoch unter dem Gaubendach); passt
    // das nicht, bleibt die Mittelscheibe mit Wangen aus Giebelfeld. Breitere Gauben: Scheiben |k| ≤ e − 1, Wangen
    // an ±e. Nur eine höhere Front (steil) behält über der Scheibe Wand und Rähm.
    const inner = e >= 1 ? Array.from({ length: 2 * e - 1 }, (_, j) => j - e + 1) : [0];
    const glassGable = e === 1 && dm.kind !== 'shed' ? [-1, 0, 1] : undefined;
    const lowOf = (ks: readonly number[]): number => Math.max(...ks.map((k) => rowsOf(k)?.[0] ?? Infinity));
    const fitsAll = (ks: readonly number[]): boolean => ks.every((k) => (rowsOf(k)?.[1] ?? -Infinity) >= lowOf(ks) + 1);
    const ks = glassGable !== undefined && fitsAll(glassGable) ? glassGable : inner;
    const walls = ks.map(rowsOf);
    const lo = lowOf(ks);
    const tops = walls.map((r) => (r === undefined ? -Infinity : Math.min(lo + 2, r[1])));
    const y1 = Math.min(...tops);
    // Gaubenfirst ≥ 1 Block unter dem Hauptfirst (Halbblöcke; bergauf entlang der Achse bis über den First)
    let ridge = -Infinity;
    for (let v = 0; v < dormerRows(dm); v++) for (let k = -dm.h; k <= dm.h; k++) ridge = Math.max(ridge, topH[dormerCell(dm, w, d, k, v)]!);
    let mainTop = -Infinity;
    for (let v = dormerRows(dm); ; v++) {
      const j = dormerCell(dm, w, d, 0, v);
      if (j < 0 || cells[j] === undefined || topH[j]! < mainTop) break;
      mainTop = topH[j]!;
    }
    if (!(y1 >= lo + 1) || ridge + 2 > mainTop) {
      failed.add(dm.face);
      continue;
    }
    const panes = ks.map((k) => {
      const j = dormerCell(dm, w, d, k, 0);
      return [site.x0 + (j % w), site.z0 + Math.floor(j / w)] as const;
    });
    const y1max = Math.max(...tops);
    fronts.push({ kind: dm.kind, dir: OPP[dm.up], panes, y0: lo + 1, y1: y1max, ...(y1max !== y1 ? { tops } : {}) });
  }
  // W4 (plan/spikes/W4F_dachproportion.md): die Brüstung unter den Scheiben gehört zur Dachdeckung – die Hauptfläche
  // läuft bis unter das Glas wie in den Vorbildern. Als Giebelfeld wurde sie im Fachwerk zum schwarzen Riegel unter
  // T-förmigem Glas (tavern-timber).
  const sillBelow = new Map<string, number>();
  for (const f of fronts) for (const [x, z] of f.panes) sillBelow.set(`${x},${z}`, f.y0);
  if (sillBelow.size > 0) {
    blocks.forEach((b, k) => {
      const y0 = sillBelow.get(`${b.pos[0]},${b.pos[2]}`);
      if (y0 !== undefined && b.kind === 'wall' && b.pos[1] < y0) blocks[k] = { pos: b.pos, i: b.i, kind: 'roof', role: 'roof_main', shape: 'block' };
    });
  }
  return { build: { plan, profile, blocks, top, gables, dormers: fronts, sills, pitch: spec.detail?.pitch ?? 'normal' }, failed };
}
