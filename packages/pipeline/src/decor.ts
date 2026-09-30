/**
 * Innen-Deko-Pass (feat/int-decor, LV-Bericht `plan/spikes/LV_tiefe_detail.md` Hebel 9/10, Techniken T19–T24):
 * ERGÄNZT nach der Einrichtung und vor dem Licht-Pass, was gebaute Innenräume von Solver-Räumen unterscheidet –
 * Wandschmuck über Möbeln, Teppich, Pflanzen (Boden, Fläche, Hängendes), Regal- und Tischinhalt (Kerzen, Krüge, Becher),
 * Hängendes an der Decke, Eingangs- und Kaminecken als kleine Vignetten. Der Pass schaltet sich über
 * `ProjectState.interiorDecor` (`'some'` | `'rich'`) ein; ohne das Feld läuft er nicht und jede Ausgabe bleibt bitgleich.
 *
 * Arbeitsweise wie der Licht-Pass (`lighting.ts`): je Raum ein `RoomPlanner` mit allen vorhandenen Komponenten als
 * Hindernissen (Türzone, Fenster, Weg, Konnektivität, Rücken zur Wand – dieselben harten Regeln wie die Einrichtung),
 * Ergänzungen als `auto`-Platzierungen (`supplementFurnishing`), Auswahl deterministisch aus dem Raum-Seed. Der Pass
 * kennt nur Raumtypen mit Rezept (Wohn-, Schlaf-, Ess-, Arbeits- und Empfangsräume); Funktionsräume bleiben unberührt.
 *
 * Regeln (aus dem LV-Bericht): Wandschmuck bevorzugt über Möbeln und nie dicht an dicht; Bodenpflanzen nur in Ecken und
 * an Wänden, weit weg von Türen; Teppich höchstens einer je Raum; Lichtakzente (Kerzen) nur im Licht-Budget des Raumtyps
 * (nichts überbeleuchtet – Spawn-Schutz und Stimmungslicht bleiben Sache des Licht-Passes); Dichte-Budget je Fläche.
 */
import type { PlacementDraft, Project, RoomId, RoomShellInfo, Shell } from '@mcda/blueprint';
import type { InteriorDecor } from '@mcda/blueprint';
import { isLightFixture, lightBudget, type ComponentDef, type RoomTypeDef } from '@mcda/catalog';
import { Rng, cellKey, hashSeed } from '@mcda/core';
import { RoomPlanner, analyzeRoom, planLayout, type PlacedComponent } from '@mcda/furnishing';
import { furnishingGeometry } from './geometry.js';
import { placedFor, themeFor, type PipelineContext } from './world.js';

/** Schritt eines Deko-Rezepts: was (Tags, Montage), wie viele je Stufe, wo bevorzugt. */
export interface DecorStep {
  /** Kennung des Schritts (Schlüsselteil der Platzierungen, Bericht). */
  readonly id: string;
  readonly mount: 'wall' | 'floor' | 'ceiling' | 'surface';
  /** Komponenten mit mindestens einem dieser Tags (nur die passende Montage). */
  readonly tags: readonly string[];
  /** Komponenten mit einem dieser Tags sind ausgeschlossen. */
  readonly not?: readonly string[];
  /** Höchstzahl je Stufe. */
  readonly some: number;
  readonly rich: number;
  /** Bodenpflanzen/-stücke: nur in Ecken (zwei Wände) bzw. an Wänden. */
  readonly where?: 'corner' | 'edge' | 'center';
  /** Wandschmuck: Mindestabstand (Zellen, Manhattan im Grundriss) zu anderem Wandschmuck des Raums. Standard 3. */
  readonly spacing?: number;
  /** Wahrscheinlichkeit, dass der Schritt in diesem Raum überhaupt läuft (Vielfalt zwischen Räumen). Standard 1. */
  readonly prob?: number;
  /** Kleinste Raumfläche (Innenzellen) für den Schritt. */
  readonly minArea?: number;
  /** Nur in dieser Stufe und darüber (`rich`). */
  readonly richOnly?: boolean;
}

export interface DecorRecipe {
  readonly id: string;
  readonly steps: readonly DecorStep[];
}

const RUG = { id: 'rug', mount: 'floor', tags: ['deco_rug'], where: 'center' } as const;
const CANDLE = ['candles'];
const PLANT_S = ['plant'];
const PLANT_F = ['deco_plant', 'plant_large'];

/** Wohn- und Aufenthaltsräume: Wandbilder über Möbeln, Teppich, Kaminsims, Pflanzen, Standuhr, Kerzen. */
const livingRecipe: DecorRecipe = {
  id: 'wohnen',
  steps: [
    { ...RUG, some: 1, rich: 1, minArea: 20 },
    { id: 'nook', mount: 'floor', tags: ['deco_nook'], some: 0, rich: 1, where: 'edge', minArea: 24, prob: 0.7 },
    { id: 'art', mount: 'wall', tags: ['tapestry', 'wall_banner', 'gallery_wall_cluster', 'picture_frame', 'mounted_antlers'], some: 1, rich: 3 },
    { id: 'mantle', mount: 'wall', tags: ['mantle'], some: 0, rich: 1, prob: 0.8 },
    { id: 'shelf', mount: 'wall', tags: ['deco_shelf', 'wall_plant', 'window_herb_shelf'], some: 1, rich: 2, prob: 0.8 },
    { id: 'plant_s', mount: 'surface', tags: PLANT_S, some: 1, rich: 2 },
    { id: 'plant_f', mount: 'floor', tags: PLANT_F, some: 1, rich: 2, where: 'corner', minArea: 20 },
    { id: 'clock', mount: 'floor', tags: ['tall_clock'], some: 0, rich: 1, where: 'edge', minArea: 30, prob: 0.6 },
    { id: 'candle', mount: 'surface', tags: CANDLE, some: 1, rich: 2 },
    { id: 'vase', mount: 'surface', tags: ['vase'], some: 0, rich: 1 },
  ],
};

const bedroomRecipe: DecorRecipe = {
  id: 'schlafen',
  steps: [
    { ...RUG, some: 1, rich: 1, minArea: 20 },
    { id: 'art', mount: 'wall', tags: ['tapestry', 'wall_banner', 'picture_frame', 'gallery_wall_cluster'], some: 1, rich: 2 },
    { id: 'mirror', mount: 'wall', tags: ['coat_rack_mirror'], some: 0, rich: 1, prob: 0.5 },
    { id: 'shelf', mount: 'wall', tags: ['deco_shelf', 'wall_plant'], some: 1, rich: 1, prob: 0.7 },
    { id: 'quilt', mount: 'floor', tags: ['quilt_rack'], some: 0, rich: 1, where: 'edge', prob: 0.6, minArea: 24 },
    { id: 'plant_s', mount: 'surface', tags: PLANT_S, some: 1, rich: 2 },
    { id: 'plant_f', mount: 'floor', tags: PLANT_F, some: 1, rich: 1, where: 'corner', minArea: 20 },
    { id: 'candle', mount: 'surface', tags: CANDLE, some: 1, rich: 1 },
  ],
};

const diningRecipe: DecorRecipe = {
  id: 'essen',
  steps: [
    { ...RUG, some: 0, rich: 1, minArea: 40, prob: 0.5 },
    { id: 'art', mount: 'wall', tags: ['kitchen_utensils', 'wall_food', 'menu_board', 'drinking_horn_rack', 'spice_shelf', 'window_herb_shelf', 'tapestry', 'wall_banner'], not: ['wall_meat'], some: 2, rich: 4 },
    { id: 'shelf', mount: 'wall', tags: ['deco_shelf'], some: 1, rich: 2, prob: 0.8 },
    { id: 'plant_s', mount: 'surface', tags: PLANT_S, some: 1, rich: 2 },
    { id: 'plant_f', mount: 'floor', tags: PLANT_F, some: 1, rich: 1, where: 'corner', minArea: 24 },
    { id: 'hang', mount: 'ceiling', tags: ['herb_rack', 'kitchen_hanging_rack'], some: 1, rich: 2, prob: 0.8, minArea: 20 },
    { id: 'mug', mount: 'surface', tags: ['mug', 'cake'], some: 1, rich: 3 },
    { id: 'candle', mount: 'surface', tags: CANDLE, some: 1, rich: 2 },
  ],
};

/** Küche: wie Essraum, aber ohne Teppich (Steinboden, Arbeitsweg). */
const kitchenRecipe: DecorRecipe = { id: 'kochen', steps: diningRecipe.steps.filter((s) => s.id !== 'rug') };

const tavernRecipe: DecorRecipe = {
  id: 'schenke',
  steps: [
    ...diningRecipe.steps.slice(0, 2),
    { id: 'game', mount: 'wall', tags: ['dart_board'], some: 0, rich: 1, prob: 0.5 },
    ...diningRecipe.steps.slice(2),
  ],
};

const studyRecipe: DecorRecipe = {
  id: 'studieren',
  steps: [
    { ...RUG, some: 1, rich: 1, minArea: 20 },
    { id: 'nook', mount: 'floor', tags: ['deco_nook'], some: 0, rich: 1, where: 'edge', minArea: 24, prob: 0.6 },
    { id: 'art', mount: 'wall', tags: ['wall_books', 'instrument_frames', 'tapestry', 'picture_frame'], some: 1, rich: 2 },
    { id: 'shelf', mount: 'wall', tags: ['deco_shelf'], some: 1, rich: 1, prob: 0.6 },
    { id: 'plant_s', mount: 'surface', tags: PLANT_S, some: 1, rich: 2 },
    { id: 'plant_f', mount: 'floor', tags: PLANT_F, some: 0, rich: 1, where: 'corner', minArea: 24 },
    { id: 'candle', mount: 'surface', tags: CANDLE, some: 1, rich: 2 },
    { id: 'vase', mount: 'surface', tags: ['vase'], some: 0, rich: 1 },
  ],
};

const hallRecipe: DecorRecipe = {
  id: 'empfang',
  steps: [
    { id: 'coat', mount: 'floor', tags: ['coat_stand'], some: 1, rich: 1, where: 'edge', minArea: 12 },
    { id: 'mirror', mount: 'wall', tags: ['coat_rack_mirror'], some: 0, rich: 1, prob: 0.6 },
    { id: 'runner', mount: 'floor', tags: ['runner_rug'], some: 1, rich: 1, where: 'center', minArea: 18 },
    { id: 'art', mount: 'wall', tags: ['tapestry', 'wall_banner', 'gallery_wall_cluster', 'picture_frame'], some: 1, rich: 2 },
    { id: 'shelf', mount: 'wall', tags: ['deco_shelf'], some: 0, rich: 1, prob: 0.6 },
    { id: 'plant_s', mount: 'surface', tags: PLANT_S, some: 1, rich: 1 },
    { id: 'plant_f', mount: 'floor', tags: PLANT_F, some: 1, rich: 1, where: 'corner', minArea: 16 },
    { id: 'candle', mount: 'surface', tags: CANDLE, some: 0, rich: 1 },
  ],
};

const workRecipe: DecorRecipe = {
  id: 'werken',
  steps: [
    { id: 'art', mount: 'wall', tags: ['wall_tools', 'farm_tools', 'wall_labels', 'schematic_board', 'thread_spool_display'], some: 1, rich: 3 },
    { id: 'plant_s', mount: 'surface', tags: PLANT_S, some: 1, rich: 1 },
    { id: 'mug', mount: 'surface', tags: ['mug'], some: 1, rich: 2 },
    { id: 'plant_f', mount: 'floor', tags: PLANT_F, some: 0, rich: 1, where: 'corner', minArea: 30 },
  ],
};

const bathRecipe: DecorRecipe = {
  id: 'baden',
  steps: [
    { id: 'plant_s', mount: 'surface', tags: PLANT_S, some: 1, rich: 2 },
    { id: 'towel', mount: 'floor', tags: ['towel_rack'], some: 1, rich: 1, where: 'edge', minArea: 12 },
    { id: 'plant_f', mount: 'floor', tags: PLANT_F, some: 1, rich: 1, where: 'corner', minArea: 20 },
    { id: 'art', mount: 'wall', tags: ['wall_plant'], some: 0, rich: 1 },
  ],
};


/** Rezept je Raumtyp (Wohn-, Schlaf-, Ess-, Arbeits- und Empfangsräume). Funktionsräume sind bewusst nicht dabei. */
export const DECOR_RECIPES: Readonly<Record<string, DecorRecipe>> = {
  bedroom: bedroomRecipe, guest_room: bedroomRecipe, nursery: bedroomRecipe, attic: bedroomRecipe,
  solar: livingRecipe, music_room: livingRecipe, game_room: livingRecipe, gallery: livingRecipe,
  dining_hall: diningRecipe, kitchen: kitchenRecipe, tavern: tavernRecipe, mead_hall: tavernRecipe,
  study: studyRecipe, library: studyRecipe, map_room: studyRecipe,
  entrance_hall: hallRecipe, hallway: hallRecipe,
  artisan_workshop: workRecipe, carpentry: workRecipe, weaving_room: workRecipe,
  washroom: bathRecipe, bathhouse: bathRecipe,
};

export interface DecorOptions {
  /** Stufe; Standard `project.state.interiorDecor`. Ohne beides läuft der Pass nicht. */
  readonly level?: InteriorDecor;
  /** Nur diese Räume (Standard: alle mit Rezept). */
  readonly roomIds?: readonly RoomId[];
}

export interface RoomDecorReport {
  readonly roomId: RoomId;
  readonly roomTypeId: string;
  readonly recipe: string;
  readonly added: number;
  /** Ergänzungen je Schritt. */
  readonly steps: Readonly<Record<string, number>>;
}

export interface DecorResult {
  readonly level: InteriorDecor | undefined;
  readonly rooms: readonly RoomDecorReport[];
}

/** Tags, die der Pass nie von sich aus setzt (Feuerstellen, Zellen, Altäre, Kampf- und Grusel-Deko). */
const SOFT_NOT = ['grim_decor', 'abandoned', 'wall_weapons', 'religious', 'training', 'cobweb', 'fire_feature', 'prison_cell', 'altar'];

/** Stile, die ein Deko-Pass nie von sich aus wählt (düster, kriegerisch, sakral …), außer der Raumtyp bringt sie selbst mit. */
const DENY_STYLES = ['grim', 'abandoned', 'martial', 'arcane', 'sacred', 'fantasy', 'overgrown', 'ruin', 'religious'];
/** Weiche Stil-Tags (Stimmung, kein Theme): sie allein sperren nichts. */
const SOFT_STYLES = ['medieval', 'rustic', 'cozy', 'noble', 'scholarly', 'tavern', 'village', 'workshop'];

/** Höchstzahl an Ergänzungen je Raum: wächst mit der Fläche, in `rich` etwa doppelt so schnell. */
export function decorBudget(level: InteriorDecor, area: number): number {
  const b = level === 'rich' ? 4 + area / 14 : 2 + area / 30;
  return Math.max(1, Math.min(level === 'rich' ? 16 : 8, Math.round(b)));
}

/**
 * Ergänzt Deko in den Räumen des Projekts (Aggregat-Befehl `supplementFurnishing`). Erwartet eingerichtete Räume und
 * die passende Hülle; ohne Stufe (Option und Projektfeld leer) passiert nichts.
 */
export function decorRooms(project: Project, shell: Shell, ctx: PipelineContext, opts: DecorOptions = {}): DecorResult {
  const level = opts.level ?? project.state.interiorDecor;
  if (level === undefined) return { level, rooms: [] };
  const ids = (opts.roomIds ?? project.state.rooms.map((r) => r.id)).filter((id) => shell.rooms.has(id));
  const styles = [...themeFor(project, ctx).chain];
  const rooms: RoomDecorReport[] = [];
  for (const id of ids) {
    const rt = roomTypeOf(project, id, ctx);
    const recipe = rt === undefined ? undefined : DECOR_RECIPES[rt.id];
    if (rt === undefined || recipe === undefined) continue;
    rooms.push(decorRoom(project, id, shell.rooms.get(id)!, rt, recipe, level, ctx, styles));
  }
  return { level, rooms };
}

function roomTypeOf(project: Project, id: RoomId, ctx: PipelineContext): RoomTypeDef | undefined {
  try {
    return ctx.catalog.roomType(project.room(id).roomTypeId);
  } catch {
    return undefined;
  }
}

interface Existing {
  readonly key: string;
  readonly componentId: string;
  readonly placed: PlacedComponent;
}

function decorRoom(
  project: Project, roomId: RoomId, geom: RoomShellInfo, rt: RoomTypeDef, recipe: DecorRecipe, level: InteriorDecor,
  ctx: PipelineContext, styles: readonly string[],
): RoomDecorReport {
  const { catalog } = ctx;
  const dataVersion = project.state.targetVersion.dataVersion;
  const roomSeed = project.roomSeed(roomId);
  const fg = furnishingGeometry(geom);
  const existing: Existing[] = project.state.placements.filter((p) => p.roomId === roomId).map((p) => ({ key: p.id, componentId: p.componentId, placed: placedFor(p, catalog) }));
  const planner = new RoomPlanner(fg, existing.map((e) => e.placed), planLayout(analyzeRoom(fg), rt));
  const area = fg.interior.difference(planner.analysis.blocked).size;
  let budget = decorBudget(level, area);
  const budgetLight = lightBudget(rt.lighting, area);
  let fixtures = existing.filter((e) => isLightFixture(catalog.get(e.componentId))).length;
  const info = planner.analysis.info;
  const baseY = fg.baseY;
  // Idempotent: ein Raum, der schon Deko dieses Passes trägt (Seeds sind aus Raum-Seed + Schlüssel abgeleitet), bleibt wie er ist
  const mine = new Set<number>();
  for (let i = 0; i < 16; i++) for (let j = 0; j < 20; j++) mine.add(hashSeed(roomSeed, 'decor', `deco${i}.${j}`));
  if (project.state.placements.some((p) => p.roomId === roomId && mine.has(p.seed))) return { roomId, roomTypeId: rt.id, recipe: recipe.id, added: 0, steps: {} };

  // Möbel-Oberkante je Grundrisszelle (Wandschmuck hängt bevorzugt darüber)
  const furnTop = new Map<string, number>();
  for (const e of existing) {
    const def = catalog.get(e.componentId);
    if (def.mount === 'wall' || def.mount === 'ceiling' || e.placed.expanded.walkable) continue;
    for (const c of e.placed.cells) {
      const k = cellKey(c.pos[0], c.pos[2]);
      furnTop.set(k, Math.max(furnTop.get(k) ?? -1, c.pos[1]));
    }
  }
  // vorhandener Wandschmuck / Bodenstücke (Abstände)
  const wallPieces: PlacedComponent[] = existing.filter((e) => catalog.get(e.componentId).mount === 'wall').map((e) => e.placed);
  let rugs = existing.filter((e) => e.componentId.includes('rug') || catalog.get(e.componentId).tags.some((t) => t === 'rug' || t.startsWith('rug_') || t.endsWith('_rug'))).length;
  const drafts: PlacementDraft[] = [];
  const counts: Record<string, number> = {};
  const liveExisting: Existing[] = [...existing];

  const styleOK = (def: ComponentDef): boolean => {
    const st = def.styleTags ?? [];
    if (st.length === 0) return true;
    if (st.some((t) => DENY_STYLES.includes(t) && !styles.includes(t))) return false;
    // ein Theme-Stil (nordic, gothic …) verlangt, dass das Theme ihn führt – außer die Komponente ist auch allgemein (medieval)
    return st.some((t) => styles.includes(t) || SOFT_STYLES.includes(t));
  };

  recipe.steps.forEach((step, stepIndex) => {
    if (budget <= 0) return;
    if (step.richOnly === true && level !== 'rich') return;
    if (step.minArea !== undefined && area < step.minArea) return;
    const rng = new Rng(hashSeed(roomSeed, 'decor', stepIndex));
    if (step.prob !== undefined && !rng.chance(step.prob)) return;
    let want = level === 'rich' ? step.rich : step.some;
    if (step.id === 'rug' && rugs > 0) return;
    if (want <= 0) return;
    const defs = catalog.byTags(step.tags, dataVersion)
      .filter((d) => d.mount === step.mount && styleOK(d) && !(step.not ?? []).some((t) => d.tags.includes(t)) && !SOFT_NOT.some((t) => d.tags.includes(t)));
    if (defs.length === 0) return;
    // je Raum ein kleines, stimmiges Angebot (Vielfalt zwischen Räumen, Einheit im Raum)
    // eigene `deco_`-Bausteine (für diesen Pass gebaut) stehen im Angebot vorn, der Rest füllt Vielfalt auf
    const isOwn = (d: ComponentDef): boolean => d.tags.some((t) => t.startsWith('deco_'));
    const mixed = shuffled(defs, rng);
    const pool = [...mixed.filter(isOwn), ...mixed.filter((d) => !isOwn(d))].slice(0, step.mount === 'surface' ? 3 : 4);
    const placedHere: PlacedComponent[] = [];
    for (let attempt = 0; attempt < want * 4 + 2 && want > 0 && budget > 0; attempt++) {
      const def = pool[attempt % pool.length]!;
      const isLight = isLightFixture(def);
      if (isLight && fixtures >= budgetLight) continue;
      const picked = pickVariant(def, planner, rng);
        if (picked === undefined) continue;
      const variantId = picked.id;
      const key = `deco${stepIndex}.${counts[step.id] ?? 0}`;
      let chosen: { placed: PlacedComponent; parentKey?: string; socketId?: string } | undefined;
      if (step.mount === 'surface') {
        const taken = new Set(drafts.filter((d) => d.parentKey !== undefined).map((d) => `${d.parentKey}|${catalog.get(d.componentId).tags.find((t) => step.tags.includes(t))}`));
        const parents = liveExisting.filter((e) => !taken.has(`${e.key}|${def.tags.find((t) => step.tags.includes(t))}`));
        const poses = planner.socketPoses(def, variantId, parents);
        if (poses.length === 0) continue;
        const sp = scoreSurface(poses, rng, existing);
        chosen = sp;
      } else {
        const cands = planner.candidates(def, variantId).filter((c) => acceptable(step, c, planner, info, wallPieces, placedHere));
        if (cands.length === 0) continue;
        const scored = cands.map((c) => ({ c, s: score(step, c, furnTop, info, baseY, planner, geom) + rng.next() * 0.4 })).sort((a, b) => b.s - a.s);
        for (const { c } of scored.slice(0, 6)) {
          if (!planner.connected(c)) continue;
          chosen = { placed: c };
          break;
        }
      }
      if (chosen === undefined) continue;
      planner.add(chosen.placed);
      if (step.mount === 'wall') wallPieces.push(chosen.placed);
      placedHere.push(chosen.placed);
      if (isLight) fixtures++;
      if (step.id === 'rug') rugs++;
      counts[step.id] = (counts[step.id] ?? 0) + 1;
      budget--;
      want--;
      drafts.push({
        key,
        componentId: def.id,
        ...(variantId !== undefined ? { variantId } : {}),
        pose: chosen.placed.pose,
        seed: hashSeed(roomSeed, 'decor', key),
        ...(chosen.parentKey !== undefined ? { parentKey: chosen.parentKey } : {}),
        ...(chosen.socketId !== undefined ? { socketId: chosen.socketId } : {}),
      });
      liveExisting.push({ key, componentId: def.id, placed: chosen.placed });
    }
  });

  if (drafts.length > 0) project.supplementFurnishing(roomId, drafts);
  return { roomId, roomTypeId: rt.id, recipe: recipe.id, added: drafts.length, steps: counts };
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Variante nach Gewicht, nur solche, die zur lichten Höhe passen (gedehnte Formen mit Länge); `undefined` = keine passt. */
function pickVariant(def: ComponentDef, planner: RoomPlanner, rng: Rng): { readonly id: string | undefined } | undefined {
  const all = def.variants ?? [];
  if (all.length === 0) return planner.fitsRoom(def) ? { id: planner.adapt(def) } : undefined;
  const vs = all.filter((v) => planner.fitsRoom(def, v.id));
  if (vs.length === 0) return undefined;
  const v = rng.weighted(vs, (x) => x.weight ?? 1);
  return { id: planner.adapt(def, v.id) };
}

/** Abstände und Ortsregeln, die nicht schon `cheapValid` prüft. */
function acceptable(
  step: DecorStep, c: PlacedComponent, planner: RoomPlanner, info: ReturnType<typeof analyzeRoom>['info'],
  wallPieces: readonly PlacedComponent[], placedHere: readonly PlacedComponent[],
): boolean {
  const [x, , z] = c.pose.pos;
  if (step.mount === 'wall') {
    const spacing = step.spacing ?? 3;
    for (const w of wallPieces) {
      const d = Math.abs(w.pose.pos[0] - x) + Math.abs(w.pose.pos[2] - z);
      if (d < spacing && rangesOverlap(w, c)) return false;
    }
    return true;
  }
  if (step.mount === 'floor' && !c.expanded.walkable) {
    // Bodenstücke stehen an der Wand (oder in der Ecke), nie mitten im Weg
    const fp = c.cells.filter((k) => k.pos[1] === planner.geometry.baseY);
    const onWall = (k: { pos: readonly [number, number, number] }): number => (info.get(cellKey(k.pos[0], k.pos[2]))?.walls.length ?? 0);
    if (fp.length === 0) return true;
    if (step.where === 'corner' && !fp.some((k) => onWall(k) >= 2)) return false;
    if (step.where !== 'center' && !fp.some((k) => onWall(k) >= 1)) return false;
    for (const p of placedHere) if (Math.abs(p.pose.pos[0] - x) + Math.abs(p.pose.pos[2] - z) < 4) return false;
    // nicht direkt an einer Tür (Weg + Wirkung)
    for (const k of fp) if ((planner.analysis.dDoor.get(cellKey(k.pos[0], k.pos[2])) ?? Infinity) < 3) return false;
  }
  if (step.mount === 'ceiling') {
    if (!c.cells.every((k) => planner.floorFree(k.pos[0], k.pos[2]))) return false;
    for (const p of placedHere) if (Math.abs(p.pose.pos[0] - x) + Math.abs(p.pose.pos[2] - z) < 3) return false;
  }
  return true;
}

/** Überschneiden sich die Höhenbereiche zweier Wand-Stücke (nur dann stören sie sich)? */
function rangesOverlap(a: PlacedComponent, b: PlacedComponent): boolean {
  const ay = a.cells.map((c) => c.pos[1]);
  const by = b.cells.map((c) => c.pos[1]);
  if (ay.length === 0 || by.length === 0) return true;
  return Math.min(...ay) <= Math.max(...by) + 1 && Math.min(...by) <= Math.max(...ay) + 1;
}

/** Wertung einer Pose: Ort nach Schritt-Art (über Möbeln, in der Ecke, zentral …). */
function score(
  step: DecorStep, c: PlacedComponent, furnTop: ReadonlyMap<string, number>, info: ReturnType<typeof analyzeRoom>['info'],
  baseY: number, planner: RoomPlanner, geom: RoomShellInfo,
): number {
  const dWall = (x: number, z: number): number => planner.analysis.dWall.get(cellKey(x, z)) ?? 0;
  if (step.mount === 'wall') {
    let s = 0;
    const lowY = Math.min(...c.cells.map((k) => k.pos[1]));
    for (const k of c.cells) {
      const top = furnTop.get(cellKey(k.pos[0], k.pos[2]));
      if (top !== undefined && lowY > top) s += 1.2;
    }
    // Augenhöhe: 2 … 3 über dem Boden
    const rel = lowY - baseY;
    s += rel >= 2 && rel <= 3 ? 1 : rel === 1 ? 0.3 : 0;
    // Wand mit Fenster nicht zuhängen: näher an Fensterzellen mindert
    const cell = info.get(cellKey(c.pose.pos[0], c.pose.pos[2]));
    if (cell?.nearWindow === true) s -= 0.8;
    if (cell?.nearDoor === true) s -= 0.8;
    return s;
  }
  if (step.mount === 'floor') {
    const [x, , z] = c.pose.pos;
    if (c.expanded.walkable) {
      // Teppich: groß, mittig, an Möbeln anliegend
      const b = geom.interior.bounds()!;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      let touch = 0;
      for (const k of c.cells) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (furnTop.has(cellKey(k.pos[0] + dx, k.pos[2] + dz))) touch++;
      return touch * 0.35 + Math.min(c.cells.length, 12) * 0.2 - (Math.abs(x - cx) + Math.abs(z - cz)) * 0.15;
    }
    const walls = info.get(cellKey(x, z))?.walls.length ?? 0;
    return walls * 1.5 + (dWall(x, z) === 0 ? 1 : 0) + ((planner.analysis.dDoor.get(cellKey(x, z)) ?? 9) >= 4 ? 0.5 : 0);
  }
  if (step.mount === 'ceiling') {
    const [x, , z] = c.pose.pos;
    let s = dWall(x, z) <= 1 ? 1 : 0;
    if (info.get(cellKey(x, z))?.nearWindow === true) s += 1.5;
    return s;
  }
  return 0;
}

function scoreSurface(
  poses: readonly { readonly parentKey: string; readonly socketId: string; readonly placed: PlacedComponent }[], rng: Rng, existing: readonly Existing[],
): { placed: PlacedComponent; parentKey: string; socketId: string } {
  // bevorzugt Eltern, die schon nach einem Möbel aussehen, das man dekoriert (Tisch, Kommode); sonst gleichverteilt
  void existing;
  return rng.pick(poses);
}
