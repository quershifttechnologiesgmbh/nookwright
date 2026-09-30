/**
 * Rollen + Formen, die der Gelände-Generator benutzt (Außen-Rollen des Themes). Jedes Theme muss sie in jeder
 * Zielversion auflösen können (Test theme-roles). Der Generator kennt keine Minecraft-Namen (ADR 8), nur Rollen.
 *
 * Konventionen für Themes:
 *  - `block`-Rollen dürfen feste Blöcke mischen (`mix` mit `block`-Einträgen), z. B. Blumen, Gras, Laub.
 *  - `ground_cover` enthält nur Blöcke MIT Ausrichtung (Blütenteppich, Laubstreu): der Generator setzt `facing`.
 *  - Alle anderen `block`-Pflanzen-Rollen enthalten nur Blöcke OHNE Ausrichtung und ohne obere Hälfte.
 *  - Unter dem Stamm liegt `ground_dirt` (Gras wird unter vollen Blöcken ohnehin zu Erde).
 */
export const TERRAIN_ROLE_SHAPES = {
  // Boden (Schicht Terrain)
  ground_grass: ['block'], // Wiese (Oberfläche)
  ground_dirt: ['block'], //  Erde unter der Oberfläche, unter Stämmen, Beetrand
  ground_stone: ['block'], // tiefer Untergrund
  ground_path: ['block'], //  Trampelpfad (Tür → Außenbereiche)
  ground_yard: ['block'], //  Hof, gepflastert
  garden_soil: ['block'], //  Gartenbeet
  farmland: ['block'], //     Ackerland
  water: ['block'], //        Wasser (Bewässerung, Teich)
  pond_bed: ['block'], //     Teichgrund
  foundation: ['block'], //   Fundament unter dem Gebäude (Rolle der Hülle)
  // W9-G4 Erdhügel (mound.ts): Oberfläche an Stufenkanten (Moos: grün auch an der Seite, statt Erdkante des Grasblocks)
  // und Stützmauer, wo der Hügel mehr als eine Stufe offen zeigt (Anschnitt neben der Front, Flanken, Erdlage über der Tür)
  ground_moss: ['block'],
  mound_wall: ['block'],
  // Ausstattung (Schicht Möbel)
  fence_outdoor: ['fence', 'fence_gate'],
  light_outdoor: ['lantern'],
  // Vegetation (Schicht Möbel)
  log_oak: ['log'],
  log_birch: ['log'],
  log_spruce: ['log'],
  leaves_oak: ['leaves'],
  leaves_birch: ['leaves'],
  leaves_spruce: ['leaves'],
  leaves_bush: ['block'],
  flower_wild: ['block'],
  flower_warm: ['block'],
  flower_cool: ['block'],
  grass_tuft: ['block'],
  ground_cover: ['block'],
  pond_plant: ['block'],
  crop_wheat: ['block'],
  crop_carrot: ['block'],
  crop_potato: ['block'],
  crop_beetroot: ['block'],
  // ---- Gelände-Feinschliff (T2, research/18 §9–§13, research/16 U5/L3/V1–V6); nur mit den neuen Optionen/Zonen
  // Wege (G1/G4): Hauptweg, weicher Rand, Trittsteine, Rinne (Stufe unten, `half: bottom`); Platzmuster (G2)
  path_main: ['block'],
  path_edge: ['block'], //    darf rieselnde Blöcke enthalten (darunter liegt immer Erde), keine Pflanzen darauf
  path_stone: ['block'],
  path_gutter: ['slab'],
  plaza_accent: ['block'],
  paddock_ground: ['block'], // Koppel (A3): nur Erde-artige Blöcke
  bed_edge: ['block'], //     Beetkante (research/16 V4), bündig im Boden
  // Zäune und Hecken (Z1/Z3): Stammpfosten, Hecke; Obstbaum-Laub (V4) – Laub-Rollen nur mit `*_leaves`
  fence_post: ['log'],
  hedge: ['block'],
  leaves_fruit: ['block'],
  // Licht im Laub (research/16 L3): Leuchtblock ohne Ausrichtung
  light_hidden: ['block'],
  // Brunnen (A4): Einfassung (Block, Mauer), Dach (Stufe oben)
  well_stone: ['block', 'wall'],
  well_roof: ['slab'],
  // Hof-Ausstattung (A6, V1): Holzstapel (liegend), Fass/Bienenstock/Kürbis (mit facing), Heu, Kübel, Tränke
  woodpile: ['log'],
  barrel_outdoor: ['block'],
  beehive: ['block'],
  hay: ['block'],
  scarecrow_head: ['block'],
  planter: ['block'],
  trough: ['block'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type TerrainRole = keyof typeof TERRAIN_ROLE_SHAPES;

export const CROP_ROLES = ['crop_wheat', 'crop_carrot', 'crop_potato', 'crop_beetroot'] as const satisfies readonly TerrainRole[];

/** Rollen mit `facing` (Form `block`): Fass, Bienenstock, Kürbiskopf – der Generator setzt die Ausrichtung. */
export const FACING_BLOCK_ROLES = ['barrel_outdoor', 'beehive', 'scarecrow_head', 'ground_cover'] as const satisfies readonly TerrainRole[];
