/**
 * W8-E „Spielbare Vorschläge“ (27.09.2026): harte Spielbarkeit eines Bautyp-Kandidaten – dieselbe Regel für den
 * Assistenten der App, `building_propose` der Engine und später die Pareto-Wahl (`feat/pareto-proposals`, dort
 * `playability` + `evaluateCandidate`, hierher gezogen, damit beide Zweige sie teilen).
 *
 * Spielbar heißt: es gibt einen Eingang, jeder Raum ist erreichbar (vom Haupteingang oder über einen eigenen
 * Nebeneingang wie die Scheune), jede obere Etage hat eine Treppe, und jedes Pflichtobjekt steht (Mindestzahl je
 * Eintrag, W8-E). Geprüft wird das Haus ohne Umgebung: Plan → Projekt → Hülle → Einrichtung → Erschließung, also genau
 * die Einrichtung, die `building_generate` bzw. „Übernehmen“ mit diesem Seed baut (ohne Materialisierung und Licht-Pass).
 * Rein und deterministisch.
 */
import type { BuildingTypeDef, Catalog } from '@mcda/catalog';
import type { Project, Shell } from '@mcda/blueprint';
import type { RoomQuality } from '@mcda/furnishing';
import { circulation, type CirculationReport } from './circulation.js';
import { furnishRoomsDetailed, shellFor, styleChainOf } from './house.js';
import { projectFromBuildingType, type BuildingTypeParams } from './buildingType.js';
import { withoutPilastersForTheme } from './rules.js';
import { themeFor, type PipelineContext } from './world.js';

/** Warum ein Kandidat nicht spielbar ist (Reihenfolge = Schwere für die Anzeige). */
export type PlayabilityIssue = 'no_entrance' | 'unreachable' | 'no_stairs' | 'required_missing';
export const PLAYABILITY_ISSUES: readonly PlayabilityIssue[] = ['no_entrance', 'unreachable', 'no_stairs', 'required_missing'];

/** Ein Befund mit Ort: Raum (Id, Raumtyp) und bei `required_missing` die Tags des fehlenden Pflichtobjekts. */
export interface PlayabilityFinding {
  readonly issue: PlayabilityIssue;
  readonly roomId?: string;
  readonly roomTypeId?: string;
  readonly tags?: readonly string[];
}

const MISSING = /Pflichtobjekt (\S+) passt nicht in den Raum/;

/**
 * Befunde aus fertig eingerichtetem Projekt, Hülle, Erschließungsbericht und Raumqualität. `warnings` sind die
 * Einrichtungs-Warnungen im Format von `furnishRoomsDetailed` („r4 (bedroom): Pflichtobjekt … passt nicht …“) – nur
 * für die Tags in der Meldung. Leer = spielbar. `_shell` bleibt für die Aufrufer; die Erreichbarkeit steht seit W12-E
 * ganz in `report` (jede Außentür zählt).
 */
export function playabilityOf(
  project: Project, _shell: Shell, report: CirculationReport, quality: ReadonlyMap<string, RoomQuality>, warnings: readonly string[] = [],
): PlayabilityFinding[] {
  const out: PlayabilityFinding[] = [];
  if (report.entrance === undefined) out.push({ issue: 'no_entrance' });
  // W12-E: `report.unreachable` zählt schon jede Außentür (auch den eigenen Nebeneingang der Scheune) – dieselbe Regel
  // wie Editor, Export und `building_generate` (vorher prüfte nur diese Stelle zusätzlich `reachableRooms`)
  const typeOf = (id: string): string | undefined => project.state.rooms.find((r) => r.id === id)?.roomTypeId;
  for (const id of report.unreachable) out.push({ issue: 'unreachable', roomId: id, ...opt('roomTypeId', typeOf(id)) });
  for (const f of report.stepless.upperWithoutStairs) out.push({ issue: 'no_stairs', roomId: String(f) });
  for (const [id, q] of quality) {
    if (!q.parts.some((p) => p.id === 'required' && p.value < 1)) continue;
    const tags = warnings.filter((w) => w.startsWith(`${id} (`)).map((w) => MISSING.exec(w)?.[1]).filter((t): t is string => t !== undefined);
    out.push({ issue: 'required_missing', roomId: id, ...opt('roomTypeId', typeOf(id)), tags: [...new Set(tags)] });
  }
  return out;
}

const opt = <K extends string>(k: K, v: string | undefined): { [P in K]?: string } => (v === undefined ? {} : ({ [k]: v } as { [P in K]?: string }));

/**
 * Spielbarkeit eines Bautyp-Kandidaten (Seed): baut das Haus ohne Umgebung wie `building_generate` und prüft es.
 * Leer = spielbar. App (mit Lage `at` des Assistenten) und Engine rufen dieselbe Funktion.
 */
export function playabilityIssues(def: BuildingTypeDef, params: BuildingTypeParams, seed: number, ctx: PipelineContext): PlayabilityFinding[] {
  const res = projectFromBuildingType(def, { ...params, surroundings: false }, seed, ctx);
  const project = res.project;
  const { exterior: _exterior, ...build } = withoutPilastersForTheme(res.build, ctx.themes, project.state.themeId);
  const shell = shellFor(project, build, themeFor(project, ctx));
  const furnished = furnishRoomsDetailed(project, shell, ctx.catalog, { styles: styleChainOf(project, ctx) });
  const report = circulation(shell, project, build.corridorTypes !== undefined ? { corridorTypes: build.corridorTypes } : {});
  return playabilityOf(project, shell, report, furnished.quality, furnished.warnings);
}

/** Nur die Arten (ohne Ort), in fester Reihenfolge – wie `ProposalCandidate.issues` im Pareto-Zweig. */
export const playabilityKinds = (findings: readonly PlayabilityFinding[]): PlayabilityIssue[] =>
  PLAYABILITY_ISSUES.filter((k) => findings.some((f) => f.issue === k));

/**
 * Hinweis auf Deutsch für Karte und API, z. B. „Pflichtobjekt fehlt: Himmelbett (Schlafzimmer)“. Namen aus dem Katalog:
 * Raumtyp-Name, für Tags der Name der ersten Komponente mit dem Tag. Leer bei spielbarem Kandidaten.
 */
export function playabilityText(findings: readonly PlayabilityFinding[], catalog?: Catalog): string {
  const room = (id: string | undefined): string | undefined => (id === undefined || catalog === undefined || !catalog.roomTypeIds().includes(id) ? id : catalog.roomType(id).name);
  const thing = (tag: string): string => {
    const first = tag.split('|')[0]!;
    return catalog?.byTags([first])[0]?.name ?? first;
  };
  const parts: string[] = [];
  const missing = findings.filter((f) => f.issue === 'required_missing');
  if (missing.length > 0) {
    parts.push(`Pflichtobjekt fehlt: ${missing.map((f) => {
      const what = (f.tags ?? []).map(thing).join(', ');
      const where = room(f.roomTypeId);
      return what === '' ? where ?? 'Raum' : where === undefined ? what : `${what} (${where})`;
    }).join('; ')}`);
  }
  if (findings.some((f) => f.issue === 'no_entrance')) parts.push('kein Eingang');
  const cut = findings.filter((f) => f.issue === 'unreachable');
  if (cut.length > 0) parts.push(`ohne Zugang: ${cut.map((f) => room(f.roomTypeId) ?? f.roomId).join(', ')}`);
  if (findings.some((f) => f.issue === 'no_stairs')) parts.push('Etage ohne Treppe');
  return parts.join(' · ');
}

/**
 * Vorschläge, spielbare zuerst (W8-E): Kandidaten in fester Reihenfolge wie `distinctPicks`, aber ein unspielbarer
 * Kandidat wird übersprungen wie ein Grundriss-Doppel und die Reserve füllt auf. `isPlayable(i)` wird nur gefragt,
 * wenn der Kandidat gezeigt würde (teuer: Einrichtung), und je Index höchstens einmal. Ist die Reserve erschöpft
 * (`exhausted`), füllen erst spielbare Doppel, dann unspielbare Kandidaten auf – nie still: sie stehen in `unplayable`.
 * Sind alle Kandidaten spielbar, ist das Ergebnis gleich `distinctPicks`.
 */
export function playablePicks(
  keys: readonly (string | undefined)[], count: number, isPlayable: (index: number) => boolean, exhausted = true,
): { readonly picks: number[]; readonly unplayable: number[] } {
  const memo = new Map<number, boolean>();
  const ok = (i: number): boolean => {
    let v = memo.get(i);
    if (v === undefined) memo.set(i, (v = isPlayable(i)));
    return v;
  };
  const seen = new Set<string>();
  const picked: number[] = [];
  const doubles: number[] = [];
  const bad: number[] = [];
  keys.forEach((k, i) => {
    if (picked.length >= count) return;
    if (k !== undefined && seen.has(k)) {
      doubles.push(i);
      return;
    }
    if (!ok(i)) {
      bad.push(i);
      return;
    }
    if (k !== undefined) seen.add(k);
    picked.push(i);
  });
  const unplayable: number[] = [];
  if (exhausted) {
    for (const i of doubles) if (picked.length < count && ok(i)) picked.push(i);
    for (const i of [...bad, ...doubles.filter((i) => memo.get(i) === false)].sort((a, b) => a - b)) {
      if (picked.length >= count) break;
      picked.push(i);
      unplayable.push(i);
    }
  }
  return { picks: picked.sort((a, b) => a - b), unplayable };
}

/** Zahl spielbarer verschiedener Grundrisse (für die Abbruchbedingung der Kandidatenschleife). */
export function playableDistinct(keys: readonly (string | undefined)[], playable: readonly (boolean | undefined)[]): number {
  return new Set(keys.flatMap((k, i) => (playable[i] === true ? [k ?? `\u0000${i}`] : []))).size;
}
