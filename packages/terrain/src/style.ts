import JSON5 from 'json5';
import { z } from 'zod';

/**
 * Geländestil (catalog/terrain/*.json5): Relief, Boden, Fundament-Anpassung, Wege und Vegetation als Daten.
 * Reine Daten + Validierung; der Generator (`generateSite`) liest nur das geprüfte Objekt.
 */

/** Baumarten des Generators (Form prozedural); die Blöcke kommen aus den Theme-Rollen `log_<art>` / `leaves_<art>`. */
export const TREE_SPECIES = ['oak', 'birch', 'spruce'] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];

const ID = /^[a-z0-9_]+$/;

export const TerrainStyleSchema = z
  .object({
    id: z.string().regex(ID, 'id: klein, z. B. meadow'),
    name: z.string().min(1),
    description: z.string().optional(),
    /** fBm-Höhenfeld (research/03 §C10): Amplitude in Blöcken um die Grundhöhe, Skala = Wellenlänge der 1. Oktave. */
    relief: z
      .object({
        amplitude: z.number().min(0).max(16),
        scale: z.number().min(4).max(256),
        octaves: z.number().int().min(1).max(5).optional(),
        /** Amplitudenfaktor je Oktave (Standard 0,5). */
        gain: z.number().min(0.2).max(0.8).optional(),
      })
      .strict(),
    /** Erdschichten unter der Oberfläche (darunter Stein). */
    soil: z.object({ depth: z.number().int().min(1).max(6).optional() }).strict().optional(),
    /**
     * Fundament-Anpassung (Jigsaw „beard“): `pad` = eben planierter Ring um Gebäude und Dachüberstand,
     * `blend` = Breite der weichen Überblendung zum natürlichen Gelände.
     */
    foundation: z.object({ pad: z.number().int().min(1).max(4).optional(), blend: z.number().int().min(1).max(16).optional() }).strict().optional(),
    paths: z
      .object({
        width: z.number().int().min(1).max(2).optional(),
        /**
         * Wegprofil und Weghierarchie (research/18 G1, research/16 U5; additiv): Hauptweg (Tür → Zufahrt),
         * Nebenweg (Tür → Außenbereiche), Pfad (Teich, Obstgarten, Wiese). Ohne `profile` gilt `width` für alle Wege.
         */
        profile: z
          .object({
            /** Breite des Hauptwegs (Standard 3); Material `path_main` (Kies/grobe Erde, „Dorfweg“). */
            main: z.number().int().min(1).max(5).optional(),
            /** Breite der Nebenwege (Standard 2); Material `ground_path` (Trampelpfad). */
            side: z.number().int().min(1).max(3).optional(),
            /** Anteil weicher Wegrand `path_edge` neben Haupt- und Nebenwegen (0–1, Standard 0,6). */
            edge: z.number().min(0).max(1).optional(),
            /** Grasnarbe in der Mitte 3 breiter Wege (Fahrspuren, „Feldweg“). */
            median: z.boolean().optional(),
            /** Rinne `path_gutter` (Stufe) in der Mitte von Hauptwegen ab 5 Breite („Stadtstraße“). */
            gutter: z.boolean().optional(),
            /** Pfade als Trittsteine `path_stone` jede zweite Zelle (G4) statt Trampelpfad. */
            stepping: z.boolean().optional(),
            /**
             * Trittstein-Weg (W4-A, Hobbit/Cottage-Vorbilder): auch Haupt- und Nebenwege aus Trittsteinen
             * `path_stone` im Schachbrett (je Reihe ein Stein, versetzt; bei 1 Breite jede zweite Zelle), dazwischen
             * Rasen. Die Wegzellen bleiben Weg (verbunden, frei von Pflanzen); am Türvorplatz liegt der Weg voll.
             */
            steppingAll: z.boolean().optional(),
            /**
             * Vorplatz (W4-A, Review M3): vor jeder Außentür 3 breit und so viele Zellen tief ein Pflaster aus einer
             * Rolle (`path_stone`) statt Hof-, Weg- und Randmischung – höchstens 3 Blockarten vor der Stufe.
             */
            forecourt: z.number().int().min(1).max(8).optional(),
            /**
             * Ausfransen (W3-GA, Vorbilder: Gras stößt direkt an den Weg, Rand ±1 unregelmäßig): Anteil der Randzellen
             * neben Haupt- und Nebenwegen, die das Wegmaterial bekommen (in zusammenhängenden Stücken, Rauschen).
             */
            bulge: z.number().min(0).max(1).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    /** Zäune (research/18 Z1): Stammpfosten `fence_post` alle `postEvery` Felder, an Ecken und Toren immer (mit Laterne). */
    fences: z
      .object({
        postEvery: z.number().int().min(2).max(8).optional(),
        /**
         * Laternen auf dem Zaunring (W3-GA, Modul „Zaun mit Tor“): `anchors` (Standard) = Eck- und Torpfosten,
         * `gate` = nur die zwei Pfosten neben dem Tor (die Laterne markiert den Eingang, nicht jede Ecke).
         */
        lanterns: z.enum(['anchors', 'gate']).optional(),
        /**
         * Straßenzaun (W3-GA): Zaunlinie an der Grundstücksseite, zu der der Hauptweg führt, Tor genau über dem Weg,
         * Laternen auf den Torpfosten („Tür → Weg → Tor“). Nicht bei Bauwerken (Burg: die Mauer ist die Grenze).
         */
        street: z.boolean().optional(),
        /**
         * Schlanke Zaunlinie (W4-A, plan/spikes/W4A_zaeune.md): die Linie besteht aus Zaunblöcken, Zwischenpfosten
         * im Takt `postEvery` sind schlanke Zaunpfosten (Zaun 2 hoch). Stammpfosten stehen nur an Ecken, Linienenden
         * und im großen Takt (höchstens alle `logEvery` Felder) als Stumpf mit Zaunkopf (Stamm 1 hoch, Zaun darüber);
         * die zwei Torpfosten bleiben volle Stämme mit Laterne. Fehlt das Feld, bleibt jeder Pfosten ein Vollstamm.
         */
        logEvery: z.number().int().min(6).max(32).optional(),
        /**
         * Länge des Straßenzauns (W4-A): `side` (Standard) = ganze Grundstücksseite, `front` = nur vor dem Haus
         * (Hausbreite + 2 je Seite, „Vorgartenzaun“) – auf Gehöften läuft er dann nicht neben dem Koppelzaun her.
         */
        streetSpan: z.enum(['side', 'front']).optional(),
      })
      .strict()
      .optional(),
    /** Außenbeleuchtung (research/18 L1), überschreibbar je Grundstück (`Site.setLighting`). */
    lighting: z
      .object({
        mode: z.enum(['none', 'paths', 'spawnproof']).optional(),
        /**
         * Abstand der Laternenpfähle entlang der Wege (Standard 10). Als Objekt **je Rang** (research/44 §4.1):
         * `main` (Hauptweg), `side` (Nebenweg), `path` (Pfad) – fehlende Ränge nehmen `main`.
         */
        every: z
          .union([
            z.number().int().min(6).max(16),
            z.object({
              main: z.number().int().min(6).max(16).optional(),
              side: z.number().int().min(6).max(16).optional(),
              path: z.number().int().min(0).max(16).optional(),
            }).strict(),
          ])
          .optional(),
        /** Licht im Laub (research/16 L3): Leuchtkern in Büschen statt sichtbarer Pfähle, wo möglich. */
        leaves: z.boolean().optional(),
        /**
         * Wegmündung (W3-GA): Laternenpfahl dort, wo der Hauptweg den Grundstücksrand erreicht – der Weg beginnt
         * „an der Straße“ sichtbar, statt im Takt irgendwo zu leuchten.
         */
        entry: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /** Außen-Ausstattung (research/18 A4/A6/V1/V4, research/16 U5/V3/V4/V6); alles optional, fehlt = aus. */
    decor: z
      .object({
        /** Brunnen in der Hofmitte (A4): offen oder mit Brunnenhaus (4 Pfosten, Dach, Laterne). */
        well: z.enum(['open', 'roofed']).optional(),
        /** Hof-Ausstattung (A6): Holzstapel unter dem Überstand, Fässer, Bienenstock am Garten, Vogelscheuche im Feld (0–1). */
        props: z.number().min(0).max(1).optional(),
        /** Streudeko (V3): Blütenteppich/Gras in Flecken an Wegrändern (0–1). */
        scatter: z.number().min(0).max(1).optional(),
        /** Kübel (V1): Kübelbusch an den Hausecken. */
        planters: z.boolean().optional(),
        /** Beet mit Kante (research/16 V4) an den Hauswänden zwischen den Fenstern. */
        beds: z.boolean().optional(),
        /** Traufstreifen (research/16 U5) rund ums Haus statt Gras. */
        eaves: z.boolean().optional(),
        /** Hausbäume (V4/V6): Bäume seitlich oder hinter dem Haus, nie vor der Hauptfassade (0–2). */
        houseTrees: z.number().int().min(0).max(2).optional(),
        /** Spalier (V4): flaches Laub auf Zaunkern an der Südwand. */
        espalier: z.boolean().optional(),
        /**
         * Feste Module statt Streuung (W3-GA, Baustandard G1): Katalog-Objekte der Zonen kommen als kleiner Satz
         * (`ZONE_KITS`: Hofecke, Gartenecke, Bank am Platz …) an Ecken und Rändern der Zone, mit dem Rücken zum Rand,
         * statt als Dichte über die Fläche.
         */
        kits: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /**
     * Katalog-Objekte der **freien Landschaft** (Q3, research/51 §6/§7): die ungezonte Wiese bekommt Objekte aus
     * dem Komponenten-Katalog. Je Stil eigener Pool und eigene Dichte – das ist der Hebel, mit dem sich die fünf
     * Geländestile in Fels/Baum/Blume unterscheiden (Kennzahl L3). Fehlt das Feld, bleibt die Landschaft leer.
     */
    landscape: z
      .object({
        /** Dichtefaktor 0–1; Objektzahl = Fläche × Faktor / 10 (ein Objekt je 10 Zellen bei Faktor 1). */
        density: z.number().min(0).max(1),
        /** Tags für die Katalog-Abfrage (Standard `["meadow"]`). */
        tags: z.array(z.string().regex(ID)).min(1).max(8).optional(),
        /** Nur diese Komponenten-IDs zulassen (z. B. nur Felsen im Hügelland). */
        only: z.array(z.string().regex(/^[a-z0-9_]+(\/[a-z0-9_]+)*$/)).min(1).max(24).optional(),
        /** Bevorzugte Tags im Pool (Gewicht 4 statt 1) – z. B. Blumen auf der Wiese. */
        prefer: z.array(z.string().regex(ID)).min(1).max(8).optional(),
        /**
         * Nur in Bezug (W3-GA): Objekte nur im Abstand 1…`distance` einer Baumgruppe (außerhalb der Krone) bzw. des
         * Grundstücksrands – Findlinge liegen am Gehölz und am Rand, nicht verstreut vor dem Haus.
         */
        near: z
          .object({
            anchors: z.array(z.enum(['trees', 'rim'])).min(1).max(2),
            distance: z.number().int().min(1).max(6),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    vegetation: z
      .object({
        trees: z
          .object({
            /** Mindestabstand der Stämme (Poisson-Disk). */
            spacing: z.number().min(4).max(32),
            /** Anteil der Kandidaten, der einen Baum bekommt (0–1), moduliert durch eine Waldmaske. */
            density: z.number().min(0).max(1),
            /**
             * Harte Schwelle (0–1, research/30 K6): Kandidaten unter diesem Wert fallen **vor** dem Würfeln
             * heraus. Damit wird eine Fläche gezielt dünner (Lichtung, Wegrand), statt zufällig dünn.
             */
            threshold: z.number().min(0).max(1).optional(),
            species: z.partialRecord(z.enum(TREE_SPECIES), z.number().min(0)),
            /**
             * Baumgruppen statt Streuung (W3-GA, Modul „Baumgruppe“): 2–3 Bäume je Gruppe im Randband des
             * Grundstücks, nie vor der Hauptfassade; `density` und `threshold` gelten dann nicht. Die Zahl der Gruppen
             * folgt dem Umfang (`every` Blöcke Rand je Gruppe), Mindestabstand der Stämme bleibt `spacing`.
             */
            groups: z
              .object({
                /** Bäume je Gruppe [min, max] (Standard [2, 3]). */
                size: z.tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)]).optional(),
                /** Randlänge je Gruppe (Standard 40): Gruppen = Umfang ÷ every, mindestens 1. */
                every: z.number().int().min(16).max(128).optional(),
                /** Abstand der Stämme zum Grundstücksrand [min, max] (Standard [2, 6]). */
                rim: z.tuple([z.number().int().min(1).max(12), z.number().int().min(1).max(16)]).optional(),
                /**
                 * Additiv (W12-C): Sichtkeil vor der Haustür (Halbwinkel in Grad, 20–80) – dort stehen weder Gruppen- noch
                 * Hausbäume noch Findlinge, auch nicht diagonal vor den Hausecken (Blick auf den Eingang frei). Fehlt = nur
                 * die Streifen vor den Fassaden (bitgleich).
                 */
                sight: z.number().int().min(20).max(80).optional(),
                /** Unterholz: Büsche je Gruppe am Kronenrand (Standard 1). */
                understory: z.number().int().min(0).max(4).optional(),
                /**
                 * Höchstzahl der Bäume je Grundstück aus Gruppen und Hausbäumen (W4-A, Vorbilder: 2–4 Bäume; der
                 * Obstgarten zählt als Zone nicht mit). Eine Gruppe beginnt nur, wenn noch `size[0]` Bäume Platz
                 * haben; Hausbäume bekommen den Rest. Fehlt das Feld, gilt keine Grenze.
                 */
                max: z.number().int().min(1).max(12).optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        bushes: z
          .object({
            spacing: z.number().min(2).max(16),
            density: z.number().min(0).max(1),
            /** Wahrscheinlichkeit je Keim am Hausfundament (research/12 §6.3: Keim alle 4–6 Blöcke Umfang). */
            foundation: z.number().min(0).max(1).optional(),
            /** Harte Schwelle für Sträucher im Gelände (0–1, research/30 K6). */
            threshold: z.number().min(0).max(1).optional(),
            /** Harte Schwelle für die Fundament-Sträucher (0–1). */
            foundationThreshold: z.number().min(0).max(1).optional(),
          })
          .strict()
          .optional(),
        ground: z
          .object({
            /** Mindestabstand der Bodenpflanzen (Poisson-Disk, ≥ 1). */
            spacing: z.number().min(1).max(6),
            density: z.number().min(0).max(1),
            /** Anteil Blumen (Rest: Gras/Farn); Blumen wachsen in Flecken (Rauschen). */
            flowers: z.number().min(0).max(1).optional(),
            /** Anteil Blütenteppich/Laubstreu. */
            carpet: z.number().min(0).max(1).optional(),
            /** Harte Schwelle (0–1, research/30 K6): dünnt die Bodenpflanzen kontrolliert aus. */
            threshold: z.number().min(0).max(1).optional(),
            /**
             * Cluster-Streuung statt Zellwahrscheinlichkeit (Q3, research/51 §4 V-C1): Poisson-Zentren mit
             * Mindestabstand `spacing`, dann radiale Dichte – dichter Kern (`core`), ausgedünnter Rand (`edge`).
             * Fehlt das Feld, bleibt die Streuung bitgleich zum Stand davor.
             */
            clusters: z
              .object({
                /** Mindestabstand der Cluster-Zentren (Poisson-Disk). */
                spacing: z.number().min(2).max(24),
                /** Cluster-Radius (Chebyshev) als Bereich [min, max]. */
                radius: z.tuple([z.number().int().min(1).max(4), z.number().int().min(1).max(4)]),
                /** Trefferwahrscheinlichkeit im Kern (Radius ≤ 1). */
                core: z.number().min(0).max(1),
                /** Trefferwahrscheinlichkeit am Rand (Radius ≥ 2). */
                edge: z.number().min(0).max(1),
              })
              .strict()
              .optional(),
            /**
             * Blumen in Bezug (W3-GA, Baustandard G1): Fleckenzentren bis `distance` an Weg, Zaun/Hecke, Baum, Busch
             * oder Haus haben die volle Dichte (Saum), im offenen Rasen nur den Anteil `open`.
             */
            near: z.object({ distance: z.number().int().min(1).max(8), open: z.number().min(0).max(1) }).strict().optional(),
          })
          .strict()
          .optional(),
        /** Obstgarten (Zone `orchard`, V4): Rasterabstand der Obstbäume (Standard 5). */
        orchard: z.object({ spacing: z.number().int().min(4).max(8).optional() }).strict().optional(),
        /**
         * Garantiert freie Stellen (research/30 K6, Nutzerreview „die Wege verbinden alles"): Wege bleiben frei,
         * unabhängig von der Dichte. Ohne diese Liste bleibt alles wie bisher.
         */
        keepFree: z
          .array(
            z.union([
              z.object({ along: z.enum(['path', 'pad']), distance: z.number().int().min(0).max(8) }).strict(),
              z.object({ around: z.enum(['door', 'pad']), distance: z.number().int().min(0).max(8) }).strict(),
            ]),
          )
          .max(8)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type TerrainStyleDef = z.infer<typeof TerrainStyleSchema>;

export type TerrainStyleResult = { ok: true; value: TerrainStyleDef; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };

export function validateTerrainStyle(input: unknown): TerrainStyleResult {
  const r = TerrainStyleSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.length > 0 ? i.path.join('.') : '(wurzel)'}: ${i.message}`), warnings: [] };
  const warnings: string[] = [];
  const trees = r.data.vegetation?.trees;
  if (trees !== undefined && trees.density > 0 && Object.values(trees.species).every((w) => w <= 0)) {
    return { ok: false, errors: [`${r.data.id}: vegetation.trees braucht mindestens eine Baumart mit Gewicht > 0`], warnings };
  }
  if (r.data.relief.amplitude > 0 && r.data.relief.scale < 2 * r.data.relief.amplitude) {
    warnings.push(`${r.data.id}: Relief steil (scale < 2 × amplitude) – der Talus-Pass flacht stark ab`);
  }
  return { ok: true, value: r.data, warnings };
}

/** Liest einen Geländestil aus JSON5-Text (Katalog-Dateien erlauben Kommentare). */
export function parseTerrainStyle(text: string, source = '<text>'): TerrainStyleResult {
  let raw: unknown;
  try {
    raw = JSON5.parse(text);
  } catch (e) {
    return { ok: false, errors: [`${source}: JSON5-Fehler: ${(e as Error).message}`], warnings: [] };
  }
  const r = validateTerrainStyle(raw);
  return r.ok ? r : { ...r, errors: r.errors.map((m) => `${source}: ${m}`) };
}
