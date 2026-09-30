/**
 * Bauwerke in der API: Mauerzüge (Wehr- und Gartenmauer mit Toren und Türmen), freistehende Türme, Windmühlen und
 * angedockte Türme am Haus, Wehrplatten (Zinnenkranz auf Flachdächern, BT01). Jedes Feld der Domänen-Typen aus @mcda/structures ist abgedeckt oder begründet
 * ausgenommen (AssertCovered).
 */
import { z } from 'zod';
import type { AttachedTower } from '@mcda/pipeline';
import type {
  AnnexKind, GateSpec, ParapetBinding, ParapetCrown, ParapetSpec, RoofShape, SiloSpec, StructuresInput, TowerFinial, TowerShape, TowerSpec, TowerStyle, TowerTop, TowerTopStyle, WallPlan, WindmillSpec,
} from '@mcda/structures';
import { enumOf, type AssertCovered, type Uncovered } from './operation.js';
import { defined } from './style.js';
import { DIRECTIONS } from './vocabulary.js';

const Int = z.number().int();
const Coord = Int.min(-512).max(512);
const cell = z.tuple([Coord, Coord]).describe('Zelle [x, z]');

export const TOWER_SHAPES = enumOf<TowerShape>()(['round', 'square']);
export const TOWER_TOPS = enumOf<TowerTop>()(['battlements', 'roof', 'lookout', 'belfry', 'platform']);
export const TOWER_ROOFS = enumOf<RoofShape>()(['cone', 'tent', 'helm', 'spire', 'bell']);
export const TOWER_FINIALS = enumOf<TowerFinial>()(['none', 'pole', 'lantern', 'spike', 'rod', 'end_rod']);
export const ANNEX_KINDS = enumOf<AnnexKind>()(['corner', 'stair']);
export const PARAPET_CROWNS = enumOf<ParapetCrown>()(['crenel', 'lookout']);

export const towerStyleFields = {
  shape: z.enum(TOWER_SHAPES).optional().describe('rund oder eckig'),
  size: Int.min(5).max(21).optional().describe('Außenmaß (ungerade)'),
  top: z.enum(TOWER_TOPS).optional().describe('Abschluss: Zinnen, Dach, Aussichtsstube, Glockenstube, Plattform'),
  roofPitch: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional().describe('Dachneigung'),
  roofShape: z.enum(TOWER_ROOFS).optional().describe('Dachform: Kegel, Zelt, Rhombenhelm, Spitzhelm, welsche Haube'),
  flare: z.boolean().optional().describe('Glockenfuß'),
  finial: z.enum(TOWER_FINIALS).optional().describe('Turmspitze'),
  corbels: z.boolean().optional().describe('Kragsteinkranz unter den Zinnen'),
  levelHeight: Int.min(3).max(8).optional().describe('Geschosshöhe'),
  bell: z.enum(['floor', 'hanging']).optional().describe('Glocke stehend oder hängend'),
  hangingLanterns: z.boolean().optional().describe('hängende Laternen unter der Traufe'),
  lit: z.boolean().optional().describe('Laterne in jedem Geschoss (keine dunklen Turmgeschosse)'),
};
/** W3-CA: Abschluss ohne Grundriss-Maße – Rollen-Überschreibung der Mauertürme (Turmsatz). */
const towerTopFields = {
  top: towerStyleFields.top, roofShape: towerStyleFields.roofShape, roofPitch: towerStyleFields.roofPitch, flare: towerStyleFields.flare,
  finial: towerStyleFields.finial, corbels: towerStyleFields.corbels, hangingLanterns: towerStyleFields.hangingLanterns,
};
const towerTopSchema = z.object(towerTopFields).strict();
/** Stil der Mauertürme: dazu die Abschlüsse je Rolle (Ecke, Torhaus). */
const towerStyleSchema = z.object({
  ...towerStyleFields,
  corner: towerTopSchema.optional().describe('Abschluss der Ecktürme (z. B. Kegelhelm), Form und Größe wie der Stil'),
  gate: towerTopSchema.optional().describe('Abschluss der Torhaus-Türme (z. B. Zinnen), Form und Größe wie der Stil'),
}).strict();

const gateSchema = z.object({
  at: cell.describe('Zelle auf (oder nahe) der Mauer'),
  width: Int.min(1).max(7).optional().describe('lichte Breite: 1 Tür, 2 Doppeltür, ≥ 3 Bogen'),
  height: Int.min(2).max(8).optional().describe('lichte Höhe des Bogens'),
  gatehouse: z.boolean().optional().describe('Torhaus mit zwei Türmen'),
  gateBlock: z.boolean().optional()
    .describe('Torbau zwischen den Torhaus-Türmen: bis zur Turmplattform hochgezogen, Zinnen, Pechnase, Fallgitter (nur mit gatehouse und Bogen)'),
}).strict();

const wallSchema = z.object({
  points: z.array(cell).min(2).max(32).describe('Mauerzug als Polyline über Zellen'),
  closed: z.boolean().optional().describe('geschlossener Ring'),
  profile: z.enum(['fortress', 'garden']).optional().describe('Wehrmauer oder Gartenmauer'),
  garden: z.object({
    pillarEvery: Int.min(2).max(12).optional().describe('Pfeilerabstand'),
    lanterns: z.boolean().optional().describe('Laternen auf den Pfeilern'),
    hedge: z.boolean().optional().describe('Heckenfüllung'),
  }).strict().optional().describe('nur Gartenmauer'),
  thickness: Int.min(1).max(5).optional().describe('Mauerdicke'),
  height: Int.min(2).max(16).optional().describe('Höhe bis zum Wehrgang'),
  outside: z.enum(['left', 'right']).optional().describe('offener Zug: Feindseite'),
  merlon: z.object({ width: Int.min(1).max(8).optional().describe('Zinne'), gap: Int.min(1).max(8).optional().describe('Scharte') })
    .strict().optional().describe('Zinnen-Rhythmus'),
  plinth: z.object({ rows: Int.min(0).max(4).optional().describe('Sockelreihen'), batter: z.boolean().optional().describe('Anlauf') })
    .strict().optional().describe('Sockel'),
  towers: z.enum(['auto', 'none']).optional().describe('automatische Türme'),
  towerStyle: towerStyleSchema.optional().describe('Gestalt der Mauertürme'),
  towerRise: Int.min(2).max(12).optional().describe('Turmplattform über dem Wehrgang'),
  accents: z.boolean().optional()
    .describe('Materialakzente: Holzdächer und Zinnenkappen der Mauertürme, Hurde am Torbau, Bannerpaar an den Torhaus-Türmen'),
  cornerAngle: Int.min(5).max(90).optional().describe('Knickwinkel für Eckturm (Grad)'),
  towerSpacing: Int.min(0).max(64).optional().describe('größter Turmabstand (0 = keine Zwischentürme)'),
  extraTowers: z.array(cell).max(16).optional().describe('zusätzliche Türme'),
  gates: z.array(gateSchema).max(8).optional().describe('Tore'),
  stairs: z.union([z.enum(['auto', 'none']), z.array(cell).max(8)]).optional().describe('Aufgänge zum Wehrgang'),
}).strict();

const towerSchema = z.object({
  ...towerStyleFields,
  center: cell.describe('Mitte'),
  levels: Int.min(1).max(8).optional().describe('Geschosse'),
  door: z.enum(DIRECTIONS).optional().describe('Richtung der Tür'),
}).strict();

const windmillSchema = z.object({
  ...towerStyleFields,
  center: cell.describe('Mitte'),
  levels: Int.min(1).max(6).optional().describe('Geschosse unter der Kappe'),
  facing: z.enum(DIRECTIONS).optional().describe('Richtung der Flügel'),
  sailLength: Int.min(3).max(12).optional().describe('Flügellänge'),
  sailWidth: Int.min(1).max(3).optional().describe('Breite der Bespannung'),
  door: z.enum(DIRECTIONS).optional().describe('Richtung der Tür'),
}).strict();

const attachedTowerSchema = z.object({
  ...towerStyleFields,
  center: cell.describe('Mitte (neben der Hauswand)'),
  side: z.enum(DIRECTIONS).describe('Richtung vom Turm zum Haus'),
  kind: z.enum(ANNEX_KINDS).optional().describe('Eckturm oder Treppenturm'),
  levels: Int.min(1).max(8).optional().describe('Mindestzahl Geschosse'),
  entrance: z.boolean().optional().describe('eigene Eingangstür von außen'),
  openings: z.array(z.object({ floorIndex: Int.min(-4).max(7).describe('Etage'), at: cell.describe('Außenwandzelle') }).strict())
    .max(8).optional().describe('Türen vom Haus in den Turm'),
}).strict();

/**
 * Wehrplatte (BT01): an einen **Baukörper** gebunden. Die Engine leitet Spalten und Höhe beim Bauen aus der Hülle ab
 * (`parapetSpecsFor`), genau wie die App – die Zinnen wandern also mit, wenn eine Etage entfällt. Ein Altbestand mit
 * festen `cells`/`y` wird von der Projektdatei weiter gelesen, die API nimmt nur die Bindung.
 */
const parapetSchema = z.object({
  volumeId: z.string().min(1).max(16).describe('Baukörper, auf dessen Flachdach die Zinnen sitzen (z. B. v1)'),
  merlon: z.object({
    width: Int.min(1).max(8).optional().describe('Zinnenbreite in Blöcken'),
    gap: Int.min(1).max(8).optional().describe('Schartenbreite in Blöcken'),
  }).strict().optional().describe('Zinnen-Rhythmus (Standard 2/1)'),
  crown: z.enum(PARAPET_CROWNS).optional().describe('Abschluss: crenel = Zinnenkranz (Standard), lookout = Ausguck mit Pfosten, Zaun-Brüstung und Zeltdach (nur quadratisches Dach)'),
  deck: z.boolean().optional().describe('Belag aus Wehrgang-Steinen auf dem Flachdach, bündig mit der Brüstung (Ausguck: ganzes Dach)'),
}).strict();

/** W12-C: Hochsilo (Bauernhof): Mantel voll Heu, Reifen, Kuppel mit Blitzableiter; spiegelsymmetrisch, ohne Tür. */
const siloSchema = z.object({
  center: cell.describe('Mitte des Silos'),
  radius: Int.min(2).max(4).optional().describe('Radius der Kreisscheibe (Standard 3 = Ø 7)'),
  height: Int.min(8).max(24).optional().describe('Mantelhöhe ab dem Sockel (Standard 16), darüber die Kuppel'),
}).strict();

export const structuresSchema = z.object({
  walls: z.array(wallSchema).max(8).optional().describe('Mauerzüge'),
  towers: z.array(towerSchema).max(16).optional().describe('freistehende Türme'),
  windmills: z.array(windmillSchema).max(4).optional().describe('Windmühlen'),
  silos: z.array(siloSchema).max(4).optional().describe('Hochsilos (Bauernhof, neben der Scheune)'),
  attachedTowers: z.array(attachedTowerSchema).max(8).optional().describe('angedockte Türme am Haus'),
  parapets: z.array(parapetSchema).max(16).optional().describe('Wehrplatten: Zinnenkränze auf den Flachdächern der Baukörper (Burg, BT01)'),
}).strict();

export type StructuresApiInput = z.output<typeof structuresSchema>;

/** W3-CA: Rollen-Abschlüsse (`corner`, `gate`) gelten nur für Mauertürme – bei freien, Windmühlen- und Anbau-Türmen wirkungslos. */
type WallOnly = 'corner' | 'gate';

// Compile-Zeit-Zwang (ADR 12). `id` vergibt die Engine; die Wehrplatten-Spalten (`parapets[].cells/y`) und die Luke
// (`hatch`, W4-B: Leiter der Hülle, gesteuert über `roofDetail.hatch`) leitet der Bautyp bzw. der Leser aus dem
// Baukörper ab (`parapetSpecsFor`), die API trägt nur die Bindung; `annexTowers` leitet
// `generateBase` aus `attachedTowers` ab.
const _style: AssertCovered<Uncovered<TowerStyle, z.output<typeof towerStyleSchema>>> = true;
const _top: AssertCovered<Uncovered<TowerTopStyle, z.output<typeof towerTopSchema>>> = true;
const _gate: AssertCovered<Uncovered<GateSpec, z.output<typeof gateSchema>>> = true;
const _wall: AssertCovered<Uncovered<WallPlan, z.output<typeof wallSchema>, 'id'>> = true;
const _tower: AssertCovered<Uncovered<TowerSpec, z.output<typeof towerSchema>, 'id' | WallOnly>> = true;
const _mill: AssertCovered<Uncovered<WindmillSpec, z.output<typeof windmillSchema>, 'id' | WallOnly>> = true;
const _silo: AssertCovered<Uncovered<SiloSpec, z.output<typeof siloSchema>, 'id'>> = true;
const _parapet: AssertCovered<Uncovered<ParapetSpec, z.output<typeof parapetSchema>, 'id' | 'cells' | 'y' | 'hatch'>> = true;
const _att: AssertCovered<Uncovered<AttachedTower, z.output<typeof attachedTowerSchema>, 'id' | WallOnly>> = true;
const _binding: AssertCovered<Uncovered<ParapetBinding, z.output<typeof parapetSchema>, 'id'>> = true;
// `bridges` (F-Ensemble) leitet `generateBase` aus dem Verbindungsgraphen ab (Schalter `ensemble` der Aufrufe).
const _in: AssertCovered<Uncovered<StructuresInput, StructuresApiInput, 'annexTowers' | 'parapets' | 'bridges'>> = true;
void [_style, _top, _gate, _wall, _tower, _mill, _silo, _parapet, _binding, _att, _in];

/** API → Domäne: Bauwerke und angedockte Türme (IDs deterministisch nach Position in der Liste). */
export function structuresOf(input: StructuresApiInput): { structures: StructuresInput; attachedTowers: AttachedTower[] } {
  const withId = <T extends object>(prefix: string) => (x: object, i: number): T => ({ ...defined<T>(x), id: `${prefix}${i + 1}` });
  return {
    structures: {
      ...(input.walls !== undefined ? { walls: input.walls.map(withId<WallPlan>('wall')) } : {}),
      ...(input.towers !== undefined ? { towers: input.towers.map(withId<TowerSpec>('tower')) } : {}),
      ...(input.windmills !== undefined ? { windmills: input.windmills.map(withId<WindmillSpec>('mill')) } : {}),
      ...(input.silos !== undefined ? { silos: input.silos.map(withId<SiloSpec>('silo')) } : {}),
      // Wehrplatten bleiben Bindungen: Zellen/`y` leitet `generateBase`/`parapetSpecsFor` aus der Hülle ab
      ...(input.parapets !== undefined
        ? { parapets: input.parapets.map((p, i): ParapetSpec => ({ id: `parapet${i + 1}`, volumeId: p.volumeId, cells: [], y: 0, ...(p.merlon !== undefined ? { merlon: defined<{ width?: number; gap?: number }>(p.merlon) } : {}) })) }
        : {}),
    },
    attachedTowers: (input.attachedTowers ?? []).map(withId<AttachedTower>('annex')),
  };
}
