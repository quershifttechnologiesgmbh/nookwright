/**
 * Story-Zustand (Q5/P15, research/55 §2/§3, Bericht64): DIESELBE Geometrie erzählt je Zustand eine andere
 * Geschichte – „Zustand ist der günstigste Story-Hebel“ (research/55 §0.3). Der Zustand ist ein **additives Feld**
 * des Projektzustands (`ProjectState.storyState`) und fehlt in allen bestehenden Projekten; ohne ihn bleibt jede
 * Ausgabe bitgleich (Prüfsummen-Netz in `packages/pipeline/test/story-state.test.ts`), wie bei der Farbpalette (Q4).
 *
 * Belege: Bericht64 (Mojang-Interview „Cave Story“) nennt „vergraute ehemalige Farben, verrottetes Holz und
 * verblasste Pracht“ – Materialien altern also **unterschiedlich**, nicht pauschal. Deshalb wirkt der Zustand
 * materialbezogen (Stein → Flechten/Risse, Holz → entrindet/vergraut, Farbflächen → grau) und ortsbezogen
 * (Laufspur an der Tür, feuchte Basis, Arbeitsraum); die Umsetzung steht in `@mcda/materialize` `story.ts`.
 *
 * research/55 §3 führt fünf Zustände; die zwölf Szenarien (§3.1–§3.12) bilden darauf ab und sind P16.
 */
export const STORY_STATES = ['neu', 'bewohnt', 'verlassen', 'verfallen', 'belagert'] as const;

/** Nutzungszustand: `neu` (kaum Spuren), `bewohnt` (Grundzustand), `verlassen` (still), `verfallen` (Ruine), `belagert`. */
export type StoryState = (typeof STORY_STATES)[number];

/** Referenzzustand für Vergleiche („gleiches Haus, anderer Zustand“): die vorhandene Verwitterung des Themes. */
export const DEFAULT_STORY_STATE: StoryState = 'bewohnt';
