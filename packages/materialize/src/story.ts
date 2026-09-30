/**
 * Story-Spuren (Q5/P15, research/55 §2/§3, Bericht64): **dieselbe Geometrie, andere Geschichte**. Dieser Pass
 * ändert **nie** Belegung, Rolle, Form oder Physik-Klasse einer Zelle – er tauscht nur Blöcke der Hüllzellen gegen
 * Varianten derselben Familie/Form. Damit bleiben Grundriss, Türen, Wege und Lichtplan unberührt; die
 * Erreichbarkeits-Zusagen aus P15 B gelten per Konstruktion.
 *
 * Aufbau – **wiederverwendet** wird die vorhandene ursachenbezogene Verwitterung (`weathering.ts`, Moos an
 * Feuchte/Niedrigkeit, Risse an Kanten), nicht neu gebaut:
 *
 * 1. **Materialbezogen** (Bericht64/Mojang „Cave Story“: „vergraute ehemalige Farben, verrottetes Holz und
 *    verblasste Pracht“). Die Materialklasse kommt aus den Plattform-Familien (`Family.kind`):
 *      - **Stein** (`stone`, `other`) → Flechten (`mossy`) und Risse (`cracked`) über die vorhandenen
 *        `variantOf`-Wege (nur wo die Familie diese Form hat – Tuff/Holz/Schiefer bleiben unberührt);
 *      - **Holz** (`wood`) → entrindet/vergraut (`stripped_log`/`stripped_wood` derselben Familie; Vanilla hat kein
 *        faules Holz, `stripped_*` ist die gebleichte Schwester des Stamms);
 *      - **Farbflächen** (`dye` gesetzt: `color:*`, `*_wool`, `*_terracotta`, `*_concrete`, `*_glass`) →
 *        **Vergrauung** in die graue Schwesterfamilie derselben Form (`red_wool` → `gray_wool`);
 *      - **Kupfer** (`copper`) → nächste Oxidationsstufe („verblasste Pracht“), nur wo die Form existiert.
 *
 * 2. **Ortsbezogen** (research/55 §3.1–§3.12): Die Spuren hängen an Tätigkeit, nicht am Zufall –
 *      - **Laufspur am Eingang** (Boden/Decke direkt an einer Tür, `doorDist ≤ 2`): Moos × 0,35, Risse × 1,25;
 *      - **feuchte Basis** (Wandreihe unten, Wandfuß am Boden, Traufe): Moos × 1,25–1,4;
 *      - **Arbeitsräume** (Werkstatt, Küche, Schmiede, Bibliothek …): „bewohnt/neu“ pflegt (× 0,6), „verlassen/
 *        verfallen“ verwahrlost (× 1,3) – der Vorrat am Arbeitsplatz als Zustandssignal.
 *
 * 3. **Deterministisch aus dem Projekt-Seed**: jede Entscheidung kommt aus `hashSeed`/`clusterU` (Projekt-Seed,
 *    Kanal, Zell-`id` bzw. Ebene + 2D-Koordinaten) – kein `Math.random`. K8: mit stabilen Zell-`id`s hängen die
 *    Spuren an der Zelle und bleiben beim Verschieben stehen.
 *
 * **Vertrag „additiv“:** ohne `MaterializeOptions.storyState` wird dieser Pass nie aufgerufen; alle Prüfsummen
 * bleiben bitgleich (Netz in `packages/pipeline/test/story-state.test.ts`).
 */
import type { StoryState } from '@mcda/blueprint';
import { clusterU, hash01, hashSeed, type NoiseParams } from '@mcda/core';
import { resolveMaterial, type FamilyData, type Registry } from '@mcda/platform';
import type { CellContext } from './context.js';
import type { ResolvedDetail, ThemeResolver } from './theme-resolve.js';
import { weatherCell, type WeatheringSettings } from './weathering.js';

/**
 * Faktoren je Zustand. `bewohnt` ist der **Referenzzustand** (Faktor 1 = die Verwitterung des Themes); `neu`
 * nimmt Spuren weg, `verlassen`/`verfallen` verstärken sie, `belagert` verschiebt sie auf Risse statt Bewuchs
 * (research/55 §3.6: Brandspuren und Improvisation, wenig Pflege).
 */
export interface StoryProfile {
  /** Faktor auf das Alter der vorhandenen Verwitterung. */
  readonly age: number;
  /** Faktor auf den Moos-Kanal für Stein (Flechten/Bemoosung). */
  readonly stoneMoss: number;
  /** Faktor auf den Riss-Kanal für Stein. */
  readonly stoneCracks: number;
  /** Anteil entrindeter/vergrauter Holzzellen (0–1). */
  readonly wood: number;
  /** Anteil vergrauter Farbflächen (0–1). */
  readonly accent: number;
  /** Pflege-Faktor für Arbeitsräume („Vorrat am Arbeitsplatz“): < 1 gepflegt, > 1 verwahrlost. */
  readonly work: number;
  /**
   * Additiv (Stimmung, Review F_theme_moods B3): Faktor auf alle Spuren an **Innenböden und -decken** (Boden/Decke eines
   * Raums, nicht unter einer Außenwand). Bewohnte Räume werden begangen und gefegt – große entrindete Flecken im
   * Dielenboden wirken sonst wie ein Fehler. Fehlt = 1 (die benannten Zustände bleiben unverändert).
   */
  readonly interiorFloor?: number;
  /**
   * Additiv (Stimmung, Review F_theme_moods): Kupfer oxidiert je **Fläche** ganz oder gar nicht (eine Dachfläche altert als
   * Ganzes) statt fleckig je Zelle. Fehlt = zellweise wie bisher.
   */
  readonly copperWhole?: boolean;
}

/** Zustandsprofile (research/55 §3.1–§3.12, Bericht64). Öffentlich, damit Tests und Bericht dieselbe Quelle lesen. */
export const STORY_PROFILES: Readonly<Record<StoryState, StoryProfile>> = {
  neu: { age: 0.15, stoneMoss: 0.2, stoneCracks: 0.3, wood: 0, accent: 0, work: 0.5 },
  bewohnt: { age: 1, stoneMoss: 1, stoneCracks: 1, wood: 0.15, accent: 0.1, work: 0.6 },
  verlassen: { age: 1.6, stoneMoss: 1.8, stoneCracks: 1.3, wood: 0.55, accent: 0.5, work: 1.3 },
  verfallen: { age: 2.6, stoneMoss: 2.6, stoneCracks: 2.2, wood: 1, accent: 0.85, work: 1.4 },
  belagert: { age: 1.3, stoneMoss: 0.5, stoneCracks: 1.6, wood: 0.35, accent: 0.6, work: 1.1 },
};

/**
 * feat/theme-moods: „wie im Theme“ – Faktoren 1 und kein materialbezogener Verfall. Ausgangspunkt der Stimmung ohne
 * benannten Zustand; `wear` schiebt von hier stufenlos Richtung `neu` (−1) bzw. `verfallen` (+1).
 */
export const STORY_NEUTRAL: StoryProfile = { age: 1, stoneMoss: 1, stoneCracks: 1, wood: 0, accent: 0, work: 1 };

/**
 * Story-Profil aus Stimmungsachse `wear` (−1 ordentlich … +1 verwittert) über einem Ausgangszustand: lineare
 * Mischung vom Ausgangsprofil (Zustand oder `STORY_NEUTRAL`) zum Profil `neu` bzw. `verfallen`, Anteil |wear|.
 * `wear = 0` liefert das Ausgangsprofil selbst. Rein, keine Zufallszahl.
 */
/** Faktor der Stimmung auf Spuren an Innenböden und -decken (B3, gemessen in `F_theme_moods.md` §10). */
export const MOOD_INTERIOR_FLOOR = 0.15;

export function moodStoryProfile(state: StoryState | undefined, wear: number): StoryProfile {
  const from = state === undefined ? STORY_NEUTRAL : STORY_PROFILES[state];
  const w = wear < -1 ? -1 : wear > 1 ? 1 : wear;
  if (w === 0) return from;
  const to = STORY_PROFILES[w < 0 ? 'neu' : 'verfallen'];
  const t = Math.abs(w);
  const mix = (a: number, b: number): number => a + (b - a) * t;
  return {
    age: mix(from.age, to.age), stoneMoss: mix(from.stoneMoss, to.stoneMoss), stoneCracks: mix(from.stoneCracks, to.stoneCracks),
    wood: mix(from.wood, to.wood), accent: mix(from.accent, to.accent), work: mix(from.work, to.work),
    // B3: Innenböden/-decken nur schwach (bewohnt heißt begangen), Kupfer altert je Fläche
    interiorFloor: MOOD_INTERIOR_FLOOR, copperWhole: true,
  };
}

/**
 * Alter, wenn das Theme **keine** eigene Verwitterung mitbringt (`decor.weathering`). Der Story-Zustand ist ein
 * ausdrücklich gewählter Zustand; er darf auch auf Themes wirken, die von Haus aus „neu“ aussehen. Die Zahl
 * entspricht dem Alter des mittelalterlichen Themes, damit „bewohnt“ über Themes hinweg vergleichbar bleibt.
 */
export const STORY_BASE_AGE = 0.3;

/** Arbeitsräume, in denen Spuren an Tätigkeit gebunden sind (research/55 §3.1/§3.4/§3.7/§3.10/§3.11). */
const WORK_ROOM_TYPES: ReadonlySet<string> = new Set([
  'alchemy', 'armory', 'bakery', 'brewhouse', 'butchery', 'carpentry', 'enchanting_tower', 'infirmary',
  'kitchen', 'library', 'map_room', 'observatory', 'pottery', 'smithy', 'storage', 'study', 'weaving_room',
  'wine_cellar', 'workshop_redstone',
]);

/** Rauschfeld der Story-Spuren: eigener Kanal, damit Moos/Risse der Verwitterung und Story-Spuren getrennt liegen. */
const STORY_NOISE: NoiseParams = { type: 'cluster', scale: 2.5, octaves: 2, dither: 0.08 };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Ortseinflüsse einer Zelle (deterministisch, allein aus dem Kontext). */
export interface StoryPlace {
  readonly age: number;
  readonly moss: number;
  readonly cracks: number;
  readonly decay: number;
}

/** Ortseinflüsse: Laufspur an der Tür, feuchte Basis, Traufe, Pflege im Arbeitsraum. */
export function storyPlace(ctx: CellContext, profile: StoryProfile): StoryPlace {
  let age = 1;
  let moss = 1;
  let cracks = 1;
  let decay = 1;
  // Laufspur am Eingang: der Weg zur Tür wird begangen – Moos bleibt weg, Abnutzung (Risse) steigt.
  const nearDoor = Number.isFinite(ctx.doorDist) ? ctx.doorDist <= 2 : ctx.door === true;
  if (nearDoor && (ctx.surface === 'floor' || ctx.surface === 'ceiling')) {
    moss *= 0.35;
    cracks *= 1.25;
    decay *= 1.2;
  }
  // Feuchte Basis: unterste Wandreihe und Wandfuß am Boden (dort steht Spritzwasser).
  const lowWall = (ctx.t.wall_h ?? 1) < 0.2;
  if (ctx.surface === 'wall' && (ctx.exterior || ctx.kind === 'wall') && lowWall) {
    moss *= 1.4;
    decay *= 1.15;
  }
  if (ctx.surface === 'floor' && ctx.wallDist === 0) {
    moss *= 1.25;
    decay *= 1.1;
  }
  // Traufe: Wasser läuft an der Dachkante – dort sitzt der Bewuchs zuerst (vgl. `weatheringChance`).
  if (ctx.surface === 'roof' && (ctx.t.roof_t ?? 1) < 0.25) moss *= 1.25;
  // Arbeitsraum: „Vorrat am Arbeitsplatz“ – gepflegt oder verwahrlost, je Zustand.
  if (ctx.roomType !== undefined && WORK_ROOM_TYPES.has(ctx.roomType)) {
    const work = profile.work;
    moss *= work;
    decay *= work;
  }
  return { age, moss, cracks, decay };
}

/** Materialklassen der Story-Spuren (aus `Family.kind` + `dye`). */
export type StoryClass = 'stone' | 'wood' | 'accent' | 'copper' | 'other';

/** Materialklasse einer Familie; `'(block)'`/unbekannt → `other` (keine Story-Spur). */
export function storyClass(family: string | undefined, families: FamilyData): StoryClass {
  if (family === undefined || family === '(block)') return 'other';
  const f = Object.hasOwn(families.families, family) ? families.families[family] : undefined;
  if (f === undefined) return 'other';
  if (f.kind === 'wood') {
    // Laub/Setzlinge sind Holz-Familienmitglieder, aber keine Baufläche – nur echte Holzformen altern
    return 'wood';
  }
  if (f.kind === 'copper') return 'copper';
  if (f.dye !== undefined) return 'accent';
  if (f.kind === 'stone' || f.kind === 'other') return 'stone';
  return 'other';
}

/** Entrindete/vergraute Form derselben Holzfamilie (Vanilla hat kein faules Holz). */
const WOOD_DECAY_SHAPE: Readonly<Record<string, string>> = {
  block: 'stripped_wood', planks: 'stripped_wood', wood: 'stripped_wood', log: 'stripped_log',
};

/** Nächste Oxidationsstufe des Kupfers („verblasste Pracht“, Bericht64). */
const COPPER_NEXT: Readonly<Record<string, string>> = {
  copper: 'weathered_copper', exposed_copper: 'weathered_copper', weathered_copper: 'oxidized_copper',
};

/** Grautöne, die schon „vergraut“ sind (dort passiert nichts). */
const GREY_DYES: ReadonlySet<string> = new Set(['gray', 'light_gray']);

/**
 * Graue Schwesterfamilie derselben Farbfläche: `red_wool` → `gray_wool`, `light_blue_terracotta` →
 * `gray_terracotta`, `color:red` → `color:gray`. `undefined`, wenn es sie nicht gibt (dann bleibt der Block).
 */
function greySister(family: string, dye: string, data: FamilyData): string | undefined {
  const target = family.startsWith('color:')
    ? 'color:gray'
    : family.startsWith(`${dye}_`) ? `gray_${family.slice(dye.length + 1)}` : undefined;
  return target !== undefined && Object.hasOwn(data.families, target) ? target : undefined;
}

/** Ziel (Familie, Form) einer Verfalls-Variante für eine aufgelöste Hüllzelle; `undefined` = keine. */
export function decayTarget(family: string, shape: string, data: FamilyData): { readonly family: string; readonly shape: string } | undefined {
  const f = Object.hasOwn(data.families, family) ? data.families[family] : undefined;
  if (f === undefined) return undefined;
  if (f.kind === 'wood') {
    const s = WOOD_DECAY_SHAPE[shape];
    return s !== undefined ? { family, shape: s } : undefined;
  }
  if (f.kind === 'copper') {
    const next = COPPER_NEXT[family];
    return next !== undefined ? { family: next, shape } : undefined;
  }
  if (f.dye !== undefined && !GREY_DYES.has(f.dye)) {
    const g = greySister(family, f.dye, data);
    return g !== undefined ? { family: g, shape } : undefined;
  }
  return undefined;
}

/** Umgebung des Story-Passes (Plattform-Daten der Zielversion). */
export interface StoryPlatform {
  readonly families: FamilyData;
  readonly registry: Registry;
}

/** Ergebnis einer Story-Variante: der Block und der benutzte Kanal (für Bericht/Tests). */
export interface StoryHit {
  readonly block: string;
  readonly via: 'mossy' | 'cracked' | 'decay';
}

/**
 * Wahrscheinlichkeit einer Verfalls-Variante (Holz/Farbfläche/Kupfer) an dieser Zelle: Anteil des Zustands ×
 * Ortsfaktor × Materialfaktor (Stein hat keinen eigenen Anteil – dort wirkt der Moos-/Riss-Kanal).
 */
export function storyDecayChance(profile: StoryProfile, cls: StoryClass, place: StoryPlace): number {
  const base = cls === 'wood' ? profile.wood : cls === 'accent' || cls === 'copper' ? profile.accent : 0;
  return clamp01(base * place.decay);
}

/**
 * Story-Variante einer Hüllzelle; `undefined` = Block bleibt.
 *
 * Reihenfolge: zuerst die **vorhandene** Verwitterung mit den Story-Faktoren (Flechten/Risse), dann – nur wenn
 * dort nichts wechselte – der materialbezogene Verfall (Holz/Farbfläche/Kupfer). So wechselt jede Zelle höchstens
 * einmal, und die bestehende Verwitterung behält Vorrang („weiterverwenden, nicht neu bauen“).
 */
export function storyWeatherCell(
  state: StoryState | StoryProfile,
  base: WeatheringSettings | undefined,
  storyRoles: ReadonlySet<string>,
  ctx: CellContext,
  seed: number,
  role: string,
  detail: ResolvedDetail,
  resolver: ThemeResolver,
  platform: StoryPlatform,
): StoryHit | undefined {
  const profile = typeof state === 'string' ? STORY_PROFILES[state] : state;
  const place0 = storyPlace(ctx, profile);
  const inner = profile.interiorFloor !== undefined && (ctx.surface === 'floor' || ctx.surface === 'ceiling') && ctx.roomId !== undefined && !ctx.exterior;
  const f = inner ? profile.interiorFloor! : 1;
  const place = inner ? { age: place0.age, moss: place0.moss * f, cracks: place0.cracks * f, decay: place0.decay * f } : place0;
  const cls = storyClass(detail.family, platform.families);
  // 1. Flechten (Stein) und Risse über die vorhandene Verwitterung, material- und ortsbezogen skaliert.
  const settings: WeatheringSettings = {
    age: (base?.age ?? STORY_BASE_AGE) * profile.age * place.age,
    moss: (base?.moss ?? 1) * (cls === 'stone' ? profile.stoneMoss : profile.stoneMoss * 0.4) * place.moss,
    cracks: (base?.cracks ?? 1) * (cls === 'stone' ? profile.stoneCracks : profile.stoneCracks * 0.5) * place.cracks,
    fade: base?.fade ?? 0,
    // Rollen: die des Themes, wenn es welche nennt – sonst alle Rollen der Hülle. Der Wechsel selbst bleibt
    // materialgebunden (`variantOf` findet nur, was die Familie wirklich hat).
    roles: base?.roles ?? storyRoles,
    // W4 (27.09.2026, W2-FC §8 Punkt 3): „Innenseiten nicht verwittern“ (Baustandard I1) gilt auch im Zustand –
    // vorher fiel das Feld hier weg, und mit `storyState` verwitterten Wände mit Raum dahinter weiter
    ...(base?.interiorFaces !== undefined ? { interiorFaces: base.interiorFaces } : {}),
  };
  const aged = weatherCell(settings, ctx, seed, role, detail, resolver);
  if (aged !== undefined) return { block: aged.block, via: aged.variant };
  // 2. Materialbezogener Verfall (Holz entrindet, Farbfläche grau, Kupfer oxidiert) – nur mit aufgelöster Familie.
  // Nur Bauteile: Gelände- und Pflanzenzellen (Bodendecke, Laub, Blütenblätter) sind kein Baumaterial. Ihre Deko-Richtung
  // passt nicht zu entrindetem Holz (Achse) – mit Farbwelten (W8-C: z. B. Bodendecke aus Planken) scheiterte sonst die
  // Materialisierung („orient.facing passt nicht“, palette-terrain).
  if (ctx.kind === 'terrain' || ctx.kind === 'plant') return undefined;
  const family = detail.family;
  const shape = detail.familyShape;
  if (family === undefined || shape === undefined) return undefined;
  const chance = storyDecayChance(profile, cls, place);
  if (chance <= 0) return undefined;
  const target = decayTarget(family, shape, platform.families);
  if (target === undefined) return undefined;
  if (cls === 'copper' && profile.copperWhole === true) {
    // ganze Fläche oder nichts: ein Wurf je Ebene statt Cluster-Rauschen (kein Fleckenteppich auf dem Kupferdach)
    if (hash01(hashSeed(seed, 'story', 'copper', ctx.plane), 0, 0) >= chance) return undefined;
  } else {
    // K8-Reparatur (W2, P0-B S1): Feld = Ebene der Fläche (mit stabilen IDs hausrelativ), nicht die Zell-ID
    const u = clusterU(hashSeed(seed, 'story', 'decay', ctx.plane), ctx.a, ctx.b, STORY_NOISE);
    const dither = hash01(hashSeed(seed, 'story', 'fade', ctx.plane), ctx.a, ctx.b);
    // Weiche Randzone wie in der Verwitterung (research/30 K2): gerader Rand wirkt „gesetzt“, ausgefranst „gewachsen“.
    if (!zone(u, chance, dither)) return undefined;
  }
  const r = resolveMaterial(platform.families, target.family, target.shape);
  if (r === undefined || !platform.registry.hasBlock(r.block)) return undefined;
  if (r.block === detail.resolution.block) return undefined;
  return { block: r.block, via: 'decay' };
}

/** Dreizonen-Schwelle der Story-Spuren (0,75 p … 1,25 p ausgefranst), Vorbild `weathering.zoneHit`. */
function zone(u: number, p: number, dither: number): boolean {
  const pIn = p * 0.75;
  const pOut = Math.min(1, p * 1.25);
  if (u < pIn) return true;
  if (u >= pOut) return false;
  return dither < (pOut - u) / (pOut - pIn);
}
