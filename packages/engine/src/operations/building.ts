/**
 * `building_generate`: Bautyp + Parameter + Seed → komplette Base (Haus, Einrichtung, Außen, Gelände, Bauwerke) →
 * Export-Volumen. Ein Aufruf, zustandslos: „Neu würfeln“ ist `rerollCount`, „anderer Stil“ ist `themeId`/`shell`.
 */
import { z } from 'zod';
import type { PlanShell } from '@mcda/archetype';
import { TARGET_VERSIONS, type BuildingSetting } from '@mcda/blueprint';
import { generateBase, projectFromBuildingType, qualityMeasures, withoutPilastersForTheme, type BuildingTypeParams } from '@mcda/pipeline';
import { defineOperation, type AssertCovered, type Uncovered } from '../operation.js';
import { MOOD_DESCRIPTION, PALETTE_OVERRIDES_DESCRIPTION, paletteOverridesOf, paletteOverridesSchema, blockRulesOf, blockRulesSchema, defined, exteriorSchema, exteriorStyle, moodSchema, shellSchema } from '../style.js';
import type { MoodVector } from '@mcda/core';
import { DIRECTIONS, EXPORT_FORMATS, FACADE_RHYTHMS, FUNCTION_LEVELS, LANDFORMS, SETTING_KINDS, SILHOUETTES, SIZE_CLASSES, INTERIOR_DECORS, STORY_STATES, VERSIONS, SURFACE_TEXTURE_IDS, WEATHERING_IDS, idsOf, type Vocabulary } from '../vocabulary.js';
import { SITE_DECOR_IDS } from '../aggregates/site.js';
import { measuresSummary, worldResult } from './result.js';

const Int = z.number().int();

const settingSchema = z
  .object({
    kind: z.enum(SETTING_KINDS).describe('Lage: ground = ebenerdig (normal), buried = im Erdhügel bzw. unter der Erde (Erdhaus), cliff = am Hang, carved = in den Fels gehauen, stilts = Pfahlbau auf Stelzen, tree = im Baum, water = am Wasser, underwater = unter Wasser. Gebaut werden heute nur ground und buried; die anderen entstehen ebenerdig, das Ergebnis nennt es in notes'),
    front: z.enum(DIRECTIONS).optional().describe('Einzige sichtbare Seite bei buried, cliff, carved: north = Norden, east = Osten, south = Süden, west = Westen'),
    height: Int.min(0).max(32).optional().describe('stilts/tree: Höhe über dem Gelände'),
    cover: Int.min(0).max(8).optional().describe('buried: Erdlagen über dem Dach'),
  })
  .strict();

/** Felder eines Bautyp-Aufrufs – gemeinsam für `building_generate`, `project_create` und den Befehl `applyBuildingType`. */
export const buildingTypeFields = (v: Vocabulary) => ({
  buildingTypeId: z.enum(idsOf(v.buildingTypes)).describe('Bautyp (siehe catalog_describe)'),
  size: z.enum(SIZE_CLASSES).optional().describe('Größenklasse: S = klein, M = mittel, L = groß; nicht jeder Bautyp hat jede'),
  floors: Int.min(1).max(8).optional().describe('Etagen ab Erdgeschoss, in den Grenzen der Größe'),
  front: z.enum(DIRECTIONS).optional().describe('Blickrichtung der Front bzw. des Eingangs (Straße): north = Norden, east = Osten, south = Süden, west = Westen; Standard south'),
  setting: settingSchema.optional().describe('Lage im Gelände; ohne Angabe die des Bautyps (meist ground)'),
  shell: shellSchema.optional().describe('Stil-Vorgaben (Dach, Fenster, Gauben, Fassade), die den Bautyp überschreiben'),
  paletteId: z.enum(idsOf(v.palettes)).optional().describe('Farbpalette neben dem Theme (siehe catalog_list Art palette); färbt das Theme um, ohne seine Bauweise zu ändern'),
  paletteOverrides: paletteOverridesSchema.optional().describe(PALETTE_OVERRIDES_DESCRIPTION),
  storyState: z.enum(STORY_STATES).optional()
    .describe('Nutzungszustand (Q5/P15): neu = kaum Spuren, bewohnt = Grundzustand, verlassen = still/ungepflegt, verfallen = Ruine, belagert = Risse statt Bewuchs. Ändert nur Materialspuren, nie den Grundriss; ohne Angabe wie bisher'),
  mood: moodSchema.optional().describe(MOOD_DESCRIPTION),
  interiorDecor: z.enum(INTERIOR_DECORS).optional().describe('Innen-Deko in Wohn-, Schlaf-, Ess-, Arbeits- und Empfangsräumen (Lichtbudget und Wege bleiben, Funktionsräume unberührt): some = etwas (Wandbilder, Pflanzen, Kerzen, Teppich), rich = reichlich (dazu Bordürenteppich, Pflanzenständer, Regal-Auslagen, Sesselecke). Ohne Angabe keine Zusatz-Deko'),
  rerollCount: Int.min(0).max(999).default(0).describe('Variante: anderer Grundriss bei gleichem Seed'),
  underground: z.boolean().optional()
    .describe('Unterbau „Keller & Gewölbe darunter“: Keller- bzw. Dungeon-Ebene unter und um das Haus – Räume nach Bautyp (Weinkeller, Lager, Kerker, Schatzkammer …), mit Gängen und Rundwegen verbunden, Treppe am Treppenkern. true = an, false = aus; ohne Angabe der Standard des Bautyps'),
  functionLevel: z.enum(FUNCTION_LEVELS).optional()
    .describe('Funktionsgrad: wie viele funktionale Anlagen das Gebäude bekommt. off = keine (Standard, Ergebnis wie bisher); some = 1–2 passende Funktionsräume je nach Bautyp und Größe (Langhaus: Lager mit Sortierer, Fleischerei; Bauernhaus: Kräuter-/Anbauhalle, Stall; Wachturm: Tresor, Geheimstudie; Burg: Produktion, Schmelze, Dorfbewohner-Halle; Taverne: Brauerei, Backstube; Handwerkerhaus: Werkstatt); rich = mehr und größere Anlagen, wo Platz ist (z. B. Redstone-Werkstatt, Spawner-Kammer, Imkerei). Die Räume stehen im Grundriss mit Tür und Treppe erreichbar; nicht jeder Bautyp hat Funktionsräume (feste Grundrisse wie house/hall/timber/twostory ohne Wirkung); ohne Angabe off'),
  landform: z.enum(LANDFORMS).optional()
    .describe('Geländeform: flat = ebenes Grundstück (Standard, Ergebnis wie bisher); natural = sanfter Hang hinter dem Haus mit Stützmauer am Sockel, Teich, Findlingen, Moosflecken, Farn am Sockel und dichterer Bepflanzung; dramatic = hoher Hang mit zwei Terrassen, mehr Findlinge und Moos. Der Eingang und der Weg zum Grundstücksrand bleiben ohne Stufen begehbar. Bautypen ohne eigenes Grundstück bekommen dafür eine Wiese rundum; ohne Angabe flat'),
  silhouette: z.enum(SILHOUETTES).optional()
    .describe('Silhouette (Schritt 2 „Grundform“): off = wie bisher (Standard, bitgleich); varied = Einzelbauten (Taverne, Langhaus, Wachturm) bekommen einen niedrigeren Anbau mit eigener Dachform und -höhe und ungeraden Wandlängen, damit der Umriss nicht nur ein Kasten ist; zusammengesetzte Bauten (Bauernhaus, Burg) bleiben unverändert. Treppen, Räume, Erreichbarkeit und Licht bleiben; ohne Angabe off'),
  facadeRhythm: z.enum(FACADE_RHYTHMS).optional()
    .describe('Fassadenrhythmus (Bauprozess Schritt 4, Feature-Schalter): off = wie bisher (Standard, Ergebnis bitgleich); on = flache Wände bekommen Fensterachsen im Takt (spiegelsymmetrisch, Mindestdichte, Abstand zu Ecken, Pfosten und Türen) und leere Dachflächen Gauben, passend zur Dachform. Erreichbarkeit, Licht und Pflichtobjekte bleiben hart – Fenster entstehen nur, wo innen Boden und außen Luft ist. Ohne Angabe off'),
  loopDoors: z.number().min(0).max(1).optional()
    .describe('Zusatztüren für Rundgänge im Haus: Wahrscheinlichkeit je benachbartem, noch nicht verbundenem Raumpaar (0–1, üblich 0.15; Schlafzimmer, Bad, Schatzkammer, Kerker ausgenommen); ohne Angabe ein Türbaum wie bisher'),
});

/**
 * Feineinstellung des Unterbaus (`UndergroundParams`: `rooms`, `loops`, `margin`) bewusst NICHT in der API (ADR 12,
 * Review A2): Stellschrauben für Messung und Tests, keine Nutzer-Fähigkeit – Raumzahl folgt der Größe, Rundwege und
 * Rand sind auf die Bautypen abgestimmt. Die API kennt nur den Schalter (`underground`: an/aus), den auch das
 * Entscheidungsmodell fragen kann; der Nutzer der App ebenso (Haken „Keller & Gewölbe darunter“).
 */

export const buildingTypeSchema = (v: Vocabulary) => z.object(buildingTypeFields(v)).strict();
type BuildingTypeInput = z.output<ReturnType<typeof buildingTypeSchema>>;

/** API-Eingabe → Parameter des Anwendungsdienstes. */
export function buildingParams(input: BuildingTypeInput): BuildingTypeParams {
  return {
    ...(input.size !== undefined ? { size: input.size } : {}),
    ...(input.floors !== undefined ? { floors: input.floors } : {}),
    ...(input.front !== undefined ? { front: input.front } : {}),
    ...(input.setting !== undefined ? { setting: defined<BuildingSetting>(input.setting) } : {}),
    ...(input.shell !== undefined ? { shell: defined<Partial<PlanShell>>(input.shell) } : {}),
    ...(input.paletteId !== undefined ? { paletteId: input.paletteId } : {}),
    ...(() => { const o = paletteOverridesOf(input.paletteOverrides); return o !== undefined ? { paletteOverrides: o } : {}; })(),
    ...(input.storyState !== undefined ? { storyState: input.storyState } : {}),
    ...(input.mood !== undefined ? { mood: defined<MoodVector>(input.mood) } : {}),
    ...(input.interiorDecor !== undefined ? { interiorDecor: input.interiorDecor } : {}),
    ...(input.underground !== undefined ? { underground: input.underground } : {}),
    ...(input.functionLevel !== undefined ? { functionLevel: input.functionLevel } : {}),
    ...(input.loopDoors !== undefined ? { loopDoors: input.loopDoors } : {}),
    ...(input.landform !== undefined ? { landform: input.landform } : {}),
    ...(input.silhouette !== undefined && input.silhouette !== 'off' ? { silhouette: input.silhouette } : {}),
    ...(input.facadeRhythm !== undefined ? { facadeRhythm: input.facadeRhythm } : {}),
    rerollCount: input.rerollCount,
  };
}

export const buildingGenerateInput = (v: Vocabulary) =>
  z
    .object({
      ...buildingTypeFields(v),
      themeId: z.enum(idsOf(v.themes)).optional().describe('Material-Theme; ohne Angabe das erste passende des Bautyps, sonst medieval'),
      exterior: exteriorSchema.optional().describe('Außen-Deko (Fensterläden, Portal, Laternen …), überschreibt den Bautyp'),
      targetVersion: z.enum(VERSIONS).default('1.21.11').describe('Minecraft-Java-Zielversion'),
      surroundings: z.boolean().default(true).describe('Gelände und Bauwerke (Garten, Mauer, Türme) mit erzeugen'),
      blockRules: blockRulesSchema.optional().describe('Blöcke sperren und ersetzen (z. B. preset easy_farm); ohne Angabe keine Sperren'),
      ensemble: z.boolean().optional()
        .describe('Verbindungsgraph der Base (F-Ensemble): Holzbrücken aus Obergeschossen zum Wehrgang bzw. Nachbargebäude, Anschluss- und Rundwege; ohne Angabe der Standard (derzeit aus)'),
      tiledWfc: z.boolean().optional()
        .describe('Tiled-WFC-Details (Feature-Schalter, Standard aus): Zinnenfolge, Pflaster von Platz und Hof, Beete und Feldbänder aus einem kleinen Kachel-Solver mit Gewichten je Theme; immer spiegelsymmetrisch. Ohne Angabe wie bisher'),
      siteDecor: z.enum(SITE_DECOR_IDS).optional()
        .describe('Grundstücks-Deko (Feature-Schalter): off = keine (Standard), some = wenige Teile, rich = dichter; Holzplatz, Kräuter- und Kürbisbeet, Bank am Weg, Bannermasten am Eingang, Torbogen, Standbilder je Theme, dazu Pferch (Stall, Hühnerhaus), Bienenhof (Imkerei), Gräber (Kapelle), Marktstand (Handelsraum, Schenke) nach den Räumen; braucht das Gelände (surroundings). Ohne Angabe wie bisher'),
      weathering: z.enum(WEATHERING_IDS).optional()
        .describe('Erzählende Verwitterung (Feature-Schalter, Schritt 5): off = keine (Standard), some = wenige Cluster, rich = dichter; Regenstreifen unter Fenstern, Schatten unter Überhängen und Dachkanten, Moos und Bruchstein am Sockel, Dachtäler mit Wasserablauf, Moos an Bäumen; jeder Fleck läuft über eine Übergangskachel in die Grundfarbe aus, Stärke folgt Stimmung wear und Zustand (storyState); nur Blocktausch, Geometrie und Spielbarkeit bleiben. Ohne Angabe wie bisher'),
      measure: z.boolean().optional()
        .describe('Qualitäts-Messung (MX-Q, nur lesen, ändert nichts am Bau): true = die Antwort enthält measures mit Fassadenmaßen (Articulation-Index von Grundriss und Frontansicht = Fläche/konvexe Hülle, Symmetrie-Differenz der Front, Entropie des Fensterrasters), Detail-Obergrenze (Anteil der Wandfläche ohne Detailblock, Richtwert mindestens ein Drittel; Detailfarbe gegen Rahmenfarbe) und Bodenverbindung/Auflager (schwebende Teile, Überstände ohne Stütze) samt weichen Befunden (lints). Ohne Angabe fehlt das Feld'),
      surfaceTexture: z.enum(SURFACE_TEXTURE_IDS).optional()
        .describe('Oberflächen-Textur (Feature-Schalter, TX-B): off = keine (Standard), subtle = dezent, rich = kräftig; zusammenhängende Blockmischung aus Schwesterblöcken (60 % Grundblock, 25 % nah, 15 % Akzent) auf Wand, Sockel und Dachhaut, Sockel und Wandreihe unter Gesims/Traufe dunkler, Dach von der Traufe (dunkler) zum First (heller), Kontrast an Ecken und Fensterlaibungen, Streublöcke gegen gleichblockige Flächen; jede Änderung folgt einer benannten Regel, Stärke folgt dem Zustand (storyState); läuft vor der Verwitterung; nur Blocktausch, Geometrie und Spielbarkeit bleiben. Ohne Angabe wie bisher'),
      seed: Int.min(0).max(2 ** 31 - 1).default(1).describe('Zufalls-Seed; gleicher Seed = gleiches Ergebnis'),
      format: z.enum(EXPORT_FORMATS).default('litematic').describe('Exportformat der Datei: litematic = Litematica, schem = Schematic (WorldEdit, .schem), nbt = Strukturblock (NBT)'),
    })
    .strict();

type Input = z.output<ReturnType<typeof buildingGenerateInput>>;

// Compile-Zeit-Zwang (ADR 12): Jeder Parameter des Anwendungsdienstes ist in der API oder begründet ausgenommen.
/** `projectId`/`at`: Adapter-Sache (Speicherort, Lage im Editor-Raster); `reroll` wird aus `rerollCount` abgeleitet. */
type InternalParams = 'projectId' | 'at' | 'reroll';
const _params: AssertCovered<Uncovered<BuildingTypeParams, Input, InternalParams>> = true;
const _shell: AssertCovered<Uncovered<PlanShell, NonNullable<Input['shell']>>> = true;
const _setting: AssertCovered<Uncovered<BuildingSetting, NonNullable<Input['setting']>>> = true;
void [_params, _shell, _setting];

export const buildingGenerate = defineOperation({
  id: 'building_generate',
  summary:
    'Erzeugt ein komplettes, eingerichtetes Gebäude samt Gelände aus einem Bautyp (Haus, Taverne, Burg, Erdhaus …) '
    + 'und exportiert es als Minecraft-Schematic. Für jede Bitte, etwas zu bauen oder zu generieren.',
  input: buildingGenerateInput,
  cacheable: true,
  run(input: Input, ctx) {
    const def = ctx.buildingTypes.get(input.buildingTypeId);
    const params: BuildingTypeParams = {
      ...buildingParams(input),
      ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
      targetVersion: TARGET_VERSIONS[input.targetVersion],
      surroundings: input.surroundings,
    };
    const res = projectFromBuildingType(def, params, input.seed, ctx);
    // Gemeinsame Regel mit der App (C2): Fachwerk-Theme → keine Wandvorlagen
    const { exterior: planExterior, ...build } = withoutPilastersForTheme(res.build, ctx.themes, res.project.state.themeId);
    const exterior = exteriorStyle(input.exterior, planExterior);
    const blockRules = input.blockRules !== undefined ? blockRulesOf(input.blockRules) : undefined;
    const world = generateBase(res.project, ctx, {
      ...build, ...(exterior !== undefined ? { exterior } : {}), ...(blockRules !== undefined ? { blockRules } : {}), ...res.surroundings,
      ...(input.ensemble !== undefined ? { ensemble: input.ensemble ? {} : false as const } : {}),
      ...(input.tiledWfc !== undefined ? { tiledWfc: input.tiledWfc } : {}),
      ...(input.siteDecor !== undefined ? { siteDecor: input.siteDecor } : {}),
      ...(input.weathering !== undefined && input.weathering !== 'off' ? { weathering: input.weathering } : {}),
      ...(input.surfaceTexture !== undefined && input.surfaceTexture !== 'off' ? { surfaceTexture: input.surfaceTexture } : {}),
    });
    return worldResult(res.project, world, {
      buildingTypeId: def.id, targetVersion: input.targetVersion, seed: input.seed, rerollCount: input.rerollCount, format: input.format,
      ...(input.measure === true ? { measures: measuresSummary(qualityMeasures(world, res.plan)) } : {}),
    }, res.notes, world.surroundings.warnings);
  },
});
