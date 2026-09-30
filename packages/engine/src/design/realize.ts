/**
 * F-JEV-iterativ, Umsetzung: Ensemble-Plan → Folge vorhandener Operationen (das „Rezept“) auf einem eigenen
 * Session-Speicher, dazu der deterministische Zusammenfasser (Welt → kompakter `state` für den Kritiker).
 *
 * Rezept: `project_create` (Bautyp, Größe, Theme, Stimmung, Keller …) → `project_command assignRoomType` (weitere
 * Nutzungen auf freie Räume) → `project_style` (Außen-Deko, gesperrte Blöcke, Brücken/Ensemble) →
 * `project_structures` mit `mode: "append"` (Mauer, Türme, Windmühle, Silo neben dem Haus) → `project_generate`.
 * Keine Parallelarchitektur: jeder Schritt ist eine Engine-Anfrage und in einem frischen Speicher wiederholbar
 * (Projekt-ID `p1`). Rein und deterministisch.
 */
import { effectiveMood } from '@mcda/pipeline';
import type { MoodAxis, MoodVector } from '@mcda/core';
import type { Engine, EngineRequest } from '../engine.js';
import type { Json, OperationResult } from '../operation.js';
import { memorySessions, type ProjectSession } from '../session.js';
import { DESIGN_MOOD_AXES, POLES, type DesignParts, type DesignPlan } from './plan.js';

/** Felder von `building_generate`, die zum Bautyp-Teil von `project_create` gehören. */
export const TYPE_KEYS = ['buildingTypeId', 'size', 'floors', 'front', 'setting', 'shell', 'paletteId', 'storyState', 'mood', 'underground', 'functionLevel', 'landform', 'silhouette', 'facadeRhythm', 'loopDoors', 'rerollCount'] as const;
/** Raumtypen, die nur einmal vorkommen und die Gebäudeart tragen (nie umwidmen). */
const CORE_ROOMS: ReadonlySet<string> = new Set(['entrance_hall', 'hallway', 'throne_room', 'mead_hall', 'tower_room', 'kitchen']);
/** Räume, die sich zum Umwidmen eignen (Reihenfolge = Vorrang). */
const FLEX_ROOMS: readonly string[] = ['storage', 'guest_room', 'study', 'attic', 'gallery', 'game_room', 'music_room', 'trophy_room', 'map_room', 'library', 'solar', 'bedroom', 'treasury', 'armory', 'washroom'];
/** Nutzungen, die ins Erdgeschoss gehören (Werkstatt, Stall, Schank). */
const GROUND_ROOMS: ReadonlySet<string> = new Set(['smithy', 'stable', 'tavern', 'bakery', 'butchery', 'trading_hall', 'carpentry', 'brewhouse', 'pottery', 'farm_room', 'mead_hall', 'barn_farm', 'chicken_house', 'apiary']);
/** Nutzungen, die im Keller stehen dürfen. */
const CELLAR_ROOMS: ReadonlySet<string> = new Set(['wine_cellar', 'dungeon', 'storage', 'treasury', 'alchemy', 'workshop_redstone', 'brewhouse']);

type Dir = 'north' | 'east' | 'south' | 'west';
const VEC: Readonly<Record<Dir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const OPP: Readonly<Record<Dir, Dir>> = { north: 'south', south: 'north', east: 'west', west: 'east' };
/** Seiten für Nebenteile, relativ zur Front: rechts, links, hinten. */
const SIDES: Readonly<Record<Dir, readonly Dir[]>> = { south: ['east', 'west', 'north'], north: ['west', 'east', 'south'], east: ['north', 'south', 'west'], west: ['south', 'north', 'east'] };

interface Box { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number }

/** Kompakte Beschreibung der Welt für den Kritiker (deutsche Schlüssel: das Modell liest sie). */
export interface WorldSummary {
  readonly bautyp: string;
  readonly bautypId: string;
  readonly theme: string;
  readonly themeId: string;
  readonly groessenklasse: string | null;
  /** Breite × Höhe × Tiefe des Exports in Blöcken. */
  readonly masse: string;
  readonly bloecke: number;
  readonly etagen: number;
  readonly keller: boolean;
  readonly raeume: Readonly<Record<string, number>>;
  readonly dach: string | null;
  readonly materialien: readonly string[];
  readonly stimmung: Readonly<Record<string, string>>;
  readonly bauwerke: {
    readonly mauern: number; readonly freistehendeTuerme: number; readonly windmuehlen: number; readonly silos: number; readonly wehrplatten: number;
  };
  readonly bruecken: number;
  readonly verstoesse: readonly string[];
  readonly hinweise: readonly string[];
}

export interface Realized {
  /** Ausgeführte Engine-Anfragen (in frischem Speicher wiederholbar). */
  readonly recipe: readonly EngineRequest[];
  /** Antwort von `project_generate` (Kennzahlen) samt Export-Artefakt. */
  readonly result: OperationResult;
  readonly summary: WorldSummary;
  /** Hinweise der Umsetzung (Raum umgewidmet, kein freier Raum, Teil ergänzt). */
  readonly notes: readonly string[];
  /** Raumtyp-IDs der Welt (für lokale Prüfungen). */
  readonly roomTypes: readonly string[];
  /** Wirksame Stimmung je Achse (−1 … 1). */
  readonly mood: MoodVector;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Plan umsetzen. Wirft, wenn eine Operation die Anfrage ablehnt (der Aufrufer fällt dann auf den vorigen Stand zurück). */
export function realize(engine: Engine, plan: DesignPlan, opts: { readonly format?: string } = {}): Realized {
  const sessions = memorySessions(2);
  const recipe: EngineRequest[] = [];
  const notes: string[] = [];
  const run = (req: EngineRequest): OperationResult & { data: Json } => {
    const r = engine.execute(req, { sessions });
    if (!r.ok) throw new Error(`${req.op}: ${r.errors.join('; ')}`);
    recipe.push(req);
    return r;
  };
  const b = plan.base;
  const typeFields = Object.fromEntries(TYPE_KEYS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
  const created = run({
    op: 'project_create',
    input: {
      seed: b['seed'] ?? 1,
      ...(b['themeId'] !== undefined ? { themeId: b['themeId'] } : {}),
      ...(b['targetVersion'] !== undefined ? { targetVersion: b['targetVersion'] } : {}),
      ...(b['surroundings'] !== undefined ? { surroundings: b['surroundings'] } : {}),
      buildingType: typeFields,
    },
  }).data as Record<string, unknown>;
  const projectId = String(created['projectId']);
  const session = (): ProjectSession => sessions.get(projectId)!;

  // Weitere Nutzungen: freie Räume umwidmen
  const rooms = (created['rooms'] as Array<{ id: string; floor: number; roomTypeId: string; area: number }>);
  const typeCount = new Map<string, number>();
  for (const r of rooms) typeCount.set(r.roomTypeId, (typeCount.get(r.roomTypeId) ?? 0) + 1);
  const mainHall = [...rooms].filter((r) => r.floor === 0).sort((x, y) => y.area - x.area)[0]?.id;
  const taken = new Set<string>();
  const commands: Array<Record<string, unknown>> = [];
  for (const want of plan.rooms) {
    if (rooms.some((r) => r.roomTypeId === want)) { notes.push(`Raum ${want} ist schon vorhanden`); continue; }
    const candidates = rooms.filter((r) => r.id !== mainHall && !taken.has(r.id)
      && !(CORE_ROOMS.has(r.roomTypeId) && (typeCount.get(r.roomTypeId) ?? 0) <= 1)
      && (r.floor >= 0 || CELLAR_ROOMS.has(want)));
    const rank = (r: { floor: number; roomTypeId: string; area: number }): number => {
      const flex = FLEX_ROOMS.indexOf(r.roomTypeId);
      return (flex >= 0 ? 40 - flex : 0) + ((typeCount.get(r.roomTypeId) ?? 0) > 1 ? 30 : 0)
        + (GROUND_ROOMS.has(want) ? (r.floor === 0 ? 50 : -50) : r.floor === 0 ? 0 : 5) + Math.min(30, r.area / 4);
    };
    const pickRoom = candidates.sort((x, y) => rank(y) - rank(x) || x.id.localeCompare(y.id))[0];
    if (pickRoom === undefined) { notes.push(`kein freier Raum für ${want}`); continue; }
    taken.add(pickRoom.id);
    typeCount.set(pickRoom.roomTypeId, (typeCount.get(pickRoom.roomTypeId) ?? 1) - 1);
    commands.push({ command: 'assignRoomType', roomId: pickRoom.id, roomTypeId: want });
    notes.push(`${pickRoom.id} (${pickRoom.roomTypeId}) → ${want}`);
  }
  if (commands.length > 0) run({ op: 'project_command', input: { projectId, commands } });

  // Stil: Außen-Deko, gesperrte Blöcke, Brücken
  const style: Record<string, unknown> = {};
  if (b['exterior'] !== undefined) style['exterior'] = b['exterior'];
  if (b['blockRules'] !== undefined) style['blockRules'] = b['blockRules'];
  if (b['ensemble'] === true || plan.parts.bridge) style['ensemble'] = true;
  if (Object.keys(style).length > 0) run({ op: 'project_style', input: { projectId, ...style } });

  // Nebenteile neben das Haus
  const structures = partsStructures(plan.parts, boxOf(rooms, created), (b['front'] as Dir | undefined) ?? 'south', session().structures);
  if (structures !== undefined) {
    run({ op: 'project_structures', input: { projectId, structures, mode: 'append' } });
    notes.push(`Bauwerke ergänzt: ${Object.entries(structures).map(([k, v]) => `${(v as unknown[]).length} ${k}`).join(', ')}`);
  }

  const generated = run({ op: 'project_generate', input: { projectId, ...(opts.format !== undefined ? { format: opts.format } : {}) } });
  const view = engine.execute({ op: 'project_get', input: { projectId } }, { sessions });
  const s = session();
  // Wirksame Stimmung wie `moodOf` der Pipeline: Theme-Vorgabe (aus catalog_get) achsenweise vom Projekt überschrieben
  const theme = engine.execute({ op: 'catalog_get', input: { kind: 'theme', id: s.project.state.themeId } });
  const mood = effectiveMood(s.project.state, theme.ok && isObj(theme.data) ? (theme.data as { mood?: never }) : undefined) ?? {};
  const roomTypes = s.project.state.rooms.map((r) => r.roomTypeId);
  return {
    recipe, result: generated, notes, roomTypes, mood,
    summary: summarize(engine, generated.data, view.ok ? view.data : null, s, mood, plan),
  };
}

/** Umriss des Hauses aus den Raumgrenzen (alle Etagen). */
function boxOf(rooms: readonly unknown[], _view: Record<string, unknown>): Box {
  let box: Box = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  let first = true;
  for (const r of rooms) {
    const bd = isObj(r) ? r['bounds'] : undefined;
    if (!Array.isArray(bd)) continue;
    const [x0, z0, x1, z1] = bd as number[];
    box = first ? { minX: x0!, minZ: z0!, maxX: x1!, maxZ: z1! }
      : { minX: Math.min(box.minX, x0!), minZ: Math.min(box.minZ, z0!), maxX: Math.max(box.maxX, x1!), maxZ: Math.max(box.maxZ, z1!) };
    first = false;
  }
  return box;
}

/**
 * Bauwerke der Nebenteile (Eingabe von `project_structures`), nur was der Bautyp nicht schon mitbringt: eine Mauer als
 * geschlossenes Rechteck um das Haus mit Tor in der Frontachse; Türme, Windmühle und Silo seitlich bzw. hinten, Tür zum
 * Haus. Abstand wächst mit einer vorhandenen Mauer (Burg: Ringmauer 6–8 vor dem Haus) und mit `shift`.
 */
export function partsStructures(parts: DesignParts, box: Box, front: Dir, existing: ProjectSession['structures']): Record<string, unknown[]> | undefined {
  const out: Record<string, unknown[]> = {};
  const hadWall = (existing?.walls?.length ?? 0) > 0;
  const midX = Math.round((box.minX + box.maxX) / 2);
  const midZ = Math.round((box.minZ + box.maxZ) / 2);
  let wallOff = 0;
  if (parts.wall !== undefined && !hadWall) {
    const off = (parts.wall === 'fortress' ? 9 : 6) + parts.shift;
    wallOff = off;
    const x0 = box.minX - off; const x1 = box.maxX + off; const z0 = box.minZ - off; const z1 = box.maxZ + off;
    const gateAt: [number, number] = front === 'south' ? [midX, z1] : front === 'north' ? [midX, z0] : front === 'east' ? [x1, midZ] : [x0, midZ];
    out['walls'] = [{
      points: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], closed: true, profile: parts.wall,
      // Blindes Urteil (Messung 1): automatische Ecktürme erdrückten kleine Häuser („Festung mit 8 Türmen“) – die
      // ergänzte Mauer bekommt keine Ecktürme, die Wehrmauer nur ein Torhaus und einen Aufgang
      towers: 'none',
      ...(parts.wall === 'fortress' ? { stairs: 'auto', height: 5 } : {}),
      gates: [parts.wall === 'fortress' ? { at: gateAt, width: 3, gatehouse: true } : { at: gateAt, width: 2 }],
    }];
  }
  // Abstand der Nebenteile: außerhalb einer Mauer (eigene oder Ringmauer der Burg, 6–8 + Turmmaß)
  // Ringmauer der Burg 6–8 vor dem Haus, dazu ggf. Zwinger (+5) und Graben: freistehende Teile erst dahinter
  const gap = (hadWall ? 24 : wallOff > 0 ? wallOff + 7 : 6) + parts.shift;
  const sides = SIDES[front];
  let slot = 0;
  const place = (half: number, extra = 0): { center: [number, number]; toHouse: Dir } => {
    const d = sides[slot % sides.length]!;
    const ring = Math.floor(slot / sides.length);
    slot++;
    const [dx, dz] = VEC[d];
    const dist = gap + extra + half + ring * 12;
    const center: [number, number] = dx !== 0
      ? [dx > 0 ? box.maxX + dist : box.minX - dist, midZ + ring * 10]
      : [midX + ring * 10, dz > 0 ? box.maxZ + dist : box.minZ - dist];
    return { center, toHouse: OPP[d] };
  };
  const haveTowers = existing?.towers?.length ?? 0;
  for (let i = haveTowers; i < parts.towers; i++) {
    const p = place(3);
    (out['towers'] ??= []).push({
      center: p.center, door: p.toHouse, ...(parts.towerTop !== undefined ? { top: parts.towerTop } : {}),
      ...(parts.towerLevels !== undefined ? { levels: parts.towerLevels } : {}),
    });
  }
  if (parts.windmill && (existing?.windmills?.length ?? 0) === 0) {
    const p = place(3, 4);
    out['windmills'] = [{ center: p.center, door: p.toHouse, facing: OPP[p.toHouse] }];
  }
  if (parts.silo && (existing?.silos?.length ?? 0) === 0) {
    const p = place(3, -2);
    out['silos'] = [{ center: p.center }];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const MOOD_NAMES: Readonly<Record<MoodAxis, string>> = { wear: 'Zustand', richness: 'Ausstattung', formality: 'Wirkung', organic: 'Ordnung' };
/** Stimmungswert → Wort („etwas gemütlich, heimelig“). */
export function moodWord(axis: MoodAxis, v: number): string {
  const [neg, pos] = POLES[axis];
  if (Math.abs(v) < 0.2) return 'neutral';
  return `${Math.abs(v) >= 0.75 ? 'deutlich' : 'etwas'} ${v < 0 ? neg : pos}`;
}

/** Zusammenfasser: Welt → kompakter `state` (Kennzahlen, Räume, Dach, Materialien, Stimmung, Teile, Verstöße). */
export function summarize(
  engine: Engine, data: Json, view: Json | null, s: ProjectSession, mood: MoodVector, plan: DesignPlan,
): WorldSummary {
  const d = (isObj(data) ? data : {}) as Record<string, unknown>;
  const v = engine.vocabulary;
  const st = s.project.state;
  const typeId = st.origin?.buildingTypeId ?? String(plan.base['buildingTypeId'] ?? '');
  const roomName = (id: string): string => v.roomTypes.find((r) => r.id === id)?.name ?? id;
  const raeume: Record<string, number> = {};
  for (const r of st.rooms) raeume[roomName(r.roomTypeId)] = (raeume[roomName(r.roomTypeId)] ?? 0) + 1;
  const floors = new Set(st.rooms.map((r) => r.floorIndex));
  const size = d['size'] as number[] | undefined;
  const rows = (isObj(d['materials']) ? (d['materials']['rows'] as Array<[string, number, number]>) : []) ?? [];
  const circ = isObj(d['circulation']) ? d['circulation'] : {};
  const verstoesse = [
    ...((circ['unreachable'] as string[] | undefined) ?? []).map((id) => `Raum ${id} nicht erreichbar`),
    ...((circ['upperWithoutStairs'] as unknown[] | undefined) ?? []).map((f) => `Etage ${String(f)} ohne Treppe`),
    ...(circ['entrance'] === null ? ['kein Eingang'] : []),
  ];
  const ens = isObj(d['ensemble']) ? d['ensemble'] : undefined;
  // Wirklich gebaute Größenklasse (Bautypen ohne Größen, z. B. das Haus: keine)
  const sizeClass = (isObj(st.origin?.params) ? (st.origin.params['size'] as string | undefined) : undefined) ?? null;
  const build = isObj(view) && isObj(view['style']) ? view['style'] : {};
  const stimmung: Record<string, string> = {};
  for (const axis of DESIGN_MOOD_AXES) stimmung[MOOD_NAMES[axis]] = moodWord(axis, mood[axis] ?? 0);
  return {
    bautyp: v.buildingTypes.find((t) => t.id === typeId)?.name ?? typeId,
    bautypId: typeId,
    theme: v.themes.find((t) => t.id === st.themeId)?.name ?? st.themeId,
    themeId: st.themeId,
    groessenklasse: sizeClass,
    masse: size !== undefined ? `${size[0]} × ${size[1]} × ${size[2]}` : '?',
    bloecke: typeof d['blocks'] === 'number' ? d['blocks'] : 0,
    etagen: [...floors].filter((f) => f >= 0).length,
    keller: [...floors].some((f) => f < 0),
    raeume,
    dach: typeof build['roof'] === 'string' ? build['roof'] : null,
    materialien: rows.slice(0, 6).map((r) => r[0]),
    stimmung,
    bauwerke: {
      mauern: s.structures?.walls?.length ?? 0,
      freistehendeTuerme: s.structures?.towers?.length ?? 0,
      windmuehlen: s.structures?.windmills?.length ?? 0,
      silos: s.structures?.silos?.length ?? 0,
      wehrplatten: s.structures?.parapets?.length ?? 0,
    },
    bruecken: ens !== undefined && Array.isArray(ens['bridges']) ? ens['bridges'].length : 0,
    verstoesse,
    hinweise: ((d['warnings'] as string[] | undefined) ?? []).slice(0, 4).map((w) => w.slice(0, 160)),
  };
}
