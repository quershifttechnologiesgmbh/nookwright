/**
 * Mehrziel-Vorschläge (feat/pareto-proposals, WFC_ausschoepfung.md §4.2/4.3): statt drei Grundrisse der Reihe nach zu
 * zeigen, bewertet der Vorschlag einen **Kandidaten-Pool** (N Seeds) mit einem **Zielvektor** und wählt aus der
 * **Pareto-Front** drei beschriftete Vorschläge: „Am schönsten“, „Am praktischsten“, „Ausgewogen“.
 *
 * - **Spielbarkeit ist ein harter Filter, nie ein Abwägungsziel** (§4 „Schönheit kauft keine unerreichbare Tür“):
 *   jeder Raum vom Eingang erreichbar, jede obere Etage mit Treppe, alle Pflichtobjekte platziert. Kandidaten, die das
 *   verfehlen, kommen nie auf die Front.
 * - **Ziele** (alle 0–1, größer = besser) sind feste, benannte Merkmale aus vorhandenen Kennzahlen (Teilwerte von
 *   `furnishing/quality.ts`, Erschließungsbericht `circulation.ts`, Fensterachsen F4 aus `quality-f.ts`). Dazu die
 *   Rohwerte (`raw`), damit später ein Vergleichsmodell (Bradley-Terry, Bericht F_pareto_proposals.md §6) Gewichte
 *   darauf lernen kann – ohne die Merkmale zu ändern.
 * - Bewertet wird das **Haus ohne Umgebung**: Plan, Hülle, Einrichtung, Erschließung; ohne Materialisierung und
 *   Licht-Pass (die kosten 2–4× so viel und ändern die Ziele kaum; Messung im Bericht). Das eingerichtete Projekt ist
 *   dasselbe, das `building_generate` bzw. „Übernehmen“ mit diesem Seed baut.
 * - Rein und deterministisch: gleiche Eingabe, gleiche Wahl. Kein Zeitbudget (wäre nicht deterministisch), sondern
 *   eine feste Kandidatenzahl.
 */
import type { BuildingPlan } from '@mcda/archetype';
import type { BuildingTypeDef } from '@mcda/catalog';
import type { Project, Shell } from '@mcda/blueprint';
import type { RoomQuality } from '@mcda/furnishing';
import { circulation } from './circulation.js';
import { playabilityKinds, playabilityOf, type PlayabilityFinding, type PlayabilityIssue } from './playability.js';
import { furnishRoomsDetailed, shellFor, styleChainOf } from './house.js';
import { projectFromBuildingType, type BuildingTypeParams } from './buildingType.js';
import { planLayoutKey, withoutPilastersForTheme } from './rules.js';
import { windowRhythm } from './quality-f.js';
import { moodOption, placedFor, themeFor, type PipelineContext } from './world.js';

/** Ziele des Vektors. Reihenfolge = Spalten des Vektors (stabil halten: gelernte Gewichte hängen daran). */
export const PROPOSAL_OBJECTIVES = ['interior', 'facade', 'daylight', 'walkways', 'access', 'capacity', 'compact'] as const;
export type ProposalObjective = (typeof PROPOSAL_OBJECTIVES)[number];

/** Gruppe eines Ziels: „schön“ oder „praktisch“ (bestimmt die Wahl der beiden Rand-Vorschläge). */
export const OBJECTIVE_GROUP: Readonly<Record<ProposalObjective, 'beauty' | 'practical'>> = {
  interior: 'beauty', facade: 'beauty', daylight: 'beauty',
  walkways: 'practical', access: 'practical', capacity: 'practical', compact: 'practical',
};

/** Deutsche Namen der Ziele (UI, Begründung). */
export const OBJECTIVE_LABEL: Readonly<Record<ProposalObjective, string>> = {
  interior: 'stimmige Einrichtung',
  facade: 'gegliederte Fassade',
  daylight: 'viel Tageslicht',
  walkways: 'freie Laufwege',
  access: 'kurze Wege',
  capacity: 'viel Lager- und Arbeitsplatz',
  compact: 'kompakter Baukörper',
};

export type ScoreVector = Readonly<Record<ProposalObjective, number>>;

/** Rohwerte hinter den Zielen (für Bericht und späteres Lernen der Gewichte). */
export interface ProposalRaw {
  /** Innenfläche aller Räume ab Erdgeschoss (Zellen). */
  readonly area: number;
  readonly rooms: number;
  /** Fensterzellen der Hülle (Öffnungen × Höhe). */
  readonly windowCells: number;
  /** Profilzellen (`kind: facade`) je Wandzelle der Hülle. */
  readonly profileShare: number;
  /** F4: längste Folge gleicher Fensterachsen. */
  readonly f4: number;
  /** Lager (Truhe, Fass) und Arbeitsblöcke der Einrichtung. */
  readonly storage: number;
  readonly work: number;
  /** Mittlere Wegzeit vom Eingang (s) über alle Räume. */
  readonly meanSeconds: number;
  readonly corridorShare: number;
}


export interface ProposalCandidate {
  readonly seed: number;
  /** Der bewertete Plan (für die Karten: Maße, Räume, Hinweise). */
  readonly plan: BuildingPlan;
  /** Das eingerichtete Projekt (Plan übernommen, Räume eingerichtet) – dasselbe, das „Übernehmen“ baut (Test A6). */
  readonly project: Project;
  /** Grundriss-Schlüssel (`planLayoutKey`). */
  readonly layout: string;
  readonly scores: ScoreVector;
  readonly raw: ProposalRaw;
  /** Arten der Spielbarkeits-Befunde (leer = spielbar), aus der gemeinsamen Regel `playabilityOf` (W8-E). */
  readonly issues: readonly PlayabilityIssue[];
  /** Befunde mit Ort (für Hinweise wie „Pflichtobjekt fehlt: …“ und für `building_propose` ohne zweite Prüfung). */
  readonly findings: readonly PlayabilityFinding[];
}

export type ProposalLabel = 'beautiful' | 'practical' | 'balanced';
export const PROPOSAL_LABELS: readonly ProposalLabel[] = ['beautiful', 'practical', 'balanced'];
export const PROPOSAL_LABEL_TEXT: Readonly<Record<ProposalLabel, string>> = {
  beautiful: 'Am schönsten', practical: 'Am praktischsten', balanced: 'Ausgewogen',
};

export interface ProposalPick {
  /** Index in der Kandidatenliste. */
  readonly index: number;
  readonly label: ProposalLabel;
  /** Eine Zeile auf Deutsch: warum dieser Vorschlag. */
  readonly reason: string;
}

export interface ParetoResult {
  readonly candidates: readonly ProposalCandidate[];
  /** Indizes der spielbaren Kandidaten auf der Pareto-Front (aufsteigend). */
  readonly front: readonly number[];
  readonly picks: readonly ProposalPick[];
}

/** Standardgröße des Kandidaten-Pools (Messung Laufzeit/Nutzen im Bericht §5). */
export const PARETO_POOL = 8;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Truhe, Fass (Lager) und Arbeitsblöcke (Villager-Berufe, Handwerk). */
const STORAGE_BLOCKS: ReadonlySet<string> = new Set(['minecraft:chest', 'minecraft:trapped_chest', 'minecraft:barrel']);
const WORK_BLOCKS: ReadonlySet<string> = new Set([
  'minecraft:crafting_table', 'minecraft:furnace', 'minecraft:smoker', 'minecraft:blast_furnace', 'minecraft:anvil',
  'minecraft:chipped_anvil', 'minecraft:smithing_table', 'minecraft:stonecutter', 'minecraft:loom', 'minecraft:cartography_table',
  'minecraft:fletching_table', 'minecraft:grindstone', 'minecraft:brewing_stand', 'minecraft:lectern', 'minecraft:composter',
  'minecraft:cauldron', 'minecraft:enchanting_table',
]);

/** Teilwerte der Raumqualität je Ziel. */
const INTERIOR_PARTS: ReadonlySet<string> = new Set(['signature', 'preferences', 'zones', 'arrangement', 'vertical']);
const WALKWAY_PARTS: ReadonlySet<string> = new Set(['space', 'aisle']);

/** Flächengewichtetes Mittel der gewählten Teilwerte über alle Räume (Räume ohne diese Teile zählen nicht). */
function partMean(quality: ReadonlyMap<string, RoomQuality>, areas: ReadonlyMap<string, number>, parts: ReadonlySet<string>): number {
  let sum = 0;
  let weight = 0;
  for (const [id, q] of quality) {
    const vals = q.parts.filter((p) => parts.has(p.id)).map((p) => p.value);
    if (vals.length === 0) continue;
    const w = areas.get(id) ?? 1;
    sum += w * (vals.reduce((a, b) => a + b, 0) / vals.length);
    weight += w;
  }
  return weight === 0 ? 1 : sum / weight;
}

/** Isoperimetrischer Quotient im Raster je Etage (4·√A / Umfang; Quadrat = 1), flächengewichtet. */
function compactness(project: Project): number {
  const byFloor = new Map<number, Set<string>>();
  for (const r of project.state.rooms) {
    if (r.floorIndex < 0) continue;
    const set = byFloor.get(r.floorIndex) ?? byFloor.set(r.floorIndex, new Set()).get(r.floorIndex)!;
    for (const [x, z] of r.cells.toArray()) set.add(`${x},${z}`);
  }
  let sum = 0;
  let weight = 0;
  for (const cells of byFloor.values()) {
    let perimeter = 0;
    for (const k of cells) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (!cells.has(`${x + dx},${z + dz}`)) perimeter++;
    }
    if (perimeter === 0) continue;
    sum += cells.size * clamp01((4 * Math.sqrt(cells.size)) / perimeter);
    weight += cells.size;
  }
  return weight === 0 ? 1 : sum / weight;
}

/** Profilanteil der Hülle: Profilzellen (Sockel, Gesims, Rahmen …) je Wandzelle. */
function profileShare(shell: Shell): number {
  let wall = 0;
  let profile = 0;
  for (const c of shell.cells) {
    if (c.kind === 'facade') profile++;
    else if (c.kind === 'wall' || c.kind === 'pillar' || c.kind === 'window' || c.kind === 'door' || c.kind === 'lintel') wall++;
  }
  return wall === 0 ? 0 : profile / wall;
}

/**
 * Einen Kandidaten bewerten: Plan → Projekt → Hülle → Einrichtung → Erschließung → Zielvektor. Dieselben Schritte wie
 * `building_generate` (ohne Umgebung, Materialisierung und Licht-Pass).
 */
export function evaluateCandidate(def: BuildingTypeDef, params: BuildingTypeParams, seed: number, ctx: PipelineContext): ProposalCandidate {
  const res = projectFromBuildingType(def, { ...params, surroundings: false }, seed, ctx);
  const project = res.project;
  const { exterior: _exterior, ...build } = withoutPilastersForTheme(res.build, ctx.themes, project.state.themeId);
  const shell = shellFor(project, build, themeFor(project, ctx));
  const furnished = furnishRoomsDetailed(project, shell, ctx.catalog, { styles: styleChainOf(project, ctx), ...moodOption(project, ctx) });
  const report = circulation(shell, project, build.corridorTypes !== undefined ? { corridorTypes: build.corridorTypes } : {});
  const findings = playabilityOf(project, shell, report, furnished.quality, furnished.warnings);

  const rooms = project.state.rooms;
  const areas = new Map<string, number>(rooms.map((r) => [r.id, r.cells.size]));
  const area = rooms.filter((r) => r.floorIndex >= 0).reduce((s, r) => s + r.cells.size, 0);
  let storage = 0;
  let work = 0;
  for (const p of project.state.placements) {
    const placed = placedFor(p, ctx.catalog);
    for (const c of placed.cells) {
      const b = (c.mat as { readonly block?: string }).block;
      if (b !== undefined && STORAGE_BLOCKS.has(b)) storage++;
      else if (b !== undefined && WORK_BLOCKS.has(b)) work++;
    }
  }
  const windowCells = shell.cells.filter((c) => c.kind === 'window').length;
  const f4 = windowRhythm(shell);
  const profile = profileShare(shell);
  const travelled = report.rooms.filter((r) => !r.unreachable && !r.corridor);
  const meanSeconds = travelled.length === 0 ? 0 : travelled.reduce((s, r) => s + r.seconds, 0) / travelled.length;
  const storageTimes = report.stations.entries.flatMap((e) => (e.storageSeconds !== undefined ? [e.storageSeconds] : []));

  // Ziele 0–1. Schwellen aus den Berichten: Station weit ab 20 s (research/23), Profil-Zielband F1 ≥ 25 %
  // (research/58 §4), Fensterachsen F4 ≤ 3, Tageslicht 1 Fensterzelle je 6 Bodenzellen (research/42 Lichtlücke),
  // Kapazität 1 Truhe/Fass/Arbeitsblock je 5 Bodenzellen (gemessen 0,02–0,19 über die Bautypen, Bericht §3).
  const access = travelled.length === 0 ? 1
    : (travelled.reduce((s, r) => s + clamp01(1 - r.seconds / 20), 0) + storageTimes.reduce((s, t) => s + clamp01(1 - t / 20), 0))
      / (travelled.length + storageTimes.length);
  const scores: ScoreVector = {
    interior: r3(partMean(furnished.quality, areas, INTERIOR_PARTS)),
    facade: r3(0.5 * clamp01(profile / 0.25) + 0.5 * (f4 <= 3 ? 1 : 3 / f4)),
    daylight: r3(area === 0 ? 0 : clamp01((windowCells / area) * 6)),
    walkways: r3(partMean(furnished.quality, areas, WALKWAY_PARTS)),
    access: r3(access),
    capacity: r3(area === 0 ? 0 : clamp01((storage + work) / area / 0.2)),
    compact: r3(compactness(project)),
  };
  return {
    seed,
    plan: res.plan,
    project,
    layout: planLayoutKey(res.plan),
    scores,
    raw: {
      area, rooms: rooms.length, windowCells, profileShare: r3(profile), f4, storage, work,
      meanSeconds: r3(meanSeconds), corridorShare: r3(report.corridorShare),
    },
    // Spielbarkeit (harter Filter): die gemeinsame Regel von W8-E (u. a. Nebeneingang der Scheune zählt als Zugang)
    issues: playabilityKinds(findings),
    findings,
  };
}

/** Vektor als Zahlenreihe (Spalten = {@link PROPOSAL_OBJECTIVES}). */
export const vectorOf = (s: ScoreVector): number[] => PROPOSAL_OBJECTIVES.map((o) => s[o]);

/** a dominiert b: in keinem Ziel schlechter, in mindestens einem besser. */
export function dominates(a: readonly number[], b: readonly number[]): boolean {
  let better = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]! < b[i]!) return false;
    if (a[i]! > b[i]!) better = true;
  }
  return better;
}

/** Indizes der nicht dominierten Vektoren (aufsteigend); gleiche Vektoren bleiben beide. */
export function paretoFront(vectors: readonly (readonly number[])[]): number[] {
  return vectors.flatMap((v, i) => (vectors.some((w, j) => j !== i && dominates(w, v)) ? [] : [i]));
}

/** Kleinste Spanne der Normierung (0–1-Skala der Ziele). */
const MIN_SPREAD = 0.1;

/** Min-Max-Normierung je Ziel über die gegebenen Kandidaten, Spanne mindestens {@link MIN_SPREAD}. */
function normalizer(cands: readonly ProposalCandidate[]): (s: ScoreVector) => Record<ProposalObjective, number> {
  const lo = {} as Record<ProposalObjective, number>;
  const hi = {} as Record<ProposalObjective, number>;
  for (const o of PROPOSAL_OBJECTIVES) {
    lo[o] = Math.min(...cands.map((c) => c.scores[o]));
    hi[o] = Math.max(...cands.map((c) => c.scores[o]));
  }
  // Spanne mindestens MIN_SPREAD: sonst bekäme ein Ziel, das im Pool kaum schwankt (Laufwege 0,97–0,98), volles Gewicht
  // für Rauschen. Mit Untergrenze zählt ein Unterschied von 0,01 nur als 0,1. Bester Wert = 1, gleiche Werte = 1.
  return (s) => Object.fromEntries(PROPOSAL_OBJECTIVES.map((o) => [o, 1 - (hi[o] - s[o]) / Math.max(MIN_SPREAD, hi[o] - lo[o])])) as Record<ProposalObjective, number>;
}

const groupMean = (n: Readonly<Record<ProposalObjective, number>>, g: 'beauty' | 'practical'): number => {
  const os = PROPOSAL_OBJECTIVES.filter((o) => OBJECTIVE_GROUP[o] === g);
  return os.reduce((s, o) => s + n[o], 0) / os.length;
};
const pct = (v: number): string => `${Math.round(v * 100)} %`;

/** Begründung: die zwei Ziele der Gruppe, in denen der Vorschlag den Pool am deutlichsten übertrifft. */
function reasonFor(label: ProposalLabel, c: ProposalCandidate, pool: readonly ProposalCandidate[]): string {
  const mean = (o: ProposalObjective): number => pool.reduce((s, x) => s + x.scores[o], 0) / pool.length;
  if (label === 'balanced') {
    const weakest = PROPOSAL_OBJECTIVES.reduce((w, o) => (c.scores[o] - mean(o) < c.scores[w] - mean(w) ? o : w));
    const head = `Guter Kompromiss: schön ${pct(groupMean(c.scores, 'beauty'))}, praktisch ${pct(groupMean(c.scores, 'practical'))}`;
    return c.scores[weakest] < mean(weakest) - 0.02
      ? `${head}; kleiner Abstrich bei ${OBJECTIVE_LABEL[weakest]} (${pct(c.scores[weakest])}, Schnitt ${pct(mean(weakest))}).`
      : `${head}; in keinem Ziel unter dem Schnitt.`;
  }
  const group = label === 'beautiful' ? 'beauty' : 'practical';
  const best = PROPOSAL_OBJECTIVES.filter((o) => OBJECTIVE_GROUP[o] === group)
    .map((o) => ({ o, d: c.scores[o] - mean(o) }))
    .sort((a, b) => b.d - a.d || PROPOSAL_OBJECTIVES.indexOf(a.o) - PROPOSAL_OBJECTIVES.indexOf(b.o))
    // nur Ziele, in denen der Vorschlag wirklich über dem Schnitt liegt (≥ 1 Prozentpunkt); mindestens das beste
    .filter((x, k) => k === 0 || x.d >= 0.01)
    .slice(0, 2);
  const text = best.map(({ o }) => `${OBJECTIVE_LABEL[o]} ${pct(c.scores[o])} (Schnitt ${pct(mean(o))})`);
  return `${label === 'beautiful' ? 'Schönste Wahl' : 'Praktischste Wahl'}: ${text.join(', ')}.`;
}

/**
 * Drei beschriftete Vorschläge aus der Front der spielbaren Kandidaten:
 * - „Am schönsten“: größtes Mittel der Schön-Ziele (normiert), Gleichstand → Summe aller, dann Index;
 * - „Am praktischsten“: dasselbe für die Praktisch-Ziele;
 * - „Ausgewogen“: größtes Minimum über alle normierten Ziele (Chebyshev-Knie), Gleichstand → Summe, dann Index.
 * Schon gewählte Kandidaten sind ausgeschlossen. Reihenfolge der Auswahlmengen: Front mit neuem Grundriss, dann jeder
 * spielbare Kandidat mit neuem Grundriss (ein anderer Grundriss zählt für den Nutzer mehr als die Front – derselbe
 * Grundriss zweimal unterscheidet sich nur in der Einrichtung, W1-G/A8), dann Front, dann alle spielbaren; unspielbare nie. `count` > 3 hängt weitere nach dem Knie-Maß an.
 */
export function pickProposals(candidates: readonly ProposalCandidate[], count = 3): { front: number[]; picks: ProposalPick[] } {
  const playable = candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.issues.length === 0);
  if (playable.length === 0) return { front: [], picks: [] };
  const front = paretoFront(playable.map(({ c }) => vectorOf(c.scores))).map((k) => playable[k]!.i);
  const norm = normalizer(playable.map(({ c }) => c));
  const n = new Map(playable.map(({ c, i }) => [i, norm(c.scores)]));
  const sum = (i: number): number => PROPOSAL_OBJECTIVES.reduce((s, o) => s + n.get(i)![o], 0);
  const knee = (i: number): number => Math.min(...PROPOSAL_OBJECTIVES.map((o) => n.get(i)![o]));
  const keyOf: Record<ProposalLabel, (i: number) => number> = {
    beautiful: (i) => groupMean(n.get(i)!, 'beauty'),
    practical: (i) => groupMean(n.get(i)!, 'practical'),
    balanced: knee,
  };
  const picks: ProposalPick[] = [];
  const used = new Set<number>();
  const layouts = new Set<string>();
  const choose = (score: (i: number) => number): number | undefined => {
    const pools = [
      front.filter((i) => !used.has(i) && !layouts.has(candidates[i]!.layout)),
      playable.map(({ i }) => i).filter((i) => !used.has(i) && !layouts.has(candidates[i]!.layout)),
      front.filter((i) => !used.has(i)),
      playable.map(({ i }) => i).filter((i) => !used.has(i)),
    ];
    const pool = pools.find((p) => p.length > 0);
    if (pool === undefined) return undefined;
    return [...pool].sort((a, b) => score(b) - score(a) || sum(b) - sum(a) || a - b)[0];
  };
  const labels: ProposalLabel[] = [...PROPOSAL_LABELS.slice(0, Math.min(count, 3))];
  while (labels.length < count) labels.push('balanced');
  const pool = playable.map(({ c }) => c);
  for (const label of labels) {
    const i = choose(keyOf[label]);
    if (i === undefined) break;
    used.add(i);
    layouts.add(candidates[i]!.layout);
    picks.push({ index: i, label, reason: reasonFor(label, candidates[i]!, pool) });
  }
  return { front, picks };
}

/** Zusatz-Kandidaten, falls im Pool weniger als `count` spielbare liegen (wie die Reserve der bisherigen Vorschläge). */
export const PARETO_RESERVE = 6;

/** Reichen die spielbaren Kandidaten für `count` Vorschläge? */
export const enoughPlayable = (cands: readonly ProposalCandidate[], count: number): boolean =>
  cands.filter((c) => c.issues.length === 0).length >= count;

/**
 * Reserve nötig? Nur wenn der Pool **einige, aber zu wenige** spielbare Kandidaten hat. Ist im ganzen Pool keiner
 * spielbar, ist das systematisch (Review A3: Burg S, Wachturm L – `tower_room` 3 von 4), und die Reserve kostet nur
 * Zeit (Burg S 11–16 s) ohne Aussicht. Dann lieber sofort melden.
 */
export const needsReserve = (cands: readonly ProposalCandidate[], count: number): boolean => {
  const playable = cands.filter((c) => c.issues.length === 0).length;
  return playable > 0 && playable < count;
};

/** Deutscher Hinweis, wenn kein Kandidat spielbar ist (Engine-Warnung und App-Hinweis, gleicher Text). */
export function noPlayableNotice(candidates: readonly ProposalCandidate[]): string {
  const missing = candidates.some((c) => c.issues.includes('required_missing'));
  return `Keine spielbare Variante gefunden (${candidates.length} Kandidaten geprüft)${missing ? ' – ein Pflichtobjekt passt in keinem Grundriss' : ''}. `
    + 'Gezeigt werden die bisherigen Vorschläge; Größe oder Etagen ändern hilft meist.';
}

/**
 * Ganzer Ablauf für einen Kandidaten-Satz (Seeds in fester Reihenfolge, vom Aufrufer): bewerten, Front, drei Vorschläge.
 * Liegen im Pool einige, aber weniger als `count` spielbare Kandidaten, kommen der Reihe nach die `reserve`-Seeds dazu,
 * bis es reicht ({@link needsReserve}); ohne einen spielbaren bleibt es beim Pool, und `picks` ist leer.
 * App und Engine rufen dieselbe Regel auf (CLAUDE.md „App und Engine verhalten sich gleich“).
 */
export function paretoProposals(
  def: BuildingTypeDef, params: BuildingTypeParams, seeds: readonly number[], ctx: PipelineContext, count = 3, reserve: readonly number[] = [],
): ParetoResult {
  const candidates = seeds.map((seed) => evaluateCandidate(def, params, seed, ctx));
  for (const seed of reserve) {
    if (!needsReserve(candidates, count)) break;
    candidates.push(evaluateCandidate(def, params, seed, ctx));
  }
  const { front, picks } = pickProposals(candidates, count);
  return { candidates, front, picks };
}
