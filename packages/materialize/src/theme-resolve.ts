/**
 * Theme-Auflösung (Pipeline-Schritt 4c „Material“, plan/01 §6, research/12 §7.3/§7.4): Rolle + Form → Block-ID
 * der Zielversion.
 *
 * Reihenfolge je Rolle:
 *  1. `blocks[form]` des Themes (fester Block, per `migrateBlockName` in die Version übersetzt)
 *  2. Einträge der Rolle: `family` | `color` (→ `<farbe>_wool`, dann `color:<farbe>`) | `mix` | `gradient`
 *     (Gewichte an der Stelle t der Kontextachse, mit Jitter). Einträge, die die Form nicht DIREKT haben
 *     (auch nicht per `variant` oder Versions-Fallback), fallen heraus; die Gewichte werden neu normiert.
 *     Wahl: `noise.type = cluster` + Ort → gleichverteiltes Cluster-Rauschen (Anteile exakt, Flecken
 *     zusammenhängend); sonst wie bisher `Rng(mixSeed)` (Hülle: je Zelle, Komponente: je Platzierung).
 *  3. Hat KEIN Eintrag die Form: gewählter Eintrag → Versions-Fallbacks, Ersatzfamilien der Rolle (`fallback`),
 *     Lücken-Fallback der Plattform (`resolveMaterial`, z. B. calcite.stairs → quartz_stairs).
 * Scheitert alles → Fehler mit allen versuchten Wegen (nie still).
 *
 * Gesperrte Blöcke (W3-BL, additiv): Mit `bans` gilt ein gesperrter Block als „nicht vorhanden“ – dieselbe Kette wie
 * oben sucht Ersatz (feste Ersetzung des Nutzers zählt als vorhanden). Findet sie nichts, ersetzt `bans.substitute`
 * den Block, den die Auflösung ohne Sperren gewählt hätte. `ResolvedDetail.avoided` nennt den gesperrten Block, den
 * die Auflösung ohne Sperren gewählt hätte. Ohne `bans` ist alles bitgleich.
 */
import {
  THEME_GRADIENT_DEFAULTS, THEME_NOISE_DEFAULTS, gradientPalette, mixEntryKey,
  type GradientAxis, type ResolvedTheme, type ThemeColor, type ThemeGradient, type ThemeMixEntry, type ThemeRoleSpec,
} from '@mcda/catalog';
import { Rng, clusterU, hashSeed, pickIndexByU, type NoiseParams } from '@mcda/core';
import { normalizeId, resolveMaterial, type FamilyData, type Registry } from '@mcda/platform';
import type { MaterialResolution } from './types.js';

/** Formen, die sich gegenseitig vertreten dürfen (Holz hat planks = block, Stein nur block). */
const SHAPE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  planks: ['block'],
  block: ['planks'],
};

const BLOCKISH: ReadonlySet<string> = new Set(['block', 'planks']);

/** Ort einer Hüllzelle für das Cluster-Rauschen (Projekt-Seed, Ebene, 2D-Koordinaten in der Ebene). */
export interface PickLocation {
  readonly seed: number;
  readonly plane: number;
  readonly a: number;
  readonly b: number;
  /**
   * Additiv (research/30 K8): stabile Zell-`id`. Seit der K8-Reparatur (W2, P0-B S1) **kein** Feldname des Rauschens
   * mehr – das Feld hängt an der Ebene (hausrelativ), damit Nachbarzellen Flecken teilen. Die ID wirkt nur noch in
   * der weißen Wahl (`mixSeed`); das Feld bleibt für Aufrufer erhalten (Vertrag nur additiv).
   */
  readonly id?: number;
}

/** Eingabe der Wahl in Mischungen/Verläufen. */
export interface PickContext {
  /** Seed der weißen Wahl (bisheriges Verhalten; Hülle je Zelle, Komponente je Platzierung). */
  readonly mixSeed: number;
  /** Ort für Cluster-Rauschen und Verlaufs-Jitter; fehlt → weiße Wahl per `mixSeed`, kein Jitter. */
  readonly at?: PickLocation;
  /** Verlaufsparameter je Kontextachse; fehlende Achse → 0,5. */
  readonly t?: Readonly<Partial<Record<GradientAxis, number>>>;
  /**
   * t-Schrittweite je Achse = eine Reihe/ein Block in t-Einheiten (research/30 K2). Nur `gradient.fade`
   * braucht sie, um „Reihen“ in t umzurechnen; fehlt sie, gilt eine Reihe als 1 t-Einheit.
   */
  readonly tStep?: Readonly<Partial<Record<GradientAxis, number>>>;
  /**
   * Rauschfeld für dieses Pick (research/30 K3). Ohne Angabe gilt der Kanal der Rolle; hat auch die keinen,
   * ist das Feld der Rollenname (bisheriges Verhalten).
   */
  readonly channel?: string;
}

/** Auflösung mit der tatsächlich benutzten Familie/Form (für den Verwitterungs-Pass). */
export interface ResolvedDetail {
  readonly resolution: MaterialResolution;
  /** Familie und Form-Schlüssel des Blocks; fehlen bei festen Blöcken und Plattform-Ersatz. */
  readonly family?: string;
  readonly familyShape?: string;
  /** Additiv (W3-BL): gesperrter Block, den die Auflösung ohne Sperren gewählt hätte (nur mit Sperren). */
  readonly avoided?: string;
}

/** Sperr-Sicht für die Theme-Auflösung (W3-BL, `BanIndex` in `banned.ts`). */
export interface BlockAvailability {
  /** Erlaubt → der Block; gesperrt → feste Ersetzung oder `undefined` (= fehlt). */
  usable(name: string): string | undefined;
  /** Ersatz, wenn die Ersatzkette nichts Erlaubtes findet. */
  substitute(name: string): string | undefined;
  isBanned(name: string): boolean;
}

interface Hit {
  readonly block: string;
  readonly family: string;
  readonly familyShape?: string;
  readonly via: MaterialResolution['via'];
}

interface Weighted {
  readonly entry: ThemeMixEntry;
  readonly weight: number;
}

const JITTER_NOISE: NoiseParams = { type: 'cluster', scale: 2, octaves: 1, dither: 0 };
/** W9-G5 (`gradient.patch`): Flecken des Nachbartons – weich, 2–4 Blöcke groß, über Reihen hinweg zusammenhängend. */
const PATCH_NOISE: NoiseParams = { type: 'cluster', scale: 2.5, octaves: 2, dither: 0.05 };
/**
 * Wahlwert für `gradient.quantize: "ring"` (D1): fest der Median. Weil die Einträge in Tonordnung stehen und die
 * Gewichte entlang der Achse wandern, wechselt der gewählte Ton nur an wenigen Ringen und immer in einer Richtung –
 * kuratierte Bänder statt Zufallsstreifen, gleich für jede Dachfläche derselben Höhe.
 */
const RING_U = 0.5;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Gewichte je Stopp in Paletten-Reihenfolge, je Stopp auf Summe 1 normiert. */
function stopVectors(g: ThemeGradient, keys: readonly string[]): number[][] {
  return g.stops.map((s) => {
    const total = s.mix.reduce((n, e) => n + e.weight, 0);
    const byKey = new Map(s.mix.map((e) => [mixEntryKey(e), e.weight / total] as const));
    return keys.map((k) => byKey.get(k) ?? 0);
  });
}

/**
 * Gewichte der Nachbarstopps an der Stelle t (linear), optional mit **Übergangsbreite** (research/30 K2) und
 * `interpolate: 'ease'`.
 *
 * `fade` (Reihen) gerechnet in `step` (t-Einheiten je Reihe): der Übergang läuft nicht über den ganzen
 * Stopp-Abstand, sondern nur über `fade` Reihen um dessen Mitte – davor gilt Stopp a, danach Stopp b. Ohne
 * `fade` (oder wenn er den Abstand ausfüllt) ist das Ergebnis **bitgleich** zu vorher.
 */
function weightsAt(g: ThemeGradient, vectors: readonly (readonly number[])[], t: number, step = 1): number[] {
  const stops = g.stops;
  let i = 0;
  while (i < stops.length - 2 && t >= stops[i + 1]!.at) i++;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  const mode = g.interpolate ?? THEME_GRADIENT_DEFAULTS.interpolate;
  if (mode === 'step') return [...vectors[t >= b.at ? i + 1 : i]!];
  let f = b.at > a.at ? clamp01((t - a.at) / (b.at - a.at)) : 0;
  const fade = g.fade ?? 0;
  if (fade > 0 && b.at > a.at) {
    const w = Math.min(1, (fade * step) / (b.at - a.at));
    if (w < 1) f = clamp01((f - (1 - w) / 2) / w);
  }
  if (mode === 'ease') f = f * f * (3 - 2 * f);
  const wa = vectors[i]!;
  const wb = vectors[i + 1]!;
  return wa.map((w, k) => (1 - f) * w + f * wb[k]!);
}

/** Gewichte eines Verlaufs an der Stelle t, in Paletten-Reihenfolge (Stopps je auf Summe 1 normiert). */
export function gradientWeightsAt(g: ThemeGradient, keys: readonly string[], t: number, step = 1): number[] {
  return weightsAt(g, stopVectors(g, keys), t, step);
}

/** Positionsunabhängige Daten einer Rolle (einmal je Resolver berechnet). */
interface RolePlan {
  readonly entries: readonly ThemeMixEntry[];
  /** Feste Gewichte (family/color/mix) … */
  readonly weights?: readonly number[];
  /** … oder Stopp-Vektoren des Verlaufs. */
  readonly vectors?: readonly (readonly number[])[];
  readonly noise?: NoiseParams;
  /** Rauschfeld der Rolle (research/30 K3): fehlt = eigenes Feld über den Rollennamen. */
  readonly channel?: string;
  /** W4 (M6): Brettlänge – Wahl je Brett entlang `a`, je Reihe `b` versetzt. */
  readonly boards?: number;
  /** W12-D: Bretter entlang `b` (an der Wand senkrecht) statt entlang `a`. */
  readonly boardAxis?: 'a' | 'b';
}

export class ThemeResolver {
  private readonly plans = new Map<string, RolePlan>();
  private readonly hitCache = new Map<string, readonly (Hit | undefined)[]>();

  /** Dieselbe Auflösung ohne Sperren (nur mit `bans`): „was wäre es gewesen“ und letzter Ersatz-Weg. */
  private readonly plain: ThemeResolver | undefined;

  constructor(
    readonly theme: ResolvedTheme,
    private readonly families: FamilyData,
    private readonly registry: Registry,
    private readonly bans?: BlockAvailability,
  ) {
    this.plain = bans === undefined ? undefined : new ThemeResolver(theme, families, registry);
  }

  /** Block der Version, wie ihn die Auflösung benutzen darf (ohne Sperren: vorhanden → er selbst). */
  private usable(block: string): string | undefined {
    if (!this.registry.hasBlock(block)) return undefined;
    return this.bans === undefined ? block : this.bans.usable(block);
  }

  private role(role: string): ThemeRoleSpec {
    const spec = Object.hasOwn(this.theme.roles, role) ? this.theme.roles[role] : undefined;
    if (spec === undefined) throw new Error(`Theme '${this.theme.id}' kennt die Rolle '${role}' nicht`);
    return spec;
  }

  /** Hat das Theme diese Rolle? */
  hasRole(role: string): boolean {
    return Object.hasOwn(this.theme.roles, role);
  }

  /** Familie + Form direkt (inkl. Aliase), nur wenn der Block in der Registry existiert. */
  private direct(family: string, shape: string): { block: string; shape: string } | undefined {
    const f = Object.hasOwn(this.families.families, family) ? this.families.families[family] : undefined;
    if (f === undefined) return undefined;
    for (const s of [shape, ...(SHAPE_ALIASES[shape] ?? [])]) {
      const b = f.shapes[s];
      const u = b === undefined ? undefined : this.usable(b);
      if (u !== undefined) return { block: u, shape: s };
    }
    return undefined;
  }

  private hasFamily(family: string): boolean {
    return Object.hasOwn(this.families.families, family);
  }

  /** Ersatzfamilien für eine in dieser Version fehlende Familie: Theme zuerst, dann Plattform. */
  private versionAlternatives(family: string): readonly string[] {
    return [...(this.theme.versionFallbacks[family] ?? []), ...(this.families.versionFallbacks[family] ?? [])];
  }

  private colorFamilies(color: ThemeColor): string[] {
    return [`${color}_wool`, `color:${color}`];
  }

  /** Familie (+ Variante) direkt: Variante als Form der Familie (nur block), dann `<variant>_<family>`, dann Grundform. */
  private familyHit(family: string, shape: string, variant: string | undefined, via: Hit['via']): Hit | undefined {
    if (!this.hasFamily(family)) return undefined;
    if (variant !== undefined) {
      if (BLOCKISH.has(shape)) {
        const b = this.families.families[family]!.shapes[variant];
        const u = b === undefined ? undefined : this.usable(b);
        if (u !== undefined) return { block: u, family, familyShape: variant, via };
      }
      const vf = `${variant}_${family}`;
      const d = this.direct(vf, shape);
      if (d !== undefined) return { block: d.block, family: vf, familyShape: d.shape, via };
    }
    const d = this.direct(family, shape);
    return d !== undefined ? { block: d.block, family, familyShape: d.shape, via } : undefined;
  }

  /** Block eines Mischungs-Eintrags für die Form – nur direkte Wege (inkl. Variante, Versions-Fallback). */
  private entryHit(e: ThemeMixEntry, shape: string): Hit | undefined {
    if (e.block !== undefined) {
      if (!BLOCKISH.has(shape)) return undefined;
      const m = this.registry.migrateBlockName(e.block);
      const b = m === undefined ? undefined : this.usable(m);
      return b !== undefined ? { block: b, family: '(block)', via: 'block' } : undefined;
    }
    if (e.color !== undefined) {
      for (const fam of this.colorFamilies(e.color)) {
        const d = this.direct(fam, shape);
        if (d !== undefined) return { block: d.block, family: fam, familyShape: d.shape, via: 'direct' };
      }
      return undefined;
    }
    const fam = e.family!;
    const hit = this.familyHit(fam, shape, e.variant, 'direct');
    if (hit !== undefined || this.hasFamily(fam)) return hit;
    for (const alt of this.versionAlternatives(fam)) {
      const h = this.familyHit(alt, shape, e.variant, 'version_fallback');
      if (h !== undefined) return h;
    }
    return undefined;
  }

  private plan(role: string, spec: ThemeRoleSpec): RolePlan {
    let p = this.plans.get(role);
    if (p !== undefined) return p;
    const s = spec.noise;
    const kind = s?.type ?? THEME_NOISE_DEFAULTS.type;
    const noise: NoiseParams | undefined = s === undefined ? undefined
      : kind === 'cells'
        ? {
          type: 'cells',
          cell: s.cell ?? 3,
          joint: s.joint ?? 0,
          metric: s.metric ?? 'chebyshev',
          randomness: s.randomness ?? 0.15,
        }
        : kind === 'cluster'
          ? {
            type: 'cluster',
            scale: s.scale ?? THEME_NOISE_DEFAULTS.scale,
            octaves: s.octaves ?? THEME_NOISE_DEFAULTS.octaves,
            dither: s.dither ?? THEME_NOISE_DEFAULTS.dither,
            ...(s.shear !== undefined ? { shear: s.shear } : {}),
          }
          : undefined;
    const withNoise = noise !== undefined ? { noise } : {};
    const withChannel = {
      ...(s?.channel !== undefined ? { channel: s.channel } : {}),
      ...(s?.boards !== undefined ? { boards: s.boards } : {}),
      ...(s?.boards !== undefined && s.boardAxis === 'b' ? { boardAxis: 'b' as const } : {}),
    };
    if (spec.family !== undefined) p = { entries: [{ family: spec.family, weight: 1 }], weights: [1] };
    else if (spec.color !== undefined) p = { entries: [{ color: spec.color, weight: 1 }], weights: [1] };
    else if (spec.mix !== undefined) p = { entries: spec.mix, weights: spec.mix.map((e) => e.weight), ...withNoise };
    else {
      const pal = gradientPalette(spec.gradient!);
      p = { entries: pal.entries, vectors: stopVectors(spec.gradient!, pal.keys), ...withNoise };
    }
    this.plans.set(role, { ...p, ...withChannel });
    return this.plans.get(role)!;
  }

  /** Direkte Treffer aller Einträge der Rolle für die Form (positionsunabhängig, gecacht). */
  private hits(role: string, plan: RolePlan, target: string): readonly (Hit | undefined)[] {
    const key = `${role}\u0000${target}`;
    let h = this.hitCache.get(key);
    if (h === undefined) {
      h = plan.entries.map((e) => this.entryHit(e, target));
      this.hitCache.set(key, h);
    }
    return h;
  }

  /** Einträge der Rolle mit Gewichten an dieser Stelle (Reihenfolge = Tonreihenfolge des Themes). */
  private weighted(role: string, spec: ThemeRoleSpec, plan: RolePlan, pick: PickContext): readonly number[] {
    if (plan.weights !== undefined) return plan.weights;
    const g = spec.gradient!;
    // W5 (W2): `facade_h` fehlt nur Aufrufern ohne Hüllkontext (Komponenten mit Capture) – dort gilt die Wandhöhe
    let t = pick.t?.[g.along] ?? (g.along === 'facade_h' ? pick.t?.wall_h : undefined) ?? 0.5;
    // D1 (W2): `quantize: "ring"` – eine Reihe ist ein Ring, ohne Jitter (sonst franst die Reihe wieder aus)
    const jitter = g.quantize === 'ring' ? 0 : (g.jitter ?? THEME_GRADIENT_DEFAULTS.jitter);
    if (pick.at !== undefined && jitter > 0) {
      // K8-Reparatur (W2, P0-B S1): Feld = Ebene (hausrelativ), nicht die Zell-ID – sonst franst jede Zelle für sich
      const j = clusterU(hashSeed(pick.at.seed, 'jitter', role, pick.at.plane), pick.at.a, pick.at.b, JITTER_NOISE);
      t = clamp01(t + jitter * (2 * j - 1));
    }
    return weightsAt(g, plan.vectors!, t, pick.tStep?.[g.along] ?? 1);
  }

  /** Gleichverteilter Wahlwert aus dem Cluster-Rauschen; `undefined` = weiße Wahl per mixSeed. */
  private clusterValue(role: string, plan: RolePlan, pick: PickContext): number | undefined {
    if (pick.at === undefined || plan.noise === undefined) return undefined;
    const { seed, plane } = pick.at;
    let a = pick.at.a;
    let b = pick.at.b;
    // W4 (27.09.2026, Review M6): Dielen – alle Blöcke eines Bretts (`boards` lang entlang a) teilen den Wahlwert, die
    // Bretter jeder Reihe b sind um einen festen Betrag je Reihe versetzt (keine durchgehenden Stoßfugen)
    // W12-D: `boardAxis: 'b'` – dieselbe Regel mit vertauschten Achsen (senkrechte Bretter, je Spalte a versetzt)
    if (plan.boards !== undefined && plan.boardAxis === 'b') {
      const off = hashSeed(seed, 'boards', plane, a) % plan.boards;
      b = Math.floor((b + off) / plan.boards);
    } else if (plan.boards !== undefined) {
      const off = hashSeed(seed, 'boards', plane, b) % plan.boards;
      a = Math.floor((a + off) / plan.boards);
    }
    // K8-Reparatur (W2, P0-B S1): Saat des Rauschfelds ist die **Ebene** der Fläche, nie die Zell-ID. Mit der ID
    // bekam jede Zelle ihr eigenes Feld, Nachbarn teilten keine Flecken mehr (Dach-Sprenkel 42 → 62 %). Die
    // Verschiebe-Stabilität kommt aus hausrelativen Koordinaten (Ebene und a/b, `shellContext` mit `relative`).
    // K3: Ein Kanal ERSETZT den Rollennamen als Feldnamen, damit zwei Rollen mit gleichem Kanal auf demselben
    // Feld liegen (z. B. Wand und Fundament). Ohne Kanal bleibt der Seed-Aufbau bitgleich zu vorher.
    const channel = pick.channel ?? plan.channel;
    const s = channel !== undefined ? hashSeed(seed, 'channel', channel, plane) : hashSeed(seed, 'noise', role, plane);
    return clusterU(s, a, b, plan.noise);
  }

  private choose<T extends { readonly weight: number }>(items: readonly T[], u: number | undefined, mixSeed: number): T {
    if (items.length === 1) return items[0]!;
    if (u !== undefined) return items[pickIndexByU(items.map((i) => i.weight), u)]!;
    return new Rng(mixSeed).weighted(items, (i) => i.weight);
  }

  /**
   * Rolle + Form → Block. `pick` bestimmt die Wahl in Mischungen/Verläufen: Zahl = `mixSeed` (weiße Wahl,
   * bisheriges Verhalten), sonst `PickContext` mit Ort (Cluster-Rauschen) und Verlaufsparametern.
   */
  resolve(role: string, shape: string, pick: number | PickContext = 0): MaterialResolution {
    return this.resolveDetailed(role, shape, pick).resolution;
  }

  resolveDetailed(role: string, shape: string, pick: number | PickContext = 0): ResolvedDetail {
    if (this.plain === undefined) return this.resolveWith(role, shape, pick);
    // W3-BL: Mit Sperren zusätzlich die Auflösung ohne Sperren – sie nennt den vermiedenen Block und ist der letzte Weg
    let plain: ResolvedDetail | undefined;
    try {
      plain = this.plain.resolveDetailed(role, shape, pick);
    } catch {
      plain = undefined;
    }
    let got: ResolvedDetail;
    try {
      got = this.resolveWith(role, shape, pick);
    } catch (e) {
      const sub = plain === undefined ? undefined : this.bans!.substitute(plain.resolution.block);
      if (plain === undefined || sub === undefined) throw e;
      got = { resolution: { ...plain.resolution, block: sub } };
    }
    const was = plain?.resolution.block;
    return was !== undefined && was !== got.resolution.block && this.bans!.isBanned(was) ? { ...got, avoided: was } : got;
  }

  private resolveWith(role: string, shape: string, pick: number | PickContext): ResolvedDetail {
    const ctx: PickContext = typeof pick === 'number' ? { mixSeed: pick } : pick;
    const spec = this.role(role);
    const fixed = spec.blocks?.[shape];
    if (fixed !== undefined) {
      const migrated = this.registry.migrateBlockName(fixed);
      if (migrated === undefined) throw new Error(`Theme '${this.theme.id}': ${role}.${shape} → ${fixed} existiert in ${this.registry.version} nicht`);
      const block = this.usable(migrated) ?? this.bans?.substitute(migrated) ?? migrated;
      return { resolution: { role, shape, block, family: '(block)', via: 'block' } };
    }
    const target = spec.shapes?.[shape] ?? shape;
    const plan = this.plan(role, spec);
    const weights = this.weighted(role, spec, plan, ctx);
    const hits = this.hits(role, plan, target);
    // D1 (W2): ganze Ringe – je Reihe derselbe Wahlwert (Median der Gewichte), kein Rauschen innerhalb der Reihe
    const u = spec.gradient?.quantize === 'ring' ? RING_U : this.clusterValue(role, plan, ctx);
    const all: Weighted[] = [];
    // 2. Einträge mit direktem Block für die Form
    const eligible: (Weighted & { hit: Hit })[] = [];
    plan.entries.forEach((entry, i) => {
      const weight = weights[i]!;
      if (weight <= 0) return;
      all.push({ entry, weight });
      const hit = hits[i];
      if (hit !== undefined) eligible.push({ entry, weight, hit });
    });
    if (eligible.length > 0) {
      let { hit } = this.choose(eligible, u, ctx.mixSeed);
      // W9-G5: Flecken des Nachbartons im Ring (`gradient.patch`, ≤ 10 % je Reihe) – nur mit Ort
      const patch = spec.gradient?.quantize === 'ring' ? spec.gradient.patch ?? 0 : 0;
      if (patch > 0 && ctx.at !== undefined) {
        const v = clusterU(hashSeed(ctx.at.seed, 'patch', role, ctx.at.plane), ctx.at.a, ctx.at.b, PATCH_NOISE);
        if (v < patch) {
          const i = hits.indexOf(hit);
          const next = [i + 1, i - 1].map((j) => hits[j]).find((h): h is Hit => h !== undefined && h.block !== hit.block);
          if (next !== undefined) hit = next;
        }
      }
      return {
        resolution: { role, shape, block: hit.block, family: hit.family, via: hit.via },
        ...(hit.family !== '(block)' ? { family: hit.family } : {}),
        ...(hit.familyShape !== undefined ? { familyShape: hit.familyShape } : {}),
      };
    }

    // 3. Kein Eintrag hat die Form: Fallback-Kette wie bisher über den gewählten Eintrag
    const chosen = all.length > 0 ? this.choose(all, u, ctx.mixSeed).entry : undefined;
    const primary = chosen === undefined ? [] : chosen.family !== undefined ? [chosen.family] : chosen.color !== undefined ? this.colorFamilies(chosen.color) : [];
    const tried: string[] = [];
    for (const fam of primary) {
      tried.push(this.hasFamily(fam) ? `${fam}.${target}` : `${fam} (fehlt in ${this.registry.version})`);
    }
    if (chosen?.block !== undefined) tried.push(`${chosen.block} (nur Form block)`);
    // Ersatzfamilie **mit der passenden Form** (research/27 „Befund für Welle D“): Eine Familie kann es in der
    // Zielversion geben, aber ohne diese Form – Wolle und Beton bekommen Treppen/Stufen erst in 26.3, und
    // `color:gray.stairs` findet dann in 1.21.11 nichts, obwohl `color:gray` existiert. Deshalb werden die
    // Versions-Ersatzfamilien hier auch für **vorhandene** Familien durchsucht (vor den Ersatzfamilien der Rolle
    // und dem Plattform-Rückfall); für Familien ohne Ersatzliste ändert das nichts.
    for (const fam of primary) {
      for (const alt of this.versionAlternatives(fam)) {
        const d = this.direct(alt, target);
        if (d !== undefined) return { resolution: { role, shape, block: d.block, family: alt, via: 'version_fallback' }, family: alt, familyShape: d.shape };
        tried.push(`${alt}.${target} (Versions-Fallback für ${fam})`);
      }
    }
    for (const fam of spec.fallback ?? []) {
      const b = this.direct(fam, target)?.block ?? this.versionAlternatives(fam).map((a) => this.direct(a, target)?.block).find((x) => x !== undefined);
      if (b !== undefined) return { resolution: { role, shape, block: b, family: fam, via: 'role_fallback' } };
      tried.push(`${fam}.${target} (Ersatzfamilie)`);
    }
    for (const fam of primary) {
      const r = resolveMaterial(this.families, fam, target);
      const u = r === undefined ? undefined : this.usable(r.block);
      if (r !== undefined && u !== undefined) return { resolution: { role, shape, block: u, family: r.family, via: 'platform_fallback' } };
    }
    throw new Error(`Theme '${this.theme.id}': Rolle '${role}' + Form '${shape}' in ${this.registry.version} nicht auflösbar (versucht: ${tried.join(', ')})`);
  }

  /** Blockname einer Form-Variante (`mossy`, `cracked`) zu Familie + Form, falls es sie in der Version gibt. */
  variantOf(family: string, familyShape: string, variant: string): string | undefined {
    if (BLOCKISH.has(familyShape)) {
      const f = Object.hasOwn(this.families.families, family) ? this.families.families[family] : undefined;
      const b = f?.shapes[variant];
      const u = b === undefined ? undefined : this.usable(b);
      if (u !== undefined) return u;
    }
    return this.direct(`${variant}_${family}`, familyShape)?.block;
  }

  /** Item-Rolle (`food.baked`) → Item-ID der Version; Auswahl per `rng`. */
  resolveItem(role: string, rng: Rng): string {
    const list = this.theme.items[role];
    if (list === undefined || list.length === 0) throw new Error(`Theme '${this.theme.id}' kennt die Item-Rolle '${role}' nicht`);
    const available = list.map(normalizeId).filter((i) => this.registry.hasItem(i));
    if (available.length === 0) throw new Error(`Item-Rolle '${role}': keines von ${list.join(', ')} existiert in ${this.registry.version}`);
    return rng.pick(available);
  }
}

/** Seed für Mischungen: Hülle pro Zelle, Komponenten pro Platzierung. */
export function mixSeed(seed: number, role: string, ...key: ReadonlyArray<string | number>): number {
  return hashSeed(seed, 'mix', role, ...key);
}
