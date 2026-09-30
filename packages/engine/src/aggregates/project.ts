/**
 * Befehlstabelle des Aggregats `Project` (Bauplan). Jede Befehlsmethode von `Project` steht hier – der Mapped Type
 * `CommandTable<Project, ProjectEvent>` erzwingt das beim Typecheck (siehe `../commands.ts`).
 */
import { z } from 'zod';
import { FLOOR_HEIGHT, TARGET_VERSIONS, type BuildingSetting, type Project, type ProjectEvent, type RoofDetail, type VolumeExterior, type VolumeProps } from '@mcda/blueprint';
import { CellSet, type Mirror, type MoodVector, type Quarter } from '@mcda/core';
import {
  applyBuildingType, fixedFurnitureInStairs, movePoses, paletteOverrideProblems, placementProblem, planBuildOptions, rerollBuildingType, shellFor, themeFor, withoutPilastersForTheme,
} from '@mcda/pipeline';
import { command, excluded, type CommandTable } from '../commands.js';
import { type AssertCovered, type Uncovered } from '../operation.js';
import { buildingParams, buildingTypeFields } from '../operations/building.js';
import { EXTERIOR_GROUP_IDS, defined, moodSchema, paletteOverridesOf, paletteOverridesSchema, roofDetailSchema } from '../style.js';
import { DIRECTIONS, ROOF_STYLES, SETTING_KINDS, STAIR_TURNS, STAIR_TYPES, INTERIOR_DECORS, STORY_STATES, VERSIONS, idsOf } from '../vocabulary.js';

const Int = z.number().int();
const Coord = Int.min(-256).max(256);
export const rectSchema = z.tuple([Coord, Coord, Coord, Coord]).describe('Rechteck [x0, z0, x1, z1] in Blöcken (inklusive)');
export const rectCells = ([x0, z0, x1, z1]: readonly [number, number, number, number]): CellSet =>
  CellSet.rect(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));

const floor = Int.min(-4).max(7).describe('Etagenindex (0 = Erdgeschoss, negativ = Keller)');
const roomId = z.string().min(1).describe('Raum-ID (siehe project_get)');
const placementId = z.string().min(1).describe('Platzierungs-ID (siehe project_get mit placements)');
const volumeId = z.string().min(1).describe('Baukörper-ID (v0 = Standard)');
const poseFields = {
  pos: z.tuple([Coord, Int.min(-64).max(320), Coord]).describe('Position [x, y, z] in Weltblöcken'),
  rot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0).describe('Drehung in Vierteln (0–3)'),
  mirror: z.enum(['none', 'x', 'z']).default('none').describe('Spiegelung'),
};
const pose = (i: { pos: [number, number, number]; rot: Quarter; mirror: Mirror }) => ({ pos: i.pos, rot: i.rot, mirror: i.mirror });

const volumeSchema = z
  .object({
    name: z.string().max(40).optional().describe('Name des Baukörpers'),
    baseOffset: Int.min(-16).max(16).optional().describe('Versatz der Bodenplatten in y (Hang, Motte)'),
    floorHeights: z.record(z.string().regex(/^-?\d+$/), Int.min(FLOOR_HEIGHT.min).max(FLOOR_HEIGHT.max)).optional()
      .describe('lichte Höhe je Etagenindex, abweichend vom Projekt'),
    roof: z.enum(ROOF_STYLES).optional().describe('eigenes Dach'),
    roofDetail: roofDetailSchema.optional().describe('eigene Dach-Details'),
    setting: z.object({
      kind: z.enum(SETTING_KINDS).describe('Lage'),
      front: z.enum(DIRECTIONS).optional().describe('sichtbare Seite'),
      height: Int.min(0).max(32).optional().describe('Höhe über Gelände'),
      cover: Int.min(0).max(8).optional().describe('Erdlagen über dem Dach'),
    }).strict().optional().describe('Lage im Gelände'),
    exterior: z.object({
      trim: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64).optional()
        .describe('Theme-Rolle der Kanten dieses Baukörpers (Dachkante und Eckständer), z. B. trim_light = heller Rahmen der Scheune'),
      roof: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64).optional()
        .describe('Theme-Rolle der Dachfläche dieses Baukörpers statt roof_main, z. B. roof_barn = dunkles Scheunendach'),
      off: z.array(z.enum(EXTERIOR_GROUP_IDS)).max(16).optional().describe('Außen-Gruppen, die an diesem Baukörper entfallen, z. B. flowerBoxes'),
      barn: z.boolean().optional().describe('Scheunentor mittig im Giebel weg vom übrigen Gebäude (Torflügel, Schlupftür) und Heuluke im Giebel'),
    }).strict().optional().describe('Außengestaltung nur dieses Baukörpers'),
  })
  .strict();
type VolumeInput = z.output<typeof volumeSchema>;
const _vol: AssertCovered<Uncovered<VolumeProps, VolumeInput>> = true;
void _vol;

function volumeProps(v: VolumeInput): VolumeProps {
  const { floorHeights, roofDetail, setting, exterior, ...rest } = v;
  return {
    ...defined<VolumeProps>(rest),
    ...(floorHeights !== undefined ? { floorHeights: Object.fromEntries(Object.entries(floorHeights).map(([k, h]) => [Number(k), h])) } : {}),
    ...(roofDetail !== undefined ? { roofDetail: defined<RoofDetail>(roofDetail) } : {}),
    ...(setting !== undefined ? { setting: defined<BuildingSetting>(setting) } : {}),
    ...(exterior !== undefined ? { exterior: defined<VolumeExterior>(exterior) } : {}),
  };
}

export const PROJECT_COMMANDS: CommandTable<Project, ProjectEvent> = {
  paintRoom: command({
    summary: 'Raum malen: Rechteck auf einer Etage mit Raumtyp (überschreibt dort bestehende Räume).',
    input: (v) => z.object({ floor, rect: rectSchema, roomTypeId: z.enum(idsOf(v.roomTypes)).describe('Raumtyp'), volumeId: volumeId.optional() }),
    apply: (p: Project, i) => p.paintRoom(i.floor, rectCells(i.rect), i.roomTypeId, i.volumeId !== undefined ? { volumeId: i.volumeId } : {}),
  }),
  eraseCells: command({
    summary: 'Fläche einer Etage leeren (Räume dort entfernen oder verkleinern).',
    input: () => z.object({ floor, rect: rectSchema }),
    apply: (p: Project, i) => p.eraseCells(i.floor, rectCells(i.rect)),
  }),
  rename: command({
    summary: 'Projekt umbenennen.',
    input: () => z.object({ name: z.string().min(1).max(64).describe('neuer Name') }),
    apply: (p: Project, i) => p.rename(i.name),
  }),
  addFloor: command({
    summary: 'Etage oben (oder mit below als Keller unten) hinzufügen.',
    input: () => z.object({
      height: Int.min(FLOOR_HEIGHT.min).max(FLOOR_HEIGHT.max).optional().describe('lichte Höhe'),
      below: z.boolean().optional().describe('true = Keller unter der untersten Etage'),
    }),
    apply: (p: Project, i) => p.addFloor(defined(i)),
  }),
  setFloorHeight: command({
    summary: 'Lichte Höhe einer Etage ändern.',
    input: () => z.object({ floor, height: Int.min(FLOOR_HEIGHT.min).max(FLOOR_HEIGHT.max).describe('lichte Höhe') }),
    apply: (p: Project, i) => p.setFloorHeight(i.floor, i.height),
  }),
  removeFloor: command({
    summary: 'Oberste oder unterste Etage entfernen.',
    input: () => z.object({ floor }),
    apply: (p: Project, i) => p.removeFloor(i.floor),
  }),
  placeStairs: command({
    summary: 'Treppe von einer Etage zur nächsten setzen.',
    input: () => z.object({
      floor: floor.describe('untere Etage'),
      at: z.tuple([Coord, Coord]).describe('Zelle der ersten Stufe [x, z]'),
      facing: z.enum(DIRECTIONS).describe('Laufrichtung bergauf'),
      type: z.enum(STAIR_TYPES).default('straight').describe('Treppenart'),
      turn: z.enum(STAIR_TURNS).optional().describe('l/u/spiral: Drehrichtung'),
    }),
    apply: (p: Project, i, env) => {
      const before = p.state;
      const events = p.placeStairs(i.floor, i.at, i.facing, i.type, i.turn !== undefined ? { turn: i.turn } : {});
      // Gemeinsame Regel mit der App: keine Treppe durch gesperrte oder von Hand gesetzte Möbel (Fehler → Rücknahme)
      const link = p.state.links.find((l) => !before.links.some((b) => b.id === l.id));
      const why = link === undefined ? undefined : fixedFurnitureInStairs(before, env.ctx.catalog, link);
      if (why !== undefined) throw new Error(why);
      return events;
    },
  }),
  removeStairs: command({
    summary: 'Treppe entfernen.',
    input: () => z.object({ stairsId: z.string().min(1).describe('Treppen-ID (siehe project_get)') }),
    apply: (p: Project, i) => p.removeStairs(i.stairsId),
  }),
  assignRoomType: command({
    summary: 'Raumtyp eines Raums ändern (Einrichtung wird neu erzeugt).',
    input: (v) => z.object({ roomId, roomTypeId: z.enum(idsOf(v.roomTypes)).describe('neuer Raumtyp') }),
    apply: (p: Project, i) => p.assignRoomType(i.roomId, i.roomTypeId),
  }),
  rerollRoom: command({
    summary: 'Einrichtung eines Raums neu würfeln (gesperrte Möbel bleiben).',
    input: () => z.object({ roomId }),
    apply: (p: Project, i) => p.rerollRoom(i.roomId),
  }),
  setRoomVariant: command({
    summary: 'Variante der Einrichtung eines Raums wählen (0 = erster Wurf; deterministisch, gesperrte Möbel bleiben).',
    input: () => z.object({ roomId, variant: Int.min(0).max(9999).describe('Variante (Würfel-Zähler), 0 = erster Wurf') }),
    apply: (p: Project, i) => p.setRoomVariant(i.roomId, i.variant),
  }),
  fixRoom: command({
    summary: 'Raum fixieren oder lösen: ein fixierter Raum übersteht „Grundriss neu würfeln“ und Bautyp-Änderungen.',
    input: () => z.object({ roomId, fixed: z.boolean().describe('true = fixieren, false = lösen') }),
    apply: (p: Project, i) => p.fixRoom(i.roomId, i.fixed),
  }),
  resizeRoom: command({
    summary: 'Raum vergrößern/verkleinern: Zellen hinzufügen (Nachbarn geben sie ab) oder entfernen; der Raum behält ID, Sperren und Einrichtung. Danach project_furnish mit keep: true für den Raum und seine Nachbarn – sie behalten, was noch passt (wie der Editor).',
    input: () => z.object({
      roomId,
      add: z.array(rectSchema).max(16).optional().describe('Rechtecke, die der Raum dazubekommt'),
      remove: z.array(rectSchema).max(16).optional().describe('Rechtecke, die der Raum abgibt'),
    }),
    apply: (p: Project, i) => {
      const union = (rs: ReadonlyArray<readonly [number, number, number, number]> | undefined): CellSet =>
        (rs ?? []).reduce((acc, r) => acc.union(rectCells(r)), CellSet.empty());
      return p.resizeRoom(i.roomId, union(i.add), union(i.remove));
    },
  }),
  applyFurnishing: excluded('Ausgabe des Einrichtungs-Solvers – Nutzer lösen sie über project_furnish bzw. project_generate aus'),
  refurnishBlock: excluded('Ausgabe des Solvers für einen Bereich – Nutzer lösen sie über project_refurnish_block aus'),
  supplementFurnishing: excluded('Licht-Pass ergänzt Lichter – läuft in project_generate'),
  addPlacement: command({
    summary: 'Möbel/Komponente von Hand platzieren (bleibt beim Neu-Einrichten erhalten).',
    input: () => z.object({
      roomId,
      componentId: z.string().min(1).describe('Komponenten-ID (catalog_get kind=component)'),
      ...poseFields,
      variantId: z.string().optional().describe('Variante der Komponente'),
      seed: Int.min(0).optional().describe('Seed der Komponente'),
    }),
    apply: (p: Project, i, env) => {
      env.ctx.catalog.get(i.componentId);
      return p.addPlacement(i.roomId, i.componentId, pose(i), defined({ variantId: i.variantId, seed: i.seed }));
    },
  }),
  movePlacement: command({
    summary: 'Möbel verschieben/drehen; aufgesetzte Teile (Kerzen auf dem Tisch) folgen. Abgelehnt, wenn es aus dem Raum ragt oder an ein anderes Möbel stößt (dieselbe Prüfung wie in der App).',
    input: () => z.object({ placementId, ...poseFields }),
    apply: (p: Project, i, env) => {
      p.placement(i.placementId);
      const poses = movePoses(p.state, env.ctx.catalog, i.placementId, pose(i));
      const why = placementProblem(p.state, shellFor(p, env.session.build, themeFor(p, env.ctx)), env.ctx.catalog, i.placementId, { poses });
      if (why !== undefined) throw new Error(why);
      return [...poses].flatMap(([id, ps]) => p.movePlacement(id, ps));
    },
  }),
  swapPlacement: command({
    summary: 'Möbel tauschen oder seine Variante wechseln (gleiche Lage; danach von Hand gesetzt, bleibt beim Neu-Einrichten).',
    input: () => z.object({
      placementId,
      componentId: z.string().min(1).describe('neue Komponente (catalog_get kind=component)'),
      variantId: z.string().optional().describe('Variante der Komponente'),
    }),
    apply: (p: Project, i, env) => {
      const def = env.ctx.catalog.get(i.componentId);
      if (i.variantId !== undefined && !(def.variants ?? []).some((v) => v.id === i.variantId)) throw new Error(`Variante ${i.variantId} gibt es bei ${i.componentId} nicht`);
      p.placement(i.placementId);
      // Dieselbe Passt-Prüfung wie die App (W3-BL): im Raum-Inneren, an keinem anderen Möbel
      const why = placementProblem(p.state, shellFor(p, env.session.build, themeFor(p, env.ctx)), env.ctx.catalog, i.placementId, { swap: { componentId: i.componentId, variantId: i.variantId } });
      if (why !== undefined) throw new Error(why);
      return p.swapPlacement(i.placementId, i.componentId, defined({ variantId: i.variantId }));
    },
  }),
  removePlacement: command({
    summary: 'Platzierung entfernen.',
    input: () => z.object({ placementId }),
    apply: (p: Project, i) => p.removePlacement(i.placementId),
  }),
  lockPlacement: command({
    summary: 'Platzierung sperren (bleibt beim Neu-Würfeln).',
    input: () => z.object({ placementId }),
    apply: (p: Project, i) => p.lockPlacement(i.placementId),
  }),
  unlockPlacement: command({
    summary: 'Sperre einer Platzierung aufheben.',
    input: () => z.object({ placementId }),
    apply: (p: Project, i) => p.unlockPlacement(i.placementId),
  }),
  setTheme: command({
    summary: 'Material-Theme des Projekts wechseln (Bauweise und Grundfarben).',
    input: (v) => z.object({ themeId: z.enum(idsOf(v.themes)).describe('Theme') }),
    apply: (p: Project, i) => p.setTheme(i.themeId),
  }),
  setPalette: command({
    summary: 'Farbpalette des Projekts wechseln oder abwählen (undefined = keine). Färbt das Theme um, ohne seine Bauweise zu ändern.',
    input: (v) => z.object({ paletteId: z.enum(idsOf(v.palettes)).optional().describe('Farbpalette (siehe catalog_list Art palette); ohne Angabe wird die Farbwelt abgewählt') }),
    apply: (p: Project, i) => p.setPalette(i.paletteId),
  }),
  setPaletteOverrides: command({
    summary:
      'Blockpalette des Projekts vor dem Generieren anpassen (W13-G): Materialfamilie je Gruppe (Wand, Rahmen, Dach, Sockel, '
      + 'Boden, Akzent, Innenholz) und Familien-Tausch (z. B. oak → spruce). Ersetzt die bisherigen Überschreibungen; ohne '
      + 'Angabe gelten wieder die Farben von Theme und Palette. Gültige Familien und harmonische Vorschläge: palette_suggest.',
    input: () => z.object({ paletteOverrides: paletteOverridesSchema.optional().describe('Überschreibungen; ohne Angabe gelöscht') }),
    apply: (p: Project, i, env) => {
      const o = paletteOverridesOf(i.paletteOverrides);
      const problems = paletteOverrideProblems(o, env.ctx.platform(p.state.targetVersion.name).families);
      if (problems.length > 0) throw new Error(`Paletten-Überschreibung ungültig: ${problems.join('; ')}`);
      return p.setPaletteOverrides(o);
    },
  }),
  setStoryState: command({
    summary:
      'Nutzungszustand des Baus setzen (neu, bewohnt, verlassen, verfallen, belagert) oder abwählen. Erzählt dieselbe '
      + 'Geometrie anders: material- und ortsbezogene Spuren (Flechten/Risse am Stein, entrindetes Holz, vergraute '
      + 'Farbflächen, Laufspur an der Tür), deterministisch aus dem Projekt-Seed. Ohne Angabe wie bisher.',
    input: () => z.object({
      storyState: z.enum(STORY_STATES).optional()
        .describe('Zustand: neu = kaum Spuren, bewohnt = Grundzustand, verlassen = still/ungepflegt, verfallen = Ruine, belagert = Risse statt Bewuchs; ohne Angabe wird der Zustand abgewählt'),
    }),
    apply: (p: Project, i) => p.setStoryState(i.storyState),
  }),
  setMood: command({
    summary:
      'Stimmung des Baus setzen oder abschalten: vier Achsen −1 … +1 – wear (ordentlich … verwittert), '
      + 'richness (karg … üppig), formality (gemütlich … repräsentativ), organic (symmetrisch … organisch). {} schaltet die '
      + 'Vorgabe des Themes ein. Wirkt nur auf weiche Größen (Möbelwahl, Deko-Menge, Verwitterung), nie auf Erreichbarkeit, '
      + 'Licht oder Pflichtmöbel. Ohne Angabe wird die Stimmung abgeschaltet (wie bisher).',
    input: () => z.object({
      mood: moodSchema.optional().describe('Stimmung; {} = Vorgabe des Themes; ohne Angabe abgeschaltet'),
    }),
    apply: (p: Project, i) => p.setMood(i.mood === undefined ? undefined : defined<MoodVector>(i.mood)),
  }),
  setInteriorDecor: command({
    summary:
      'Innen-Deko-Stufe setzen oder abschalten: etwas = Wandschmuck, Pflanzen, Teppich und Kerzen in Wohn-, Schlaf-, Ess-, '
      + 'Arbeits- und Empfangsräumen; reich = deutlich mehr, dazu Hängendes an der Decke. Wege, Türen, Fenster und das '
      + 'Lichtbudget bleiben frei; Funktionsräume bleiben unberührt. Wirkt bei der nächsten Einrichtung. Ohne Angabe wird die '
      + 'Deko-Stufe abgeschaltet (wie bisher).',
    input: () => z.object({
      interiorDecor: z.enum(INTERIOR_DECORS).optional().describe('Stufe: etwas oder reich; ohne Angabe abgeschaltet'),
    }),
    apply: (p: Project, i) => p.setInteriorDecor(i.interiorDecor),
  }),
  setTargetVersion: command({
    summary: 'Minecraft-Zielversion wechseln.',
    input: () => z.object({ version: z.enum(VERSIONS).describe('Zielversion') }),
    apply: (p: Project, i) => p.setTargetVersion(TARGET_VERSIONS[i.version]),
  }),
  addVolume: command({
    summary: 'Baukörper anlegen (eigenes Dach, eigene Höhe; z. B. Anbau, Turm). ID steht in den Events.',
    input: () => volumeSchema,
    apply: (p: Project, i) => p.addVolume(volumeProps(i)),
  }),
  changeVolume: command({
    summary: 'Eigenschaften eines Baukörpers ersetzen.',
    input: () => volumeSchema.extend({ volumeId }),
    apply: (p: Project, i) => {
      const { volumeId: id, ...props } = i;
      return p.changeVolume(id, volumeProps(props));
    },
  }),
  removeVolume: command({
    summary: 'Baukörper entfernen (mit reassign wandern seine Räume in den Standard-Baukörper).',
    input: () => z.object({ volumeId, reassign: z.boolean().optional().describe('Räume umhängen statt Fehler') }),
    apply: (p: Project, i) => p.removeVolume(i.volumeId, defined({ reassign: i.reassign })),
  }),
  assignRoomVolume: command({
    summary: 'Räume einem Baukörper zuordnen.',
    input: () => z.object({ roomIds: z.array(roomId).min(1).describe('Räume'), volumeId }),
    apply: (p: Project, i) => p.assignRoomVolume(i.roomIds, i.volumeId),
  }),
  applyBuildingType: command({
    summary: 'Bautyp-Grundriss auf das Projekt anwenden (Bautyp-Räume werden ersetzt; eigene Räume und Räume mit gesperrten oder von Hand gesetzten Möbeln bleiben; Stil des Bautyps wird übernommen).',
    input: (v) => z.object(buildingTypeFields(v)),
    apply: (p: Project, i, env) => {
      const plan = applyBuildingType(p, env.ctx.buildingTypes.get(i.buildingTypeId), buildingParams(i), env.ctx);
      env.session.build = { ...env.session.build, ...withoutPilastersForTheme(planBuildOptions(plan), env.ctx.themes, p.state.themeId) };
      return plan.warnings;
    },
  }),
  rerollBuildingType: command({
    summary: 'Grundriss des Bautyps neu würfeln (nur für Projekte aus einem Bautyp; eigene Räume und Räume mit gesperrten oder von Hand gesetzten Möbeln bleiben).',
    input: () => z.object({}),
    apply: (p: Project, _i, env) => {
      const o = p.state.origin;
      if (o === undefined) throw new Error('Projekt stammt aus keinem Bautyp');
      const plan = rerollBuildingType(p, env.ctx.buildingTypes.get(o.buildingTypeId), env.ctx);
      env.session.build = { ...env.session.build, ...withoutPilastersForTheme(planBuildOptions(plan), env.ctx.themes, p.state.themeId) };
      return plan.warnings;
    },
  }),
};
