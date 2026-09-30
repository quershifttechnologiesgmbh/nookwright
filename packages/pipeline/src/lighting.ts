/**
 * Licht-Pass (research/02 §7.12, plan/01 §4.8 Regel `spawnSafe`): ERGÄNZT Lichtquellen, bis jede begehbare
 * Zelle eines Raums Blocklicht ≥ 1 hat (Monster spawnen in der Oberwelt nur bei Blocklicht 0, Faktencheck 5)
 * und – wenn der Raumtyp es wünscht – das Stimmungs-Ziel `lighting.minLevel` erreicht.
 *
 * Je Runde: materialisieren → Blocklicht jeder begehbaren Zelle messen (echte BFS aus `materialize`) →
 * je Raum gierig Lichtquellen wählen → als automatische Platzierungen ergänzen (`supplementFurnishing`) →
 * die nächste Runde misst wieder (höchstens `maxRounds`). Mit `exterior` (C4) zählen Außen-Laternen mit, die durch
 * Fenster und Türen hereinleuchten.
 *
 * Wahl: dunkelste Zelle zuerst; Lichtquellen-Arten in der Wunsch-Reihenfolge des Raumtyps (Standard:
 * Deckenlaterne über freier Fläche → Wandlicht → Kerzen auf vorhandener Abstellfläche → Stehlampe).
 * Innerhalb einer Art gewinnt der größte geschätzte Zugewinn (Level − Manhattan-Abstand, ohne Verdeckung –
 * die nächste Runde korrigiert Schätzfehler). Posen prüft `RoomPlanner` mit den harten Regeln des Solvers.
 * Deterministisch: aller Zufall kommt aus dem Raum-Seed.
 */
import type { PlacementDraft, Project, RoomId, RoomShellInfo, Shell } from '@mcda/blueprint';
import { isLightFixture, lightBudget, type ComponentDef, type MaterialSpec, type RoomTypeDef } from '@mcda/catalog';
import { Rng, hashSeed, key3, type Vec3 } from '@mcda/core';
import type { ExteriorPlacement } from '@mcda/exterior';
import { RoomPlanner, analyzeRoom, planLayout, type PlacedComponent } from '@mcda/furnishing';
import { ThemeResolver, WorldView, banIndexOf, emission, isWalkable, type PlatformView } from '@mcda/materialize';
import { blockState } from '@mcda/voxel';
import { furnishingGeometry } from './geometry.js';
import { materializeWorld, placedFor, themeFor, type PipelineContext, type World } from './world.js';

export interface LightingOptions {
  /** Höchstzahl der Runden (je Runde eine Materialisierung). Standard 4. */
  readonly maxRounds?: number;
  /** Höchstzahl neuer Lichtquellen je Raum und Runde. Standard 12. */
  readonly maxPerRound?: number;
  /** Stimmungs-Ziel des Raumtyps anstreben (Standard true); false = nur Spawn-Schutz (Blocklicht ≥ 1). */
  readonly mood?: boolean;
  /** Nur diese Räume (Standard: alle). */
  readonly roomIds?: readonly RoomId[];
  /**
   * Additiv (C4): Außen-Komponenten (X1) mitmessen – Wand- und Traufenlaternen leuchten durch Fenster und Türen in die
   * Räume, der Pass ergänzt dort weniger Lichter. Sie werden in jeder Runde mit materialisiert (auch in `world`). Fehlt
   * bzw. leer = Messung wie bisher (bitgleich).
   */
  readonly exterior?: readonly ExteriorPlacement[];
  /**
   * Additiv (Erklärvideo, 27.09.2026): Beobachter je Runde und Raum – gemessenes Blocklicht jeder begehbaren Zelle
   * (`measure`), ergänzte Lichter (`added`) und die Endmessung (`final`). Nur lesend; ohne die Option wie vorher.
   */
  readonly trace?: (event: LightTraceEvent) => void;
}

/** Ereignisse für `LightingOptions.trace` (Zellen: Position und Blocklicht wie im Pass gemessen). */
export type LightTraceEvent =
  | { readonly type: 'measure'; readonly round: number; readonly roomId: RoomId; readonly target: number; readonly cells: readonly { readonly pos: Vec3; readonly level: number }[] }
  | { readonly type: 'added'; readonly round: number; readonly roomId: RoomId; readonly drafts: readonly PlacementDraft[] }
  | { readonly type: 'final'; readonly roomId: RoomId; readonly target: number; readonly cells: readonly { readonly pos: Vec3; readonly level: number }[] };

export interface RoomLightReport {
  readonly roomId: RoomId;
  /** Angestrebtes Mindest-Blocklicht (1 = nur Spawn-Schutz). */
  readonly target: number;
  /** Vom Licht-Pass ergänzte Platzierungen. */
  readonly added: number;
  readonly walkableCells: number;
  /** Begehbare Zellen mit Blocklicht 0 (dort können Monster spawnen). */
  readonly darkCells: number;
  /** Begehbare Zellen unter dem Ziel. */
  readonly belowTarget: number;
  /** Kleinstes Blocklicht einer begehbaren Zelle (15 ohne begehbare Zellen). */
  readonly minLevel: number;
}

export interface LightingResult {
  /** Welt nach dem letzten Ergänzen. */
  readonly world: World;
  /** Runden, in denen etwas ergänzt wurde. */
  readonly rounds: number;
  readonly rooms: readonly RoomLightReport[];
  /** Räume, die trotz Licht-Pass dunkle begehbare Zellen behalten. */
  readonly warnings: readonly string[];
  /** Stimmungs-Ziel nicht überall erreicht (kein Sicherheitsproblem). */
  readonly notes: readonly string[];
}

/** Standard-Reihenfolge der Lichtquellen-Arten (Tags), wenn der Raumtyp keine nennt. */
export const DEFAULT_LIGHT_PREFERENCE: readonly string[] = ['light_ceiling', 'light_wall', 'light_small', 'light_floor'];

const DEFAULTS = { maxRounds: 4, maxPerRound: 12 } as const;
/** Wertung einer Lichtpose an einem Anker-Möbel (W3-IN, `lighting.anchors`): bevorzugte Lichtpunkte. */
const ANCHOR_BONUS = 1.5;

interface LitCell {
  readonly pos: Vec3;
  level: number;
}

interface Emitter {
  readonly pos: Vec3;
  readonly level: number;
}

interface LightCandidate {
  readonly def: ComponentDef;
  readonly variantId: string | undefined;
  readonly placed: PlacedComponent;
  readonly emitters: readonly Emitter[];
  readonly parentKey?: string;
  readonly socketId?: string;
}

/**
 * Ergänzt Lichtquellen in den Räumen des Projekts (Aggregat-Befehl `supplementFurnishing`) und liefert die
 * Welt nach dem letzten Schritt. Erwartet eingerichtete Räume (`furnishRooms`) und die passende Hülle.
 */
export function lightRooms(project: Project, shell: Shell, ctx: PipelineContext, opts: LightingOptions = {}): LightingResult {
  const maxRounds = opts.maxRounds ?? DEFAULTS.maxRounds;
  const maxPerRound = opts.maxPerRound ?? DEFAULTS.maxPerRound;
  const s = project.state;
  const platform = ctx.platform(s.targetVersion.name);
  // W3-BL: mit gesperrten Blöcken schätzt der Pass die Lichtarten so, wie die Materialisierung sie ersetzt
  const bans = banIndexOf(platform);
  const emissions = new EmissionTable(new ThemeResolver(themeFor(project, ctx), platform.families, platform.registry, bans), platform);
  const ids = (opts.roomIds ?? s.rooms.map((r) => r.id)).filter((id) => shell.rooms.has(id));
  const added = new Map<RoomId, number>();
  /** Fehlbetrag (Summe der Level unter dem Ziel) je Raum nach der letzten Runde mit Ergänzungen. */
  const lastDeficit = new Map<RoomId, number>();
  const lastLightTags = new Map<RoomId, readonly string[]>();
  const failedLightTags = new Map<RoomId, Set<string>>();

  const exterior = opts.exterior ?? [];
  let world = materializeWorld(project, ctx, shell, exterior);
  let rounds = 0;
  for (let round = 1; round <= maxRounds; round++) {
    const view = new WorldView(world.materialized.volume, platform);
    let changed = false;
    for (const id of ids) {
      const geom = shell.rooms.get(id)!;
      const target = targetLevel(roomTypeOf(project, id, ctx), opts.mood !== false);
      const cells = measure(world, view, geom);
      opts.trace?.({ type: 'measure', round, roomId: id, target, cells: cells.map((c) => ({ pos: c.pos, level: c.level })) });
      const deficit = cells.reduce((sum, c) => sum + Math.max(0, target - c.level), 0);
      if (deficit === 0) continue;
      // Q1a: Verdeckung kann den geschätzten Gewinn einer Lichtart zunichtemachen (Burgkerker).
      // Dann diese Art ausschließen und die nächste versuchen, statt dieselben Lichter anzuhäufen
      // oder trotz verfügbarer Alternativen mit einer dunklen Spawn-Zelle abzubrechen.
      const failed = failedLightTags.get(id) ?? new Set<string>();
      if (deficit >= (lastDeficit.get(id) ?? Infinity)) {
        const previousSize = failed.size;
        for (const tag of lastLightTags.get(id) ?? []) failed.add(tag);
        if (failed.size === previousSize) continue;
        failedLightTags.set(id, failed);
      }
      lastDeficit.set(id, deficit);
      const drafts = planRoom(project, id, geom, cells, target, round, maxPerRound, ctx, emissions, failed);
      if (drafts.length === 0) continue;
      lastLightTags.set(id, drafts.flatMap((draft) => ctx.catalog.get(draft.componentId).tags));
      project.supplementFurnishing(id, drafts);
      opts.trace?.({ type: 'added', round, roomId: id, drafts });
      added.set(id, (added.get(id) ?? 0) + drafts.length);
      changed = true;
    }
    if (!changed) break;
    rounds = round;
    world = materializeWorld(project, ctx, shell, exterior);
  }

  const view = new WorldView(world.materialized.volume, platform);
  const rooms: RoomLightReport[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  for (const id of ids) {
    const geom = shell.rooms.get(id)!;
    const rt = roomTypeOf(project, id, ctx);
    const target = targetLevel(rt, opts.mood !== false);
    const cells = measure(world, view, geom);
    opts.trace?.({ type: 'final', roomId: id, target, cells: cells.map((c) => ({ pos: c.pos, level: c.level })) });
    const report: RoomLightReport = {
      roomId: id,
      target,
      added: added.get(id) ?? 0,
      walkableCells: cells.length,
      darkCells: cells.filter((c) => c.level === 0).length,
      belowTarget: cells.filter((c) => c.level < target).length,
      minLevel: cells.reduce((m, c) => Math.min(m, c.level), 15),
    };
    rooms.push(report);
    const label = `${id} (${rt?.id ?? project.room(id).roomTypeId})`;
    if (report.darkCells > 0) warnings.push(`${label}: ${report.darkCells} begehbare Zelle(n) bleiben ohne Licht – Monster können spawnen`);
    else if (report.belowTarget > 0) notes.push(`${label}: Stimmungslicht ≥ ${target} an ${report.belowTarget} von ${report.walkableCells} Zellen nicht erreicht (min. ${report.minLevel})`);
  }
  return { world, rounds, rooms, warnings, notes };
}

function roomTypeOf(project: Project, id: RoomId, ctx: PipelineContext): RoomTypeDef | undefined {
  try {
    return ctx.catalog.roomType(project.room(id).roomTypeId);
  } catch {
    return undefined; // unbekannter Raumtyp: nur Spawn-Schutz
  }
}

function targetLevel(rt: RoomTypeDef | undefined, mood: boolean): number {
  return mood ? Math.max(1, rt?.lighting?.minLevel ?? 1) : 1;
}

/** Begehbare Zellen eines Raums mit ihrem Blocklicht (gleiche Definition wie der Spawn-Report). */
function measure(world: World, view: WorldView, geom: RoomShellInfo): LitCell[] {
  const out: LitCell[] = [];
  const light = world.materialized.light;
  for (const [x, z] of geom.interior.toArray()) {
    for (let y = geom.baseY; y < geom.baseY + geom.height; y++) {
      const pos: Vec3 = [x, y, z];
      if (isWalkable(view, pos)) out.push({ pos, level: light.levelAt(pos) });
    }
  }
  return out;
}

const dist = (a: Vec3, b: Vec3): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/** Geschätztes Blocklicht an `p` mit zusätzlichen Quellen (ohne Verdeckung). */
function estimate(current: number, emitters: readonly Emitter[], p: Vec3): number {
  let l = current;
  for (const e of emitters) l = Math.max(l, e.level - dist(e.pos, p));
  return l;
}

/** Gierige Auswahl der Lichtquellen für einen Raum in einer Runde. */
function planRoom(
  project: Project,
  roomId: RoomId,
  geom: RoomShellInfo,
  measured: readonly LitCell[],
  target: number,
  round: number,
  maxPerRound: number,
  ctx: PipelineContext,
  emissions: EmissionTable,
  failedTags: ReadonlySet<string>,
): PlacementDraft[] {
  const { catalog } = ctx;
  const dataVersion = project.state.targetVersion.dataVersion;
  const roomSeed = project.roomSeed(roomId);
  const rng = new Rng(hashSeed(roomSeed, 'light', round));
  const existing = project.state.placements.filter((p) => p.roomId === roomId).map((p) => ({ key: p.id, componentId: p.componentId, placed: placedFor(p, catalog) }));
  // Treppe, Öffnung und Geländer sind tabu (wie in der Einrichtung); gemessen wird trotzdem der ganze Raum
  // Mittelgang/Freifläche des Raumtyps (K3c) bleiben auch für ergänzte Lichter frei – ungelockert, also eher strenger
  const fg = furnishingGeometry(geom);
  const rt = roomTypeOf(project, roomId, ctx);
  const layout = rt === undefined ? undefined : planLayout(analyzeRoom(fg), rt);
  const planner = new RoomPlanner(fg, existing.map((e) => e.placed), layout);
  const used = new Set(existing.map((e) => e.componentId));
  const prefer = rt?.lighting?.prefer ?? DEFAULT_LIGHT_PREFERENCE;
  // W3-IN (I7): Licht-Budget – Stimmungslicht nur, solange der Raum weniger Leuchten hat als erlaubt; Spawn-Schutz
  // (Blocklicht ≥ 1) geht immer vor. Bevorzugte Lichtpunkte (`anchors`): Abstell- und Hängelichter nur an Anker-Möbeln,
  // je Möbel ein stehendes und ein hängendes, und dort höher gewertet (Kerzen auf dem Tisch, Laterne über der Tafel).
  const budget = lightBudget(rt?.lighting, fg.interior.difference(planner.analysis.blocked).size);
  let fixtures = existing.filter((e) => isLightFixture(catalog.get(e.componentId))).length;
  const anchors = rt?.lighting?.anchors;
  // je Möbel höchstens ein stehendes und ein hängendes Licht (Schlüssel `<Möbel>|hang` bzw. `<Möbel>|stand`)
  const litKey = (parent: string, def: ComponentDef): string => `${parent}|${def.mount === 'ceiling' ? 'hang' : 'stand'}`;
  const lit = new Set(project.state.placements.filter((p) => p.roomId === roomId && p.parentId !== undefined && isLightFixture(catalog.get(p.componentId))).map((p) => litKey(p.parentId as string, catalog.get(p.componentId))));
  const anchorOf = new Map(existing.map((e) => [e.key, anchors !== undefined && catalog.get(e.componentId).tags.some((t) => anchors.includes(t))]));
  // Vorlieben bleiben vorn; bei Platzmangel stehen die übrigen sicheren Lichtarten als Rückfall bereit.
  const tiers = [...prefer, ...DEFAULT_LIGHT_PREFERENCE.filter((tag) => !prefer.includes(tag))]
    .filter((tag) => !failedTags.has(tag));
  // Stil je Raum: leichte, per Seed gewürfelte Vorliebe je Komponente (Vielfalt zwischen Räumen)
  const affinity = (defId: string): number => 1 + 0.25 * (hashSeed(roomSeed, 'light-style', defId) / 0x1_0000_0000);
  let cells: LitCell[] = measured.map((c) => ({ pos: c.pos, level: c.level }));
  const drafts: PlacementDraft[] = [];

  for (let n = 0; n < maxPerRound; n++) {
    // über dem Budget nur noch Spawn-Schutz (Ziel 1)
    const goal = fixtures >= budget ? 1 : target;
    const deficient = cells.filter((c) => c.level < goal);
    if (deficient.length === 0) break;
    const dark = darkest(deficient);
    let best: { cand: LightCandidate; score: number } | undefined;
    for (const tag of tiers) {
      const scored: { cand: LightCandidate; score: number }[] = [];
      for (const cand of tierCandidates(tag)) {
        if (estimate(dark.level, cand.emitters, dark.pos) <= dark.level) continue; // muss die dunkelste Zelle heben
        let gain = 0;
        for (const c of deficient) {
          const next = estimate(c.level, cand.emitters, c.pos);
          gain += Math.min(goal, next) - Math.min(goal, c.level);
          if (c.level === 0 && next > 0) gain += 5; // Spawn-Schutz zählt extra
        }
        const nearest = Math.min(...cand.emitters.map((e) => dist(e.pos, dark.pos)));
        const anchored = cand.parentKey !== undefined && anchorOf.get(cand.parentKey) === true ? ANCHOR_BONUS : 1;
        scored.push({ cand, score: gain * anchored * affinity(cand.def.id) * (used.has(cand.def.id) ? 1.2 : 1) - 0.1 * nearest + rng.next() * 0.01 });
      }
      // Konnektivität (teuer) nur für die besten prüfen; erste Art mit einem Treffer gewinnt (Wunsch-Reihenfolge)
      best = scored.sort((a, b) => b.score - a.score).find((x) => planner.connected(x.cand.placed));
      if (best !== undefined) break;
    }
    if (best === undefined) break;
    const { cand } = best;
    planner.add(cand.placed);
    used.add(cand.def.id);
    if (isLightFixture(cand.def)) fixtures++;
    if (cand.parentKey !== undefined) lit.add(litKey(cand.parentKey, cand.def));
    // Belegte Zellen (und Zellen, deren Kopfraum jetzt belegt ist) sind nicht mehr begehbar
    const blocked = new Set(cand.placed.expanded.walkable ? [] : cand.placed.cells.map((c) => key3(c.pos)));
    cells = cells
      .filter((c) => !blocked.has(key3(c.pos)) && !blocked.has(key3([c.pos[0], c.pos[1] + 1, c.pos[2]])))
      .map((c) => ({ pos: c.pos, level: estimate(c.level, cand.emitters, c.pos) }));
    const key = `light${round}.${n}`;
    drafts.push({
      key,
      componentId: cand.def.id,
      ...(cand.variantId !== undefined ? { variantId: cand.variantId } : {}),
      pose: cand.placed.pose,
      seed: hashSeed(roomSeed, 'light', key),
      ...(cand.parentKey !== undefined ? { parentKey: cand.parentKey } : {}),
      ...(cand.socketId !== undefined ? { socketId: cand.socketId } : {}),
    });
  }
  return drafts;

  /** Gültige Posen aller Komponenten einer Lichtquellen-Art (Tag) in der aktuellen Belegung. */
  function tierCandidates(tag: string): LightCandidate[] {
    const out: LightCandidate[] = [];
    for (const def of catalog.byTags([tag], dataVersion)) {
      for (const variantId of def.variants?.map((v) => v.id) ?? [undefined]) {
        // W3-IN: mit Ankern nur an Anker-Möbeln ohne Licht; Hängelichter (Pendel) auch über dem Anker-Möbel
        const parents = anchors === undefined ? existing : existing.filter((e) => anchorOf.get(e.key) === true && !lit.has(litKey(e.key, def)));
        if (def.mount === 'surface' || (anchors !== undefined && def.mount === 'ceiling')) {
          for (const sp of planner.socketPoses(def, variantId, parents)) {
            out.push(candidate(def, variantId, sp.placed, sp.parentKey, sp.socketId));
          }
          if (def.mount === 'surface') continue;
        }
        for (const placed of planner.candidates(def, variantId)) {
          // Deckenlicht nur über freier Bodenfläche (nicht über Möbeln)
          if (def.mount === 'ceiling' && !placed.cells.every((c) => planner.floorFree(c.pos[0], c.pos[2]))) continue;
          out.push(candidate(def, variantId, placed));
        }
      }
    }
    return out.filter((c) => c.emitters.length > 0);
  }

  function candidate(def: ComponentDef, variantId: string | undefined, placed: PlacedComponent, parentKey?: string, socketId?: string): LightCandidate {
    return {
      def,
      variantId,
      placed,
      emitters: placed.cells.flatMap((c) => {
        const level = emissions.of(c.mat);
        return level > 0 ? [{ pos: c.pos, level }] : [];
      }),
      ...(parentKey !== undefined ? { parentKey } : {}),
      ...(socketId !== undefined ? { socketId } : {}),
    };
  }
}

/** Dunkelste Zelle; bei Gleichstand die mit den meisten dunklen Nachbarn (größte dunkle Region), dann Position. */
function darkest(cells: readonly LitCell[]): LitCell {
  const around = (c: LitCell): number => cells.filter((o) => o.level <= c.level && dist(o.pos, c.pos) <= 2).length;
  let best = cells[0]!;
  let bestAround = around(best);
  for (const c of cells.slice(1)) {
    if (c.level > best.level) continue;
    const a = around(c);
    if (c.level < best.level || a > bestAround) {
      best = c;
      bestAround = a;
    }
  }
  return best;
}

/** Blocklicht-Emission eines Katalog-Materials im Theme der Zielversion (Tabelle aus `materialize`). */
class EmissionTable {
  private readonly cache = new Map<string, number>();

  constructor(
    private readonly resolver: ThemeResolver,
    private readonly platform: PlatformView,
  ) {}

  of(mat: MaterialSpec): number {
    const key = JSON.stringify(mat);
    let level = this.cache.get(key);
    if (level === undefined) {
      level = 0;
      try {
        const name = mat.block !== undefined ? this.platform.registry.migrateBlockName(mat.block) : this.resolver.resolve(mat.role!, mat.shape!).block;
        if (name !== undefined) level = emission(blockState(name, mat.state ?? {}));
      } catch {
        level = 0; // nicht auflösbar: die Materialisierung meldet das selbst
      }
      this.cache.set(key, level);
    }
    return level;
  }
}
