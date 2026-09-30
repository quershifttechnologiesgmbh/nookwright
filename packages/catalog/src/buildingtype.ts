import { parseJson5Text } from './json5Text.js';
import { z } from 'zod';
import type { ValidationResult } from './validate.js';

/**
 * Bautyp = Vorlage auf Gebäude-Ebene (research/19 §7.2, Published Language): Größen S/M/L, Lage, Massing,
 * Raumprogramm, Treppen, Stil (Hülle, Außen), Gelände-Vorlage, Bauwerke und Silhouette-Prüfungen. Reine Daten
 * (`catalog/buildingtypes/*.json5`); den Grundriss daraus berechnet `@mcda/archetype`.
 *
 * Verweise (Raumtypen, Themes, Dachformen, Gelände-Vorlagen und -Stile, Zonenarten) prüft `lintBuildingType` gegen
 * die Mengen, die der Aufrufer übergibt – der Katalog kennt die anderen Kontexte nicht.
 */

const Int = z.number().int();
/** Zahl oder Bereich [min, max] (beide inklusive). */
const RangeSchema = z.union([Int.min(0), z.tuple([Int.min(0), Int.min(0)])]);
const Ratio = z.tuple([z.number().positive(), z.number().positive()]);
const UnitRange = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const Dir = z.enum(['north', 'east', 'south', 'west']);
const Prob = z.number().min(0).max(1);

/** Außenmaß [Breite an der Front, Tiefe] (Wände inklusive). */
const Dim = z.tuple([Int.min(3).max(64), Int.min(3).max(64)]);

const SizeSchema = z
  .object({
    /** [kleinstes, größtes] Außenmaß des Hauptbaukörpers (bei `row`: je Haus). */
    footprint: z.tuple([Dim, Dim]),
    /** Etagen ab dem Erdgeschoss (ohne Keller). */
    floors: RangeSchema,
    /** Lichte Höhe der Obergeschosse (Standard 3) bzw. des Erdgeschosses (Standard wie `floorHeight`). */
    floorHeight: RangeSchema.optional(),
    groundHeight: RangeSchema.optional(),
    /** Keller: ja/nein oder Wahrscheinlichkeit. */
    cellar: z.union([z.boolean(), Prob]).optional(),
    /** Flügel aus `massing.wings`, die diese Größe haben kann. */
    wings: z.array(z.string()).optional(),
    /** Nur `row`: Zahl der Häuser. */
    units: RangeSchema.optional(),
    /** Ensemble-Teile aus `parts`, die diese Größe haben kann (BT01; Wahrscheinlichkeit am Teil). */
    parts: z.array(z.string()).optional(),
  })
  .strict();

/** Maße eines Ensemble-Teils (je Größe überschreibbar). */
const PartSizeSchema = z
  .object({
    footprint: z.tuple([Dim, Dim]).optional(),
    /** Etagen absolut … */
    floors: RangeSchema.optional(),
    /** … oder relativ: Etagen des Hauptbaukörpers + `above` (Bergfried überragt den Palas). */
    above: RangeSchema.optional(),
    /**
     * Eigene lichte Höhe aller Etagen des Teils (sonst die des Hauptbaukörpers). Weicht sie ab, liegen die Böden der
     * Obergeschosse versetzt – dann gibt es dort keine Tür zwischen den Baukörpern, nur im gemeinsamen Erdgeschoss.
     */
    floorHeight: RangeSchema.optional(),
  })
  .strict();

/**
 * Ensemble-Teil (research/19 §7.4, BT01): eigener Baukörper mit eigenem Massing, eigenem Programm (`program[].part`),
 * eigenem Dach und Anker relativ zum Hauptbaukörper – angebaut (`gap` 0, Brandwand) oder frei stehend.
 */
const PartSchema = PartSizeSchema.extend({
  /** Anzeigename des Baukörpers. */
  name: z.string().optional(),
  /** Grammatik des Teils: Turm (ein Raum je Etage, Leitern), Rechteck oder Halle. */
  massing: z.enum(['tower', 'rect', 'hall']),
  prob: Prob.optional(),
  cellar: z.union([z.boolean(), Prob]).optional(),
  anchor: z
    .object({
      /** Seite am Hauptbaukörper (von außen auf die Front gesehen); Liste = Auswahl per Seed. */
      side: z.union([z.enum(['back', 'left', 'right']), z.array(z.enum(['back', 'left', 'right'])).min(1)]),
      /** Lage entlang der Seite (Standard `start` = Rückseite bzw. linke Ecke; Ecke = start/end). */
      align: z.union([z.enum(['start', 'center', 'end', 'any']), z.array(z.enum(['start', 'center', 'end'])).min(1)]).optional(),
      /** Abstand (0 = angebaut, gemeinsame Brandwand). */
      gap: RangeSchema.optional(),
      /** Überstand über die Ecke hinaus (Eckturm springt vor). */
      shift: RangeSchema.optional(),
    })
    .strict(),
  roof: z.string().optional(),
  roofDetail: z
    .object({
      pitch: z.enum(['low', 'normal', 'steep']).optional(), trim: z.boolean().optional(), gableWindows: z.boolean().optional(),
      /** W4-B: Dachluke mit Leiter (Flachdach, Zugang zur Wehrplatte) und Turmschaft ohne Band je Geschoss. */
      hatch: z.boolean().optional(), plainShaft: z.boolean().optional(),
      /** W7-B: Turmschaft mit eigenem Fassadenraster je Seite (Fuge zum Nachbarbaukörper als Ecke). */
      shaftGrid: z.boolean().optional(),
    })
    .strict()
    .optional(),
  /** Brüstung auf dem Flachdach: Zinnenkranz (Wehrplatte, als Bauwerk-Aufsatz) bzw. Ausguck mit Zeltdach (W3-CA). */
  parapet: z.enum(['crenel', 'lookout']).optional(),
  /** W3-CA: Belag aus Wehrgang-Steinen auf dem Flachdach, bündig mit der Brüstung. */
  parapetDeck: z.boolean().optional(),
  stairs: z.object({ type: z.enum(['straight', 'ladder']).optional() }).strict().optional(),
  /** Maße je Größe (überschreiben die Standardwerte des Teils). */
  sizes: z.object({ S: PartSizeSchema.optional(), M: PartSizeSchema.optional(), L: PartSizeSchema.optional() }).strict().optional(),
  /**
   * W12-C (Review R6-4): Außengestaltung dieses Baukörpers (`Volume.exterior`) – eigene Kantenrolle (Dachkante und
   * Eckständer, z. B. `trim_light`), abgeschaltete Außen-Gruppen (z. B. `flowerBoxes`) und Scheunentor mit Heuluke.
   */
  exterior: z
    .object({
      trim: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
      /** W16-B: Rolle der Dachfläche dieses Baukörpers statt `roof_main` (z. B. `roof_barn`). */
      roof: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
      off: z.array(z.string()).optional(),
      barn: z.boolean().optional(),
    })
    .strict()
    .optional(),
}).strict();

const WingSchema = z
  .object({
    /** Seite am Hauptbaukörper (Front = Straße): hinten, links, rechts (von außen auf die Front gesehen). */
    side: z.enum(['back', 'left', 'right']),
    /** Ausladung weg vom Hauptbaukörper bzw. Länge entlang der Seite. */
    depth: RangeSchema,
    length: RangeSchema,
    /** Lage entlang der Seite (Standard `any`): L = Ende, T = Mitte. */
    align: z.enum(['start', 'center', 'end', 'any']).optional(),
    floors: RangeSchema.optional(),
    prob: Prob.optional(),
    /** Eigener Baukörper (research/19 §7.4, eigenes Dach) statt Teil des Hauptbaukörpers. */
    volume: z.boolean().optional(),
    /** Abstand zum Hauptbaukörper (nur `volume`; 0 = angebaut). */
    gap: Int.min(0).max(16).optional(),
    roof: z.string().optional(),
  })
  .strict();

const FixedRoomSchema = z
  .object({
    rect: z.tuple([Int, Int, Int, Int]), room: z.string(), floor: Int.optional(),
    /**
     * W13-A (28.09.2026, Komposition der Baumasse): Baukörper aus `massing.volumes`, zu dem der Raum gehört (eigenes Dach,
     * eigene lichte Höhe; Brandwand zum Hauptbau). Fehlt = Hauptbaukörper (bitgleich).
     */
    volume: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  })
  .strict();

/**
 * W13-A (28.09.2026, Komposition der Baumasse): Nebenbaukörper eines festen Grundrisses – Anbau, Flügel oder Werkstatt
 * mit eigenem Dach (First per Seitenverhältnis, meist quer zum Hauptfirst) und eigener, meist niedrigerer lichter Höhe.
 * Community-Häuser bestehen aus mehreren Körpern mit gestaffelten Dächern statt einer Kiste unter einem Dach.
 */
const FixedVolumeSchema = z
  .object({
    /** Anzeigename des Baukörpers. */
    name: z.string().optional(),
    /** Eigene lichte Höhe aller Etagen (sonst die des Hauptbaukörpers). */
    floorHeight: Int.min(2).max(16).optional(),
    /** Dachform (sonst die des Hauptbaukörpers). */
    roof: z.string().optional(),
    /** W13-A (Runde 2): Dachneigung dieses Baukörpers (Turmhelm steil); übrige Dach-Details wie der Hauptbau. */
    pitch: z.enum(['low', 'normal', 'steep']).optional(),
  })
  .strict();
const FixedStairsSchema = z
  .object({
    floor: Int,
    origin: z.tuple([Int, Int]),
    facing: Dir,
    type: z.enum(['straight', 'l', 'u', 'spiral', 'ladder']),
    turn: z.enum(['left', 'right']).optional(),
    /** W13-A (Runde 2): Baukörper aus `massing.volumes` (Leiter im Eckturm). Fehlt = Hauptbaukörper. */
    volume: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  })
  .strict();

/**
 * W5 (27.09.2026, Review N8): gerade Frontlänge (Außenmaß entlang der Front, Süden) statt der ungeraden Vorzugslänge –
 * nur eine gerade Linie hat ein gerades Mittelfeld, in das eine Doppeltür spiegelgleich passt (Schankraum, Methalle).
 * Fehlt = ungerade wie bisher (bitgleich).
 */
const EvenFront = z.boolean().optional();

/**
 * W9-G1 (27.09.2026, Review R5 G1 „raus aus der Kiste“): Baumasse-Akzente wie bei Community-Bauten – Auskragung der
 * Obergeschosse auf Konsolen und ein Quergiebel bzw. Vorbau an der Front. Sie wachsen die gelegten Räume nach außen
 * (kanonisch, Front = Süden), der Grundriss innen bleibt. Fehlt = Kiste wie bisher (bitgleich).
 */
const JettySchema = z
  .object({
    /** Seiten, an denen die Obergeschosse 1 Block auskragen (`front` = Straße). */
    sides: z.array(z.enum(['front', 'back', 'left', 'right'])).min(1),
    /** Jedes Obergeschoss kragt über das darunter aus (gestaffelt, höchstens 2 Blöcke gesamt); sonst nur das erste. */
    each: z.boolean().optional(),
    prob: Prob.optional(),
  })
  .strict();
const CrossSchema = z
  .object({
    /** Breite des Vorsprungs entlang der Front bzw. Ausladung vor die Front (Außenmaß, Wände inklusive). */
    width: RangeSchema,
    depth: RangeSchema,
    /** Lage entlang der Front: Mitte (T, Zwerchhaus) oder ein Ende (L); `any` per Seed. */
    align: z.enum(['start', 'center', 'end', 'any', 'corner']).optional(),
    /** `all` = Quergiebel über alle Etagen, `ground` = eingeschossiger Vorbau (Windfang) mit eigenem Dach. */
    floors: z.enum(['all', 'ground']).optional(),
    prob: Prob.optional(),
    /**
     * W12-A (Review R6-3): Raumtyp eines eigenen Raums im Vorsprung des Erdgeschosses (Diele/Windfang, z. B.
     * `hallway`). Hat er die Flur-Rolle (`hallway`/`corridor` bzw. `entrance` des Bautyps), liegt die Haustür im Vorsprung –
     * Quergiebel bzw. Vorbau stehen so auf der Eingangsseite. Fehlt = der Raum dahinter wächst (wie bisher).
     */
    room: z.string().optional(),
  })
  .strict();
const FeaturesSchema = z.object({ jetty: JettySchema.optional(), cross: CrossSchema.optional() }).strict().optional();

const MassingSchema = z.discriminatedUnion('generator', [
  /** Fester Grundriss (die alten App-Vorlagen): Räume als Rechtecke relativ zur linken oberen Ecke. */
  z
    .object({
      generator: z.literal('fixed'),
      upperFloors: Int.min(0).max(8).optional(),
      floorHeight: Int.min(2).max(16).optional(),
      rooms: z.array(FixedRoomSchema).min(1),
      stairs: z.array(FixedStairsSchema).optional(),
      features: FeaturesSchema,
      /** W13-A: Nebenbaukörper, auf die `rooms[].volume` verweist (Schlüssel = Name im Katalog). Fehlt = ein Baukörper (bitgleich). */
      volumes: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), FixedVolumeSchema).optional(),
      /**
       * W12-A (Review R6-3): Variante mit Obergeschoss(en) – ersetzt Räume, Treppen und Etagenzahl des festen Grundrisses.
       * Größe S nie, L immer, sonst per Seed mit `prob` (Standard 0,5); „neu würfeln“ wechselt sie. Fehlt = bitgleich.
       */
      storeys: z
        .object({
          upperFloors: Int.min(1).max(8),
          rooms: z.array(FixedRoomSchema).min(1),
          stairs: z.array(FixedStairsSchema).min(1),
          prob: Prob.optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z.object({
    generator: z.literal('rect'), ratio: Ratio.optional(), evenFront: EvenFront, features: FeaturesSchema,
    /**
     * W12-B (28.09.2026, plan/spikes/W12B_erdhausfront.md): Eingangsraum als mittiges Querband über die ganze Tiefe,
     * links und rechts gleich breite Seiten mit je einem Frontraum – spiegelgleiche Front (Erdhaus: Rundtür mittig).
     */
    centerHub: z.boolean().optional(),
  }).strict(),
  /** Halle/Schiff: Räume nur quer zur Längsachse geteilt (Langhaus, Kapelle). */
  z.object({ generator: z.literal('hall'), ratio: Ratio.optional(), evenFront: EvenFront, features: FeaturesSchema }).strict(),
  z.object({ generator: z.literal('wings'), ratio: Ratio.optional(), evenFront: EvenFront, wings: z.record(z.string(), WingSchema), features: FeaturesSchema }).strict(),
  /** Zeile: mehrere Häuser nebeneinander, je eigener Baukörper (Brandwand, eigenes Dach). */
  z.object({ generator: z.literal('row') }).strict(),
  /** Turm (eckig): ein Raum je Etage, Leitern im Wechsel an gegenüberliegenden Wänden. */
  z.object({ generator: z.literal('tower') }).strict(),
]);

/** Etagenwahl im Programm: Index, Bereich oder Name (`ground` = 0, `upper` = ≥ 1, `top` = oberste, `cellar` = −1). */
const FloorSelSchema = z.union([Int, z.tuple([Int, Int]), z.enum(['ground', 'upper', 'top', 'cellar', 'all'])]);

const ProgramEntrySchema = z
  .object({
    /** Raumtyp oder Auswahl daraus (je Seed einer). */
    room: z.union([z.string(), z.array(z.string()).min(1)]),
    floor: FloorSelSchema.optional(),
    /** Anteil an der Etagenfläche (sonst aus `minArea`). */
    share: z.number().positive().max(1).optional(),
    count: RangeSchema.optional(),
    /** Mindest-Innenfläche (Standard: `minArea` des Raumtyps). */
    minArea: Int.min(1).optional(),
    /** Pflichtraum: muss auf jeder passenden Etage stehen (die es in der gewählten Größe gibt). */
    required: z.boolean().optional(),
    prob: Prob.optional(),
    near: z.enum(['entrance', 'front', 'back', 'stairs']).optional(),
    adjacent: z.array(z.string()).optional(),
    /**
     * Gewichtete Nachbarschaft (research/22 §0.1, Synthese 25 Regel 12): Raumtyp → −1 … +1.
     * Positiv zieht an (kurze Wege), negativ stößt ab (Lärm, Rauch, Geruch – Küche, Schmiede, Stall).
     * Ohne dieses Feld bleibt die Grundrisswahl unverändert.
     */
    adjacencyWeights: z.record(z.string(), z.number().min(-1).max(1)).optional(),
    /** Raum im Flügel `wing` (sonst im Hauptbaukörper). */
    wing: z.string().optional(),
    /** Raum im Ensemble-Teil `part` (Etagen des Teils, `top` = seine oberste). */
    part: z.string().optional(),
    /** Füllt die Restfläche. */
    fill: z.boolean().optional(),
    /**
     * W16-B (Review R7-4): Licht-Bedarf ausdrücklich – `true` auch für den Eingangsraum (Wohnküche mit Haustür), `false`
     * für einen Raum, der sonst eins bräuchte. Fehlt = Regel des Planers (kein Lager, Bad, Flur, Eingangsraum).
     */
    lit: z.boolean().optional(),
    /**
     * Funktionsgrad (W2-1): der Eintrag entfällt, wenn die Außenfläche des Baukörpers (bzw. Flügels/Teils) je Etage kleiner
     * ist. Für große Funktionsräume, die nur in großen Häusern Platz haben. Fehlt = keine Grenze (bitgleich wie bisher).
     */
    minFloor: Int.min(1).optional(),
    /**
     * Funktionsgrad (W2-1): dieser Eintrag verdrängt Wunschräume (nicht Pflichträume) dieser Raumtypen auf derselben Etage
     * desselben Baukörpers – der Funktionsraum nimmt ihren Platz. Fehlt = nichts wird verdrängt.
     */
    replaces: z.array(z.string()).min(1).optional(),
  })
  .strict();

/** Funktionsgrad-Stufen (`BuildingParams.functionLevel`): aus, einzelne Anlagen, viele und größere Anlagen. */
export const FUNCTION_LEVELS = ['off', 'some', 'rich'] as const;
export type FunctionLevel = (typeof FUNCTION_LEVELS)[number];

/**
 * Funktionsraum eines Bautyps (W2-1, Option „Funktionsgrad“): Tabelle je Gebäudetyp, aus der der Planer je Seed einige
 * Räume ins Raumprogramm hängt (`planBuilding`, `functionLevel`). Ohne die Option bleibt das Programm unverändert.
 * Reine Daten – Zuordnung Gebäudetyp → Anlagen steht im Katalog, nicht im Code.
 */
const FunctionEntrySchema = z
  .object({
    /** Raumtyp oder Auswahl daraus (je Seed einer). */
    room: z.union([z.string(), z.array(z.string()).min(1)]),
    /** Etage (Standard `ground`). Nicht mit `wing`. */
    floor: FloorSelSchema.optional(),
    wing: z.string().optional(),
    part: z.string().optional(),
    /** Ab welcher Stufe der Raum vorkommt: `some` (Standard) = ab „einige“, `rich` = nur bei „viele“. */
    level: z.enum(['some', 'rich']).optional(),
    /** Größenklassen, in denen der Raum vorkommt (Standard: alle). */
    sizes: z.array(z.enum(['S', 'M', 'L'])).min(1).optional(),
    /** Gewicht bei der Auswahl (Standard 1). */
    weight: z.number().positive().optional(),
    /** Höchstens ein Raum je Gruppe (z. B. Verarbeitung: Schmelze, Backstube). */
    group: z.string().optional(),
    /** Anteil an der Etagenfläche (Standard 0.3); bei `rich` gilt `richShare`, wenn angegeben. */
    share: z.number().positive().max(1).optional(),
    richShare: z.number().positive().max(1).optional(),
    /** Mindest-Innenfläche (Standard: die des Raumtyps). */
    minArea: Int.min(1).optional(),
    /** Mindest-Außenfläche der Etage (siehe `program[].minFloor`). */
    minFloor: Int.min(1).optional(),
    /** Wunschräume, die der Funktionsraum verdrängt (siehe `program[].replaces`). */
    replaces: z.array(z.string()).min(1).optional(),
    near: z.enum(['entrance', 'front', 'back', 'stairs']).optional(),
    adjacent: z.array(z.string()).optional(),
    adjacencyWeights: z.record(z.string(), z.number().min(-1).max(1)).optional(),
  })
  .strict();

const ShellSchema = z
  .object({
    roof: z.string().optional(),
    overhang: Int.min(0).max(3).optional(),
    roofDetail: z
      .object({
        pitch: z.enum(['low', 'normal', 'steep']).optional(),
        trim: z.boolean().optional(),
        verge: z.enum(['plain', 'closed']).optional(),
        flare: z.boolean().optional(),
        gableWindows: z.boolean().optional(),
        halfHipRows: Int.min(1).max(3).optional(),
        mansardBreak: Int.min(1).max(4).optional(),
        /** W4-B: Dachluke mit Leiter (Flachdach, Zugang zu Wehrplatte/Ausguck) und Turmschaft ohne Band je Geschoss. */
        hatch: z.boolean().optional(),
        plainShaft: z.boolean().optional(),
      })
      .strict()
      .optional(),
    dormers: z
      .object({ kind: z.enum(['gable', 'shed', 'hip', 'blind']), width: z.union([z.literal(1), z.literal(3), z.literal(5)]).optional(), minGap: Int.min(0).max(8).optional() })
      .strict()
      .optional(),
    facade: z
      .object({
        plinthProfile: z.boolean().optional(),
        cornice: z.boolean().optional(),
        quoins: z.boolean().optional(),
        pilasters: Int.min(3).max(8).optional(),
        brackets: Int.min(2).max(6).optional(),
        /** W5-B: Rolle der Fensterrahmen (Bank und Sturz über die ganze Breite), z. B. `wall_cornice` für Stein-Rahmen der Burg. */
        frameRole: z.enum(['window_frame', 'wall_cornice']).optional(),
        /**
         * W13-E: eigenes Wandkleid der Obergeschosse und Giebel (Wohnbauten: Stein/Holz unten, Fachwerk darüber); das
         * Material sagen die Wandregeln des Themes (`when.upperFrame`). Fehlt = bitgleich.
         */
        upperFrame: z.boolean().optional(),
        /** W16-B (Review R7-4): Raumtypen mit Fenster-Pflicht je Etage (`FacadeStyle.lightRooms`), z. B. die Wohnküche mit Haustür. */
        lightRooms: z.array(z.string()).optional(),
        /** Q2 (research/58 §Q2): Fassaden-Pflichtregeln; fehlt = Vorgabe `FACADE_QUALITY_RULES` des Generators. */
        rules: z
          .object({
            minOverhang: Int.min(1).max(3).optional(),
            roofEdge: z.boolean().optional(),
            windowFrame: z.boolean().optional(),
            foundationBase: z.boolean().optional(),
            pierFrom: Int.min(3).max(12).optional(),
            maxIdenticalAxes: Int.min(1).max(8).optional(),
            focus: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    windows: z.object({ enabled: z.boolean().optional(), spacing: Int.min(2).max(8).optional() }).strict().optional(),
  })
  .strict();

/** Fenstermodule der Außengestaltung (`@mcda/exterior` `WINDOW_MODULES`; Test hält beide Listen gleich). */
export const BUILDING_WINDOW_MODULES = ['townhouse', 'cottage', 'timber', 'stone', 'nordic', 'fort'] as const;
/** W4-B: Eingangsmodule der Außengestaltung (`@mcda/exterior` `ENTRANCE_MODULES`; Test hält beide Listen gleich). */
export const BUILDING_ENTRANCE_MODULES = ['townhouse', 'cottage', 'timber', 'stone', 'nordic'] as const;

const ExteriorSchema = z.union([
  z.literal(false),
  z.object({
    density: z.number().min(0).max(2).optional(),
    off: z.array(z.string()).optional(),
    /** W3-CA: Fenstermodul des Bautyps (Standard: nach Theme), z. B. `stone` für die Burg. */
    windowModule: z.enum(BUILDING_WINDOW_MODULES).optional(),
    /** W4-B: Eingangsmodul des Bautyps (Standard: nach Theme) – dieselbe Familie wie die Fenster, z. B. `stone` für die Burg. */
    entranceModule: z.enum(BUILDING_ENTRANCE_MODULES).optional(),
    /** W5-B: Module im Material des Themes – `windowModule`/`entranceModule` geben nur die Familie vor (Burg: Stein-Modul nur an Steinwänden). */
    themeMaterial: z.boolean().optional(),
  }).strict(),
]);

const SiteZoneSchema = z
  .object({
    kind: z.string(),
    /** Seite relativ zur Haustür (vorn = Blickrichtung hinaus). */
    at: z.enum(['front', 'back', 'left', 'right']),
    /** Tiefe weg vom Haus, Breite entlang der Seite (Standard: Hausbreite), Abstand zum Haus (Standard 3). */
    depth: Int.min(3).max(64),
    width: Int.min(3).max(64).optional(),
    gap: Int.min(0).max(16).optional(),
    /**
     * W16-B (Review R7-2): Zone vor einem Ensemble-Teil (z. B. `barn`) statt vor dem ganzen Gebäude – Seite, Breite und
     * Abstand gelten dann für dessen Grundfläche (Weizenfeld vor der Scheune).
     */
    part: z.string().optional(),
    /** W16-B: Lage entlang der Seite bei `width` – mittig (Standard) oder bündig mit dem Ende zum Hauptbau (`inner`). */
    align: z.enum(['center', 'inner']).optional(),
  })
  .strict();

const SiteSchema = z
  .object({
    template: z.string().optional(),
    style: z.string().optional(),
    lighting: z.enum(['none', 'paths', 'spawnproof']).optional(),
    /** Grundstücksrand um das Haus (Standard 12). */
    margin: Int.min(4).max(64).optional(),
    zones: z.array(SiteZoneSchema).optional(),
  })
  .strict();

/** Abschluss eines Mauerturms je Rolle (W3-CA, `TowerTopStyle` der Bauwerke). */
const TowerTopSchema = z
  .object({
    top: z.enum(['battlements', 'roof', 'lookout', 'belfry', 'platform']).optional(),
    roofShape: z.enum(['cone', 'tent', 'helm', 'spire', 'bell']).optional(),
    roofPitch: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    finial: z.enum(['none', 'pole', 'lantern', 'spike', 'rod', 'end_rod']).optional(),
    flare: z.boolean().optional(),
    corbels: z.boolean().optional(),
    hangingLanterns: z.boolean().optional(),
  })
  .strict();

/** Gestalt der Mauertürme (Teilmenge von `TowerStyle` der Bauwerke). */
const TowerStyleSchema = z
  .object({
    shape: z.enum(['round', 'square']).optional(),
    size: Int.min(5).max(15).optional(),
    top: z.enum(['battlements', 'roof', 'lookout', 'belfry', 'platform']).optional(),
    roofShape: z.enum(['cone', 'tent', 'helm', 'spire', 'bell']).optional(),
    // W3-CA: Neigung, Spitze, Glockenfuß, Kragsteine, Licht je Geschoss und der Turmsatz (Abschluss je Rolle)
    roofPitch: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    finial: z.enum(['none', 'pole', 'lantern', 'spike', 'rod', 'end_rod']).optional(),
    flare: z.boolean().optional(),
    corbels: z.boolean().optional(),
    lit: z.boolean().optional(),
    corner: TowerTopSchema.optional(),
    gate: TowerTopSchema.optional(),
  })
  .strict();

/**
 * Ringmauer um alle Baukörper (BT01, research/19 §3): Mauerzug mit Türmen im Takt, Tor auf der Achse der Haustür
 * (Torhaus optional), Wehrgang mit Treppe, Hof als Gelände-Zone; optional Zwinger (zweiter, niedrigerer Ring) und
 * Graben. Der Anwendungsdienst legt den Ring erst an, wenn die Haustür feststeht.
 */
const RingSchema = z
  .object({
    /** Freier Abstand Baukörper (samt Überstand) → Innenkante der Mauertürme. */
    offset: RangeSchema,
    height: RangeSchema.optional(),
    thickness: Int.min(2).max(5).optional(),
    /** Größter Turmabstand entlang der Mauer. */
    towerSpacing: RangeSchema.optional(),
    /** Turmgestalt; Liste = Auswahl per Seed. */
    towers: z.array(TowerStyleSchema).min(1).optional(),
    merlon: z.object({ width: Int.min(1).max(4).optional(), gap: Int.min(1).max(4).optional() }).strict().optional(),
    gate: z.object({
      width: Int.min(1).max(7).optional(), height: Int.min(2).max(8).optional(), gatehouse: z.union([z.boolean(), Prob]).optional(),
      /** W3-CA: Torbau zwischen den Torhaus-Türmen (Zinnen, Pechnase, Fallgitter). */
      gateBlock: z.boolean().optional(),
    }).strict().optional(),
    /** Zwinger: zweiter Ring außen, niedriger, ohne Türme; Tor in derselben Achse. */
    outer: z.object({ prob: Prob.optional(), gap: Int.min(2).max(12).optional(), height: Int.min(3).max(8).optional() }).strict().optional(),
    /** Graben (Wasserband) außen um den äußersten Ring, mit Damm vor dem Tor. */
    moat: z.object({ prob: Prob.optional(), width: Int.min(2).max(6).optional(), gap: Int.min(1).max(8).optional() }).strict().optional(),
    /** Hof als Gelände-Zone (Standard `yard`, `false` = keine). */
    yard: z.union([z.literal(false), z.string()]).optional(),
    /** W9-G5: Materialakzente (Holzdächer, Zinnenkappen, Hurde am Torbau, Bannerpaar), `WallPlan.accents`. */
    accents: z.boolean().optional(),
  })
  .strict();

const StructuresSchema = z
  .object({
    /** Windmühle neben dem Haus (TW). */
    windmill: z
      .object({ prob: Prob.optional(), side: z.enum(['left', 'right', 'back']).optional(), distance: Int.min(4).max(40).optional(), levels: Int.min(2).max(5).optional() })
      .strict()
      .optional(),
    ring: RingSchema.optional(),
    /**
     * W12-C (Review R6-4): runder Hochsilo an einem Ensemble-Teil (Scheune) – hinter dessen Rückwand an der Außenecke,
     * zur Hälfte über die Giebelflucht hinaus (sichtbar neben dem Giebel). Nur in den genannten Größen (Standard L).
     */
    silo: z
      .object({
        prob: Prob.optional(),
        /** Ensemble-Teil, an dem der Silo steht (Standard: der erste Teil). */
        part: z.string().optional(),
        sizes: z.array(z.enum(['S', 'M', 'L'])).min(1).optional(),
        /** Radius (2–4, Standard 3 = Ø 7) und Mantelhöhe (8–24, Standard 16). */
        radius: Int.min(2).max(4).optional(),
        height: Int.min(8).max(24).optional(),
        /** Abstand zur Rückwand des Teils (Standard 2). */
        gap: Int.min(1).max(6).optional(),
        /**
         * W16-B (Review R7-2): Seite des Teils – `back` (Standard, hinter der Rückwand) oder `front` (vor der Vorderwand,
         * an der Außenecke; im ersten Blick von vorn sichtbar statt hinter der Scheune verdeckt).
         */
        side: z.enum(['back', 'front']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Silhouette-Prüfungen (research/19 §9.1) – weiche Qualitätswerte, keine Fehler (ADR 11). */
const ChecksSchema = z
  .object({
    /** Länge zu Breite des Hauptbaukörpers. */
    ratio: Ratio.optional(),
    /** Gesamthöhe (Boden bis First) zu Breite (kürzere Seite). */
    heightToWidth: Ratio.optional(),
    /** Dachhöhe zu Traufhöhe. */
    roofToEave: Ratio.optional(),
    /** Frontbreite. */
    width: z.tuple([Int.min(1), Int.min(1)]).optional(),
    floors: z.tuple([Int.min(1), Int.min(1)]).optional(),
    /** Ensemble: Oberkante des höchsten Teils zu Oberkante des Hauptbaukörpers (Bergfried überragt den Palas). */
    partOverMain: Ratio.optional(),
    /** Silhouette (research/20 §0.9): Zahl der unterscheidbaren Baukörper. */
    massCount: z.tuple([Int.min(1), Int.max(9)]).optional(),
    /** Silhouette: Oberkante des höchsten Baukörpers zu Oberkante des Hauptbaukörpers (Fokus-Element). */
    focusOverMain: Ratio.optional(),
    /** MX-Q: Grundrissfläche zu konvexer Hülle (1 = Kasten, kleiner = gegliedert). */
    articulationPlan: UnitRange.optional(),
    /** MX-Q: Frontansicht-Fläche zu konvexer Hülle. */
    articulationFront: UnitRange.optional(),
    /** MX-Q: Symmetrie-Differenz der Front (Spiegelbild und Geschossachsen; 0 = symmetrisch). */
    facadeSymmetry: UnitRange.optional(),
    /** MX-Q: Shannon-Entropie Wand/Fenster/Tür des Frontrasters in Bit (0–1,585). */
    facadeEntropy: z.tuple([z.number().min(0).max(2), z.number().min(0).max(2)]).optional(),
  })
  .strict();

const StyleFilterSchema = z
  .object({ require: z.array(z.string()).min(1).optional(), exclude: z.array(z.string()).min(1).optional() })
  .strict();

export const BuildingTypeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    /** Name des erzeugten Projekts. */
    name: z.string().min(1),
    /** Anzeige in der Galerie (Standard `name`). */
    label: z.string().optional(),
    description: z.string().optional(),
    family: z.enum(['house', 'fort', 'nature', 'fantasy', 'nordic']),
    /** `draft` = Entwurf (Generator oder Regeln fehlen noch; nicht in der Galerie). */
    status: z.enum(['ready', 'draft']).optional(),
    styleTags: StyleFilterSchema.optional(),
    /** Theme-Vorschläge, das erste ist Standard. */
    themes: z.array(z.string()).min(1).optional(),
    setting: z
      .object({
        kind: z.enum(['ground', 'buried', 'cliff', 'carved', 'stilts', 'tree', 'water', 'underwater']),
        front: Dir.optional(),
        height: Int.min(0).optional(),
        cover: Int.min(0).optional(),
      })
      .strict()
      .optional(),
    sizes: z.object({ S: SizeSchema.optional(), M: SizeSchema.optional(), L: SizeSchema.optional() }).strict().optional(),
    massing: MassingSchema,
    /** Raumtyp des Eingangsraums: im Erdgeschoss Treppenraum, in der Hülle mit Flur-Rolle (Haustür, Türen zu allen Nachbarn). */
    entrance: z.string().optional(),
    /** Flur auf Etagen mit diesem Raumtyp ab einer Tiefe (kürzere Seite) von `minDepth` (Standard 9). */
    corridor: z.object({ room: z.string(), minDepth: Int.min(7).max(64).optional() }).strict().optional(),
    program: z.array(ProgramEntrySchema).optional(),
    /** Funktionsräume für die Option `functionLevel` (W2-1); ohne Tabelle hat der Bautyp keine. */
    functions: z.array(FunctionEntrySchema).optional(),
    stairs: z
      .object({
        /** Treppenart (Standard: gerade, im Turm Leiter). */
        type: z.enum(['straight', 'ladder']).optional(),
        /** Lage des Treppenkerns entlang der Längsachse. */
        at: z.enum(['end', 'center', 'any']).optional(),
        /** Raumtyp, der den Treppenkern enthält (Standard: Eingangs- bzw. Flurraum, sonst der größte). */
        room: z.string().optional(),
      })
      .strict()
      .optional(),
    shell: ShellSchema.optional(),
    exterior: ExteriorSchema.optional(),
    /**
     * W3-CA: Wehrplatte bzw. Ausguck auf dem Flachdach des **Hauptbaukörpers** (nur mit `shell.roof: flat`), als
     * Bauwerk-Aufsatz wie `parts.*.parapet`.
     */
    parapet: z.object({ crown: z.enum(['crenel', 'lookout']).optional(), deck: z.boolean().optional() }).strict().optional(),
    site: SiteSchema.optional(),
    structures: StructuresSchema.optional(),
    /** Ensemble-Teile (research/19 §7.4): weitere Baukörper mit Anker, eigenem Programm und Dach. */
    parts: z.record(z.string(), PartSchema).optional(),
    checks: ChecksSchema.optional(),
  })
  .strict();

export type BuildingTypeDef = z.infer<typeof BuildingTypeSchema>;
export type BuildingPartDef = z.infer<typeof PartSchema>;
export type BuildingRingDef = z.infer<typeof RingSchema>;
export type BuildingSizeClass = 'S' | 'M' | 'L';
export type BuildingSizeDef = z.infer<typeof SizeSchema>;
export type BuildingWingDef = z.infer<typeof WingSchema>;
export type BuildingMassingDef = z.infer<typeof MassingSchema>;
export type BuildingFeaturesDef = NonNullable<z.infer<typeof FeaturesSchema>>;
export type BuildingProgramEntry = z.infer<typeof ProgramEntrySchema>;
export type BuildingFunctionEntry = z.infer<typeof FunctionEntrySchema>;
export type BuildingFloorSel = z.infer<typeof FloorSelSchema>;
export type BuildingShellDef = z.infer<typeof ShellSchema>;
export type BuildingExteriorDef = z.infer<typeof ExteriorSchema>;
export type BuildingSiteDef = z.infer<typeof SiteSchema>;
export type BuildingStructuresDef = z.infer<typeof StructuresSchema>;
export type BuildingChecksDef = z.infer<typeof ChecksSchema>;
/** Zahl oder Bereich [min, max]. */
export type BuildingRange = z.infer<typeof RangeSchema>;

export const BUILDING_SIZES: readonly BuildingSizeClass[] = ['S', 'M', 'L'];

/** Bereich → [min, max]. */
export const rangeOf = (r: BuildingRange): readonly [number, number] => (typeof r === 'number' ? [r, r] : r);

/** Fachliche Prüfungen, die das Schema allein nicht ausdrückt (ohne Verweise auf andere Kataloge). */
export function validateBuildingTypeDef(input: unknown): ValidationResult<BuildingTypeDef> {
  const parsed = BuildingTypeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(wurzel)'}: ${i.message}`), warnings: [] };
  }
  const def = parsed.data;
  const errors: string[] = [];
  const range = (r: BuildingRange | undefined, where: string): void => {
    if (r !== undefined && typeof r !== 'number' && r[0] > r[1]) errors.push(`${where}: min > max`);
  };
  const m = def.massing;
  const wings = m.generator === 'wings' ? m.wings : {};
  if (def.parapet !== undefined && def.shell?.roof !== 'flat') errors.push('parapet: nur mit Flachdach (shell.roof: flat)');
  if (m.generator === 'fixed') {
    // W13-A (Runde 2): Räume und Treppen eines Nebenbaukörpers (Eckturm) dürfen über die Etagen des Hauptbaus hinausgehen
    // (höchstens 8 Obergeschosse); die Treppe braucht dann eine Etage desselben Baukörpers darüber
    for (const [i, r] of m.rooms.entries()) {
      if (r.rect[0] > r.rect[2] || r.rect[1] > r.rect[3]) errors.push(`massing.rooms.${i}: Rechteck verkehrt herum`);
      const top = r.volume === undefined ? (m.upperFloors ?? 0) : 8;
      if ((r.floor ?? 0) < 0 || (r.floor ?? 0) > top) errors.push(`massing.rooms.${i}: Etage ${r.floor} gibt es nicht`);
    }
    for (const [i, s] of (m.stairs ?? []).entries()) {
      const above = s.volume === undefined ? s.floor < (m.upperFloors ?? 0) : m.rooms.some((r) => r.volume === s.volume && (r.floor ?? 0) === s.floor + 1);
      if (s.floor < 0 || !above) errors.push(`massing.stairs.${i}: keine Etage über ${s.floor}`);
    }
    // W13-A: Räume verweisen nur auf deklarierte Nebenbaukörper
    for (const [where, list] of [['massing.rooms', m.rooms], ['massing.storeys.rooms', m.storeys?.rooms ?? []]] as const) {
      for (const [i, r] of list.entries()) if (r.volume !== undefined && m.volumes?.[r.volume] === undefined) errors.push(`${where}.${i}.volume: unbekannter Baukörper '${r.volume}'`);
    }
    for (const [where, list] of [['massing.stairs', m.stairs ?? []], ['massing.storeys.stairs', m.storeys?.stairs ?? []]] as const) {
      for (const [i, st] of list.entries()) if (st.volume !== undefined && m.volumes?.[st.volume] === undefined) errors.push(`${where}.${i}.volume: unbekannter Baukörper '${st.volume}'`);
    }
  } else {
    const sizes = BUILDING_SIZES.filter((s) => def.sizes?.[s] !== undefined);
    if (sizes.length === 0) errors.push(`${def.id}: Generator '${m.generator}' braucht mindestens eine Größe (sizes)`);
    if ((def.program ?? []).length === 0) errors.push(`${def.id}: Generator '${m.generator}' braucht ein Raumprogramm`);
    for (const s of sizes) {
      const size = def.sizes![s]!;
      const [lo, hi] = size.footprint;
      if (lo[0] > hi[0] || lo[1] > hi[1]) errors.push(`sizes.${s}.footprint: min > max`);
      range(size.floors, `sizes.${s}.floors`);
      range(size.floorHeight, `sizes.${s}.floorHeight`);
      range(size.groundHeight, `sizes.${s}.groundHeight`);
      range(size.units, `sizes.${s}.units`);
      if (rangeOf(size.floors)[0] < 1) errors.push(`sizes.${s}.floors: mindestens 1`);
      for (const h of [size.floorHeight, size.groundHeight]) if (h !== undefined && (rangeOf(h)[0] < 2 || rangeOf(h)[1] > 16)) errors.push(`sizes.${s}: lichte Höhe 2–16`);
      for (const w of size.wings ?? []) if (wings[w] === undefined) errors.push(`sizes.${s}.wings: unbekannter Flügel '${w}'`);
      if (size.units !== undefined && m.generator !== 'row') errors.push(`sizes.${s}.units: nur für Generator 'row'`);
      for (const p of size.parts ?? []) {
        const part = def.parts?.[p];
        if (part === undefined) {
          errors.push(`sizes.${s}.parts: unbekannter Teil '${p}'`);
          continue;
        }
        const ps = { ...part, ...part.sizes?.[s] };
        if (ps.footprint === undefined) errors.push(`parts.${p}: Größe ${s} ohne footprint`);
        if (ps.floors === undefined && ps.above === undefined) errors.push(`parts.${p}: Größe ${s} ohne floors bzw. above`);
      }
    }
    for (const [id, p] of Object.entries(def.parts ?? {})) {
      for (const ps of [p, ...Object.values(p.sizes ?? {})]) {
        if (ps === undefined) continue;
        range(ps.floors, `parts.${id}.floors`);
        range(ps.above, `parts.${id}.above`);
        if (ps.footprint !== undefined && (ps.footprint[0][0] > ps.footprint[1][0] || ps.footprint[0][1] > ps.footprint[1][1])) errors.push(`parts.${id}.footprint: min > max`);
      }
      range(p.anchor.gap, `parts.${id}.anchor.gap`);
      range(p.anchor.shift, `parts.${id}.anchor.shift`);
      if (p.parapet !== undefined && p.roof !== 'flat') errors.push(`parts.${id}.parapet: nur mit Flachdach (roof: flat)`);
      if (p.parapetDeck !== undefined && p.parapet === undefined) errors.push(`parts.${id}.parapetDeck: nur mit parapet`);
    }
    const ring = def.structures?.ring;
    if (ring !== undefined) for (const k of ['offset', 'height', 'towerSpacing'] as const) range(ring[k], `structures.ring.${k}`);
    for (const [id, w] of Object.entries(wings)) {
      range(w.depth, `massing.wings.${id}.depth`);
      range(w.length, `massing.wings.${id}.length`);
      range(w.floors, `massing.wings.${id}.floors`);
      if (w.gap !== undefined && w.volume !== true) errors.push(`massing.wings.${id}.gap: nur für eigene Baukörper (volume)`);
    }
  }
  for (const [i, e] of (def.program ?? []).entries()) {
    range(e.count, `program.${i}.count`);
    if (typeof e.floor !== 'string' && Array.isArray(e.floor) && e.floor[0] > e.floor[1]) errors.push(`program.${i}.floor: min > max`);
    if (e.wing !== undefined && wings[e.wing] === undefined) errors.push(`program.${i}.wing: unbekannter Flügel '${e.wing}'`);
    if (e.wing !== undefined && e.floor !== undefined) errors.push(`program.${i}: Flügel-Räume stehen auf allen Etagen des Flügels (kein floor)`);
    if (e.part !== undefined && def.parts?.[e.part] === undefined) errors.push(`program.${i}.part: unbekannter Teil '${e.part}'`);
    if (e.part !== undefined && e.wing !== undefined) errors.push(`program.${i}: entweder wing oder part`);
    if (e.fill === true && (e.share !== undefined || e.count !== undefined)) errors.push(`program.${i}: fill schließt share und count aus`);
  }
  for (const [i, e] of (def.functions ?? []).entries()) {
    if (typeof e.floor !== 'string' && Array.isArray(e.floor) && e.floor[0] > e.floor[1]) errors.push(`functions.${i}.floor: min > max`);
    if (e.wing !== undefined && wings[e.wing] === undefined) errors.push(`functions.${i}.wing: unbekannter Flügel '${e.wing}'`);
    if (e.wing !== undefined && e.floor !== undefined) errors.push(`functions.${i}: Flügel-Räume stehen auf allen Etagen des Flügels (kein floor)`);
    if (e.part !== undefined && def.parts?.[e.part] === undefined) errors.push(`functions.${i}.part: unbekannter Teil '${e.part}'`);
    if (e.part !== undefined && e.wing !== undefined) errors.push(`functions.${i}: entweder wing oder part`);
  }
  if ((def.functions ?? []).length > 0 && m.generator === 'fixed') errors.push('functions: feste Grundrisse (fixed) haben kein Raumprogramm');
  for (const [k, r] of Object.entries(def.checks ?? {})) if (r !== undefined && r[0] > r[1]) errors.push(`checks.${k}: min > max`);
  return errors.length > 0 ? { ok: false, errors, warnings: [] } : { ok: true, value: def, warnings: [] };
}

export function parseBuildingTypeDef(text: string, source = '<text>'): ValidationResult<BuildingTypeDef> {
  let raw: unknown;
  try {
    raw = parseJson5Text(text);
  } catch (e) {
    return { ok: false, errors: [`${source}: JSON5-Fehler: ${(e as Error).message}`], warnings: [] };
  }
  const r = validateBuildingTypeDef(raw);
  return r.ok ? r : { ...r, errors: r.errors.map((m) => `${source}: ${m}`) };
}

/** Bekannte Namen der anderen Kontexte für den Katalog-Lint (vom Aufrufer, z. B. aus Katalog, Themes, Hülle, Gelände). */
export interface BuildingTypeRefs {
  readonly roomTypes: ReadonlySet<string>;
  readonly themes: ReadonlySet<string>;
  readonly roofs: ReadonlySet<string>;
  readonly siteTemplates: ReadonlySet<string>;
  readonly terrainStyles: ReadonlySet<string>;
  readonly zoneKinds: ReadonlySet<string>;
  /** Gruppen der Außengestaltung (optional). */
  readonly exteriorGroups?: ReadonlySet<string>;
}

/** Katalog-Lint: Verweise auf Raumtypen, Themes, Dachformen, Gelände-Vorlagen/-Stile, Zonenarten → Fehlertexte. */
export function lintBuildingType(def: BuildingTypeDef, refs: BuildingTypeRefs): string[] {
  const errors: string[] = [];
  const need = (set: ReadonlySet<string> | undefined, v: string | undefined, what: string, where: string): void => {
    if (set !== undefined && v !== undefined && !set.has(v)) errors.push(`${def.id}: ${where}: unbekannte${what} '${v}'`);
  };
  const m = def.massing;
  if (m.generator === 'fixed') for (const [i, r] of m.rooms.entries()) need(refs.roomTypes, r.room, 'r Raumtyp', `massing.rooms.${i}`);
  if (m.generator === 'fixed') for (const [id, v] of Object.entries(m.volumes ?? {})) need(refs.roofs, v.roof, ' Dachform', `massing.volumes.${id}.roof`);
  if (m.generator === 'wings') for (const [id, w] of Object.entries(m.wings)) need(refs.roofs, w.roof, ' Dachform', `massing.wings.${id}.roof`);
  for (const [id, p] of Object.entries(def.parts ?? {})) need(refs.roofs, p.roof, ' Dachform', `parts.${id}.roof`);
  const yard = def.structures?.ring?.yard;
  if (typeof yard === 'string') need(refs.zoneKinds, yard, ' Zonenart', 'structures.ring.yard');
  for (const [i, e] of (def.program ?? []).entries()) for (const r of typeof e.room === 'string' ? [e.room] : e.room) need(refs.roomTypes, r, 'r Raumtyp', `program.${i}`);
  for (const [i, e] of (def.functions ?? []).entries()) {
    for (const r of typeof e.room === 'string' ? [e.room] : e.room) need(refs.roomTypes, r, 'r Raumtyp', `functions.${i}`);
    for (const r of e.replaces ?? []) need(refs.roomTypes, r, 'r Raumtyp', `functions.${i}.replaces`);
  }
  need(refs.roomTypes, def.entrance, 'r Raumtyp', 'entrance');
  need(refs.roomTypes, def.corridor?.room, 'r Raumtyp', 'corridor.room');
  need(refs.roomTypes, def.stairs?.room, 'r Raumtyp', 'stairs.room');
  for (const t of def.themes ?? []) need(refs.themes, t, 's Theme', 'themes');
  need(refs.roofs, def.shell?.roof, ' Dachform', 'shell.roof');
  const site = def.site;
  need(refs.siteTemplates, site?.template, ' Gelände-Vorlage', 'site.template');
  need(refs.terrainStyles, site?.style, 'r Geländestil', 'site.style');
  for (const [i, zn] of (site?.zones ?? []).entries()) need(refs.zoneKinds, zn.kind, ' Zonenart', `site.zones.${i}`);
  if (def.exterior !== undefined && def.exterior !== false) for (const g of def.exterior.off ?? []) need(refs.exteriorGroups, g, ' Außen-Gruppe', 'exterior.off');
  for (const [id, p] of Object.entries(def.parts ?? {})) for (const g of p.exterior?.off ?? []) need(refs.exteriorGroups, g, ' Außen-Gruppe', `parts.${id}.exterior.off`);
  const silo = def.structures?.silo;
  if (silo?.part !== undefined && def.parts?.[silo.part] === undefined) errors.push(`structures.silo.part: unbekannter Teil '${silo.part}'`);
  for (const [i, zn] of (def.site?.zones ?? []).entries()) {
    if (zn.part !== undefined && def.parts?.[zn.part] === undefined) errors.push(`site.zones.${i}.part: unbekannter Teil '${zn.part}'`);
  }
  return errors;
}

/** Unveränderliche Bautypen-Sammlung (Read Model). */
export class BuildingTypeCatalog {
  private constructor(private readonly byId: ReadonlyMap<string, BuildingTypeDef>) {}

  static of(defs: readonly BuildingTypeDef[]): BuildingTypeCatalog {
    const byId = new Map<string, BuildingTypeDef>();
    for (const d of defs) {
      if (byId.has(d.id)) throw new Error(`Bautyp '${d.id}' ist doppelt im Katalog`);
      byId.set(d.id, d);
    }
    return new BuildingTypeCatalog(byId);
  }

  get(id: string): BuildingTypeDef {
    const d = this.byId.get(id);
    if (d === undefined) throw new Error(`Unbekannter Bautyp '${id}'`);
    return d;
  }

  ids(): string[] {
    return [...this.byId.keys()].sort();
  }

  /** Fertige Bautypen (ohne Entwürfe), nach Familie und Name. */
  ready(): BuildingTypeDef[] {
    return [...this.byId.values()].filter((d) => d.status !== 'draft').sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name));
  }
}
