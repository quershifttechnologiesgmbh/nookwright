/**
 * `rooms_generate`: Haus aus gemalten Räumen (Rechtecke je Etage + Raumtyp) ohne Bautyp – der Editor-Weg als
 * JSON. Treppen verbinden Etagen; Stil wie bei `building_generate`; optional Gelände um das Haus.
 */
import { z } from 'zod';
import { FLOOR_HEIGHT, Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet, type MoodVector } from '@mcda/core';
import { applyAutoStairs, applyNewProjectMood, autoStairsText, buildingOf, generateBase, shellFor, themeFor, withFacadeRhythm, type BaseOptions, type BuildOptions, type SurroundingsInput } from '@mcda/pipeline';
import { Site, plotAround } from '@mcda/terrain';
import { defineOperation, type AssertCovered, type Uncovered } from '../operation.js';
import { structuresOf, structuresSchema } from '../structures.js';
import { MOOD_DESCRIPTION, blockRulesOf, blockRulesSchema, defined, exteriorSchema, exteriorStyle, moodSchema, shellSchema } from '../style.js';
import {
  DIRECTIONS, EXPORT_FORMATS, FACADE_RHYTHMS, LANDFORMS, SITE_TEMPLATE_IDS, STAIR_TURNS, INTERIOR_DECORS, STAIR_TYPES, STORY_STATES, VERSIONS, SURFACE_TEXTURE_IDS, WEATHERING_IDS, idsOf, type Vocabulary,
} from '../vocabulary.js';
import { SITE_DECOR_IDS } from '../aggregates/site.js';
import { worldResult } from './result.js';

const Int = z.number().int();
const Coord = Int.min(-256).max(256);

export const roomsGenerateInput = (v: Vocabulary) =>
  z
    .object({
      name: z.string().min(1).max(64).default('Haus').describe('Projektname (steht in der Schematic)'),
      floorHeights: z.array(Int.min(FLOOR_HEIGHT.min).max(FLOOR_HEIGHT.max)).min(1).max(8).default([3])
        .describe('lichte Höhe je Etage ab Erdgeschoss; Länge = Zahl der Etagen'),
      rooms: z
        .array(
          z
            .object({
              floor: Int.min(0).max(7).describe('Etage (0 = Erdgeschoss)'),
              roomTypeId: z.enum(idsOf(v.roomTypes)).describe('Raumtyp'),
              rect: z.tuple([Coord, Coord, Coord, Coord]).describe('Rechteck [x0, z0, x1, z1] in Blöcken (Außenmaß, inklusive)'),
            })
            .strict(),
        )
        .min(1).max(64)
        .describe('Räume; Rechtecke derselben Etage dürfen sich nicht überlappen (später gemalte gewinnen)'),
      stairs: z
        .array(
          z
            .object({
              floor: Int.min(0).max(6).describe('untere Etage'),
              at: z.tuple([Coord, Coord]).describe('Startzelle [x, z]'),
              facing: z.enum(DIRECTIONS).describe('Laufrichtung'),
              type: z.enum(STAIR_TYPES).default('straight').describe('Treppenart'),
              turn: z.enum(STAIR_TURNS).optional().describe('l/u: Drehrichtung'),
            })
            .strict(),
        )
        .max(16).default([])
        .describe('Treppen zwischen Etagen'),
      autoStairs: z.boolean().optional()
        .describe('Treppen automatisch (W11-A): jede Etage ohne Treppe zur Nachbar-Etage bekommt eine – in Eingangshalle/Flur bevorzugt, Schlafzimmer nur ohne Alternative, gestapelt, nie auf Kosten eines Pflichtmöbels; angegebene stairs bleiben. Ohne Angabe wie bisher (nur die angegebenen Treppen)'),
      themeId: z.enum(idsOf(v.themes)).optional().describe('Material-Theme; Standard das erste des Katalogs'),
      shell: shellSchema.optional().describe('Dach, Fenster, Gauben, Fassade; Standard Satteldach'),
      exterior: exteriorSchema.optional().describe('Außen-Deko; ohne Angabe keine'),
      storyState: z.enum(STORY_STATES).optional()
        .describe('Nutzungszustand (Q5/P15): neu = kaum Spuren, bewohnt = Grundzustand, verlassen = still/ungepflegt, verfallen = Ruine, belagert = Risse statt Bewuchs. Ändert nur Materialspuren, nie den Grundriss; ohne Angabe wie bisher'),
      mood: moodSchema.optional().describe(MOOD_DESCRIPTION),
      interiorDecor: z.enum(INTERIOR_DECORS).optional().describe('Innen-Deko in Wohn-, Schlaf-, Ess-, Arbeits- und Empfangsräumen (Lichtbudget und Wege bleiben, Funktionsräume unberührt): some = etwas (Wandbilder, Pflanzen, Kerzen, Teppich), rich = reichlich (dazu Bordürenteppich, Pflanzenständer, Regal-Auslagen, Sesselecke). Ohne Angabe keine Zusatz-Deko'),
      lighting: z.boolean().default(true).describe('Lichter ergänzen (spawnsicher, Stimmung je Raumtyp)'),
      facadeRhythm: z.enum(FACADE_RHYTHMS).optional().describe('Fassadenrhythmus (Bauprozess Schritt 4, Feature-Schalter): off = wie bisher (Standard, Ergebnis bitgleich); on = flache Wände bekommen Fensterachsen im Takt (spiegelsymmetrisch, Mindestdichte, Abstand zu Ecken, Pfosten und Türen) und leere Dachflächen Gauben, passend zur Dachform. Erreichbarkeit, Licht und Pflichtobjekte bleiben hart – Fenster entstehen nur, wo innen Boden und außen Luft ist. Ohne Angabe off'),
      loopDoors: z.number().min(0).max(1).optional()
        .describe('Zusatztüren für Rundgänge: Wahrscheinlichkeit je benachbartem, noch nicht verbundenem Raumpaar (0–1; Schlafzimmer, Bad, Schatzkammer, Kerker ausgenommen); ohne Angabe ein Türbaum wie bisher'),
      blockRules: blockRulesSchema.optional().describe('Blöcke sperren und ersetzen (z. B. preset easy_farm); ohne Angabe keine Sperren'),
      surroundings: z
        .object({
          terrainStyleId: z.enum(idsOf(v.terrainStyles)).describe('Geländestil'),
          template: z.enum(SITE_TEMPLATE_IDS).optional().describe('Vorlage: homestead = Hof, Garten, Feld, Koppel'),
          margin: Int.min(4).max(48).default(12).describe('Grundstücksrand um das Haus in Blöcken'),
        })
        .strict()
        .optional()
        .describe('Gelände um das Haus; ohne Angabe keins'),
      structures: structuresSchema.optional().describe('Mauern, Türme, Windmühlen, angedockte Türme'),
      ensemble: z.boolean().optional()
        .describe('Verbindungsgraph der Base (F-Ensemble): Holzbrücken aus Obergeschossen zum Wehrgang bzw. Nachbargebäude, Anschluss- und Rundwege; ohne Angabe der Standard (derzeit aus)'),
      landform: z.enum(LANDFORMS).optional()
        .describe('Geländeform: flat = ebenes Grundstück (Standard, Ergebnis wie bisher); natural = sanfter Hang hinter dem Haus mit Stützmauer am Sockel, Teich, Findlingen, Moosflecken, Farn am Sockel und dichterer Bepflanzung; dramatic = hoher Hang mit zwei Terrassen, mehr Findlinge und Moos. Der Eingang und der Weg zum Grundstücksrand bleiben ohne Stufen begehbar. Bautypen ohne eigenes Grundstück bekommen dafür eine Wiese rundum; wirkt nur mit surroundings; ohne Angabe flat'),
      tiledWfc: z.boolean().optional()
        .describe('Tiled-WFC-Details (Feature-Schalter, Standard aus): Zinnenfolge, Pflaster von Platz und Hof, Beete und Feldbänder aus einem kleinen Kachel-Solver mit Gewichten je Theme; immer spiegelsymmetrisch. Ohne Angabe wie bisher'),
      siteDecor: z.enum(SITE_DECOR_IDS).optional()
        .describe('Grundstücks-Deko (Feature-Schalter): off = keine (Standard), some = wenige Teile, rich = dichter; Holzplatz, Kräuter- und Kürbisbeet, Bank am Weg, Bannermasten am Eingang, Torbogen, Standbilder je Theme, dazu Pferch (Stall, Hühnerhaus), Bienenhof (Imkerei), Gräber (Kapelle), Marktstand (Handelsraum, Schenke) nach den Räumen; braucht das Gelände (surroundings). Ohne Angabe wie bisher'),
      weathering: z.enum(WEATHERING_IDS).optional()
        .describe('Erzählende Verwitterung (Feature-Schalter, Schritt 5): off = keine (Standard), some = wenige Cluster, rich = dichter; Regenstreifen unter Fenstern, Schatten unter Überhängen und Dachkanten, Moos und Bruchstein am Sockel, Dachtäler mit Wasserablauf, Moos an Bäumen; jeder Fleck läuft über eine Übergangskachel in die Grundfarbe aus, Stärke folgt Stimmung wear und Zustand (storyState); nur Blocktausch, Geometrie und Spielbarkeit bleiben. Ohne Angabe wie bisher'),
      surfaceTexture: z.enum(SURFACE_TEXTURE_IDS).optional()
        .describe('Oberflächen-Textur (Feature-Schalter, TX-B): off = keine (Standard), subtle = dezent, rich = kräftig; zusammenhängende Blockmischung aus Schwesterblöcken (60 % Grundblock, 25 % nah, 15 % Akzent) auf Wand, Sockel und Dachhaut, Sockel und Wandreihe unter Gesims/Traufe dunkler, Dach von der Traufe (dunkler) zum First (heller), Kontrast an Ecken und Fensterlaibungen, Streublöcke gegen gleichblockige Flächen; jede Änderung folgt einer benannten Regel, Stärke folgt dem Zustand (storyState); läuft vor der Verwitterung; nur Blocktausch, Geometrie und Spielbarkeit bleiben. Ohne Angabe wie bisher'),
      targetVersion: z.enum(VERSIONS).default('1.21.11').describe('Minecraft-Java-Zielversion'),
      seed: Int.min(0).max(2 ** 31 - 1).default(1).describe('Zufalls-Seed; gleicher Seed = gleiches Ergebnis'),
      format: z.enum(EXPORT_FORMATS).default('litematic').describe('Exportformat der Datei'),
    })
    .strict();

type Input = z.output<ReturnType<typeof roomsGenerateInput>>;

// Compile-Zeit-Zwang (ADR 12)
/**
 * `corridorTypes`: Katalog-Standard; `annexes`/`extraCells`: Kopplung anderer Kontexte (über `generateBase`);
 * Stil-Felder über `shell`, `exterior` und `lighting`.
 */
type BuildInternal = 'corridorTypes' | 'annexes' | 'extraCells' | keyof NonNullable<Input['shell']>;
const _build: AssertCovered<Uncovered<BuildOptions, Input, BuildInternal>> = true;
/** `site`/`terrainStyle` über `surroundings`; `attachedTowers` über `structures`; `structureSeed` = Projekt-Seed. */
type SurroundingsCovered = 'site' | 'terrainStyle' | 'structureSeed' | 'attachedTowers';
const _sur: AssertCovered<Uncovered<SurroundingsInput, Input, SurroundingsCovered>> = true;
void [_build, _sur];

export const roomsGenerate = defineOperation({
  id: 'rooms_generate',
  summary:
    'Baut ein Haus aus frei angegebenen Räumen (Rechtecke je Etage mit Raumtyp) und Treppen, richtet es ein und '
    + 'exportiert es. Nur wählen, wenn der Nutzer Räume, Maße oder einen Grundriss konkret vorgibt.',
  input: roomsGenerateInput,
  cacheable: true,
  run(input: Input, ctx, v) {
    const themeId = input.themeId ?? v.themes[0]?.id ?? 'medieval';
    const p = Project.create({
      id: 'rooms', name: input.name, seed: input.seed, themeId, targetVersion: TARGET_VERSIONS[input.targetVersion],
      floor: { y0: 0, height: input.floorHeights[0]! },
    });
    for (const h of input.floorHeights.slice(1)) p.addFloor({ height: h });
    const top = input.floorHeights.length - 1;
    for (const r of input.rooms) {
      if (r.floor > top) throw new Error(`Raum ${r.roomTypeId}: Etage ${r.floor} fehlt (floorHeights hat ${top + 1})`);
      const [x0, z0, x1, z1] = r.rect;
      p.paintRoom(r.floor, CellSet.rect(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)), r.roomTypeId);
    }
    for (const s of input.stairs) p.placeStairs(s.floor, s.at, s.facing, s.type, s.turn !== undefined ? { turn: s.turn } : {});
    // W11-A: fehlende Treppen nach derselben Regel wie der Editor (vor Stil und Einrichtung, wie dort)
    const autoNote = input.autoStairs === true ? autoStairsText(applyAutoStairs(p, { catalog: ctx.catalog }), p.state, ctx.catalog) : '';
    // Nutzungszustand (Q5/P15): gehört zum Projekt; die Materialisierung liest ihn vom Projektzustand.
    if (input.storyState !== undefined) p.setStoryState(input.storyState);
    // feat/theme-moods: Stimmung gehört zum Projekt wie der Zustand
    // B4: neue Projekte mit der Stimmung des Themes; ausdrückliches `mood` hat Vorrang
    applyNewProjectMood(p, input.mood !== undefined ? defined<MoodVector>(input.mood) : undefined);
    // feat/int-decor: Innen-Deko-Stufe gehört zum Projekt (Pass in generate)
    if (input.interiorDecor !== undefined) p.setInteriorDecor(input.interiorDecor);

    const shell = defined<Partial<BuildOptions>>(input.shell ?? {});
    const exterior = exteriorStyle(input.exterior, undefined);
    const blockRules = input.blockRules !== undefined ? blockRulesOf(input.blockRules) : undefined;
    const build: BuildOptions = withFacadeRhythm({
      roof: 'gable', ...shell, ...(exterior !== undefined ? { exterior } : {}), ...(input.lighting ? {} : { lighting: false as const }),
      ...(blockRules !== undefined ? { blockRules } : {}),
      ...(input.loopDoors !== undefined ? { loopDoors: input.loopDoors } : {}),
    }, input.facadeRhythm);
    let around: SurroundingsInput = {};
    const notes: string[] = autoNote === '' ? [] : [autoNote];
    if (input.surroundings !== undefined) {
      const sur = input.surroundings;
      const building = buildingOf(shellFor(p, build, themeFor(p, ctx)));
      const site = Site.create({ id: 'rooms-site', projectId: p.state.id, seed: input.seed, styleId: sur.terrainStyleId, plot: plotAround(building, sur.margin) });
      if (sur.template !== undefined) site.applyTemplate(sur.template, building);
      around = { site: site.state };
    }
    const st = input.structures !== undefined ? structuresOf(input.structures) : undefined;
    const opts: BaseOptions = {
      ...build, ...around,
      ...(st !== undefined ? { structures: st.structures } : {}),
      ...(st !== undefined && st.attachedTowers.length > 0 ? { attachedTowers: st.attachedTowers } : {}),
      ...(input.ensemble !== undefined ? { ensemble: input.ensemble ? {} : false as const } : {}),
      ...(input.landform !== undefined && around.site !== undefined ? { landform: input.landform } : {}),
      ...(input.tiledWfc !== undefined ? { tiledWfc: input.tiledWfc } : {}),
      ...(input.siteDecor !== undefined ? { siteDecor: input.siteDecor } : {}),
      ...(input.weathering !== undefined && input.weathering !== 'off' ? { weathering: input.weathering } : {}),
      ...(input.surfaceTexture !== undefined && input.surfaceTexture !== 'off' ? { surfaceTexture: input.surfaceTexture } : {}),
    };
    const world = generateBase(p, ctx, opts);
    return worldResult(p, world, { targetVersion: input.targetVersion, seed: input.seed, format: input.format }, notes, world.surroundings.warnings);
  },
});
