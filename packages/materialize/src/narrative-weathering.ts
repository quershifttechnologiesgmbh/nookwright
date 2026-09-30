/**
 * Erzählende Verwitterung v2 (WS „7 Schritte“, Schritt 5 „Texturierung mit Bedeutung“, Schalter `weathering`).
 *
 * Statt Zufallsstreuung bekommen Fassaden, Dächer und Sockel **Verwitterungs-Cluster mit Ursache** – und die Wirkung
 * hängt vom **Material** ab, nicht nur von der Ursache:
 *
 * Zwei Schichten je Wandfläche, in der Reihenfolge des Profi-Rezepts (plan/spikes/LV_yt_texturieren_profi.md):
 *
 * 1. **Material-Ereignisse** (Cluster mit Ursache, N–T–C-Kachelmodell, gewinnen bei Überschneidung):
 *   - `plinth` Grün am Sockel: Moos/Bruchstein, nur auf Stein (DR3 A7: kein Moos auf Putz/Holz),
 *   - `spall`  Abplatzungen des Putzes an Ecken/Öffnungslaibungen und am Sockel: der Stein darunter kommt hervor,
 *   - `drip`   Regenrinne: Tropfstreifen an Wandenden unter Überhang/Traufe,
 *   - `tree`   Baumkontakt (Stein: Moos; Putz/Holz/Ton: feuchtes Dunkel),
 *   - `corner` Kavität (Voxel-AO, DR3 A2): Innenecke neben vorspringendem Pfeiler/Erker.
 * 2. **Tonzonen** aus der Geometrie (Stufe 0/1/2 dunkler, Tonraster-WFC `TONE_MODEL`):
 *   - `drip`   Schatten oben: 1–2 Reihen unter Dach/Decke/Überstand, als Flecken (Rauschen), direkt unter der Kante dichter,
 *   - `rain`   dunklere 3er-Kette unter jeder Fensterspalte (Kopf 2 Stufen, dann 1) – der Tropfeffekt,
 *   - `plinth` Sockel dunkler: unterste Reihe 2 Stufen, darüber 1, Oberkante je Spalte ausgefranst.
 *   Der Solver darf eine Zone nur abschwächen (Randomisierung), senkrecht gilt |Δ| ≤ 1 (Verlauf statt Sprung).
 *   Schritt 1/2 des Rezepts (Rücksprung dunkler, Kanten heller) ist Grundtextur und gehört zu TX-B, nicht hierher.
 * Dazu Dach und Schlot: `soot` Ruß über Schornsteinen, `valley` Dachkehlen mit Ablauf, `eave` zur Traufe dunkler/bemoost,
 * `corner` Dachecken. (`ridge`, `splash` bleiben als Werte für ältere Messdateien, werden nicht mehr gesetzt.)
 *
 * Material (`Material`): **Putz** (helle Steine/Ton, Pilzstiel …) bekommt nie Moos, sondern graue Streifen (Leiter
 * aus hellen Steinen: Diorit → polierter Diorit → glatter Stein) und Abplatzungen; **Stein** Moos/Bruchstein, Stufe 1 = rissige Variante derselben Familie, Stufe 2 = dunklere Schwester;
 * **Holz** dunklere Schwester der Holzart; **Ton** dunklere Schwester. Eine „dunkle Schwester“ ist nie heller als der
 * Ausgangsblock (Familien-Farbe wird beim Setzen geprüft) und nie so dunkel, dass ein schwarzes Loch entsteht.
 *
 * Kachelmodell (Tiled WFC, `core/wfc.ts`): N neutral · T Übergang · C Cluster. Nachbarregel je Kante: N grenzt nur
 * an N/T, C nur an T/C – ein Cluster läuft also **immer** über eine Übergangskachel in die Grundfarbe aus (harte
 * Bedingung des Constraint-Netzes, keine Nachkontrolle). Feste Zellen sind die Ursachen (C); der Wuchsbereich jeder
 * Ursache begrenzt Form und Größe. **Raster unter 60 aktiven Zellen** (kleine Fassaden) löst ein regelbasierter Verlauf
 * (Abstand zur Ursache → Wahrscheinlichkeit) statt WFC – dort gibt WFC nur Sprenkel. Das Dach ist ein Verlauf nach
 * relativer Höhe (Traufe → First) mit weichem Rauschen, kein WFC.
 *
 * **Rein und deterministisch**: Zufall nur aus dem Projekt-Seed (`hashSeed`, `Rng` im Solver). Keine Geometrie:
 * Belegung, Rolle und Physik-Klasse bleiben; es wird nur der Block einer Hüllzelle getauscht (`replaceState`,
 * Eigenschaften bleiben). Läuft nach dem Merge, vor Autotiling/Bans/Physik – und nur mit dem Schalter.
 */
import type { Shell, ShellKind } from '@mcda/blueprint';
import {
  clusterU, grid2d, hash01, hashSeed, key3, solveWfc, type NoiseParams, type Vec3, type WfcModel,
} from '@mcda/core';
import type { FamilyData } from '@mcda/platform';
import { blockState, isAir, type VoxelVolume } from '@mcda/voxel';
import type { CellContext } from './context.js';

/** Stufen des schalters `weathering` (aus = kein Pass). */
export type NarrativeWeatheringLevel = 'some' | 'rich';

/** Schalter `weathering` in Pipeline/Engine/App: `off` = kein Pass (bitgleich). */
export type WeatheringSwitch = 'off' | NarrativeWeatheringLevel;

/** Ursache eines Clusters (jeder geänderte Block hat genau eine). */
export type CauseKind = 'rain' | 'drip' | 'plinth' | 'splash' | 'spall' | 'tree' | 'soot' | 'valley' | 'eave' | 'ridge' | 'corner';
export const CAUSE_KINDS: readonly CauseKind[] = ['rain', 'drip', 'plinth', 'splash', 'spall', 'tree', 'soot', 'valley', 'eave', 'ridge', 'corner'];

/** Art des Eingriffs am Block (Ergebnis aus Ursache × Material). */
export type ClusterType = 'moss' | 'dark' | 'rubble' | 'light' | 'spall' | 'splash';
const CLUSTER_TYPES: readonly ClusterType[] = ['moss', 'dark', 'rubble', 'light', 'spall', 'splash'];

/** Material der Fläche, an der eine Ursache angreift. */
export type Material = 'plaster' | 'stone' | 'wood' | 'clay';

/** Kacheln des Modells (Reihenfolge = Index). */
const N = 0;
const T = 1;
const C = 2;

/** Raster mit weniger aktiven Zellen lösen der Regelverlauf statt WFC (sonst nur Sprenkel). */
export const RULE_BELOW_CELLS = 60;

/** Kennzahlen für Bericht/Messung (`metrics.json`). */
export interface NarrativeWeatheringStats {
  readonly level: NarrativeWeatheringLevel;
  readonly strength: number;
  /** Zahl der gelösten Raster (Wandflächen + Dach) und wie viele der Solver lösen konnte. */
  readonly rasters: number;
  readonly rastersFailed: number;
  /** Davon mit Regelverlauf gelöst (kleine Raster, Dach). */
  readonly rastersRule: number;
  /** Tonraster (Zonen je Wandfläche, WFC mit Verlaufsregel) und wie viele auf den Rückfall (alle Zonen eine Stufe) fielen. */
  readonly toneRasters: number;
  readonly toneFailed: number;
  readonly backtracks: number;
  /** Sichtbare Außenzellen (Wandflächen + Dachhaut), die im Raster lagen. */
  readonly surfaceCells: number;
  /** Feste Ursachen-Zellen (Cluster-Keime) je Ursache. */
  readonly causes: Readonly<Record<CauseKind, number>>;
  /** Geänderte Blöcke gesamt und je Klasse/Art. */
  readonly changed: number;
  readonly changedCluster: number;
  readonly changedTransition: number;
  readonly byType: Readonly<Record<ClusterType, number>>;
  /** Je Ursache: Zahl der Cluster (Keime) und der geänderten Blöcke – Summe der Blöcke = `changed`. */
  readonly byCause: Readonly<Record<CauseKind, { readonly clusters: number; readonly blocks: number }>>;
  /** Geänderte Blöcke je Material der Ausgangsfläche. */
  readonly byMaterial: Readonly<Record<Material, number>>;
  readonly plinthChanged: number;
  readonly roofChanged: number;
}

export interface NarrativeWeatheringInput {
  readonly volume: VoxelVolume;
  readonly shell: Shell;
  /** Kontext je Hüllzelle (gleiche Reihenfolge wie `shell.cells`) – für `roofLine`. */
  readonly contexts: readonly CellContext[];
  /** Rolle je Position (`key3`), wie im Merge gesetzt. */
  readonly roleAt: ReadonlyMap<string, string>;
  readonly families: FamilyData;
  /** Gibt es den Block in der Zielversion? */
  readonly hasBlock: (name: string) => boolean;
  /** Ergänzt Pflicht-Eigenschaften des Ziel-Blocks (z. B. `axis` bei Tiefenschiefer); ohne Angabe bleiben die Eigenschaften des alten Blocks. */
  readonly resolveState?: (name: string, props: Readonly<Record<string, string>>) => { readonly name: string; readonly properties: Readonly<Record<string, string>> };
  readonly seed: number;
  readonly level: NarrativeWeatheringLevel;
  /** Stärke ≥ 0 (Stufe × Story-Profil `age`); ≤ 0 = nichts. */
  readonly strength: number;
  /** Nur Messung: `wfc` erzwingt WFC auch für kleine Raster, `rule` ersetzt WFC überall durch den Regelverlauf. Ohne Angabe: WFC ab 60 Zellen, sonst Regel. */
  readonly solver?: 'wfc' | 'rule';
}

// ------------------------------------------------------------------ Modell

/** N–T–C: C grenzt nie an N. Alle vier Richtungen gleich (die Form macht der Wuchsbereich, nicht die Regel). */
const NEIGHBOURS: readonly (readonly number[])[] = [[N, T], [N, T, C], [T, C]];
export const WEATHERING_MODEL: WfcModel = {
  tiles: [{ id: 'neutral', weight: 1 }, { id: 'transition', weight: 1 }, { id: 'cluster', weight: 1 }],
  dirs: 4,
  compat: [NEIGHBOURS, NEIGHBOURS, NEIGHBOURS, NEIGHBOURS],
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const PLINTH_NOISE: NoiseParams = { type: 'cluster', scale: 2.6, octaves: 2, dither: 0.04 };
const SHADE_NOISE: NoiseParams = { type: 'cluster', scale: 3.5, octaves: 2, dither: 0.04 };
const KIND_NOISE: NoiseParams = { type: 'cluster', scale: 4, octaves: 1 };
const ROOF_NOISE: NoiseParams = { type: 'cluster', scale: 3.2, octaves: 2, dither: 0.03 };

// ------------------------------------------------------------------ Töne (Familie → Block)

const TONE_SHAPES: ReadonlySet<string> = new Set(['block', 'planks', 'stairs', 'slab', 'wall', 'log', 'stripped_log', 'wood', 'stripped_wood']);
const TONE_KINDS: ReadonlySet<string> = new Set(['stone', 'wood', 'terracotta']);
const BLOCKISH: ReadonlySet<string> = new Set(['block']);
/** Grüne/gestreifte Texturen (Tuff, Basalt, Schwarzstein, Tiefenschiefer mit Achse) lesen sich im Stein nicht als dunklerer Ton, sondern als Fremdkörper. */
const NOT_A_SIBLING = /^(mossy_|cracked_|chiseled|infested|waxed|cut_|smooth_red|crying_|gilded_)|(blackstone|tuff|basalt|amethyst|obsidian|prismarine|purpur|end_stone|nether|resin)|^deepslate$/;
/** Rollen, die nicht verwittern (Rahmen, Balken, Öffnungen, Licht). */
const SKIP_ROLES = /beam|pillar|frame|window|door|shutter|lantern|light|glass|fence|rail|ladder|chimney_cap|banner|sign/;
const RUBBLE: readonly string[] = ['mossy_cobblestone', 'mossy_cobblestone', 'cobblestone', 'mossy_stone_bricks', 'cobbled_deepslate'];
/** Putz-Leiter (hell → dunkel): Familien, die wie schmutziger Kalkputz altern (Diorit zuerst: die Sprenkel lesen sich als Schmutz). */
const PLASTER_LADDER: readonly string[] = ['diorite', 'polished_diorite', 'smooth_stone', 'polished_andesite', 'andesite'];
/** Blöcke ohne Familie, die als Putz gelten (Pilzstiel als helle Wandtextur). */
const PLASTER_EXTRA: ReadonlySet<string> = new Set(['mushroom_stem', 'white_concrete', 'light_gray_concrete', 'bone_block']);
/** Untergrenze der Helligkeit des Ziel-Blocks gegenüber dem Ausgangsblock (keine schwarzen Löcher). */
const MIN_LUM_RATIO = 0.5;

const stripNs = (n: string): string => (n.startsWith('minecraft:') ? n.slice(10) : n);

function rgb(hex: string | undefined): readonly [number, number, number] | undefined {
  if (hex === undefined || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
const lum = (c: readonly [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** Farbton-Abstand (Chromatizität r,g,b geteilt durch Summe): Schwesterfamilien sollen dieselbe Farbrichtung behalten. */
function chromaDist(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const sa = Math.max(1, a[0] + a[1] + a[2]);
  const sb = Math.max(1, b[0] + b[1] + b[2]);
  return Math.hypot(a[0] / sa - b[0] / sb, a[1] / sa - b[1] / sb, a[2] / sa - b[2] / sb);
}

interface FamShape { readonly family: string; readonly shape: string }

/** Familien-Sicht: Block → (Familie, Form), Varianten, dunklere/hellere Schwesterfamilie. Rein, mit Zwischenspeicher. */
export class ToneIndex {
  private readonly byBlock = new Map<string, FamShape>();
  private readonly darkCache = new Map<string, string | null>();
  private readonly lightCache = new Map<string, string | null>();

  constructor(private readonly data: FamilyData, private readonly hasBlock: (name: string) => boolean) {
    for (const [id, f] of Object.entries(data.families)) {
      for (const [shape, b] of Object.entries(f.shapes)) {
        if (!TONE_SHAPES.has(shape)) continue;
        const key = stripNs(b);
        if (!this.byBlock.has(key)) this.byBlock.set(key, { family: id, shape });
      }
    }
  }

  lookup(name: string): FamShape | undefined {
    const fs = this.byBlock.get(stripNs(name));
    if (fs === undefined) return undefined;
    const f = this.data.families[fs.family];
    return f !== undefined && TONE_KINDS.has(f.kind) ? fs : undefined;
  }

  /** Art der Familie (`stone`/`wood`/`terracotta`), falls bekannt. */
  kindOf(family: string): string | undefined {
    return Object.hasOwn(this.data.families, family) ? this.data.families[family]?.kind : undefined;
  }

  /** Helligkeit der Familien-Texturfarbe (0–255); `undefined` ohne Farbe. */
  lumOf(family: string): number | undefined {
    const c = rgb(Object.hasOwn(this.data.families, family) ? this.data.families[family]?.color : undefined);
    return c === undefined ? undefined : lum(c);
  }

  /** Block einer Familie in einer Form (nur wenn es ihn in der Zielversion gibt). */
  blockOf(family: string, shape: string): string | undefined {
    const f = Object.hasOwn(this.data.families, family) ? this.data.families[family] : undefined;
    const b = f?.shapes[shape];
    if (b === undefined) return undefined;
    const n = stripNs(b);
    return this.hasBlock(n) ? n : undefined;
  }

  /** Variante (`mossy`, `cracked`) derselben Familie und Form – wie `ThemeResolver.variantOf`. */
  variant(family: string, shape: string, variant: 'mossy' | 'cracked'): string | undefined {
    if (BLOCKISH.has(shape)) {
      const b = this.blockOf(family, variant);
      if (b !== undefined) return b;
    }
    return this.blockOf(`${variant}_${family}`, shape);
  }

  /**
   * Nächste dunklere Schwesterfamilie gleicher Art und Form (Ziel: 0,8 × Texturfarbe); `undefined` ohne nahen Treffer.
   * Nie heller als der Ausgangsblock (Helligkeitsverhältnis < 0,95 ist harte Bedingung).
   */
  darker(family: string, shape: string): string | undefined {
    return this.sister(family, shape, 0.8, 0.45, 0.95, this.darkCache);
  }

  /** Nächste hellere Schwesterfamilie (Ziel: 1,22 × Texturfarbe, Verhältnis 1,05–1,7). */
  lighter(family: string, shape: string): string | undefined {
    return this.sister(family, shape, 1.18, 1.05, 1.4, this.lightCache);
  }

  private sister(family: string, shape: string, factor: number, minRatio: number, maxRatio: number, cache: Map<string, string | null>): string | undefined {
    const key = `${family}|${shape}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit ?? undefined;
    let best: string | undefined;
    const own = this.data.families[family];
    const base = rgb(own?.color);
    if (own !== undefined && base !== undefined && !NOT_A_SIBLING.test(family)) {
      const target = base.map((v) => Math.min(255, v * factor)) as [number, number, number];
      // Holz hat wenig Arten: dort größere Toleranz (Fichte → Schwarzeiche)
      let bestD = own.kind === 'wood' ? 90 : 60;
      for (const [id, g] of Object.entries(this.data.families)) {
        if (id === family || g.kind !== own.kind || NOT_A_SIBLING.test(id)) continue;
        const c = rgb(g.color);
        if (c === undefined) continue;
        const ratio = lum(c) / Math.max(1, lum(base));
        if (ratio < minRatio || ratio > maxRatio) continue;
        const hue = chromaDist(c, base);
        if (hue > 0.085) continue;
        const d = Math.hypot(c[0] - target[0], c[1] - target[1], c[2] - target[2]) + 300 * hue;
        if (d >= bestD) continue;
        const b = this.blockOf(id, shape);
        if (b === undefined) continue;
        bestD = d;
        best = b;
      }
    }
    cache.set(key, best ?? null);
    return best;
  }

  /** `steps` Stufen dunkler (jede Stufe eine Schwesterfamilie); bleibt beim letzten Treffer stehen. */
  darkerBy(family: string, shape: string, steps: number): string | undefined {
    let fam = family;
    let out: string | undefined;
    for (let s = 0; s < steps; s++) {
      const b = this.darker(fam, shape);
      if (b === undefined) break;
      out = b;
      const next = this.lookup(b);
      if (next === undefined) break;
      fam = next.family;
    }
    return out;
  }

  /** Putz-Ton: `steps` Stufen dunkler auf der Putz-Leiter (je Stufe mindestens 8 % dunkler als zuvor). */
  plasterDarker(current: string, shape: string, steps: number): string | undefined {
    const fs = this.lookup(current);
    let l = fs !== undefined ? this.lumOf(fs.family) : undefined;
    if (l === undefined) l = 225; // Pilzstiel, Beton …: wie Kalkputz
    let out: string | undefined;
    for (let s = 0; s < steps; s++) {
      let found: string | undefined;
      let foundLum = 0;
      for (const id of PLASTER_LADDER) {
        const rl = this.lumOf(id);
        if (rl === undefined || rl > l * 0.93) continue;
        const b = this.blockOf(id, shape);
        if (b === undefined) continue;
        found = b;
        foundLum = rl;
        break;
      }
      if (found === undefined) break;
      out = found;
      l = foundLum;
    }
    return out;
  }

  /** Bruchstein-Ersatz derselben Form (nur Stein); `pick` ∈ [0,1) wählt aus der Liste. */
  rubble(family: string, shape: string, current: string, pick: number): string | undefined {
    if (this.data.families[family]?.kind !== 'stone') return undefined;
    const list = RUBBLE.filter((id) => id !== family);
    for (let k = 0; k < list.length; k++) {
      const id = list[(Math.floor(pick * list.length) + k) % list.length]!;
      const b = this.blockOf(id, shape);
      if (b !== undefined && b !== current) return b;
    }
    return undefined;
  }
}

// ------------------------------------------------------------------ Material × Ursache → Eingriff

/** Material eines Blocks; `undefined` = verwittert nicht (Glas, Pflanzen, Metall …). */
function materialOf(tones: ToneIndex, name: string): { readonly mat: Material; readonly fs: FamShape | undefined } | undefined {
  const fs = tones.lookup(name);
  if (fs === undefined) return PLASTER_EXTRA.has(stripNs(name)) ? { mat: 'plaster', fs: undefined } : undefined;
  const kind = tones.kindOf(fs.family);
  const l = tones.lumOf(fs.family) ?? 0;
  if (kind === 'wood') return { mat: 'wood', fs };
  if (l >= 172 && (kind === 'stone' || kind === 'terracotta') && !fs.family.startsWith('mossy_') && !fs.family.startsWith('cracked_')) return { mat: 'plaster', fs };
  if (kind === 'terracotta') return { mat: 'clay', fs };
  return { mat: 'stone', fs };
}

interface Move { readonly op: ClusterType; readonly steps: number }

/**
 * Was passiert bei Ursache × Material im Cluster (`cls === C`) bzw. im Übergang? `pick` ∈ [0,1) würfelt Varianten,
 * `share` ist der Anteil der Übergangszellen, die tatsächlich getauscht werden.
 */
function moveFor(cause: CauseKind, cls: number, mat: Material, pick: number): { readonly move: Move; readonly share: number } | undefined {
  const dark = (steps = 1): Move => ({ op: 'dark', steps });
  const moist = mat === 'stone';
  if (cls === C) {
    switch (cause) {
      case 'rain': case 'drip': return { move: dark(), share: 1 };
      case 'corner': return { move: pick < 0.4 && moist ? { op: 'moss', steps: 1 } : dark(), share: 1 };
      case 'plinth': return mat === 'stone' ? { move: { op: pick < 0.55 ? 'moss' : 'rubble', steps: 1 }, share: 1 }
        : mat === 'plaster' ? { move: { op: 'spall', steps: 1 }, share: 1 } : { move: dark(), share: 1 };
      case 'splash': return mat === 'plaster' ? { move: pick < 0.4 ? { op: 'splash', steps: 1 } : dark(2), share: 1 } : { move: dark(mat === 'stone' ? 1 : 2), share: 1 };
      case 'spall': return mat === 'plaster' ? { move: { op: 'spall', steps: 1 }, share: 1 } : { move: dark(), share: 1 };
      case 'tree': return { move: moist ? { op: 'moss', steps: 1 } : dark(), share: 1 };
      case 'soot': return { move: dark(2), share: 1 };
      case 'valley': return { move: pick < 0.3 && moist ? { op: 'moss', steps: 1 } : dark(), share: 1 };
      case 'eave': return { move: pick < 0.5 && moist ? { op: 'moss', steps: 1 } : dark(), share: 1 };
      case 'ridge': return { move: { op: 'light', steps: 1 }, share: 1 };
    }
  }
  // Übergang: schwächere Fassung derselben Ursache
  switch (cause) {
    case 'soot': return { move: dark(), share: 0.65 };
    case 'ridge': return { move: { op: 'light', steps: 1 }, share: 0.4 };
    case 'plinth': return moist ? { move: pick < 0.5 ? { op: 'moss', steps: 1 } : dark(), share: 0.45 } : { move: dark(), share: 0.4 };
    case 'tree': return { move: moist ? { op: 'moss', steps: 1 } : dark(), share: 0.35 };
    case 'eave': return { move: dark(), share: 0.4 };
    default: return { move: dark(), share: 0.4 };
  }
}

interface BlockCtx {
  readonly tones: ToneIndex;
  /** Untergrund-Stein, der bei Abplatzungen des Putzes sichtbar wird (häufigster Stein der Wandflächen). */
  readonly underlay: string | undefined;
  /** Auf dem Dach: fehlt die bemooste Variante, wird dunkel statt gar nichts gesetzt. */
  readonly roof: boolean;
}

/** Ziel-Block für Eingriff × Material; `undefined` = Block bleibt (fehlende Variante, zu hell/zu dunkel …). */
function targetBlock(bc: BlockCtx, move: Move, mat: Material, fs: FamShape | undefined, current: string, pick: number): string | undefined {
  const { tones } = bc;
  const shape = fs?.shape ?? 'block';
  const curLum = fs !== undefined ? tones.lumOf(fs.family) : 225;
  const guarded = (b: string | undefined, dir: 'dark' | 'light'): string | undefined => {
    if (b === undefined || b === current) return undefined;
    const t = tones.lookup(b);
    const l = t !== undefined ? tones.lumOf(t.family) : undefined;
    if (l === undefined || curLum === undefined) return undefined;
    if (dir === 'dark') return l < curLum * 0.97 && l >= curLum * (mat === 'plaster' ? 0.68 : bc.roof ? 0.72 : MIN_LUM_RATIO) ? b : undefined;
    return l > curLum * 1.03 ? b : undefined;
  };
  const darkOf = (steps: number): string | undefined => {
    if (mat === 'plaster') return guarded(tones.plasterDarker(current, shape, steps), 'dark');
    if (fs === undefined) return undefined;
    return guarded(tones.darkerBy(fs.family, fs.shape, steps) ?? (steps > 1 ? tones.darker(fs.family, fs.shape) : undefined), 'dark');
  };
  switch (move.op) {
    case 'dark': {
      // Stein, eine Stufe: zuerst die rissige Variante derselben Familie (gleiche Textur, etwas dunkler), erst Stufe 2 wechselt die Familie
      if (mat === 'stone' && move.steps === 1 && fs !== undefined && !bc.roof) {
        const cr = tones.variant(fs.family, fs.shape, 'cracked');
        if (cr !== undefined && cr !== current) return cr;
      }
      const d = darkOf(move.steps) ?? (move.steps > 1 ? darkOf(1) : undefined);
      if (d !== undefined || fs === undefined || mat !== 'stone') return d;
      return tones.variant(fs.family, fs.shape, 'cracked');
    }
    case 'moss': {
      if (fs === undefined || mat === 'plaster') return darkOf(1);
      if (fs.family.startsWith('mossy_')) return undefined;
      return tones.variant(fs.family, fs.shape, 'mossy') ?? (bc.roof ? darkOf(1) : undefined);
    }
    case 'rubble': {
      if (fs === undefined || mat !== 'stone') return darkOf(1);
      if (fs.family.startsWith('mossy_') || fs.family.startsWith('cracked_')) return undefined;
      return tones.rubble(fs.family, fs.shape, current, pick) ?? tones.variant(fs.family, fs.shape, 'mossy');
    }
    case 'light': {
      if (fs === undefined || mat === 'wood') return undefined;
      return guarded(tones.lighter(fs.family, fs.shape), 'light');
    }
    case 'spall': {
      if (mat !== 'plaster') return darkOf(1);
      const fam = bc.underlay !== undefined ? tones.lookup(bc.underlay) : undefined;
      const under = fam !== undefined ? tones.blockOf(fam.family, shape) : undefined;
      return under !== undefined && under !== current ? under : darkOf(2);
    }
    case 'splash': {
      const b = tones.blockOf('packed_mud', shape);
      return b !== undefined && b !== current ? b : darkOf(2);
    }
  }
}

// ------------------------------------------------------------------ Raster lösen

/** Eine feste Ursache: Zelle (C), Ursache und Wuchsbereich (Zellen, die C werden dürfen). */
export interface Cause {
  readonly cell: number;
  readonly kind: CauseKind;
  readonly grow: readonly number[];
}

export interface RasterResult {
  readonly cls: Uint8Array;
  /** Index der Ursache in `CAUSE_KINDS` je Zelle (−1 = keine). */
  readonly type: Int8Array;
  readonly ok: boolean;
  readonly backtracks: number;
  /** Mit Regelverlauf statt WFC gelöst. */
  readonly rule: boolean;
}

const causeCode = (k: CauseKind): number => CAUSE_KINDS.indexOf(k);

/**
 * Löst ein Raster (w × h, `active` = Maske) aus den Ursachen. Wuchsbereich `allowC`, Übergangsring `allowT` (4er-
 * Nachbarschaft darum), sonst nur N. Danach Ursache je Zelle = Ursache der nächsten Keimzelle (Breitensuche über C/T).
 * `solver`: `auto` = WFC ab {@link RULE_BELOW_CELLS} aktiven Zellen, darunter Regelverlauf.
 */
export function solveRaster(
  w: number, h: number, active: Uint8Array, causes: readonly Cause[], seed: number, strength: number, solver: 'wfc' | 'rule' | 'auto',
): RasterResult {
  const size = w * h;
  const cls = new Uint8Array(size);
  const type = new Int8Array(size).fill(-1);
  const fixedC = new Uint8Array(size);
  const allowC = new Uint8Array(size);
  let activeCount = 0;
  for (let i = 0; i < size; i++) activeCount += active[i]!;
  for (const c of causes) {
    if (active[c.cell] === 0) continue;
    fixedC[c.cell] = 1;
    allowC[c.cell] = 1;
    for (const g of c.grow) if (active[g] === 1) allowC[g] = 1;
  }
  const nb = (i: number): number[] => {
    const x = i % w;
    const out: number[] = [];
    if (x + 1 < w) out.push(i + 1);
    if (x > 0) out.push(i - 1);
    if (i + w < size) out.push(i + w);
    if (i - w >= 0) out.push(i - w);
    return out.filter((j) => active[j] === 1);
  };
  const allowT = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (allowC[i] === 0) continue;
    allowT[i] = 1;
    for (const j of nb(i)) allowT[j] = 1;
  }
  const useWfc = solver === 'wfc' || (solver === 'auto' && activeCount >= RULE_BELOW_CELLS);
  let ok = true;
  let backtracks = 0;
  if (useWfc) {
    const grid = grid2d(w, h, (x, z) => active[z * w + x] === 1);
    const fixed = new Map<number, readonly number[]>();
    for (let i = 0; i < size; i++) {
      if (active[i] === 0) continue;
      fixed.set(i, fixedC[i] === 1 ? [C] : allowC[i] === 1 ? [N, T, C] : allowT[i] === 1 ? [N, T] : [N]);
    }
    // Gewichte (grob): Neutral trägt, der Übergang ist selten (breite Cluster statt Sprenkel), der Cluster wächst mit der Stärke
    const weights = [5, 1.3, clamp(0.6 + 1.1 * strength, 0.4, 2.8)];
    const res = solveWfc(WEATHERING_MODEL, grid, { seed, fixed, weights, maxBacktracks: 96, restarts: 3 });
    backtracks = res.backtracks;
    if (res.ok) {
      for (let i = 0; i < size; i++) if (active[i] === 1) cls[i] = res.tiles[i]!;
      // Einzelne Cluster-Zellen ohne Cluster-Nachbarn (Sprenkel) werden zu Übergang; der Keim bleibt immer stehen
      for (let i = 0; i < size; i++) {
        if (cls[i] !== C || fixedC[i] === 1) continue;
        if (!nb(i).some((j) => cls[j] === C)) cls[i] = T;
      }
    } else {
      ok = false;
    }
  }
  const rule = !useWfc || !ok;
  if (rule) {
    // Regelverlauf (kleine Raster, Vergleichsbasis und Rückfall): Cluster = Keim + Wuchsbereich, dessen Wahrscheinlichkeit mit
    // dem Abstand zum Keim fällt (Wert-Rauschen statt Solver); Übergang = Ring um jeden Cluster.
    cls.fill(0);
    const dist = new Int16Array(size).fill(-1);
    const bfs: number[] = [];
    for (let i = 0; i < size; i++) if (fixedC[i] === 1) { dist[i] = 0; bfs.push(i); }
    for (let q = 0; q < bfs.length; q++) {
      const i = bfs[q]!;
      for (const j of nb(i)) if (dist[j] === -1 && allowC[j] === 1) { dist[j] = dist[i]! + 1; bfs.push(j); }
    }
    const pg = clamp(0.55 + 0.4 * strength, 0.4, 0.97);
    for (let i = 0; i < size; i++) {
      if (fixedC[i] === 1) { cls[i] = C; continue; }
      if (dist[i]! < 1) continue;
      const p = pg * 0.93 ** (dist[i]! - 1);
      if (hash01(hashSeed(seed, 'rule'), i % w, (i / w) | 0) < p) cls[i] = C;
    }
    for (let i = 0; i < size; i++) {
      if (cls[i] !== C) continue;
      for (const j of nb(i)) if (cls[j] === N) cls[j] = T;
    }
  }
  // Ursache: Breitensuche von den Keimen aus durch C-/T-Zellen; erste Ursache in Listenreihenfolge gewinnt
  const queue: number[] = [];
  for (const c of causes) {
    if (active[c.cell] === 0 || type[c.cell] !== -1) continue;
    type[c.cell] = causeCode(c.kind);
    queue.push(c.cell);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    for (const j of nb(i)) {
      if (type[j] !== -1 || cls[j] === N) continue;
      type[j] = type[i]!;
      queue.push(j);
    }
  }
  for (let i = 0; i < size; i++) if (type[i] === -1) cls[i] = N;
  return { cls, type, ok, backtracks, rule };
}

// ------------------------------------------------------------------ Tonzonen (LV „Texture like a pro“)

/** Tonstufen 0 (Grundton) · 1 · 2 (zwei Stufen dunkler). Senkrechte Nachbarn unterscheiden sich höchstens um eine Stufe (Verlauf, kein Sprung). */
const TONE_NB: readonly (readonly number[])[] = [[0, 1], [0, 1, 2], [1, 2]];
/** Waagerecht frei (Tropfkette neben Grundton ist erlaubt), senkrecht Verlauf: Wasser/Schmutz läuft ab, Stufen fallen weich aus. */
const TONE_FREE: readonly (readonly number[])[] = [[0, 1, 2], [0, 1, 2], [0, 1, 2]];
export const TONE_MODEL: WfcModel = {
  tiles: [{ id: 'base', weight: 1 }, { id: 'dark1', weight: 1 }, { id: 'dark2', weight: 1 }],
  dirs: 4,
  // Richtungen wie `grid2d`: +x, −x (entlang der Wand), +z, −z (Zeilen = Höhe)
  compat: [TONE_FREE, TONE_FREE, TONE_NB, TONE_NB],
};

export interface ToneResult {
  /** Tonstufe je Zelle (0 außerhalb der Maske). */
  readonly tone: Uint8Array;
  readonly ok: boolean;
  readonly backtracks: number;
}

/**
 * Löst das Tonraster: Zielstufe `target` je Zelle aus den Zonen (Geometrie). Domäne je Zelle {max(0, t−1) … t}: der Solver
 * darf eine Zone nur **abschwächen**, nie über die Geometrie hinaus dunkeln – das ist die „Randomisierung“ des Videos. Die
 * senkrechte Nachbarregel |a−b| ≤ 1 erzwingt Verläufe (keine Stufe 2 direkt über/unter dem Grundton). Immer lösbar (alle Zielzellen auf 1 ist eine
 * Lösung); scheitert WFC am Budget, greift genau diese Abschwächung als Rückfall.
 */
export function solveTone(w: number, h: number, active: Uint8Array, target: Uint8Array, seed: number, keep: number): ToneResult {
  const size = w * h;
  const tone = new Uint8Array(size);
  let any = false;
  for (let i = 0; i < size; i++) if (active[i] === 1 && target[i]! > 0) { any = true; break; }
  if (!any) return { tone, ok: true, backtracks: 0 };
  const grid = grid2d(w, h, (x, z) => active[z * w + x] === 1);
  const fixed = new Map<number, readonly number[]>();
  for (let i = 0; i < size; i++) {
    if (active[i] === 0) continue;
    const t = target[i]!;
    fixed.set(i, t === 0 ? [0] : t === 1 ? [0, 1] : [1, 2]);
  }
  // `keep` ≈ Anteil der Zellen, die ihre Zielstufe behalten (Stärke); Rest wird eine Stufe heller
  const kp = clamp(keep, 0.3, 0.95);
  const res = solveWfc(TONE_MODEL, grid, { seed, fixed, weights: [1 - kp, kp, 2 * kp], maxBacktracks: 64, restarts: 2 });
  if (res.ok) {
    for (let i = 0; i < size; i++) if (active[i] === 1) tone[i] = res.tiles[i]!;
    return { tone, ok: true, backtracks: res.backtracks };
  }
  for (let i = 0; i < size; i++) if (active[i] === 1) tone[i] = Math.min(1, target[i]!);
  return { tone, ok: false, backtracks: res.backtracks };
}

// ------------------------------------------------------------------ Hauptpass

const WALLISH: ReadonlySet<ShellKind> = new Set<ShellKind>(['wall', 'pillar', 'lintel', 'fort', 'facade']);
/** Wandrichtungen (nach außen): +x, −x, +z, −z. */
const NORMALS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Feuchte je Himmelsrichtung der Fläche (Nord/West schattig und feuchter, Süd trockener). */
const MOIST: readonly number[] = [0.9, 1.0, 0.8, 1.25];
const TREE_ROLE = /leaves|trunk|log|bush|hedge|canopy/;
const DIRS4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function applyNarrativeWeathering(input: NarrativeWeatheringInput): NarrativeWeatheringStats {
  const { volume, shell, contexts, roleAt, seed, level, strength } = input;
  const k = Math.max(0, strength);
  const solver = input.solver ?? 'auto';
  const tones = new ToneIndex(input.families, input.hasBlock);
  const rich = level === 'rich';
  /** Stärke relativ zu `rich` bei normalem Alter (1); `some` ≈ 0,57. Wahrscheinlichkeiten skalieren damit, nicht nur ihre Zusätze. */
  const kk = clamp(k / 1.15, 0, 1.5) ** 1.3; // some ≈ halb so stark wie rich

  const zeroCause = (): Record<CauseKind, number> => Object.fromEntries(CAUSE_KINDS.map((c) => [c, 0])) as Record<CauseKind, number>;
  const stats = {
    rasters: 0, rastersFailed: 0, rastersRule: 0, toneRasters: 0, toneFailed: 0, backtracks: 0, surfaceCells: 0,
    causes: zeroCause(),
    changed: 0, changedCluster: 0, changedTransition: 0,
    byType: Object.fromEntries(CLUSTER_TYPES.map((t) => [t, 0])) as Record<ClusterType, number>,
    blocks: zeroCause(),
    byMaterial: { plaster: 0, stone: 0, wood: 0, clay: 0 } as Record<Material, number>,
    plinthChanged: 0, roofChanged: 0,
  };
  const done = (): NarrativeWeatheringStats => ({
    level, strength: k, rasters: stats.rasters, rastersFailed: stats.rastersFailed, rastersRule: stats.rastersRule,
    toneRasters: stats.toneRasters, toneFailed: stats.toneFailed,
    backtracks: stats.backtracks, surfaceCells: stats.surfaceCells, causes: stats.causes,
    changed: stats.changed, changedCluster: stats.changedCluster, changedTransition: stats.changedTransition,
    byType: stats.byType,
    byCause: Object.fromEntries(CAUSE_KINDS.map((c) => [c, { clusters: stats.causes[c], blocks: stats.blocks[c] }])) as Record<CauseKind, { clusters: number; blocks: number }>,
    byMaterial: stats.byMaterial, plinthChanged: stats.plinthChanged, roofChanged: stats.roofChanged,
  });
  if (k <= 0) return done();

  const [ox, oy, oz] = volume.origin;
  const [sx, sy, sz] = volume.size;
  const idx = (x: number, y: number, z: number): number => ((x - ox) * sy + (y - oy)) * sz + (z - oz);
  const inside = (x: number, y: number, z: number): boolean => x >= ox && y >= oy && z >= oz && x < ox + sx && y < oy + sy && z < oz + sz;

  // ---- Kinds je Position (Hülle) und Volumen-Sicht
  const kindAt = new Map<string, ShellKind>();
  for (const c of shell.cells) kindAt.set(key3(c.pos), c.kind);
  const solid = new Uint8Array(sx * sy * sz);
  for (let x = ox; x < ox + sx; x++) for (let y = oy; y < oy + sy; y++) for (let z = oz; z < oz + sz; z++) {
    if (!isAir(volume.stateAt([x, y, z]))) solid[idx(x, y, z)] = 1;
  }
  const isSolid = (x: number, y: number, z: number): boolean => inside(x, y, z) && solid[idx(x, y, z)] === 1;

  // ---- Außenluft: Luft, die vom Rand des Volumens aus erreichbar ist (Höfe gelten als außen, Räume nicht)
  const outdoor = new Uint8Array(sx * sy * sz);
  const stack: number[] = [];
  const push = (x: number, y: number, z: number): void => {
    if (!inside(x, y, z)) return;
    const i = idx(x, y, z);
    if (solid[i] === 1 || outdoor[i] === 1) return;
    outdoor[i] = 1;
    stack.push(i);
  };
  for (let x = ox; x < ox + sx; x++) for (let y = oy; y < oy + sy; y++) for (let z = oz; z < oz + sz; z++) {
    if (x === ox || x === ox + sx - 1 || y === oy + sy - 1 || z === oz || z === oz + sz - 1) push(x, y, z);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const z = oz + (i % sz);
    const y = oy + (Math.floor(i / sz) % sy);
    const x = ox + Math.floor(i / (sz * sy));
    push(x + 1, y, z); push(x - 1, y, z); push(x, y + 1, z); push(x, y - 1, z); push(x, y, z + 1); push(x, y, z - 1);
  }
  const isOut = (x: number, y: number, z: number): boolean => !inside(x, y, z) || outdoor[idx(x, y, z)] === 1;

  const treeNear = (x: number, y: number, z: number, nx: number, nz: number): boolean => {
    // Laub/Stamm/Busch in der Wandnähe: 1 Zelle vor der Wand, ±1 entlang, ±1 in der Höhe
    for (let dn = 1; dn <= 2; dn++) for (let da = -1; da <= 1; da++) for (let dy = -1; dy <= 2; dy++) {
      const px = x + nx * dn + (nz !== 0 ? da : 0);
      const pz = z + nz * dn + (nx !== 0 ? da : 0);
      const p: Vec3 = [px, y + dy, pz];
      if (!isSolid(p[0], p[1], p[2]) || kindAt.get(key3(p)) !== 'plant') continue;
      if (TREE_ROLE.test(roleAt.get(key3(p)) ?? '')) return true;
    }
    return false;
  };

  const weatherable = (pos: Vec3): boolean => {
    const role = roleAt.get(key3(pos));
    return role !== undefined && !SKIP_ROLES.test(role);
  };

  // ---- Untergrund für Putz-Abplatzungen: häufigster einfacher Stein an den Wandflächen (kein Moos/Riss-Ersatz)
  const stoneCount = new Map<string, number>();
  for (const c of shell.cells) {
    if (c.kind !== 'wall' && c.kind !== 'fort' && c.kind !== 'facade') continue;
    if (!inside(c.pos[0], c.pos[1], c.pos[2])) continue;
    const st = volume.stateAt(c.pos);
    const m = materialOf(tones, st.name);
    if (m === undefined || m.mat !== 'stone' || m.fs === undefined || m.fs.shape !== 'block') continue;
    if (m.fs.family.startsWith('mossy_') || m.fs.family.startsWith('cracked_') || m.fs.family.includes('deepslate')) continue;
    const n = stripNs(st.name);
    stoneCount.set(n, (stoneCount.get(n) ?? 0) + 1);
  }
  const underlay = [...stoneCount.entries()].sort((l, r) => r[1] - l[1] || (l[0] < r[0] ? -1 : 1))[0]?.[0];

  /** `steps` gesetzt = Tonzone (feste Stufe dunkler, ohne Dither); sonst Cluster-Eingriff aus Ursache × Material. */
  interface Change { readonly pos: Vec3; readonly cls: number; readonly cause: number; readonly plinth: boolean; readonly roof: boolean; readonly steps?: number }
  const changes: Change[] = [];

  // ---------------------------------------------------------------- Schornstein: Ruß (zuerst, gewinnt bei Überschneidung)
  const chimneyCols: [number, number, number][] = []; // x, z, oberstes Schlot-y
  {
    const top = new Map<string, [number, number, number]>();
    for (const [key, role] of roleAt) {
      if (!role.startsWith('hearth')) continue;
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      const ck = `${x},${z}`;
      const cur = top.get(ck);
      if (cur === undefined || y > cur[2]) top.set(ck, [x, z, y]);
    }
    for (const [x, z, y] of [...top.values()].sort((l, r) => l[0] - r[0] || l[1] - r[1])) {
      if (!isOut(x, y + 1, z) && !isOut(x, y + 2, z)) continue; // Kamin im Raum, kein Schlot über dem Dach
      chimneyCols.push([x, z, y]);
      stats.causes.soot++;
      for (let dy = 0; dy < 3; dy++) {
        const p: Vec3 = [x, y - dy, z];
        if (isSolid(p[0], p[1], p[2]) && roleAt.get(key3(p))?.startsWith('hearth') === true) changes.push({ pos: p, cls: C, cause: causeCode('soot'), plinth: false, roof: false });
      }
    }
  }

  // ---------------------------------------------------------------- Wandflächen
  for (let di = 0; di < NORMALS.length; di++) {
    const [nx, nz] = NORMALS[di]!;
    const alongX = nx === 0; // Wand läuft entlang x (Normale ±z)
    const moist = MOIST[di]!;
    interface FaceCell { readonly a: number; readonly y: number; readonly pos: Vec3; readonly ground: number; readonly mat: Material | undefined }
    interface Plane { cells: FaceCell[]; windows: FaceCell[]; present: Set<string> }
    const planes = new Map<number, Plane>();
    const plane = (p: number): Plane => {
      let e = planes.get(p);
      if (e === undefined) { e = { cells: [], windows: [], present: new Set() }; planes.set(p, e); }
      return e;
    };
    for (let x = ox; x < ox + sx; x++) for (let y = oy; y < oy + sy; y++) for (let z = oz; z < oz + sz; z++) {
      if (solid[idx(x, y, z)] === 0) continue;
      const pos: Vec3 = [x, y, z];
      const kind = kindAt.get(key3(pos));
      if (kind === undefined) continue;
      const isWall = WALLISH.has(kind);
      if (!isWall && kind !== 'window') continue;
      if (!isOut(x + nx, y, z + nz)) continue;
      const p = alongX ? z : x;
      const a = alongX ? x : z;
      // Bodenabstand vor der Wand: Luftzellen bis zum ersten festen Block (max. 3), Volumenrand zählt als Boden
      let ground = 0;
      for (; ground < 3; ground++) {
        const gy = y - ground - 1;
        if (!inside(x + nx, gy, z + nz)) break;
        if (isSolid(x + nx, gy, z + nz)) {
          // Vorsprung (Geschoss-Überhang, Sims, Dach) ist kein Boden: dort gibt es weder Sockel noch Spritzwasser
          const lk = kindAt.get(key3([x + nx, gy, z + nz]));
          if (lk !== 'terrain' && lk !== 'plant') ground = 9;
          break;
        }
        if (!isOut(x + nx, gy, z + nz)) { ground = 9; break; }
      }
      const mat = materialOf(tones, volume.stateAt(pos).name)?.mat;
      const cell: FaceCell = { a, y, pos, ground, mat };
      plane(p).present.add(`${a},${y}`);
      if (kind === 'window') plane(p).windows.push(cell);
      else if (weatherable(pos)) plane(p).cells.push(cell);
    }
    for (const [p, { cells, windows, present }] of [...planes.entries()].sort((l, r) => l[0] - r[0])) {
      if (cells.length === 0) continue;
      let minA = Infinity, maxA = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of cells) {
        if (c.a < minA) minA = c.a; if (c.a > maxA) maxA = c.a;
        if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
      }
      const w = maxA - minA + 1;
      const h = maxY - minY + 1;
      const active = new Uint8Array(w * h);
      const ri = (a: number, y: number): number => (a < minA || a > maxA || y < minY || y > maxY ? -1 : (y - minY) * w + (a - minA));
      const groundAt = new Map<number, number>();
      const matAt = new Map<number, Material | undefined>();
      for (const c of cells) { active[ri(c.a, c.y)] = 1; groundAt.set(ri(c.a, c.y), c.ground); matAt.set(ri(c.a, c.y), c.mat); }
      const winSet = new Set<number>();
      for (const c of windows) winSet.add(ri(c.a, c.y));
      stats.surfaceCells += cells.length;
      const fseed = hashSeed(seed, 'nwf', di, p);
      const causes: Cause[] = [];
      const seen = new Set<number>();
      const add = (cell: number, kind: CauseKind, grow: readonly number[]): boolean => {
        if (cell < 0 || active[cell] === 0 || seen.has(cell)) return false;
        seen.add(cell);
        causes.push({ cell, kind, grow: grow.filter((g) => g >= 0) });
        stats.causes[kind]++;
        return true;
      };
      const to = (a: number, y: number): number => ri(a, y);
      /** Wandende: links oder rechts daneben keine Wandzelle (Gebäudeecke, Tür-/Fensterlaibung). */
      const isEnd = (a: number, y: number): boolean => {
        // Ende = daneben ist keine Wand der Ebene mehr (Gebäudeecke) oder ein Fenster; Balken/Fachwerk zählen nicht
        for (const da of [-1, 1]) {
          const key = `${a + da},${y}`;
          if (!present.has(key) || winSet.has(to(a + da, y))) return true;
        }
        return false;
      };
      /** Ausgefranster Streifen ab Zeile y0 abwärts: Länge len, 1–2 breit; Rand fällt zufällig ab. */
      const streak = (a: number, y0: number, len: number, tag: string): number[] => {
        const out: number[] = [];
        const dir = hash01(hashSeed(fseed, tag, 'd', a, y0), a, y0) < 0.5 ? -1 : 1;
        const wide = hash01(hashSeed(fseed, tag, 'w', a, y0), a, y0) < 0.4;
        for (let d = 1; d < len; d++) {
          out.push(to(a, y0 - d));
          if (wide && d >= 1 && d < len - 1 - Math.floor(hash01(hashSeed(fseed, tag, 'f', a, y0, d), a, d) * 2)) out.push(to(a + dir, y0 - d));
        }
        return out;
      };
      const lenBase = clamp(Math.round(2.6 + 2.2 * k), 3, 6);

      // Abplatzungen des Putzes: Sockelzeilen (Höhenverlauf) und Wandenden/Laibungen, der Stein darunter kommt hervor
      const pSpall = clamp(0.5 * kk, 0, 0.7);
      for (const c of cells) {
        if (c.mat !== 'plaster') continue;
        const end = isEnd(c.a, c.y);
        const rowP = c.ground === 0 ? 1 : c.ground === 1 ? 0.45 : c.ground === 2 ? 0.15 : 0;
        const nearFoot = rowP > 0;
        const p = (nearFoot ? rowP * pSpall * (end ? 1.8 : 0.6) : end ? pSpall * 0.05 : 0);
        if (p <= 0 || clusterU(hashSeed(fseed, 'spall'), c.a, c.y, PLINTH_NOISE) >= p) continue;
        add(to(c.a, c.y), 'spall', [to(c.a - 1, c.y), to(c.a + 1, c.y), to(c.a, c.y + 1), to(c.a + (hash01(hashSeed(fseed, 'sp', c.a, c.y), c.a, c.y) < 0.5 ? -1 : 1), c.y + 1)]);
      }

      // Sockel: Wuchsfläche mit Höhenverlauf am Boden; Spritzwasser/Erde bei Putz, Holz, Ton
      const pPlinth = clamp(0.45 * kk * moist, 0, 0.85);
      const colBase = new Map<number, FaceCell>();
      for (const c of cells) if (c.ground === 0 && (colBase.get(c.a) === undefined || c.y < colBase.get(c.a)!.y)) colBase.set(c.a, c);
      for (const [a, c] of [...colBase.entries()].sort((l, r) => l[0] - r[0])) {
        // Grün am Sockel (LV Schritt 6) nur auf Stein; der dunkle Sockelverlauf aller Materialien ist eine Tonzone (unten)
        if (c.mat !== 'stone') continue;
        const u = clusterU(hashSeed(fseed, 'plinth'), a, 0, PLINTH_NOISE);
        if (u >= pPlinth) continue;
        const u2 = hash01(hashSeed(fseed, 'ph', a), a, c.y);
        const hgt = 1 + (u2 < 0.6 ? 1 : 0) + (u2 < 0.25 ? 1 : 0) + (rich && u2 < 0.1 ? 1 : 0);
        const grow: number[] = [to(a - 1, c.y), to(a + 1, c.y)];
        for (let j = 1; j < hgt; j++) { grow.push(to(a, c.y + j)); if (u2 < 0.5) grow.push(to(a + (j % 2 === 0 ? 1 : -1), c.y + j)); }
        add(to(a, c.y), 'plinth', grow);
      }

      // Regenrinne: Tropfstreifen an den Wandenden unter Überhang/Traufe (das Schattenband selbst ist eine Tonzone, unten)
      for (const c of cells) {
        const [x, y, z] = c.pos;
        const above = kindAt.get(key3([x, y + 1, z]));
        const over = above === 'roof' || above === 'ceiling' || isSolid(x + nx, y + 1, z + nz);
        if (!over) continue;
        if (isEnd(c.a, c.y) && hash01(hashSeed(fseed, 'gutter', c.a, c.y), c.a, c.y) < clamp(0.4 * kk, 0, 0.9)) {
          add(to(c.a, c.y), 'drip', [to(c.a - 1, c.y), to(c.a + 1, c.y), ...streak(c.a, c.y, lenBase + 1, 'gut')]);
          continue;
        }
      }

      // Baumkontakt: Moos (Stein) bzw. feuchtes Dunkel (Putz, Holz, Ton) an Wand mit Laub/Stamm/Busch davor
      if (rich || k >= 0.5) {
        for (const c of cells) {
          if (!treeNear(c.pos[0], c.pos[1], c.pos[2], nx, nz)) continue;
          if (hash01(hashSeed(fseed, 'tree', c.a, c.y), c.a, c.y) >= clamp(0.75 * kk * moist, 0, 0.9)) continue;
          add(to(c.a, c.y), 'tree', [to(c.a, c.y + 1), to(c.a - 1, c.y), to(c.a + 1, c.y)]);
        }
      }

      // Kavität (Voxel-AO, DR3 A2): Innenecke, wo neben der Wandzelle ein Pfeiler/Erker/Strebe vorspringt – Schmutz und Feuchte sammeln sich
      const tx = alongX ? 1 : 0, tz = alongX ? 0 : 1;
      const pCav = clamp(0.16 * kk * moist, 0, 0.8);
      for (const c of cells) {
        const [x, y, z] = c.pos;
        const jut = (isSolid(x - tx + nx, y, z - tz + nz) ? 1 : 0) + (isSolid(x + tx + nx, y, z + tz + nz) ? 1 : 0);
        if (jut === 0) continue;
        const low = c.ground <= 1 ? 1 : 0.4; // bodennah und geschützt sammelt sich mehr
        if (hash01(hashSeed(fseed, 'cav', c.a, c.y), c.a, c.y) >= pCav * low * (jut === 2 ? 1.3 : 1)) continue;
        add(to(c.a, c.y), 'corner', [to(c.a, c.y + 1), to(c.a, c.y - 1)]);
      }

      const posOf = (i: number): Vec3 => {
        const a = minA + (i % w);
        const y = minY + Math.floor(i / w);
        return alongX ? [a, y, p] : [p, y, a];
      };
      // Cluster (Material-Ereignisse: Moos, Bruchstein, Abplatzung, Baum, Kavität, Regenrinne) zuerst – sie gewinnen vor den Tonzonen
      if (causes.length > 0) {
        const res = solveRaster(w, h, active, causes, hashSeed(fseed, 'wfc'), k, solver);
        stats.rasters++; stats.backtracks += res.backtracks; if (!res.ok) stats.rastersFailed++; if (res.rule) stats.rastersRule++;
        for (let i = 0; i < w * h; i++) {
          if (res.cls[i] === N || active[i] === 0) continue;
          changes.push({ pos: posOf(i), cls: res.cls[i]!, cause: res.type[i]!, plinth: (groundAt.get(i) ?? 9) <= 1, roof: false });
        }
      }

      // Tonzonen aus der Geometrie (LV „Texture like a pro“, Reihenfolge = Solver-Reihenfolge; DR3 A1/A9):
      //   (3) Schatten oben unter Traufe/Überstand, (3b) dunklere 3er-Kette unter Fenstern (Tropfeffekt),
      //   (4) Sockel dunkler, (5) randomisieren = Tonraster-WFC schwächt Zonen ab, Verlauf |Δ| ≤ 1 bleibt Pflicht.
      // Schritte (1)/(2) des Videos (Rücksprung dunkler, Kanten/Träger heller) gehören zur Grundtextur (TX-B), nicht hierher.
      const maxStep = rich ? 2 : 1;
      const target = new Uint8Array(w * h);
      const zcause = new Int8Array(w * h).fill(-1);
      const setZ = (i: number, st: number, cause: CauseKind): void => {
        if (i < 0 || active[i] === 0 || st <= target[i]!) return;
        target[i] = Math.min(st, maxStep);
        zcause[i] = causeCode(cause);
      };
      const COVER: ReadonlySet<ShellKind> = new Set<ShellKind>(['roof', 'ceiling', 'floor', ...WALLISH]);
      for (const c of cells) {
        const [x, y, z] = c.pos;
        const i = to(c.a, c.y);
        // (3) Abstand zur Deckung darüber: Dach/Decke in der Wand oder ein Überstand davor (Traufe, vorkragendes Geschoss)
        let dUp = 0;
        for (let d = 1; d <= 3 && dUp === 0; d++) {
          const ak = kindAt.get(key3([x, y + d, z]));
          if (ak === 'window') break;
          if (ak === 'roof' || ak === 'ceiling') { dUp = d; break; }
          const fk = isSolid(x + nx, y + d, z + nz) ? kindAt.get(key3([x + nx, y + d, z + nz])) : undefined;
          if (fk !== undefined && COVER.has(fk)) dUp = d;
        }
        if (dUp > 0) {
          const u = clusterU(hashSeed(fseed, 'top'), c.a, c.y, SHADE_NOISE);
          // Flecken, kein Band: das Rauschen dünnt die Zone aus, unter der Kante am dichtesten
          if (dUp === 1 && u < 0.55 + 0.25 * kk) setZ(i, u < 0.2 + 0.2 * kk ? 2 : 1, 'drip');
          else if (dUp === 2 && u < 0.15 + 0.25 * kk) setZ(i, 1, 'drip');
        }
        // (4) Sockel: unterste Reihe zwei Stufen, darüber eine; Oberkante je Spalte ausgefranst (Wert-Rauschen)
        if (c.ground <= 2) {
          const u = clusterU(hashSeed(fseed, 'foot'), c.a, 0, PLINTH_NOISE);
          const hgt = 1 + (u < 0.35 + 0.4 * kk ? 1 : 0) + (u < 0.2 * kk ? 1 : 0);
          if (c.ground === 0) setZ(i, 2, 'plinth');
          else if (c.ground < hgt) setZ(i, 1, 'plinth');
        }
      }
      // (3b) Unter jeder Fensterspalte eine dunklere Kette (Kopf zwei Stufen, dann eine): 3 Blöcke, ±1 je Fenster. Sie läuft nur
      // über Wandfläche derselben Ebene – unter Fenstern auf Riegel/Stockwerksbalken (Fachwerk, Vorkragung) entsteht keine Kette.
      // Unterkante jeder Fensteröffnung (auch in oberen Geschossen): Fensterzelle ohne Fenster direkt darunter
      const winAt = new Set<string>(windows.map((wc) => `${wc.a},${wc.y}`));
      const sills = windows.filter((wc) => !winAt.has(`${wc.a},${wc.y - 1}`)).sort((l, r) => l.y - r.y || l.a - r.a);
      const pWin = clamp(0.45 + 0.45 * kk, 0, 0.95);
      for (const { a, y } of sills) {
        const edge = !winAt.has(`${a - 1},${y}`) || !winAt.has(`${a + 1},${y}`);
        if (hash01(hashSeed(fseed, 'win', a, y), a, y) >= (edge ? pWin : pWin * 0.55)) continue;
        const len = 3 + (hash01(hashSeed(fseed, 'wl', a, y), a, y) < 0.3 ? -1 : 0) + (rich && hash01(hashSeed(fseed, 'wl2', a, y), y, a) < 0.3 ? 1 : 0);
        let d = 1;
        while (d <= 3 && (to(a, y - d) < 0 || active[to(a, y - d)] === 0)) d++; // Fensterbank/Laden überspringen
        if (d > 3) continue;
        for (let n = 0; n < len; n++) {
          const i = to(a, y - d - n);
          if (i < 0 || active[i] === 0) break;
          setZ(i, n === 0 ? 2 : 1, 'rain');
        }
      }
      const tres = solveTone(w, h, active, target, hashSeed(fseed, 'tone'), 0.55 + 0.25 * kk);
      if (tres.ok) stats.toneRasters++; else stats.toneFailed++;
      stats.backtracks += tres.backtracks;
      const seeded = new Set<number>();
      for (let i = 0; i < w * h; i++) {
        const t = tres.tone[i]!;
        if (t === 0 || zcause[i]! < 0) continue;
        const kind = CAUSE_KINDS[zcause[i]!]!;
        // Zählung: jede Zone ist ein Keim je Ursache und Ebene (Kennzahl „Cluster“)
        if (!seeded.has(zcause[i]!)) { seeded.add(zcause[i]!); stats.causes[kind]++; }
        changes.push({ pos: posOf(i), cls: t === target[i] ? C : T, cause: zcause[i]!, plinth: (groundAt.get(i) ?? 9) <= 1, roof: false, steps: t });
      }
    }
  }

  // ---------------------------------------------------------------- Dach: Verlauf Traufe → First
  {
    const topY = new Map<number, number>(); // Spalte → y der obersten, frei liegenden Dachzelle
    const col = (x: number, z: number): number => (x < ox || z < oz || x >= ox + sx || z >= oz + sz ? -1 : (x - ox) * sz + (z - oz));
    const colX = (c: number): number => ox + Math.floor(c / sz);
    const colZ = (c: number): number => oz + (c % sz);
    for (let x = ox; x < ox + sx; x++) for (let z = oz; z < oz + sz; z++) {
      for (let y = oy + sy - 1; y >= oy; y--) {
        if (solid[idx(x, y, z)] === 0) continue;
        if (kindAt.get(key3([x, y, z])) === 'roof' && isOut(x, y + 1, z) && weatherable([x, y, z])) topY.set(col(x, z), y);
        break;
      }
    }
    if (topY.size > 0) {
      stats.surfaceCells += topY.size;
      stats.rasters++; stats.rastersRule++;
      const rseed = hashSeed(seed, 'nwf', 'roof');
      const heightAt = (x: number, z: number): number => topY.get(col(x, z)) ?? Infinity;
      const cols = [...topY.keys()].sort((l, r) => l - r);
      // Zusammenhängende Dachflächen (Nachbarn höchstens eine Stufe Höhenunterschied) → relative Höhe 0 (Traufe) … 1 (First)
      const comp = new Map<number, number>();
      const range: [number, number][] = [];
      for (const c0 of cols) {
        if (comp.has(c0)) continue;
        const id = range.length;
        let lo = topY.get(c0)!, hi = lo;
        const q = [c0];
        comp.set(c0, id);
        for (let qi = 0; qi < q.length; qi++) {
          const c = q[qi]!;
          const x = colX(c), z = colZ(c);
          const y = topY.get(c)!;
          for (const [dx, dz] of DIRS4) {
            const cn = col(x + dx, z + dz);
            const yn = topY.get(cn);
            if (yn === undefined || comp.has(cn) || Math.abs(yn - y) > 1) continue;
            comp.set(cn, id); q.push(cn);
            if (yn < lo) lo = yn; if (yn > hi) hi = yn;
          }
        }
        range.push([lo, hi]);
      }
      const rel = (c: number): number => {
        const [lo, hi] = range[comp.get(c)!]!;
        return hi - lo < 2 ? 0.5 : (topY.get(c)! - lo) / (hi - lo);
      };
      const seenRoof = new Set<number>();
      const put = (c: number, cls: number, cause: CauseKind): void => {
        if (seenRoof.has(c)) return;
        seenRoof.add(c);
        stats.causes[cause]++;
        changes.push({ pos: [colX(c), topY.get(c)!, colZ(c)], cls, cause: causeCode(cause), plinth: false, roof: true });
      };

      // Schornstein: Ruß auf dem Dach ringsum
      for (const [cx, cz] of chimneyCols) {
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          const c = col(cx + dx, cz + dz);
          if (!topY.has(c) || seenRoof.has(c)) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dz));
          const u = hash01(hashSeed(rseed, 'soot', cx + dx, cz + dz), cx + dx, cz + dz);
          if (d <= 1 ? u < 0.85 : u < 0.5 * clamp(k, 0.5, 1.2)) put(c, d <= 1 ? C : T, 'soot');
        }
      }

      // Dachtäler (Kehlen) samt Wasserablauf abwärts bis zur Traufe
      const valleys: [number, number][] = [];
      shell.cells.forEach((cell, i) => {
        if (cell.kind !== 'roof' || contexts[i]?.roofLine !== 'valley') return;
        const [x, y, z] = cell.pos;
        if (topY.get(col(x, z)) === y) valleys.push([x, z]);
      });
      for (const [x, z] of valleys) {
        put(col(x, z), C, 'valley');
        for (const [dx, dz] of DIRS4) { const c = col(x + dx, z + dz); if (topY.has(c)) put(c, T, 'valley'); }
        if (!rich) continue;
        // Ablauf: 4er-Nachbar mit der niedrigsten Dachhöhe (Gleichstand: feste Richtungsreihenfolge)
        let cx = x, cz = z, y0 = heightAt(x, z);
        for (let step = 1; step <= 8; step++) {
          let best: readonly [number, number] | undefined;
          let bestH = y0;
          for (const [dx, dz] of DIRS4) {
            const hh = heightAt(cx + dx, cz + dz);
            if (hh < bestH) { bestH = hh; best = [dx, dz]; }
          }
          if (best === undefined) break;
          cx += best[0]; cz += best[1]; y0 = bestH;
          if (hash01(hashSeed(rseed, 'run', x, z, step), cx, cz) >= 0.92 ** step * clamp(0.5 + 0.5 * k, 0, 1)) break;
          put(col(cx, cz), C, 'valley');
        }
      }

      // Traufverlauf, Ecken, First, Baum über dem Dach
      const pEave = clamp(0.4 * kk, 0, 0.9);
      for (const c of cols) {
        if (seenRoof.has(c)) continue;
        const x = colX(c), z = colZ(c), y = topY.get(c)!;
        const r = rel(c);
        const free = DIRS4.filter(([dx, dz]) => !topY.has(col(x + dx, z + dz)) && inside(x + dx, oy, z + dz) && !isSolid(x + dx, y, z + dz)).length;
        if (rich) {
          let tree = false;
          for (let dy = 1; dy <= 4 && !tree; dy++) for (let dx = -1; dx <= 1 && !tree; dx++) for (let dz = -1; dz <= 1 && !tree; dz++) {
            const p: Vec3 = [x + dx, y + dy, z + dz];
            tree = isSolid(p[0], p[1], p[2]) && kindAt.get(key3(p)) === 'plant' && TREE_ROLE.test(roleAt.get(key3(p)) ?? '');
          }
          if (tree && hash01(hashSeed(rseed, 'rtree', x, z), x, z) < 0.7) { put(c, C, 'tree'); continue; }
        }
        const u = clusterU(hashSeed(rseed, 'grad'), x, z, ROOF_NOISE);
        // Feuchte sammelt sich unten: Wahrscheinlichkeit fällt mit der relativen Höhe; freie Kanten (Traufe/Giebelrand) zusätzlich
        const p = pEave * (1 - r) ** 1.8 * (free >= 1 ? 1.35 : 1) + (free >= 2 ? 0.12 * k : 0);
        if (u < p) put(c, C, free >= 2 && r > 0.35 ? 'corner' : 'eave');
        else if (u < p + 0.07) put(c, T, free >= 2 && r > 0.35 ? 'corner' : 'eave');
      }
    }
  }

  // ---------------------------------------------------------------- Blöcke setzen (eine Zelle höchstens einmal)
  const touched = new Set<string>();
  const bcWall: BlockCtx = { tones, underlay, roof: false };
  const bcRoof: BlockCtx = { tones, underlay, roof: true };
  for (const ch of changes) {
    const key = key3(ch.pos);
    if (touched.has(key)) continue;
    const state = volume.stateAt(ch.pos);
    const m = materialOf(tones, state.name);
    if (m === undefined) continue;
    const cause = CAUSE_KINDS[ch.cause]!;
    const pick = hash01(hashSeed(seed, 'nwp', ch.pos[0], ch.pos[1], ch.pos[2]), ch.pos[0], ch.pos[2]);
    const cur = stripNs(state.name);
    const mv = ch.steps !== undefined ? { move: { op: 'dark' as const, steps: ch.steps }, share: 1 } : moveFor(cause, ch.cls, m.mat, pick);
    if (mv === undefined) continue;
    // Übergang: nur ein Teil der Zellen wird getauscht (Dither), der Rest bleibt Grundton (Tonzonen sind schon randomisiert)
    if (ch.steps === undefined && ch.cls !== C && hash01(hashSeed(seed, 'nwq', ch.pos[0], ch.pos[1], ch.pos[2]), ch.pos[2], ch.pos[0]) >= mv.share) continue;
    const target = targetBlock(ch.roof ? bcRoof : bcWall, mv.move, m.mat, m.fs, cur, pick);
    if (target === undefined || target === cur) continue;
    // Eigenschaften des alten Blocks nur übernehmen, wenn der neue sie kennt (Pilzstiel → Stein: keine up/down/north …)
    const keep = m.fs !== undefined ? state.properties : {};
    const next = input.resolveState?.(target, keep);
    volume.replaceState(ch.pos, next !== undefined ? blockState(next.name, next.properties) : blockState(target, keep));
    touched.add(key);
    stats.changed++;
    stats.blocks[cause]++;
    stats.byMaterial[m.mat]++;
    if (ch.cls === C) { stats.changedCluster++; stats.byType[mv.move.op]++; } else stats.changedTransition++;
    if (ch.plinth) stats.plinthChanged++;
    if (ch.roof) stats.roofChanged++;
  }
  return done();
}
