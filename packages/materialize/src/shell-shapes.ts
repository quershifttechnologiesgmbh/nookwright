/**
 * Rollen + Formen, die die Hülle laut Vertrag (blueprint/src/shell/types.ts) benutzt – Bauplan (Wände, Dach,
 * Treppen, Geländer, Leiter) und Bauwerke (`kind: 'fort'`, @mcda/structures). Jedes Theme muss sie in jeder
 * Zielversion auflösen können (Test theme-resolution). Die Außen-Rollen des Geländes stehen in
 * `@mcda/terrain` (`TERRAIN_ROLE_SHAPES`).
 */
export const SHELL_ROLE_SHAPES: Readonly<Record<string, readonly string[]>> = {
  floor_primary: ['block', 'planks', 'slab'],
  // Bauwerke: Mauerkörper, Kragsteine, Bogensteine und Treppenaufgänge als Treppe
  wall_primary: ['block', 'planks', 'stairs'],
  // Giebelfeld (W2, Baustandard D4): Wandzellen unter dem Dach (Giebeldreieck, Ziergiebel, Gaubenfront, Kniestock)
  wall_gable: ['block'],
  // Pfeiler/Stürze (log), Treppenstufen (stairs), Podest/Unterbau (planks), Geländer (fence) – Etagen (F1);
  // Falltür und Stufe als Rückfall für Fensterrahmen/Fensterläden (M2: Rückfall-Vertrag)
  beam: ['log', 'stairs', 'planks', 'fence', 'trapdoor', 'slab'],
  // Leiter als Treppenart (F1)
  ladder: ['ladder'],
  door: ['door'],
  window: ['pane'],
  ceiling: ['block', 'planks', 'slab'],
  roof_main: ['stairs', 'slab', 'block'],
  // Sockel, Anlauf und Vortreppen der Bauwerke (B1); Bodenplatte unter Wänden
  foundation: ['block', 'stairs', 'slab'],
  // feat/underground: Boden der Gewölbe-Ebene (Unterbau, Etage ≤ −2)
  floor_stone: ['block'],
  // Befestigung (B1): Brüstung/Zinnen, Wehrgang-Belag (mit Stufen), Turmböden, Schießscharten
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
  // Außendesign (research/18 §14): Dachkante (Traufe/Ortgang/First), Fensterrahmen/-bank/-verdachung,
  // Sockelprofil, Gesims/Geschossband, Eckquader, Fensterläden
  roof_trim: ['stairs', 'slab', 'block'],
  window_frame: ['stairs', 'trapdoor', 'slab'],
  wall_plinth: ['block', 'stairs', 'slab'],
  // W9-G4: Steinring der Rundtür und Rahmen der Rundfenster am Erdhaus (eine Blockart: spiegelsymmetrisch; Rückfall
  // `wall_plinth`)
  portal_stone: ['block', 'stairs', 'slab'],
  wall_cornice: ['stairs', 'slab'],
  wall_quoin: ['block'],
  shutter: ['trapdoor'],
  // Türme und Windmühle (research/18 T4/T6, @mcda/structures): Glocke der Glockenstube, Segeltuch der Flügel
  bell: ['bell'],
  sail: ['block'],
  // Rückfall-Ziel der Segel (Theme-Rolle der Komponenten, hier nur als Vertrag für den Rückfall)
  textile_neutral: ['block'],
  // Senkrecht/hängend (O1): Turmspitze Blitzableiter bzw. Endstab (orient.vertical), hängende Laternen an Ketten
  // (orient.hanging; Theme-Rolle der Hängelampen-Komponenten)
  finial: ['lightning_rod', 'end_rod'],
  light_hanging: ['chain', 'lantern'],
  // W12-C: heller Kantenrahmen je Baukörper (`Volume.exterior.trim`): Dachkante (Treppe, Stufe, Windbrett) und Eckbrett
  // (Vollblock); dazu Rahmen von Scheunentor und Heuluke (Außen-Deko). Rückfall `roof_trim` hat dieselben Formen.
  trim_light: ['stairs', 'slab', 'block'],
  // W16-B (Review R7-2): Dachfläche je Baukörper (`Volume.exterior.roof`): dunkles Scheunendach, Rückfall `roof_main`
  roof_barn: ['stairs', 'slab', 'block'],
  // W16-B: Reifen des Hochsilos (Rückfall `trim_light`)
  silo_band: ['block'],
  // W12-C: Hochsilo (@mcda/structures `silos`): Mantel und Heu-Füllung
  silo: ['block'],
  hay: ['block'],
};

/**
 * Rollen-Rückfall für Themes, die eine neuere Hüllen-Rolle noch nicht kennen (z. B. Community-Themes von vor
 * der Befestigung): die Materialisierung nimmt dann die hier genannte Rolle mit derselben Form. Die
 * mitgelieferten Themes definieren alle Rollen selbst; der Rückfall hält ältere Themes gültig.
 */
export const SHELL_ROLE_FALLBACKS: Readonly<Record<string, string>> = {
  wall_gable: 'wall_primary',
  parapet: 'wall_primary',
  walkway: 'wall_primary',
  tower_floor: 'wall_primary',
  fort_base: 'wall_primary',
  roof_tower: 'roof_main',
  hoarding: 'parapet',
  crown_cap: 'wall_cornice',
  arrow_slit: 'window',
  roof_trim: 'roof_main',
  trim_light: 'roof_trim',
  roof_barn: 'roof_main',
  silo_band: 'trim_light',
  silo: 'foundation',
  hay: 'foundation',
  window_frame: 'beam',
  wall_plinth: 'foundation',
  portal_stone: 'wall_plinth',
  wall_cornice: 'foundation',
  wall_quoin: 'foundation',
  shutter: 'beam',
  sail: 'textile_neutral',
};

/**
 * Rollen, deren Rückfall schon VOR den Flächen-Regeln gilt (W2, D4): ein Theme ohne `wall_gable` behandelt das
 * Giebelfeld genau wie bisher als `wall_primary` – samt Fachwerk und Wandregeln (bitgleich). Kennt das Theme die
 * Rolle, bekommt der Giebel sein eigenes Material und keine Wandregeln.
 */
export const PRE_SURFACE_FALLBACKS: ReadonlySet<string> = new Set(['wall_gable']);

/** Rolle einer Hüllzelle für die Flächen-Regeln: bei `PRE_SURFACE_FALLBACKS` schon hier der Rückfall. */
export function surfaceRole(has: (role: string) => boolean, role: string): string {
  return PRE_SURFACE_FALLBACKS.has(role) ? effectiveShellRole(has, role) : role;
}

/** Rolle, die ein Theme tatsächlich auflöst: die eigene, sonst der Rückfall (eine Stufe). */
export function effectiveShellRole(has: (role: string) => boolean, role: string): string {
  if (has(role)) return role;
  const alt = Object.hasOwn(SHELL_ROLE_FALLBACKS, role) ? SHELL_ROLE_FALLBACKS[role] : undefined;
  return alt !== undefined && has(alt) ? alt : role;
}
