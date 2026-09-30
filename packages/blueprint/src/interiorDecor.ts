/**
 * Innen-Deko-Stufe (feat/int-decor, LV Hebel 9/10 „Tiefe, Detail und Kohäsion“): wie dicht die Räume nach der
 * Einrichtung mit Vignetten, Wandschmuck, Pflanzen, Teppichen, Hängendem und Regalinhalt ausgestattet werden. Additives
 * Feld des Projektzustands (`ProjectState.interiorDecor`); fehlt es, ist jede Ausgabe bitgleich zu vorher
 * (Prüfsummen-Netz). Umsetzung: `decorRooms` in `@mcda/pipeline`.
 */
export const INTERIOR_DECORS = ['some', 'rich'] as const;

/** `some` = 1–2 Vignetten je Raum, Wandschmuck, Pflanzen; `rich` = dichter (mehr Hängendes, Regalinhalt, Lichtakzente). */
export type InteriorDecor = (typeof INTERIOR_DECORS)[number];
