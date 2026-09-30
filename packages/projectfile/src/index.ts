/**
 * @mcda/projectfile – Projektdatei der App (`.projekt.json`) als gemeinsame Sprache von App und Engine-API (C1):
 * Format und Versionen, Grenzen, Einstellungen außerhalb der Event-Historie und die Umgebung. Rein (kein I/O).
 * Abhängigkeiten: core, blueprint, catalog, structures, terrain, pipeline – nie app oder engine (kein Zyklus).
 */
export * from './settings.js';
export * from './surroundings.js';
export * from './file.js';
export * from './share.js';
