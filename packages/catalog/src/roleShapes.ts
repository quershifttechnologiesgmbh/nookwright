/**
 * Form-Vertrag der Hüllen-Rollen (Q4): Welche Minecraft-Formen fragt der Materialisierer für eine Theme-Rolle ab?
 * Kopie der Tabelle aus `@mcda/materialize` (`SHELL_ROLE_SHAPES`) – bewusst hier, weil `@mcda/catalog` nicht von
 * `@mcda/materialize` abhängen darf (der Materialisierer hängt am Katalog). Ein Test in `packages/materialize`
 * vergleicht beide Tabellen, damit sie nicht auseinanderlaufen.
 */
export const SHELL_ROLE_SHAPES: Readonly<Record<string, readonly string[]>> = {
  floor_primary: ['block', 'planks', 'slab'],
  wall_primary: ['block', 'planks', 'stairs'],
  wall_gable: ['block'],
  beam: ['log', 'stairs', 'planks', 'fence', 'trapdoor', 'slab'],
  ladder: ['ladder'],
  door: ['door'],
  window: ['pane'],
  ceiling: ['block', 'planks', 'slab'],
  roof_main: ['stairs', 'slab', 'block'],
  foundation: ['block', 'stairs', 'slab'],
  // feat/underground: Boden der Gewölbe-Ebene (Unterbau, Etage ≤ −2); gleich wie @mcda/materialize shell-shapes
  floor_stone: ['block'],
  parapet: ['block'],
  walkway: ['block', 'stairs'],
  tower_floor: ['block'],
  // W7-B: Sockelgeschoss der Mauertürme bis zum Wehrgang (Rückfall `wall_primary`)
  fort_base: ['block'],
  // W9-G5 (Materialspiel, `WallPlan.accents`): Turmdächer der Mauertürme (Rückfall `roof_main`), Hurde/Holzkrone am
  // Torbau (Rückfall `parapet`), Kappen auf den Turmzinnen (Rückfall `wall_cornice`)
  roof_tower: ['stairs', 'slab', 'block'],
  hoarding: ['block'],
  crown_cap: ['slab'],
  arrow_slit: ['pane'],
  roof_trim: ['stairs', 'slab', 'block'],
  window_frame: ['stairs', 'trapdoor', 'slab'],
  wall_plinth: ['block', 'stairs', 'slab'],
  // W9-G4: Steinring der Rundtür und Rahmen der Rundfenster am Erdhaus (Rückfall `wall_plinth`)
  portal_stone: ['block', 'stairs', 'slab'],
  wall_cornice: ['stairs', 'slab'],
  wall_quoin: ['block'],
  shutter: ['trapdoor'],
  bell: ['bell'],
  sail: ['block'],
  textile_neutral: ['block'],
  finial: ['lightning_rod', 'end_rod'],
  light_hanging: ['chain', 'lantern'],
  trim_light: ['stairs', 'slab', 'block'],
  // W16-B: Dachfläche je Baukörper (`Volume.exterior.roof`, Scheunendach; Rückfall `roof_main`)
  roof_barn: ['stairs', 'slab', 'block'],
  // W16-B: Reifen des Hochsilos (Rückfall `trim_light`)
  silo_band: ['block'],
  silo: ['block'],
  hay: ['block'],
};
