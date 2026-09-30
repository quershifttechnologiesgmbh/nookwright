import { z } from 'zod';

/**
 * Published Language des Katalogs (siehe plan/01_komponenten_modell.md §10).
 * MVP-Umfang: statische Komponenten mit Varianten, Masken und Sockets.
 * Konventionen:
 *  - Kanonische Front = Süden (+z). Lokale Koordinaten ≥ 0.
 *  - `layers[y][z]` ist eine Zeile über x (West → Ost); Zeile 0 = Norden (Rückseite).
 *  - Reservierte Zeichen in `layers`: '.' = gehört nicht zur Komponente, '_' = muss Luft bleiben.
 */

export const RESERVED_EMPTY = '.';
export const RESERVED_AIR = '_';

const vec3 = z.tuple([z.number().int(), z.number().int(), z.number().int()]);
const localVec3 = z.tuple([z.number().int().min(0), z.number().int().min(0), z.number().int().min(0)]);

export const RelDirSchema = z.enum(['front', 'back', 'left', 'right', 'up', 'down']);

export const OrientSchema = z
  .object({
    front: RelDirSchema.optional(),
    back: RelDirSchema.optional(),
    axis: z.enum(['x', 'y', 'z', 'along', 'across']).optional(),
    upsideDown: z.boolean().optional(),
    hanging: z.boolean().optional(),
    attachTo: z.union([RelDirSchema, z.literal('parent')]).optional(),
    open: z.boolean().optional(),
    /** Teil eines Mehrblock-Blocks (Bett). */
    part: z.enum(['head', 'foot']).optional(),
    /** Hälfte eines zweihohen Blocks (Tür, hohe Pflanze). */
    half: z.enum(['upper', 'lower']).optional(),
  })
  .strict();

export const ItemRefSchema = z
  .object({
    role: z.string().optional(),
    item: z.string().optional(),
    count: z.union([z.number().int().min(1), z.tuple([z.number().int().min(1), z.number().int().min(1)])]).optional(),
  })
  .strict()
  .refine((i) => (i.role === undefined) !== (i.item === undefined), { message: 'ItemRef braucht genau eins von role oder item' });

export const ContentsSchema = z
  .object({
    lootTable: z.string().optional(),
    items: z.array(ItemRefSchema).optional(),
    fill: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
    text: z.array(z.string()).optional(),
  })
  .strict();

const BLOCK_ID = /^[a-z0-9_.-]+:[a-z0-9_/.-]+$/;

export const MaterialSchema = z
  .object({
    role: z.string().regex(/^[a-z0-9_]+$/).optional(),
    shape: z.string().regex(/^[a-z0-9_]+$/).optional(),
    block: z.string().regex(BLOCK_ID, 'Block-ID im Format namespace:name').optional(),
    orient: OrientSchema.optional(),
    state: z.record(z.string(), z.string()).optional(),
    contents: ContentsSchema.optional(),
    minVersion: z.number().int().optional(),
  })
  .strict()
  .refine((m) => (m.block !== undefined ? m.role === undefined && m.shape === undefined : m.role !== undefined && m.shape !== undefined), {
    message: 'Material braucht entweder `block` oder `role` + `shape`',
  });

export const CellSpecSchema = z.object({ at: localVec3, mat: MaterialSchema }).strict();

export const EntitySpecSchema = z
  .object({
    type: z.string(),
    at: localVec3,
    face: RelDirSchema.optional(),
    item: ItemRefSchema.optional(),
    variant: z.string().optional(),
    invisible: z.boolean().optional(),
  })
  .strict();

export const SocketSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_]+$/),
    type: z.enum(['adjacent', 'surface', 'hang', 'face', 'inside', 'overlay', 'above', 'below']),
    at: vec3.optional(),
    side: RelDirSchema.optional(),
    accepts: z.array(z.string()).min(1),
    prob: z.number().min(0).max(1).optional(),
    count: z.union([z.number().int().min(0), z.tuple([z.number().int().min(0), z.number().int().min(0)])]).optional(),
    required: z.boolean().optional(),
    pairWith: z.string().optional(),
    facing: z.enum(['front', 'back', 'left', 'right', 'toParent', 'awayFromParent', 'same']).optional(),
    consistency: z.enum(['same_component', 'same_motifs', 'free']).optional(),
  })
  .strict();

export const MasksSchema = z
  .object({
    air: z.array(vec3).optional(),
    clearance: z.array(z.object({ side: z.union([RelDirSchema, z.literal('all')]), depth: z.number().int().min(1), hard: z.boolean() }).strict()).optional(),
    use: z.array(z.object({ side: RelDirSchema, depth: z.number().int().min(1).optional() }).strict()).optional(),
    support: z.array(z.object({ at: localVec3, side: RelDirSchema, kind: z.enum(['full', 'center', 'hang']) }).strict()).optional(),
  })
  .strict();

const contentShape = {
  layers: z.array(z.array(z.string())).min(1).optional(),
  legend: z.record(z.string().length(1), MaterialSchema).optional(),
  cells: z.array(CellSpecSchema).min(1).optional(),
  entities: z.array(EntitySpecSchema).optional(),
  sockets: z.array(SocketSchema).optional(),
  masks: MasksSchema.optional(),
};

/**
 * Vertikale Dehnung (V3, plan/01 §4.4 Art 3 „adaptiv“, „slice nach oben“): über der Schicht `layer` werden
 * n Zusatz-Schichten eingeschoben (Kopie von `layer` oder `rows`), n = 0 … `max`. Die Einrichtung wählt n aus
 * der lichten Höhe: `ceiling` = bis unter die Decke (Bücherwand, Himmelbett-Pfosten), `drop` = die unterste
 * Zelle hängt etwa auf halber Raumhöhe, mindestens Kopffreiheit (Kettenlänge von Kronleuchter und Laterne).
 * Die gewählte Länge steht in der Varianten-ID (`<variante>~<n>`, ohne Variante `~<n>`); n = 0 ist die Basisform.
 */
export const StretchSchema = z
  .object({
    layer: z.number().int().min(0),
    max: z.number().int().min(1).max(15),
    fill: z.enum(['ceiling', 'drop']),
    /** Eingeschobene Schicht (Zeilen wie in `layers`); fehlt sie, wird Schicht `layer` kopiert. */
    rows: z.array(z.string()).min(1).optional(),
  })
  .strict();

/** Höhen-Auswahl (V3): Form nur in Räumen mit dieser lichten Höhe (additiv; Auswahl, keine harte Regel). */
const roomHeightShape = {
  minRoomHeight: z.number().int().min(1).max(32).optional(),
  maxRoomHeight: z.number().int().min(1).max(32).optional(),
  stretch: StretchSchema.optional(),
};

export const VariantSchema = z
  .object({ id: z.string().regex(/^[a-z0-9_]+$/), weight: z.number().positive().optional(), ...contentShape, ...roomHeightShape })
  .strict();

export const ComponentDefSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+(\/[a-z0-9_]+)*$/, 'id: klein, mit / gegliedert, z. B. seat/chair'),
    kind: z.literal('static'),
    name: z.string().optional(),
    category: z.enum(['furniture', 'decor', 'attachment', 'light', 'storage', 'work', 'architecture', 'overlay']),
    tags: z.array(z.string()).min(1),
    functionTags: z.array(z.string()).optional(),
    styleTags: z.array(z.string()).optional(),
    obtainability: z.enum(['survival', 'survival_rare', 'creative', 'commands']),
    minVersion: z.number().int().optional(),
    maxVersion: z.number().int().optional(),
    // Additiv (X1, plan/01 §4.1, research/18 §14): Außen-Montagen – platziert der Außen-Solver (@mcda/exterior) an
    // den Ankern der Hülle, nie die Einrichtung. Kanonisch: Rückseite (z = 0) an der Wand bzw. auf dem Dach, Front = außen.
    mount: z.enum(['floor', 'wall', 'ceiling', 'surface', 'floor_inset', 'wall_inset', 'free', 'facade', 'eave', 'roof', 'roof_peak', 'corner_out']),
    rotations: z.union([z.literal('all'), z.literal('backToWall'), z.array(z.number().int().min(0).max(3)).min(1)]),
    mirror: z.boolean().optional(),
    light: z.union([z.number().int().min(0).max(15), z.literal('auto')]).optional(),
    /**
     * Man kann durch die Blöcke hindurchlaufen (Physik-Klasse air/thin/flat: Wandfackel, Teppich, Druckplatte …).
     * Der Solver zählt solche Zellen nicht als belegten Boden (Laufwege, Nutzungsfelder, Konnektivität).
     */
    walkable: z.boolean().optional(),
    /** Nur `mount: 'wall'`: Höhe der untersten Zelle über dem Boden (y = baseY + wallHeight). Standard 1. */
    wallHeight: z.number().int().min(0).max(15).optional(),
    /**
     * Nur `mount: 'wall'` (V3, additiv): mehrere erlaubte Höhen in Wunsch-Reihenfolge (ersetzt `wallHeight`).
     * Werte ≥ 0 wie `wallHeight` (unterste Zelle über dem Boden), Werte < 0 von der Decke aus gezählt:
     * −1 = oberste Zelle direkt unter der Decke. Die erste Höhe bekommt in der Wertung den größten Bonus.
     */
    wallHeights: z.array(z.number().int().min(-15).max(15)).min(1).optional(),
    variants: z.array(VariantSchema).min(1).optional(),
    ...contentShape,
    ...roomHeightShape,
  })
  .strict();

export type RelDirSpec = z.infer<typeof RelDirSchema>;
export type Orient = z.infer<typeof OrientSchema>;
export type ItemRef = z.infer<typeof ItemRefSchema>;
export type Contents = z.infer<typeof ContentsSchema>;
export type MaterialSpec = z.infer<typeof MaterialSchema>;
export type CellSpec = z.infer<typeof CellSpecSchema>;
export type EntitySpec = z.infer<typeof EntitySpecSchema>;
export type SocketDef = z.infer<typeof SocketSchema>;
export type Masks = z.infer<typeof MasksSchema>;
export type VariantDef = z.infer<typeof VariantSchema>;
export type StretchDef = z.infer<typeof StretchSchema>;
export type ComponentDef = z.infer<typeof ComponentDefSchema>;
