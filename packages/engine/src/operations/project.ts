/**
 * Projekt-Operationen: zustandsbehaftete Bearbeitung über Sessions. Die Befehle sind die Befehlsmethoden der
 * Aggregate `Project` und `Site` (Tabellen in `../aggregates/`), dazu Stil, Bauwerke, Einrichtung, Undo, Abfrage und
 * Generierung. So kann ein Modell ein Haus Schritt für Schritt bauen und ändern.
 */
import { z } from 'zod';
import { Project, TARGET_VERSIONS, type ProjectEvent } from '@mcda/blueprint';
import { FLOOR_HEIGHT } from '@mcda/blueprint';
import type { StructuresInput } from '@mcda/structures';
import {
  BLOCK_ATTEMPTS, BLOCK_MARGIN, FALLBACK_THEME_ID, applyAutoStairs, autoStairsText, blockRulesCatalog, buildingOf, furnishRoomsDetailed, generateBase, applyNewProjectMood, moodOption, projectFromBuildingType, refurnishBlock,
  roomZones, shellFor, styleChainOf, themeFor, withoutPilastersForTheme,
} from '@mcda/pipeline';
import { Site, plotAround, type SiteEvent } from '@mcda/terrain';
import { PROJECT_COMMANDS, rectCells, rectSchema } from '../aggregates/project.js';
import { SITE_COMMANDS, SITE_DECOR_IDS } from '../aggregates/site.js';
import { commandSchema, runCommand, type CommandEnv, type CommandTable } from '../commands.js';
import { defineOperation, type EngineContext, type Json, type Runtime } from '../operation.js';
import { NO_REDO, requireSession, type ProjectSession, type SessionBuild } from '../session.js';
import { structuresOf, structuresSchema } from '../structures.js';
import { blockRulesOf, blockRulesSchema, defined, exteriorSchema, exteriorStyle, shellSchema } from '../style.js';
import { EXPORT_FORMATS, FACADE_RHYTHMS, LANDFORMS, SITE_TEMPLATE_IDS, SURFACE_TEXTURE_IDS, VERSIONS, WEATHERING_IDS, idsOf, type Vocabulary } from '../vocabulary.js';
import { buildingParams, buildingTypeSchema } from './building.js';
import { worldResult } from './result.js';
import { PROJECT_FILE_FORMAT, PROJECT_FILE_VERSION, readProjectFile } from '@mcda/projectfile';
import { appFileOf, sessionFromAppFile } from '../appFile.js';

const Int = z.number().int();
const projectId = z.string().min(1).describe('Projekt-ID aus project_create');

const json = (v: unknown): Json => JSON.parse(JSON.stringify(v ?? null)) as Json;
const bounds = (cells: { bounds(): { minX: number; minZ: number; maxX: number; maxZ: number } | undefined }): Json => {
  const b = cells.bounds();
  return b === undefined ? null : [b.minX, b.minZ, b.maxX, b.maxZ];
};

/** Kompakte Sicht auf eine Session (für Modelle: IDs, Etagen, Räume, Treppen, Zonen). */
export function sessionView(s: ProjectSession, placements = false): Json {
  const st = s.project.state;
  return json({
    projectId: s.id,
    name: st.name,
    seed: st.seed,
    themeId: st.themeId,
    targetVersion: st.targetVersion.name,
    // W13-G: Blockpalette des Projekts (nur wenn gesetzt – ohne sie bleibt die Sicht feldgleich)
    ...(st.paletteOverrides !== undefined ? { paletteOverrides: st.paletteOverrides } : {}),
    origin: st.origin ?? null,
    floors: st.floors.map((f) => ({ index: f.index, y0: f.y0, height: f.height })),
    volumes: st.volumes ?? [],
    rooms: st.rooms.map((r) => ({
      id: r.id, floor: r.floorIndex, roomTypeId: r.roomTypeId, volumeId: r.volumeId ?? 'v0', bounds: bounds(r.cells), area: r.cells.size,
      placements: st.placements.filter((p) => p.roomId === r.id).length,
    })),
    stairs: st.links.map((l) => ({ id: l.id, type: l.type, floor: l.floorIndex, at: l.origin, facing: l.facing, ...(l.turn !== undefined ? { turn: l.turn } : {}) })),
    ...(placements ? {
      placements: st.placements.map((p) => ({
        id: p.id, roomId: p.roomId, componentId: p.componentId, pos: p.pose.pos, rot: p.pose.rot, mirror: p.pose.mirror, locked: p.locked, origin: p.origin,
        // W3-BL: aufgesetzte Teile (Kerzen auf dem Tisch) folgen ihrem Möbel bei movePlacement
        ...(p.parentId !== undefined ? { parentId: p.parentId } : {}),
      })),
    } : {}),
    style: s.build,
    site: s.site === undefined ? null : {
      styleId: s.site.state.styleId, plot: s.site.state.plot, lighting: s.site.state.lighting ?? null,
      zones: s.site.state.zones.map((zn) => ({ id: zn.id, kind: zn.kind, edge: zn.edge ?? null, bounds: bounds(zn.cells), area: zn.cells.size })),
    },
    structures: {
      walls: s.structures?.walls?.length ?? 0, towers: s.structures?.towers?.length ?? 0,
      windmills: s.structures?.windmills?.length ?? 0, parapets: s.structures?.parapets?.length ?? 0, attachedTowers: s.attachedTowers.length,
    },
    history: { project: s.project.history.length, site: s.site?.history.length ?? 0 },
  });
}

const DEFAULT_BUILD: SessionBuild = { roof: 'gable' };

export const projectCreate = defineOperation({
  id: 'project_create',
  summary: 'Neues Projekt öffnen (leer oder aus einem Bautyp) – für schrittweises Bauen und Ändern mit project_command. Liefert die projectId.',
  cacheable: false,
  input: (v: Vocabulary) => z.object({
    name: z.string().min(1).max(64).default('Haus').describe('Projektname'),
    seed: Int.min(0).max(2 ** 31 - 1).default(1).describe('Zufalls-Seed'),
    themeId: z.enum(idsOf(v.themes)).optional().describe('Material-Theme; ohne Angabe das erste passende des Bautyps, sonst medieval'),
    targetVersion: z.enum(VERSIONS).default('1.21.11').describe('Minecraft-Java-Zielversion'),
    floorHeight: Int.min(FLOOR_HEIGHT.min).max(FLOOR_HEIGHT.max).default(3).describe('lichte Höhe des Erdgeschosses (leeres Projekt)'),
    buildingType: buildingTypeSchema(v).optional().describe('Start aus einem Bautyp (Grundriss, Stil, Gelände, Bauwerke)'),
    surroundings: z.boolean().default(true).describe('nur mit buildingType: Gelände und Bauwerke des Bautyps übernehmen'),
  }).strict(),
  run(i, ctx, v, rt) {
    const id = rt.sessions.nextId();
    // W7-E: ohne Angabe nicht mehr das erste Theme des Katalogs (desert), sondern wie building_generate: beim Bautyp dessen
    // Theme, sonst FALLBACK_THEME_ID (wie ein neues Projekt der App)
    const themeId = i.themeId ?? (v.themes.some((t) => t.id === FALLBACK_THEME_ID) ? FALLBACK_THEME_ID : v.themes[0]?.id ?? FALLBACK_THEME_ID);
    let session: ProjectSession;
    let notes: readonly string[] | undefined;
    if (i.buildingType !== undefined) {
      const res = projectFromBuildingType(ctx.buildingTypes.get(i.buildingType.buildingTypeId), {
        ...buildingParams(i.buildingType), ...(i.themeId !== undefined ? { themeId: i.themeId } : {}), projectId: id,
        targetVersion: TARGET_VERSIONS[i.targetVersion], surroundings: i.surroundings,
      }, i.seed, ctx);
      notes = res.notes;
      res.project.rename(i.name === 'Haus' ? res.project.state.name : i.name);
      session = {
        id, project: res.project, site: res.site,
        build: {
          ...withoutPilastersForTheme(res.build, ctx.themes, res.project.state.themeId),
          ...(res.surroundings.landform !== undefined ? { landform: res.surroundings.landform } : {}),
        },
        structures: res.surroundings.structures, attachedTowers: res.surroundings.attachedTowers ?? [], redo: NO_REDO,
      };
    } else {
      const project = Project.create({
        id, name: i.name, seed: i.seed, themeId, targetVersion: TARGET_VERSIONS[i.targetVersion], floor: { y0: 0, height: i.floorHeight },
      });
      applyNewProjectMood(project); // B4: neue Projekte mit der Stimmung des Themes
      session = { id, project, site: undefined, build: DEFAULT_BUILD, structures: undefined, attachedTowers: [], redo: NO_REDO };
    }
    rt.sessions.put(session);
    // W7-E: Hinweise des Bautyps (z. B. „Lage … noch nicht baubar – ebenerdig gebaut“) wie bei building_generate
    return { data: notes === undefined ? sessionView(session) : { ...(sessionView(session) as Record<string, Json>), notes: [...notes] } };
  },
});

/**
 * Befehle atomar anwenden: schlägt einer fehl, ruft `rollback(historyLength)` den Stand davor zurück (Aggregat aus der
 * gekürzten Historie, Stil der Session unverändert) und der Fehler nennt den Befehl.
 */
function applyCommands<A extends { history: readonly unknown[] }, E>(
  table: CommandTable<A, E>, agg: A, commands: readonly Record<string, unknown>[], env: CommandEnv, rollback: (length: number) => void,
): Json[] {
  const before = agg.history.length;
  const buildBefore = env.session.build;
  const results: Json[] = [];
  for (const [n, c] of commands.entries()) {
    try {
      const r = runCommand(table, agg, c as { command: string }, env);
      results.push(json(Array.isArray(r) ? r.map((e: { type?: string }) => e.type ?? e) : r));
    } catch (err) {
      env.session.build = buildBefore;
      rollback(before);
      throw new Error(`Befehl ${n + 1} (${String(c['command'])}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return results;
}

const envOf = (ctx: EngineContext, vocab: Vocabulary, session: ProjectSession): CommandEnv => ({ ctx, vocab, session });

export const projectCommand = defineOperation({
  id: 'project_command',
  summary:
    'Bauplan ändern: Räume malen/löschen, Raumtyp, Etagen, Treppen, Möbel, Theme, Baukörper, Bautyp anwenden. '
    + 'Mehrere Befehle in einem Aufruf werden atomar ausgeführt.',
  cacheable: false,
  input: (v: Vocabulary) => z.object({
    projectId,
    commands: z.array(commandSchema(PROJECT_COMMANDS, v)).min(1).max(64).describe('Befehle in Reihenfolge'),
  }).strict(),
  run(i, ctx, v, rt) {
    const s = requireSession(rt.sessions, i.projectId);
    const project = s.project;
    s.redo = { ...s.redo, project: [] };
    const results = applyCommands<Project, ProjectEvent>(PROJECT_COMMANDS, project, i.commands as Record<string, unknown>[], envOf(ctx, v, s),
      (n) => { s.project = Project.fromHistory(project.history.slice(0, n)); });
    return { data: { results, project: sessionView(s) } };
  },
});

export const siteCreate = defineOperation({
  id: 'site_create',
  summary: 'Gelände ums Haus anlegen (ersetzt ein bestehendes): Geländestil, Rand, optional Vorlage.',
  cacheable: false,
  input: (v: Vocabulary) => z.object({
    projectId,
    terrainStyleId: z.enum(idsOf(v.terrainStyles)).describe('Geländestil'),
    margin: Int.min(4).max(64).default(12).describe('Grundstücksrand ums Haus'),
    template: z.enum(SITE_TEMPLATE_IDS).optional().describe('Vorlage (homestead: Hof, Garten, Feld, Koppel)'),
  }).strict(),
  run(i, ctx, v, rt) {
    const s = requireSession(rt.sessions, i.projectId);
    const building = buildingOf(shellFor(s.project, s.build, themeFor(s.project, ctx)));
    const site = Site.create({ id: `${s.id}-site`, projectId: s.id, seed: s.project.state.seed, styleId: i.terrainStyleId, plot: plotAround(building, i.margin) });
    s.site = site;
    s.redo = { ...s.redo, site: [] };
    if (i.template !== undefined) runCommand(SITE_COMMANDS, site, { command: 'applyTemplate', template: i.template, keepStyle: true }, envOf(ctx, v, s));
    return { data: sessionView(s) };
  },
});

export const siteRemove = defineOperation({
  id: 'site_remove',
  summary: 'Gelände des Projekts entfernen.',
  cacheable: false,
  input: () => z.object({ projectId }).strict(),
  run(i, _ctx, _v, rt) {
    const s = requireSession(rt.sessions, i.projectId);
    s.site = undefined;
    return { data: sessionView(s) };
  },
});

export const siteCommand = defineOperation({
  id: 'site_command',
  summary: 'Gelände ändern: Zonen (Garten, Feld, Teich, Weg …), Zäune/Hecken, Höhen formen, Stil, Beleuchtung, Vegetation, Vorlage.',
  cacheable: false,
  input: (v: Vocabulary) => z.object({
    projectId,
    commands: z.array(commandSchema(SITE_COMMANDS, v)).min(1).max(64).describe('Befehle in Reihenfolge'),
  }).strict(),
  run(i, ctx, v, rt) {
    const s = requireSession(rt.sessions, i.projectId);
    if (s.site === undefined) throw new Error('Projekt hat kein Gelände – erst site_create');
    const site = s.site;
    s.redo = { ...s.redo, site: [] };
    const results = applyCommands<Site, SiteEvent>(SITE_COMMANDS, site, i.commands as Record<string, unknown>[], envOf(ctx, v, s),
      (n) => { s.site = Site.fromHistory(site.history.slice(0, n)); });
    return { data: { results, project: sessionView(s) } };
  },
});

export const projectStyle = defineOperation({
  id: 'project_style',
  summary: 'Stil des Projekts ändern: Dach, Fenster, Dach-Details, Gauben, Fassade, Außen-Deko, Beleuchtung, gesperrte Blöcke, Grundstücks-Deko, Geländeform, erzählende Verwitterung.',
  cacheable: false,
  input: () => z.object({
    projectId,
    shell: shellSchema.optional().describe('Hüllen-Stil (ersetzt je Feld)'),
    exterior: exteriorSchema.optional().describe('Außen-Deko'),
    lighting: z.boolean().optional().describe('Lichter ergänzen'),
    blockRules: blockRulesSchema.optional()
      .describe('Blöcke sperren und ersetzen (ersetzt die bisherigen Regeln; {} = keine Sperren). Möbel mit gesperrten Blöcken nehmen beim Einrichten eine andere Variante'),
    ensemble: z.boolean().optional()
      .describe('Verbindungsgraph der Base (F-Ensemble): Holzbrücken aus Obergeschossen zum Wehrgang bzw. Nachbargebäude, Anschluss- und Rundwege an/aus; ohne Angabe unverändert'),
    siteDecor: z.enum(SITE_DECOR_IDS).optional()
      .describe('Grundstücks-Deko des Projekts (Feature-Schalter): off = keine (Standard), some = wenige Teile, rich = dichter (Holzplatz, Beete, Bank, Bannermasten, Torbogen, Standbilder je Theme; Pferch, Bienenhof, Gräber, Marktstand nach den Räumen); braucht das Gelände; ohne Angabe unverändert'),
    landform: z.enum(LANDFORMS).optional()
      .describe('Geländeform (feat/gelaende): flat = wie bisher, natural = Hang hinter dem Haus mit Stützmauer, Teich, Findlinge, Moos am Sockel, dichtere Bepflanzung, dramatic = hoher Hang mit zwei Terrassen; wirkt nur mit Gelände; ohne Angabe unverändert'),
    weathering: z.enum(WEATHERING_IDS).optional()
      .describe('Erzählende Verwitterung (Feature-Schalter, Schritt 5): off = keine (Standard), some = wenige Cluster, rich = dichter; Regenstreifen unter Fenstern, Schatten unter Überhängen und Dachkanten, Moos und Bruchstein am Sockel, Dachtäler mit Wasserablauf, Moos an Bäumen; jeder Fleck läuft über eine Übergangskachel in die Grundfarbe aus, Stärke folgt Stimmung wear und Zustand (storyState); nur Blocktausch, Geometrie und Spielbarkeit bleiben. ohne Angabe unverändert'),
    surfaceTexture: z.enum(SURFACE_TEXTURE_IDS).optional()
      .describe('Oberflächen-Textur (Feature-Schalter, TX-B): off = keine (Standard), subtle = dezent, rich = kräftig; zusammenhängende Blockmischung aus Schwesterblöcken (60 % Grundblock, 25 % nah, 15 % Akzent) auf Wand, Sockel und Dachhaut, Sockel und Wandreihe unter Gesims/Traufe dunkler, Dach von der Traufe (dunkler) zum First (heller), Kontrast an Ecken und Fensterlaibungen, Streublöcke gegen gleichblockige Flächen; jede Änderung folgt einer benannten Regel, Stärke folgt dem Zustand (storyState); läuft vor der Verwitterung; nur Blocktausch, Geometrie und Spielbarkeit bleiben. Ohne Angabe unverändert'),
    facadeRhythm: z.enum(FACADE_RHYTHMS).optional()
      .describe('Fassadenrhythmus (Bauprozess Schritt 4): off = wie bisher, on = Fensterachsen im Takt auf flachen Wänden und Gauben auf leeren Dachflächen; wirkt beim nächsten Erzeugen; ohne Angabe unverändert'),
  }).strict(),
  run(i, _ctx, _v, rt) {
    const s = requireSession(rt.sessions, i.projectId);
    const { exterior: current, lighting: currentLight, blockRules: currentRules, ensemble: currentEnsemble, siteDecor: currentDecor, landform: currentLandform, weathering: currentWeathering, surfaceTexture: currentTexture, facadeRhythm: currentRhythm, ...rest } = s.build;
    const ensemble = i.ensemble === undefined ? currentEnsemble : i.ensemble ? {} : (false as const);
    const siteDecor = i.siteDecor === undefined ? currentDecor : i.siteDecor === 'off' ? undefined : i.siteDecor;
    const landform = i.landform === undefined ? currentLandform : i.landform === 'flat' ? undefined : i.landform;
    const weathering = i.weathering === undefined ? currentWeathering : i.weathering === 'off' ? undefined : i.weathering;
    const surfaceTexture = i.surfaceTexture === undefined ? currentTexture : i.surfaceTexture === 'off' ? undefined : i.surfaceTexture;
    const facadeRhythm = i.facadeRhythm === undefined ? currentRhythm : i.facadeRhythm === 'off' ? undefined : { windows: true, dormers: true };
    const exterior = exteriorStyle(i.exterior, current);
    const lighting = i.lighting === undefined ? currentLight : i.lighting ? undefined : (false as const);
    const blockRules = i.blockRules === undefined ? currentRules : blockRulesOf(i.blockRules);
    s.build = {
      ...rest, ...defined<SessionBuild>(i.shell ?? {}),
      ...(exterior !== undefined ? { exterior } : {}), ...(lighting !== undefined ? { lighting } : {}),
      ...(blockRules !== undefined ? { blockRules } : {}),
      ...(ensemble !== undefined ? { ensemble } : {}),
      ...(siteDecor !== undefined ? { siteDecor } : {}),
      ...(landform !== undefined ? { landform } : {}),
      ...(weathering !== undefined ? { weathering } : {}),
      ...(surfaceTexture !== undefined ? { surfaceTexture } : {}),
      ...(facadeRhythm !== undefined ? { facadeRhythm } : {}),
    };
    return { data: sessionView(s) };
  },
});

export const projectStructures = defineOperation({
  id: 'project_structures',
  summary: 'Bauwerke des Projekts setzen (ersetzt alle; mit mode append ergänzt): Mauern mit Toren und Türmen, freistehende Türme, Windmühlen, Silos, angedockte Türme, Wehrplatten.',
  cacheable: false,
  input: () => z.object({
    projectId,
    structures: structuresSchema.describe('Bauwerke; leeres Objekt = keine'),
    mode: z.enum(['replace', 'append']).optional()
      .describe('replace = alle bisherigen Bauwerke ersetzen (Standard); append = zu den bisherigen hinzufügen (z. B. zur Ringmauer des Bautyps einen Wachturm)'),
  }).strict(),
  run(i, _ctx, _v, rt) {
    const s = requireSession(rt.sessions, i.projectId);
    const { structures, attachedTowers } = structuresOf(i.structures);
    if (i.mode === 'append') {
      s.structures = appendStructures(s.structures, structures);
      s.attachedTowers = withUniqueIds([...s.attachedTowers, ...attachedTowers]);
    } else {
      s.structures = structures;
      s.attachedTowers = attachedTowers;
    }
    return { data: sessionView(s) };
  },
});

/** F-JEV-iterativ: IDs eindeutig halten (angehängte Bauwerke zählen je Liste ab 1 wie die bisherigen). */
function withUniqueIds<T extends { readonly id: string }>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  return list.map((x) => {
    let id = x.id;
    for (let n = 2; seen.has(id); n++) id = `${x.id}-${n}`;
    seen.add(id);
    return id === x.id ? x : { ...x, id };
  });
}

/** `project_structures` mit `mode: "append"`: je Liste die bisherigen Bauwerke, dann die neuen. */
function appendStructures(current: StructuresInput | undefined, add: StructuresInput): StructuresInput {
  const out: Record<string, readonly { readonly id: string }[]> = { ...(current ?? {}) } as Record<string, readonly { readonly id: string }[]>;
  for (const [k, list] of Object.entries(add) as Array<[string, readonly { readonly id: string }[] | undefined]>) {
    if (list === undefined || list.length === 0) continue;
    out[k] = withUniqueIds([...(out[k] ?? []), ...list]);
  }
  return out as StructuresInput;
}

export const projectUndo = defineOperation({
  id: 'project_undo',
  summary: 'Letzte Änderungen am Bauplan oder Gelände rückgängig machen.',
  cacheable: false,
  input: () => z.object({
    projectId,
    target: z.enum(['project', 'site']).default('project').describe('Bauplan oder Gelände'),
    steps: Int.min(1).max(100).default(1).describe('Anzahl Schritte'),
  }).strict(),
  run(i, _ctx, _v, rt) {
    const s = requireSession(rt.sessions, i.projectId);
    if (i.target === 'project') {
      const h = s.project.history;
      s.project = s.project.undo(i.steps);
      s.redo = { ...s.redo, project: [...h.slice(h.length - i.steps), ...s.redo.project] };
    } else {
      if (s.site === undefined) throw new Error('Projekt hat kein Gelände');
      const h = s.site.history;
      s.site = s.site.undo(i.steps);
      s.redo = { ...s.redo, site: [...h.slice(h.length - i.steps), ...s.redo.site] };
    }
    return { data: sessionView(s) };
  },
});

export const projectRedo = defineOperation({
  id: 'project_redo',
  summary: 'Rückgängig gemachte Änderungen wiederherstellen (bis zum nächsten neuen Befehl möglich).',
  cacheable: false,
  input: () => z.object({
    projectId,
    target: z.enum(['project', 'site']).default('project').describe('Bauplan oder Gelände'),
    steps: Int.min(1).max(100).default(1).describe('Anzahl Schritte'),
  }).strict(),
  run(i, _ctx, _v, rt) {
    const s = requireSession(rt.sessions, i.projectId);
    const stack = i.target === 'project' ? s.redo.project : s.redo.site;
    if (stack.length < i.steps) throw new Error(`Nur ${stack.length} Schritt(e) wiederherstellbar`);
    const again = stack.slice(0, i.steps);
    if (i.target === 'project') {
      s.project = Project.fromHistory([...s.project.history, ...(again as ProjectEvent[])]);
      s.redo = { ...s.redo, project: stack.slice(i.steps) as ProjectEvent[] };
    } else {
      s.site = Site.fromHistory([...s.site!.history, ...(again as SiteEvent[])]);
      s.redo = { ...s.redo, site: stack.slice(i.steps) as SiteEvent[] };
    }
    return { data: sessionView(s) };
  },
});

export const projectGet = defineOperation({
  id: 'project_get',
  summary: 'Aktuellen Stand eines Projekts lesen: Etagen, Räume mit IDs und Maßen, Treppen, Zonen, Stil; optional alle Möbel.',
  cacheable: false,
  input: () => z.object({ projectId, placements: z.boolean().default(false).describe('Möbel-Platzierungen mitliefern') }).strict(),
  run: (i, _ctx, _v, rt) => ({ data: sessionView(requireSession(rt.sessions, i.projectId), i.placements) }),
});

export const projectList = defineOperation({
  id: 'project_list',
  summary: 'Offene Projekte auflisten.',
  cacheable: false,
  input: () => z.object({}).strict(),
  run: (_i, _ctx, _v, rt) => ({
    data: rt.sessions.ids().map((id) => {
      const s = rt.sessions.get(id)!;
      return { projectId: id, name: s.project.state.name, rooms: s.project.state.rooms.length };
    }),
  }),
});

export const projectDelete = defineOperation({
  id: 'project_delete',
  summary: 'Projekt schließen und verwerfen.',
  cacheable: false,
  input: () => z.object({ projectId }).strict(),
  run: (i, _ctx, _v, rt) => ({ data: { deleted: rt.sessions.delete(i.projectId) } }),
});

export const projectFurnish = defineOperation({
  id: 'project_furnish',
  summary: 'Räume (neu) einrichten; gesperrte und von Hand gesetzte Möbel bleiben. Danach haben Möbel IDs zum Sperren/Verschieben.',
  cacheable: false,
  input: () => z.object({
    projectId,
    roomIds: z.array(z.string().min(1)).max(64).optional().describe('nur diese Räume (Standard alle)'),
    density: z.number().min(0).max(2).optional().describe('Möbeldichte (1 = Standard)'),
    minAisle: z.boolean().optional().describe(
      'Mittelgang verbindlich halten (P07): der Gang des Raumtyps bleibt mindestens auf seiner Mindestbreite, statt bei Platzmangel aufgegeben zu werden; ein Konflikt mit Pflichtmöbeln wird als Warnung gemeldet',
    ),
    keep: z.boolean().optional().describe(
      'bisherige Möbel behalten, soweit sie noch passen (z. B. nach resizeRoom, verschobener Tür oder Wandhöhe): jedes Möbel bleibt an seiner Stelle, wenn es dort alle Regeln erfüllt; nur der Rest wird neu gesetzt – wie der Editor beim Ziehen einer Raumkante',
    ),
  }).strict(),
  run(i, ctx, _v, rt) {
    const s = requireSession(rt.sessions, i.projectId);
    // W3-BL: dieselbe Auswahl-Sicht wie generateBase (Varianten mit gesperrten Blöcken ausgeblendet)
    const report = furnishRoomsDetailed(s.project, shellFor(s.project, s.build, themeFor(s.project, ctx)), blockRulesCatalog(ctx.catalog, s.build.blockRules), {
      styles: styleChainOf(s.project, ctx),
      // feat/theme-moods: Stimmung des Projekts wie in `generateWith` (ohne Stimmung leer, bitgleich)
      ...moodOption(s.project, ctx),
      ...(i.roomIds !== undefined ? { roomIds: i.roomIds } : {}),
      ...(i.density !== undefined ? { density: i.density } : {}),
      ...(i.minAisle === true ? { minAisle: true } : {}),
      ...(i.keep === true ? { keep: true } : {}),
    });
    return { data: { warnings: report.warnings, quality: json(Object.fromEntries(report.quality)), project: sessionView(s) } };
  },
});

/**
 * F „Bereich neu einrichten“ (WFC 3.2, Modifying in Blocks): eine Funktionszone oder ein Rechteck eines Raums neu
 * einrichten, alles andere bleibt eingefroren (wie gesperrt); ein schmaler Überlappungsrand darf mit umgestellt werden.
 * Dieselbe Funktion wie der Editor (`refurnishBlock`, @mcda/pipeline). Ein Event → ein Undo-Schritt.
 */
export const projectRefurnishBlock = defineOperation({
  id: 'project_refurnish_block',
  summary:
    'Bereich eines Raums neu einrichten: Funktionszone (zone, siehe zones im Ergebnis) oder Rechteck (rect); alles außerhalb '
    + 'bleibt unverändert, Möbel im Überlappungsrand (margin) dürfen mit umgestellt werden, Pflichtobjekte bleiben erfüllt. '
    + 'Nie schlechter: ein Versuch, der weniger Möbel aufstellt, als er entfernt (oder den Bereich nur leert), zählt als gescheitert. '
    + 'Scheitert der Bereich, wird nur er mit dem nächsten Unter-Seed wiederholt; ohne Erfolg bleibt das Projekt unverändert.',
  cacheable: false,
  input: () => z.object({
    projectId,
    roomId: z.string().min(1).describe('Raum-ID (siehe project_get)'),
    zone: Int.min(0).max(7).optional().describe('Index der Funktionszone des Raums (zones im Ergebnis; kleine Räume haben eine)'),
    rect: rectSchema.optional().describe('Rechteck [x0, z0, x1, z1] im Raum (statt zone)'),
    margin: Int.min(BLOCK_MARGIN.min).max(BLOCK_MARGIN.max).optional().describe(`Überlappungsrand in Zellen (Standard ${BLOCK_MARGIN.standard})`),
    attempts: Int.min(BLOCK_ATTEMPTS.min).max(BLOCK_ATTEMPTS.max).optional().describe(`Versuche mit neuen Unter-Seeds (Standard ${BLOCK_ATTEMPTS.standard})`),
    density: z.number().min(0).max(2).optional().describe('Möbeldichte des Raums (1 = Standard) – wie in project_furnish bzw. der Dichte des Raums in der App'),
    minAisle: z.boolean().optional().describe('Mittelgang verbindlich halten (P07) – wie in project_furnish'),
  }).strict(),
  run(i, ctx, _v, rt) {
    const s = requireSession(rt.sessions, i.projectId);
    const shell = shellFor(s.project, s.build, themeFor(s.project, ctx));
    const zones = roomZones(shell, i.roomId);
    const zoneView = zones.map((z, k) => ({ zone: k, bounds: bounds(z.cells), area: z.cells.size }));
    if ((i.zone === undefined) === (i.rect === undefined)) throw new Error('Genau eines angeben: zone oder rect');
    const cells = i.rect !== undefined ? rectCells(i.rect) : zones[i.zone!]?.cells;
    if (cells === undefined) throw new Error(`Zone ${i.zone} gibt es in ${i.roomId} nicht (${zones.length} Zonen)`);
    // Wie die App: voller Katalog (Pflicht-Tags, Grundflächen), Auswahl aus der Sicht der Block-Regeln (W3-BL)
    const report = refurnishBlock(s.project, shell, ctx.catalog, {
      roomId: i.roomId, cells, ...(i.margin !== undefined ? { margin: i.margin } : {}), ...(i.attempts !== undefined ? { attempts: i.attempts } : {}),
    }, {
      choice: blockRulesCatalog(ctx.catalog, s.build.blockRules),
      styles: styleChainOf(s.project, ctx),
      ...(i.density !== undefined ? { density: i.density } : {}),
      ...(i.minAisle === true ? { minAisle: true } : {}),
    });
    if (report.changed) s.redo = { ...s.redo, project: [] };
    return {
      data: {
        ok: report.ok, changed: report.changed, removed: report.removed.length, added: report.added, frozen: report.frozen, attempts: report.attempts,
        block: bounds(report.block), region: bounds(report.region), warnings: report.warnings, ...(report.reason !== undefined ? { reason: report.reason } : {}),
        zones: json(zoneView), project: sessionView(s),
      },
    };
  },
});

/**
 * W11-A „Treppen automatisch aus den Räumen“: verbindet jede Etage mit Räumen, die noch keine Treppe zur Nachbar-Etage
 * hat – dieselbe Regel wie der Editor (`planAutoStairs`, @mcda/pipeline). Vorhandene Treppen bleiben; ohne Lücke
 * ändert sich nichts. Die Treppen sind normale `StairsPlaced`-Events (Rückgängig mit project_undo, je Treppe ein Schritt).
 */
export const projectAutoStairs = defineOperation({
  id: 'project_auto_stairs',
  summary:
    'Treppen automatisch setzen: jede Etage mit Räumen ohne Treppe zur Nachbar-Etage bekommt genau eine (Spannbaum über die Etagen, '
    + 'auch Keller). Bevorzugt Eingangshalle/Flur, dann Gemeinschaftsräume, Schlafzimmer und Bad nur ohne Alternative; gestapelt über '
    + 'vorhandenen Treppen, an der Wand, nicht vor Türen und Fenstern, nie durch gesperrte Möbel und nie so, dass einem Raum ein '
    + 'Pflichtmöbel fehlt. Vorhandene Treppen bleiben unverändert.',
  cacheable: false,
  input: () => z.object({ projectId }).strict(),
  run(i, ctx, _v, rt) {
    const s = requireSession(rt.sessions, i.projectId);
    const before = s.project.history.length;
    const plan = applyAutoStairs(s.project, { catalog: ctx.catalog, ...(s.build.corridorTypes !== undefined ? { corridorTypes: s.build.corridorTypes } : {}) });
    if (s.project.history.length !== before) s.redo = { ...s.redo, project: [] };
    return {
      data: {
        placed: json(plan.stairs), gaps: json(plan.gaps), message: autoStairsText(plan, s.project.state, ctx.catalog), project: sessionView(s),
      },
    };
  },
});

export const projectGenerate = defineOperation({
  id: 'project_generate',
  summary: 'Projekt zur fertigen Welt bauen (Hülle, Einrichtung, Licht, Außen, Gelände, Bauwerke) und exportieren. Ändert das Projekt nicht.',
  cacheable: false,
  input: () => z.object({ projectId, format: z.enum(EXPORT_FORMATS).default('litematic').describe('Exportformat') }).strict(),
  run(i, ctx, _v, rt: Runtime) {
    const s = requireSession(rt.sessions, i.projectId);
    // Auf einer Kopie: die Einrichtung schreibt Platzierungen ins Aggregat, das soll die Session nicht verändern
    const copy = Project.fromHistory(s.project.history);
    const world = generateBase(copy, ctx, {
      ...s.build,
      ...(s.site !== undefined ? { site: s.site.state } : {}),
      ...(s.structures !== undefined ? { structures: s.structures } : {}),
      ...(s.attachedTowers.length > 0 ? { attachedTowers: s.attachedTowers } : {}),
    });
    return worldResult(copy, world, { projectId: s.id, targetVersion: copy.state.targetVersion.name, format: i.format }, [], world.surroundings.warnings);
  },
});

/** Dateiformat der Engine: Event-Historien der Aggregate + Stil + Bauwerke (Zustand entsteht per Replay). */
export const ENGINE_PROJECT_FORMAT = 'engine-projekt';
export const ENGINE_PROJECT_VERSION = 1;

/** Inhalt im Engine-Format (project_save; auch Grundlage des dauerhaften Projektspeichers `src/store.ts`). */
export function engineFileOf(s: ProjectSession): Json {
  return json({
    format: ENGINE_PROJECT_FORMAT, version: ENGINE_PROJECT_VERSION, name: s.project.state.name,
    build: s.build, structures: s.structures ?? null, attachedTowers: s.attachedTowers,
    site: s.site?.history ?? null, history: s.project.history,
  });
}

/** Session aus dem Engine-Format (Zustand per Replay der Historien); Redo leer. */
export function sessionFromEngineFile(id: string, e: EngineFile): ProjectSession {
  return {
    id,
    project: Project.fromHistory(e.history as ProjectEvent[]),
    site: e.site === null ? undefined : Site.fromHistory(e.site as SiteEvent[]),
    build: e.build as SessionBuild,
    structures: (e.structures ?? undefined) as ProjectSession['structures'],
    attachedTowers: e.attachedTowers as ProjectSession['attachedTowers'],
    redo: NO_REDO,
  };
}

export const projectSave = defineOperation({
  id: 'project_save',
  summary:
    'Projekt als JSON-Datei-Inhalt sichern (Event-Historie, Stil, Gelände, Bauwerke) – mit project_load wieder öffnen. '
    + "format 'app' schreibt die Projektdatei der Web-App (.projekt.json).",
  cacheable: false,
  input: () => z.object({
    projectId,
    format: z.enum(['engine', 'app']).default('engine').describe("Dateiformat: engine (Standard) oder app = .projekt.json der Web-App"),
    savedAt: z.string().datetime().optional().describe("nur format app: Speicherzeitpunkt (ISO); Standard jetzt"),
  }).strict(),
  run(i, _ctx, _v, rt) {
    const s = requireSession(rt.sessions, i.projectId);
    if (i.format === 'app') return { data: json(appFileOf(s, i.savedAt !== undefined ? new Date(i.savedAt) : new Date())) };
    return { data: engineFileOf(s) };
  },
});

const engineFileSchema = z.object({
  format: z.literal(ENGINE_PROJECT_FORMAT).describe('Dateiformat'),
  version: z.literal(ENGINE_PROJECT_VERSION).describe('Formatversion'),
  name: z.string().optional().describe('Anzeigename'),
  build: z.record(z.string(), z.unknown()).describe('Stil'),
  structures: z.record(z.string(), z.unknown()).nullable().describe('Bauwerke'),
  attachedTowers: z.array(z.unknown()).describe('angedockte Türme'),
  site: z.array(z.unknown()).nullable().describe('Event-Historie des Geländes'),
  history: z.array(z.unknown()).min(1).describe('Event-Historie des Projekts'),
}).strict().describe('Inhalt aus project_save (format engine)');

export type EngineFile = z.output<typeof engineFileSchema>;

/** Projektdatei der App: Grobform hier, Prüfung (Version 1–2, Events, Grenzen, Einstellungen) in @mcda/projectfile. */
const appFileSchema = z.object({
  format: z.literal(PROJECT_FILE_FORMAT).describe('Dateiformat der Web-App'),
  version: Int.min(1).max(PROJECT_FILE_VERSION).describe('Formatversion (1 wird migriert)'),
  history: z.array(z.unknown()).min(1).describe('Event-Historie des Projekts'),
}).catchall(z.unknown()).describe('Projektdatei der Web-App (.projekt.json) bzw. project_save mit format app');

export const projectLoad = defineOperation({
  id: 'project_load',
  summary: 'Gesichertes Projekt als neue Session öffnen: Ausgabe von project_save oder die Projektdatei der Web-App (.projekt.json).',
  cacheable: false,
  input: () => z.object({
    file: z.union([engineFileSchema, appFileSchema]).describe('Datei-Inhalt (Engine-Format oder .projekt.json der App)'),
  }).strict(),
  run(i, ctx, _v, rt) {
    const f = i.file;
    if (f.format === PROJECT_FILE_FORMAT) {
      const r = readProjectFile(f, { catalog: ctx.catalog, themes: ctx.themes });
      if (!r.ok) throw new Error(r.error);
      const session = sessionFromAppFile(rt.sessions.nextId(), r);
      rt.sessions.put(session);
      return { data: { ...(sessionView(session) as Record<string, Json>), warnings: [...r.warnings] } };
    }
    const session = sessionFromEngineFile(rt.sessions.nextId(), f as EngineFile);
    rt.sessions.put(session);
    return { data: sessionView(session) };
  },
});

export const PROJECT_OPERATIONS = [
  projectCreate, projectCommand, projectStyle, projectStructures, siteCreate, siteCommand, siteRemove,
  projectFurnish, projectRefurnishBlock, projectAutoStairs, projectUndo, projectRedo, projectGet, projectList, projectDelete, projectGenerate, projectSave, projectLoad,
];
